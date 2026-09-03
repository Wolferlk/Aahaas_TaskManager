import mysql, { type Pool, type PoolConnection, type RowDataPacket, type ResultSetHeader } from 'mysql2/promise';

/**
 * Single shared pool for the Task Management module.
 *
 * Every query in this module targets a `tm_*` table. Nothing here reads or
 * writes the Operations System's own tables.
 */
declare global {
  // eslint-disable-next-line no-var
  var __tmPool: Pool | undefined;
}

function unquote(v: string | undefined) {
  if (!v) return v;
  const t = v.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1);
  return t;
}

function createPool(): Pool {
  return mysql.createPool({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USERNAME,
    password: unquote(process.env.DB_PASSWORD),
    database: process.env.DB_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    namedPlaceholders: false,
  });
}

export const pool: Pool = global.__tmPool ?? createPool();
if (process.env.NODE_ENV !== 'production') global.__tmPool = pool;

export async function query<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T[]> {
  const [rows] = await pool.query(sql, params);
  return rows as T[];
}

export async function queryOne<T = RowDataPacket>(sql: string, params: unknown[] = []): Promise<T | null> {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
}

export async function execute(sql: string, params: unknown[] = []): Promise<ResultSetHeader> {
  const [res] = await pool.query(sql, params);
  return res as ResultSetHeader;
}

/** Runs a unit of work inside a transaction, rolling back on any throw. */
export async function transaction<T>(fn: (cx: PoolConnection) => Promise<T>): Promise<T> {
  const cx = await pool.getConnection();
  try {
    await cx.beginTransaction();
    const out = await fn(cx);
    await cx.commit();
    return out;
  } catch (err) {
    await cx.rollback();
    throw err;
  } finally {
    cx.release();
  }
}

export type { RowDataPacket, ResultSetHeader, PoolConnection };
