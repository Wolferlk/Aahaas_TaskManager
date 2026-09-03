import { NextResponse } from 'next/server';
import { execute, queryOne } from '@/lib/db';
import { forbidden, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { computeMetrics, getWeights, leaderboard, scoreFromMetrics } from '@/lib/performance';
import { interpretPerformance } from '@/lib/ai';
import { teamMemberIds } from '@/lib/tasks';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export async function GET(req: Request) {
  try {
    const me = await requireUser();
    const sp = searchParams(req);
    const now = new Date();

    const year = Number(sp.get('year')) || now.getFullYear();
    const month = Number(sp.get('month')) || now.getMonth() + 1;
    const targetId = Number(sp.get('user_id')) || me.id;

    if (targetId !== me.id) {
      if (me.role === 'MANAGER') {
        // Managers may view anyone.
      } else if (me.role === 'LEADER') {
        const members = await teamMemberIds(me.id);
        if (!members.includes(targetId)) throw forbidden('You can only view your own team.');
      } else {
        throw forbidden('You can only view your own performance.');
      }
    }

    const [metrics, weights, target] = await Promise.all([
      computeMetrics(targetId, year, month),
      getWeights(),
      queryOne<{ full_name: string; avatar_url: string | null; job_title: string | null }>(
        'SELECT full_name, avatar_url, job_title FROM tm_users WHERE id = ?',
        [targetId],
      ),
    ]);

    const { score, lines } = scoreFromMetrics(metrics, weights);

    // Previous month, for the trend arrow.
    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const prevMetrics = await computeMetrics(targetId, prevYear, prevMonth);
    const prevScore = scoreFromMetrics(prevMetrics, weights).score;

    const stored = await queryOne<{ ai_analysis: string | null }>(
      'SELECT ai_analysis FROM tm_performance_snapshots WHERE user_id = ? AND period_year = ? AND period_month = ?',
      [targetId, year, month],
    );

    return NextResponse.json({
      user: { id: targetId, ...target },
      period: { year, month, label: `${MONTHS[month - 1]} ${year}` },
      metrics,
      score,
      previous_score: prevScore,
      delta: Math.round((score - prevScore) * 10) / 10,
      breakdown: lines,
      weights,
      ai_analysis: stored?.ai_analysis ? JSON.parse(stored.ai_analysis) : null,
      leaderboard_visible: me.role !== 'EMPLOYEE' || true,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/**
 * Generates the AI narrative for a period and stores the snapshot.
 * The metrics are calculated first and handed to the model — it interprets
 * numbers, it never produces them.
 */
export async function POST(req: Request) {
  try {
    const me = await requireUser();
    const body = (await req.json()) as { user_id?: number; year?: number; month?: number };
    const now = new Date();
    const year = body.year ?? now.getFullYear();
    const month = body.month ?? now.getMonth() + 1;
    const targetId = body.user_id ?? me.id;

    if (targetId !== me.id && me.role === 'EMPLOYEE') {
      throw forbidden('You can only generate your own analysis.');
    }

    const [metrics, weights, target] = await Promise.all([
      computeMetrics(targetId, year, month),
      getWeights(),
      queryOne<{ full_name: string }>('SELECT full_name FROM tm_users WHERE id = ?', [targetId]),
    ]);
    const { score } = scoreFromMetrics(metrics, weights);

    const analysis = await interpretPerformance(
      me.id,
      target?.full_name ?? 'This person',
      `${MONTHS[month - 1]} ${year}`,
      metrics as unknown as Record<string, number>,
    );

    await execute(
      `INSERT INTO tm_performance_snapshots (user_id, period_year, period_month, metrics, score, ai_analysis)
       VALUES (?,?,?,CAST(? AS JSON),?,?)
       ON DUPLICATE KEY UPDATE metrics = VALUES(metrics), score = VALUES(score),
                               ai_analysis = VALUES(ai_analysis), generated_at = NOW()`,
      [targetId, year, month, JSON.stringify(metrics), score, JSON.stringify(analysis.data)],
    );

    return NextResponse.json({
      ok: true,
      analysis: analysis.data,
      ai_used: analysis.ok,
      message: analysis.ok
        ? 'Analysis generated from your recorded metrics.'
        : 'AI analysis unavailable. The summary below is calculated directly from your metrics.',
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
