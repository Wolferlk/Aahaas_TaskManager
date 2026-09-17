import crypto from 'node:crypto';
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { ApiError, audit, badRequest, forbidden, parseBody, requirePermission, toErrorResponse } from '@/lib/api';
import { buildBackupWorkbook, collectStats, labelFor, wipeOperationalData } from '@/lib/appReset';

/** Building the workbook and truncating ~35 tables can outrun the default budget. */
export const maxDuration = 300;
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  mode: z.enum(['backup', 'reset']),
  reset_code: z.string().min(1, 'Enter the reset password to continue.'),
  confirm: z.string().optional(),
});

const CONFIRM_PHRASE = 'RESET ALL DATA';

/**
 * The reset password lives in TM_RESET_CODE, never in the database and never in
 * a response. Without it configured the endpoint refuses outright rather than
 * falling back to "no password required".
 */
function checkResetCode(supplied: string) {
  const expected = process.env.TM_RESET_CODE;
  if (!expected) {
    throw new ApiError(503, 'Data export and reset are disabled until TM_RESET_CODE is configured on the server.');
  }
  const a = Buffer.from(supplied);
  const b = Buffer.from(expected);
  // Constant-time, and length-padded so the comparison itself leaks nothing.
  const equal = a.length === b.length && crypto.timingSafeEqual(a, b);
  if (!equal) throw badRequest('That reset password is not correct.');
}

/** Preview: what a reset would clear and what it would keep. */
export async function GET() {
  try {
    await requirePermission('tm.settings.manage');
    const stats = await collectStats();
    return NextResponse.json({
      confirm_phrase: CONFIRM_PHRASE,
      // Whether the code exists, never the code itself.
      reset_code_configured: !!process.env.TM_RESET_CODE,
      cleared: stats.filter((s) => !s.preserved),
      preserved: stats.filter((s) => s.preserved),
      total_cleared_rows: stats.filter((s) => !s.preserved).reduce((n, s) => n + s.rows, 0),
      total_preserved_rows: stats.filter((s) => s.preserved).reduce((n, s) => n + s.rows, 0),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Exports the workbook and, in `reset` mode, clears the operational tables.
 *
 * The export is always built *before* anything is deleted and the deletion only
 * runs once the workbook bytes are in hand, so a failed export leaves the data
 * untouched. The response body is the .xlsx itself — the browser saves it the
 * moment the reset succeeds, which is the only copy of what was removed.
 */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.settings.manage');
    if (user.role !== 'MANAGER') throw forbidden('Only a Manager can export or reset app data.');

    const body = await parseBody(req, bodySchema);

    // This endpoint is reachable with nothing but a session cookie and it is the
    // most destructive one in the module, so a Manager session alone is not
    // enough — the reset password has to be supplied every time.
    checkResetCode(body.reset_code);

    if (body.mode === 'reset' && body.confirm?.trim().toUpperCase() !== CONFIRM_PHRASE) {
      throw badRequest(`Type "${CONFIRM_PHRASE}" to confirm.`);
    }

    const stats = await collectStats();
    const backup = await buildBackupWorkbook(stats, {
      by: `${user.full_name} <${user.email}>`,
      reason: body.mode === 'reset' ? 'RESET' : 'BACKUP',
    });

    let clearedRows = 0;
    let clearedTables = 0;
    let detached: string[] = [];

    if (body.mode === 'reset') {
      const result = await wipeOperationalData(stats);
      clearedTables = result.cleared.length;
      clearedRows = result.cleared.reduce((n, t) => n + t.rows, 0);
      detached = result.detached;
    }

    // Written after the wipe on purpose — tm_audit_logs is one of the cleared
    // tables, so an entry made beforehand would not survive its own reset.
    await audit(user.id, body.mode === 'reset' ? 'APP_DATA_RESET' : 'APP_DATA_EXPORTED', 'SYSTEM', null, null, {
      tables_cleared: clearedTables,
      rows_cleared: clearedRows,
      rows_exported: backup.totalRows,
      sheets: backup.sheets,
      detached,
      truncated_sheets: backup.truncated,
    });

    const summary = {
      mode: body.mode,
      tables_cleared: clearedTables,
      rows_cleared: clearedRows,
      rows_exported: backup.totalRows,
      sheets: backup.sheets,
      truncated_sheets: backup.truncated,
      detached: detached.map(labelFor),
    };

    return new NextResponse(new Uint8Array(backup.buffer), {
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': `attachment; filename="${backup.filename}"`,
        'Content-Length': String(backup.buffer.length),
        'Cache-Control': 'no-store',
        // The body is binary, so the outcome rides along in a header the
        // client reads to render its confirmation.
        'X-Reset-Summary': JSON.stringify(summary),
      },
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
