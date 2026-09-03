// READ-ONLY inspection. Lists existing tables so we can guarantee no name clash.
import mysql from 'mysql2/promise';
import { loadDbConfig } from './db-config.mjs';

const cfg = loadDbConfig();
const conn = await mysql.createConnection(cfg);
const [rows] = await conn.query(
  `SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES
   WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME`, [cfg.database]);
console.log(`Database: ${cfg.database} @ ${cfg.host}`);
console.log(`Total tables: ${rows.length}`);
const tm = rows.filter(r => r.TABLE_NAME.startsWith('tm_'));
console.log(`Existing tm_* tables: ${tm.length}`);
if (tm.length) console.log(tm.map(r => '  ' + r.TABLE_NAME + ' (' + r.TABLE_ROWS + ' rows)').join('\n'));
console.log('--- all tables ---');
console.log(rows.map(r => r.TABLE_NAME).join(', '));
await conn.end();
