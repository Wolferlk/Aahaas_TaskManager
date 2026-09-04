/**
 * Additive-only migration runner for the Task Management module.
 *
 * Safety contract:
 *  - Only `CREATE TABLE IF NOT EXISTS \`tm_*\`` statements are accepted.
 *  - Any statement touching a non-tm_ identifier, or containing a destructive
 *    keyword, aborts the whole run before a single query is sent.
 *  - Existing tm_* tables are never altered or dropped; re-running is a no-op.
 */
import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { loadDbConfig } from './db-config.mjs';

const FORBIDDEN = /\b(DROP|TRUNCATE|ALTER|RENAME|DELETE|UPDATE|INSERT|REPLACE|GRANT|REVOKE|FOREIGN_KEY_CHECKS)\b/i;

// Referential-action and timestamp clauses legitimately contain the words
// DELETE / UPDATE; strip them before scanning for destructive verbs.
function stripBenignClauses(stmt) {
  return stmt
    .replace(/ON\s+DELETE\s+(CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT)/gi, '')
    .replace(/ON\s+UPDATE\s+(CASCADE|RESTRICT|NO\s+ACTION|SET\s+NULL|SET\s+DEFAULT|CURRENT_TIMESTAMP)/gi, '');
}

function splitStatements(sql) {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter(Boolean);
}

// Every db/*.sql file, applied in filename order. Each is additive-only.
const sqlDir = path.join(process.cwd(), 'db');
const sqlFiles = fs.readdirSync(sqlDir).filter((f) => f.endsWith('.sql')).sort();
const statements = sqlFiles.flatMap((f) => splitStatements(fs.readFileSync(path.join(sqlDir, f), 'utf8')));

// --- Static verification pass (nothing runs until every statement passes) ---
const problems = [];
for (const stmt of statements) {
  const head = stmt.slice(0, 120).replace(/\s+/g, ' ');
  if (!/^CREATE TABLE IF NOT EXISTS `tm_[a-z0-9_]+`/i.test(stmt)) {
    problems.push(`Not an additive tm_ CREATE TABLE: ${head}`);
    continue;
  }
  if (FORBIDDEN.test(stripBenignClauses(stmt))) {
    problems.push(`Contains a destructive keyword: ${head}`);
  }
  for (const ref of stmt.matchAll(/REFERENCES\s+`([a-z0-9_]+)`/gi)) {
    if (!ref[1].startsWith('tm_')) {
      problems.push(`Foreign key points outside the module: ${ref[1]}`);
    }
  }
}
if (problems.length) {
  console.error('MIGRATION ABORTED — safety checks failed:');
  problems.forEach((p) => console.error('  - ' + p));
  process.exit(1);
}

const cfg = loadDbConfig();
if (!cfg.host || !cfg.database) {
  console.error('Missing database configuration.');
  process.exit(1);
}

const conn = await mysql.createConnection({ ...cfg, multipleStatements: false });

// --- Live verification: snapshot the schema before we touch anything ---
const [before] = await conn.query(
  'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
  [cfg.database]
);
const beforeNames = new Set(before.map((r) => r.TABLE_NAME));
const foreignBefore = [...beforeNames].filter((n) => !n.startsWith('tm_')).sort();

console.log(`Connected to ${cfg.database}@${cfg.host}`);
console.log(`Existing tables: ${beforeNames.size} (non-module: ${foreignBefore.length})`);
console.log(`Applying ${statements.length} additive statements from ${sqlFiles.join(', ')}...\n`);

let created = 0;
let skipped = 0;
for (const stmt of statements) {
  const name = stmt.match(/`(tm_[a-z0-9_]+)`/)[1];
  if (beforeNames.has(name)) {
    skipped++;
    console.log(`  = ${name} (already present, untouched)`);
    continue;
  }
  await conn.query(stmt);
  created++;
  console.log(`  + ${name}`);
}

// --- Post-verification: nothing outside the module may have changed ---
const [after] = await conn.query(
  'SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?',
  [cfg.database]
);
const foreignAfter = [...new Set(after.map((r) => r.TABLE_NAME))]
  .filter((n) => !n.startsWith('tm_'))
  .sort();

const drift =
  foreignBefore.length !== foreignAfter.length ||
  foreignBefore.some((n, i) => n !== foreignAfter[i]);

console.log(`\nCreated: ${created}   Already present: ${skipped}`);
console.log(`Non-module tables before: ${foreignBefore.length}, after: ${foreignAfter.length}`);
console.log(drift ? 'WARNING: non-module table list changed!' : 'Verified: no existing table was added, removed or renamed.');

await conn.end();
process.exit(drift ? 1 : 0);
