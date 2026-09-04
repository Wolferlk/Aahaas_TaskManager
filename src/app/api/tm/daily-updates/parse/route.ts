import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query } from '@/lib/db';
import { parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { parseDailyUpdate } from '@/lib/ai';

const schema = z.object({ text: z.string().trim().min(5, 'Paste your update first.').max(50000) });

/**
 * Turns free-form text into structured work items.
 *
 * Nothing is saved to a task here — the result goes to the review screen and
 * only the user's confirmed edits are persisted. If OpenAI is unavailable the
 * deterministic splitter runs instead and the response says so.
 */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { text } = await parseBody(req, schema);
    const started = Date.now();

    const [projects, openTasks] = await Promise.all([
      query<{ name: string }>("SELECT name FROM tm_projects WHERE deleted_at IS NULL AND status IN ('PLANNING','ACTIVE') LIMIT 60"),
      query<{ id: number; task_number: string; title: string }>(
        `SELECT id, task_number, title FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED')
          ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
      ),
    ]);

    const result = await parseDailyUpdate(text, user.id, {
      projects: projects.map((p) => p.name),
      openTasks,
    });

    // --- Suggest an existing task for each item (never auto-link) ----------
    const items = result.data.items.map((item) => {
      const suggestion = matchExistingTask(item.title, item.description ?? '', openTasks);
      return { ...item, suggested_task: suggestion };
    });

    await execute(
      `INSERT INTO tm_daily_update_ai_parses (user_id, model, input_text, output_json, success, error, duration_ms)
       VALUES (?,?,?,CAST(? AS JSON),?,?,?)`,
      [
        user.id,
        process.env.OPENAI_MODEL || 'gpt-4o-mini',
        text.slice(0, 60000),
        JSON.stringify({ items, narrative: result.data.narrative }),
        result.ok ? 1 : 0,
        result.ok ? null : 'AI unavailable — deterministic fallback used',
        Date.now() - started,
      ],
    );

    return NextResponse.json({
      items,
      // Wrap-up sections ("Main outcomes", "Overall status") are day narrative,
      // not work items — the review screen pre-fills the day detail with them.
      narrative: result.data.narrative,
      ai_used: result.ok,
      fallback: result.fallback,
      message:
        result.message ??
        (result.ok
          ? 'Review each item below. Nothing is saved until you confirm.'
          : 'AI analysis unavailable. Your data has been kept — please review the items below.'),
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Lightweight token-overlap match. The user always confirms before linking. */
function matchExistingTask(
  title: string,
  description: string,
  tasks: Array<{ id: number; task_number: string; title: string }>,
) {
  const stop = new Set(['the', 'and', 'for', 'with', 'from', 'this', 'that', 'was', 'are', 'has', 'have', 'completed', 'started', 'fixed', 'work', 'working']);
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, ' ')
        .split(/\s+/)
        .filter((w) => w.length > 2 && !stop.has(w)),
    );

  const source = tokens(`${title} ${description}`);
  if (!source.size) return null;

  let best: { id: number; task_number: string; title: string; confidence: number } | null = null;
  for (const t of tasks) {
    const target = tokens(t.title);
    if (!target.size) continue;
    let overlap = 0;
    for (const w of target) if (source.has(w)) overlap++;
    const confidence = overlap / Math.min(source.size, target.size);
    if (confidence >= 0.34 && (!best || confidence > best.confidence)) {
      best = { id: t.id, task_number: t.task_number, title: t.title, confidence: Math.round(confidence * 100) / 100 };
    }
  }
  return best;
}
