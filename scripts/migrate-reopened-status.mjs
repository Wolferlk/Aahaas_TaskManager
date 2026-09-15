/**
 * One-off migration: add 'REOPENED' to the `tm_tasks`.`status` ENUM.
 *
 * The main runner (`npm run db:migrate`) is additive-only and refuses ALTER by
 * design, so this widening lives in its own script. It is idempotent: if the
 * enum already carries REOPENED the script exits without touching the table.
 * Widening an ENUM with an extra value rewrites no rows and preserves the
 * existing ones, so this is safe to run against live data.
 */
import mysql from 'mysql2/promise';
import { loadDbConfig } from './db-config.mjs';

const TARGET_ENUM =
  "ENUM('DRAFT','TODO','IN_PROGRESS','REOPENED','BLOCKED','WAITING','REVIEW','COMPLETED','REJECTED','CANCELLED')";

const conn = await mysql.createConnection(loadDbConfig());
try {
  const [rows] = await conn.query(
    `SELECT COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tm_tasks' AND COLUMN_NAME = 'status'`,
  );

  if (rows.length === 0) {
    console.error('tm_tasks.status not found — run `npm run db:migrate` first.');
    process.exit(1);
  }

  const current = String(rows[0].COLUMN_TYPE);
  if (/'REOPENED'/i.test(current)) {
    console.log('Already migrated: tm_tasks.status already allows REOPENED.');
  } else {
    await conn.query(`ALTER TABLE \`tm_tasks\` MODIFY COLUMN \`status\` ${TARGET_ENUM} NOT NULL DEFAULT 'TODO'`);
    console.log("Added 'REOPENED' to tm_tasks.status.");
  }
} finally {
  await conn.end();
}
