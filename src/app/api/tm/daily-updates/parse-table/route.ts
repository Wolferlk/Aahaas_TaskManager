import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query } from '@/lib/db';
import { badRequest, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { itemsFromTableRows } from '@/lib/ai';
import { suggestTaskForItem } from '@/lib/dailyUpdates';
import { groupRowsByDate, parseTableRows, MAX_TABLE_ROWS } from '@/lib/tableUpdates';

const schema = z.object({
  text: z.string().trim().min(3, 'Paste your table first.').max(120000),
  /** How to read 09/07/2026 — settled from the paste itself unless overridden. */
  date_order: z.enum(['AUTO', 'DMY', 'MDY']).default('AUTO'),
  /** The day a row with no date of its own belongs to. */
  fallback_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.').optional(),
});

/**
 * Turns a pasted tracker table into dated, fully written-up work items.
 *
 * Splitting the grid is deterministic (`parseTableRows`) — the same paste always
 * yields the same rows, dates and statuses. The model is asked only to write
 * each terse row up in full, and every row survives even when it is unavailable.
 *
 * Nothing is saved here. The rows come back grouped into the days they would be
 * recorded as, and only what the user confirms on the review screen is written.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, schema);
    const started = Date.now();

    const parsed = parseTableRows(body.text, {
      dateOrder: body.date_order,
      fallbackDate: body.fallback_date,
    });

    if (!parsed.rows.length) {
      throw badRequest(
        parsed.rejected.length
          ? `No rows could be recorded. ${parsed.rejected[0].reason}`
          : 'No task rows were found in that paste. Each row needs at least a line of work on it.',
      );
    }

    const [projects, openTasks] = await Promise.all([
      query<{ name: string }>(
        "SELECT name FROM tm_projects WHERE deleted_at IS NULL AND status IN ('PLANNING','ACTIVE') LIMIT 60",
      ),
      query<{ id: number; task_number: string; title: string }>(
        `SELECT id, task_number, title FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED')
          ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
      ),
    ]);

    const result = await itemsFromTableRows(
      user.id,
      parsed.rows.map((row, n) => ({
        n,
        date: row.date,
        text: row.text,
        notes: row.notes,
        status: row.status,
      })),
      { projects: projects.map((p) => p.name) },
    );

    // An existing task is suggested per item, never linked — the review screen
    // still owns that decision, exactly as it does for a free-form paste.
    const items = result.data.map(({ row, ...item }) => ({
      ...item,
      source_row: {
        index: parsed.rows[row.n]?.index ?? null,
        raw_date: parsed.rows[row.n]?.raw_date ?? null,
        raw_status: parsed.rows[row.n]?.raw_status ?? null,
        dated: parsed.rows[row.n]?.dated ?? false,
        line: parsed.rows[row.n]?.line ?? row.text,
      },
      date: row.date,
      suggested_task: suggestTaskForItem(item.title, item.description ?? '', openTasks),
    }));

    const days = groupRowsByDate(items).map((day) => ({ date: day.date, items: day.rows }));

    await execute(
      `INSERT INTO tm_daily_update_ai_parses (user_id, model, input_text, output_json, success, error, duration_ms)
       VALUES (?,?,?,CAST(? AS JSON),?,?,?)`,
      [
        user.id,
        process.env.OPENAI_MODEL || 'gpt-4o-mini',
        body.text.slice(0, 60000),
        JSON.stringify({ days, date_order: parsed.date_order }),
        result.ok ? 1 : 0,
        result.ok ? null : 'AI unavailable — rows written up deterministically',
        Date.now() - started,
      ],
    );

    return NextResponse.json({
      days,
      total_items: items.length,
      date_order: parsed.date_order,
      // True when nothing in the paste could say which of day/month comes
      // first, so the review screen offers the reader that choice.
      ambiguous: parsed.ambiguous,
      order_reason: parsed.order_reason,
      rejected: parsed.rejected,
      skipped: parsed.skipped.slice(0, 20),
      max_rows: MAX_TABLE_ROWS,
      ai_used: result.ok,
      fallback: result.fallback,
      message: result.message,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
