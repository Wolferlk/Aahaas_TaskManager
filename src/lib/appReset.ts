import 'server-only';
import { pool, query, type PoolConnection, type RowDataPacket } from './db';
import { buildXlsx, type Cell, type Sheet } from './xlsx';

/**
 * App Data Reset — takes the module back to a clean slate without touching a
 * single person's account.
 *
 * Two rules drive everything here:
 *   1. People and their access are untouchable. Accounts, sessions, password
 *      resets and personal preferences are never read for deletion, so nobody
 *      is signed out and nobody has to register again.
 *   2. Configuration survives, operations do not. Departments, teams, the
 *      settings table, mail routing, integrations and the reference catalogues
 *      (rewards, badges, categories, tags, templates) are what an admin set up
 *      once; tasks, projects, updates, approvals, notifications and logs are
 *      what the app produced while running, and those are what "reset" means.
 *
 * The table list is read from information_schema rather than hard-coded, so a
 * table added later is cleared by default instead of being silently missed.
 */

/** Tables that a reset must never delete from. */
export const PRESERVED_TABLES = [
  // People and access.
  'tm_users',
  'tm_user_sessions',
  'tm_user_preferences',
  'tm_password_resets',
  'tm_login_attempts',
  // Organisation structure.
  'tm_departments',
  'tm_teams',
  'tm_team_members',
  // Configuration and integrations.
  'tm_settings',
  'tm_email_recipients',
  'tm_daily_mail_routes',
  'tm_daily_mail_prefs',
  'tm_github_connections',
  'tm_github_repos',
  // Reference catalogues — definitions, not awarded/used records.
  'tm_rewards',
  'tm_badges',
  'tm_task_categories',
  'tm_task_tags',
  'tm_task_templates',
] as const;

/** Columns that never leave the server, whatever table they sit on. */
const SECRET_COLUMNS = new Set([
  'password_hash',
  'token_hash',
  'access_token',
  'refresh_token',
  'token_cipher',
  'client_secret',
  'webhook_secret',
  'reset_token',
]);

/** Sheets are capped so one runaway table cannot exhaust server memory. */
const MAX_ROWS_PER_SHEET = 50_000;

const PRESERVED = new Set<string>(PRESERVED_TABLES);

export interface TableStat {
  table: string;
  label: string;
  rows: number;
  preserved: boolean;
}

/** "tm_daily_update_items" -> "Daily Update Items" */
export function labelFor(table: string): string {
  return table
    .replace(/^tm_/, '')
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

async function tableNames(): Promise<string[]> {
  const rows = await query<{ TABLE_NAME: string }>(
    `SELECT TABLE_NAME FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_TYPE = 'BASE TABLE' AND TABLE_NAME LIKE 'tm\\_%'
      ORDER BY TABLE_NAME`,
  );
  // mysql2 lower-cases nothing, but column case varies by server config.
  return rows.map((r) => (r.TABLE_NAME ?? (r as unknown as { table_name: string }).table_name));
}

/** Live row counts for every tm_* table, flagged preserved or clearable. */
export async function collectStats(): Promise<TableStat[]> {
  const tables = await tableNames();
  const stats = await Promise.all(
    tables.map(async (table) => {
      const rows = await query<{ c: number }>(`SELECT COUNT(*) AS c FROM \`${table}\``);
      return {
        table,
        label: labelFor(table),
        rows: Number(rows[0]?.c ?? 0),
        preserved: PRESERVED.has(table),
      };
    }),
  );
  return stats;
}

function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (Buffer.isBuffer(value)) return value.toString('utf8').slice(0, 2000);
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 4000);
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  return String(value);
}

async function sheetFor(table: string, rowCap: number): Promise<Sheet> {
  const rows = await query<Record<string, unknown>>(
    `SELECT * FROM \`${table}\` ORDER BY 1 LIMIT ${rowCap}`,
  );
  const columns = rows.length
    ? Object.keys(rows[0]).filter((c) => !SECRET_COLUMNS.has(c))
    : (
        await query<{ COLUMN_NAME: string }>(
          `SELECT COLUMN_NAME FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? ORDER BY ORDINAL_POSITION`,
          [table],
        )
      )
        .map((c) => c.COLUMN_NAME ?? (c as unknown as { column_name: string }).column_name)
        .filter((c) => !SECRET_COLUMNS.has(c));

  return {
    name: labelFor(table),
    columns,
    rows: rows.map((row) => columns.map((c) => toCell(row[c]))),
  };
}

export interface BackupResult {
  buffer: Buffer;
  filename: string;
  sheets: number;
  totalRows: number;
  truncated: string[];
}

/**
 * Builds the workbook: a Summary tab, then one tab per tm_* table — the
 * clearable ones first, since those are the ones about to disappear.
 */
export async function buildBackupWorkbook(
  stats: TableStat[],
  meta: { by: string; reason: 'BACKUP' | 'RESET' },
): Promise<BackupResult> {
  const ordered = [...stats].sort((a, b) => {
    if (a.preserved !== b.preserved) return a.preserved ? 1 : -1;
    return a.label.localeCompare(b.label);
  });

  const truncated: string[] = [];
  const sheets: Sheet[] = [];
  let totalRows = 0;

  for (const stat of ordered) {
    const sheet = await sheetFor(stat.table, MAX_ROWS_PER_SHEET);
    if (stat.rows > MAX_ROWS_PER_SHEET) truncated.push(stat.label);
    totalRows += sheet.rows.length;
    sheets.push(sheet);
  }

  const stamp = new Date();
  const summary: Sheet = {
    name: 'Summary',
    columns: ['Table', 'Tab', 'Rows in database', 'Rows exported', 'Action'],
    rows: ordered.map((s) => [
      s.table,
      s.label,
      s.rows,
      Math.min(s.rows, MAX_ROWS_PER_SHEET),
      s.preserved ? 'Kept — not affected by reset' : reasonLabel(meta.reason),
    ]),
  };
  summary.rows.unshift(
    ['Exported at', stamp.toISOString().replace('T', ' ').slice(0, 19) + ' UTC', null, null, null],
    ['Exported by', meta.by, null, null, null],
    [meta.reason === 'RESET' ? 'Backup taken before' : 'Export type', reasonLabel(meta.reason), null, null, null],
    [null, null, null, null, null],
  );

  const filename = `aahaas-task-manager-${meta.reason === 'RESET' ? 'reset-backup' : 'backup'}-${stamp
    .toISOString()
    .slice(0, 19)
    .replace(/[:T]/g, '-')}.xlsx`;

  return { buffer: buildXlsx([summary, ...sheets]), filename, sheets: sheets.length + 1, totalRows, truncated };
}

function reasonLabel(reason: 'BACKUP' | 'RESET') {
  return reason === 'RESET' ? 'Cleared by app data reset' : 'Data export';
}

export interface ResetResult {
  cleared: Array<{ table: string; rows: number }>;
  preserved: Array<{ table: string; rows: number }>;
  /** Preserved columns that pointed at cleared rows and were set back to NULL. */
  detached: string[];
}

/**
 * A preserved table can hold a foreign key into a cleared one — a GitHub repo
 * linked to a project, for instance. Once the project rows are gone that id
 * points at nothing, so every nullable column of that shape is set back to
 * NULL. Anything non-nullable is reported rather than guessed at.
 */
async function detachDanglingReferences(
  cx: PoolConnection,
  clearedTables: string[],
): Promise<string[]> {
  if (!clearedTables.length) return [];

  const [rows] = await cx.query<RowDataPacket[]>(
    `SELECT k.TABLE_NAME AS child, k.COLUMN_NAME AS col, c.IS_NULLABLE AS nullable
       FROM information_schema.KEY_COLUMN_USAGE k
       JOIN information_schema.COLUMNS c
         ON c.TABLE_SCHEMA = k.TABLE_SCHEMA AND c.TABLE_NAME = k.TABLE_NAME AND c.COLUMN_NAME = k.COLUMN_NAME
      WHERE k.TABLE_SCHEMA = DATABASE()
        AND k.REFERENCED_TABLE_NAME IS NOT NULL
        AND k.TABLE_NAME IN (?)
        AND k.REFERENCED_TABLE_NAME IN (?)`,
    [[...PRESERVED_TABLES], clearedTables],
  );

  const detached: string[] = [];
  for (const row of rows) {
    const child = String(row.child);
    const col = String(row.col);
    if (String(row.nullable).toUpperCase() !== 'YES') continue;
    await cx.query(`UPDATE \`${child}\` SET \`${col}\` = NULL WHERE \`${col}\` IS NOT NULL`);
    detached.push(`${child}.${col}`);
  }
  return detached;
}

/**
 * Empties every clearable table on a single connection with foreign key checks
 * suspended, so the order of deletion never matters. TRUNCATE also restarts
 * AUTO_INCREMENT, which is what makes the app feel genuinely new — task #1 is
 * task #1 again.
 */
export async function wipeOperationalData(stats: TableStat[]): Promise<ResetResult> {
  const clearable = stats.filter((s) => !s.preserved);
  const cx = await pool.getConnection();
  try {
    await cx.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const stat of clearable) {
      await cx.query(`TRUNCATE TABLE \`${stat.table}\``);
    }
    const detached = await detachDanglingReferences(cx, clearable.map((s) => s.table));
    return {
      cleared: clearable.map((s) => ({ table: s.table, rows: s.rows })),
      preserved: stats.filter((s) => s.preserved).map((s) => ({ table: s.table, rows: s.rows })),
      detached,
    };
  } finally {
    // Restored on the same connection even if a TRUNCATE threw, before the
    // connection goes back into the shared pool.
    await cx.query('SET FOREIGN_KEY_CHECKS = 1').catch(() => {});
    cx.release();
  }
}
