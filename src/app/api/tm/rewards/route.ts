import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { audit, requirePermission, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { leaderboard } from '@/lib/performance';
import { explainReward } from '@/lib/ai';
import { notify } from '@/lib/notifications';

/**
 * Monthly Power Reward.
 *
 * Winners are chosen by measurable metrics only. AI writes the explanation
 * afterwards, and a Manager still has to approve every assignment.
 */
export async function GET(req: Request) {
  try {
    await requireUser();
    const sp = searchParams(req);
    const now = new Date();
    const year = Number(sp.get('year')) || now.getFullYear();
    const month = Number(sp.get('month')) || now.getMonth() + 1;

    const [assignments, board, catalogue] = await Promise.all([
      query(
        `SELECT ra.*, r.code, r.name AS reward_name, r.icon, r.description,
                u.full_name, u.avatar_url, u.job_title,
                d.name AS department_name, t.name AS team_name,
                ap.full_name AS approved_by_name
           FROM tm_reward_assignments ra
           JOIN tm_rewards r ON r.id = ra.reward_id
           JOIN tm_users u ON u.id = ra.user_id
           LEFT JOIN tm_departments d ON d.id = u.department_id
           LEFT JOIN tm_teams t ON t.id = u.team_id
           LEFT JOIN tm_users ap ON ap.id = ra.approved_by
          WHERE ra.period_year = ? AND ra.period_month = ?
          ORDER BY FIELD(ra.status,'APPROVED','PROPOSED','REJECTED'), r.code`,
        [year, month],
      ),
      leaderboard(year, month, 20),
      query('SELECT * FROM tm_rewards WHERE is_active = 1 ORDER BY id'),
    ]);

    return NextResponse.json({ period: { year, month }, assignments, leaderboard: board, rewards: catalogue });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const PICKERS: Record<string, (m: Record<string, number>) => number> = {
  TOP_PERFORMER: () => 0, // handled by score
  DEADLINE_MASTER: (m) => m.deadline_met_rate,
  BEST_TEAM_PLAYER: (m) => m.comments_made,
  MOST_CONSISTENT: (m) => m.active_days,
  PROBLEM_SOLVER: (m) => m.tasks_completed - m.blocked_tasks,
  HIGH_IMPACT: (m) => m.critical_completed,
  BEST_IMPROVEMENT: () => 0, // handled by delta
};

/** Proposes winners for a period. Nothing is awarded until a Manager approves. */
export async function POST(req: Request) {
  try {
    const user = await requirePermission('tm.reward.approve');
    const body = (await req.json()) as { year?: number; month?: number };
    const now = new Date();
    const year = body.year ?? now.getFullYear();
    const month = body.month ?? now.getMonth() + 1;

    const board = await leaderboard(year, month, 100);
    if (!board.length) {
      return NextResponse.json({ ok: true, proposed: 0, message: 'No recorded activity for this period yet.' });
    }

    const rewards = await query<{ id: number; code: string; name: string; metric_key: string | null }>(
      'SELECT id, code, name, metric_key FROM tm_rewards WHERE is_active = 1',
    );

    let proposed = 0;
    for (const reward of rewards) {
      let winner = board[0];
      let value = winner.score;

      if (reward.code === 'TOP_PERFORMER') {
        winner = board[0];
        value = winner.score;
      } else if (reward.code === 'BEST_IMPROVEMENT') {
        // Improvement needs the previous month for comparison.
        const prevMonth = month === 1 ? 12 : month - 1;
        const prevYear = month === 1 ? year - 1 : year;
        const prev = await leaderboard(prevYear, prevMonth, 100);
        const prevMap = new Map(prev.map((p) => [p.id, p.score]));
        const ranked = board
          .map((r) => ({ ...r, delta: r.score - (prevMap.get(r.id) ?? 0) }))
          .filter((r) => prevMap.has(r.id))
          .sort((a, b) => b.delta - a.delta);
        if (!ranked.length || ranked[0].delta <= 0) continue;
        winner = ranked[0];
        value = Math.round(ranked[0].delta * 10) / 10;
      } else {
        const pick = PICKERS[reward.code];
        if (!pick) continue;
        const ranked = board
          .map((r) => ({ ...r, metric: pick(r.metrics as unknown as Record<string, number>) }))
          .sort((a, b) => b.metric - a.metric);
        if (!ranked.length || ranked[0].metric <= 0) continue;
        winner = ranked[0];
        value = Math.round(ranked[0].metric * 10) / 10;
      }

      const reason = `Highest ${reward.name.toLowerCase()} metric for the period (${value}).`;
      const explanation = await explainReward(user.id, winner.full_name, reward.name, {
        score: winner.score,
        tasks_completed: winner.metrics.tasks_completed,
        deadline_met_rate: Math.round(winner.metrics.deadline_met_rate),
        critical_completed: winner.metrics.critical_completed,
        metric_value: value,
      });

      await execute(
        `INSERT INTO tm_reward_assignments
           (reward_id, user_id, period_year, period_month, points, metric_value, reason, ai_explanation, status)
         VALUES (?,?,?,?,?,?,?,?, 'PROPOSED')
         ON DUPLICATE KEY UPDATE
           points = VALUES(points), metric_value = VALUES(metric_value),
           reason = VALUES(reason), ai_explanation = VALUES(ai_explanation)`,
        [reward.id, winner.id, year, month, winner.points, value, reason, explanation.data],
      );
      proposed++;
    }

    await audit(user.id, 'REWARDS_PROPOSED', 'REWARD', null, null, { year, month, proposed });
    return NextResponse.json({
      ok: true,
      proposed,
      message: `${proposed} reward(s) proposed from recorded metrics. Approve the ones you want to publish.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}

export async function PATCH(req: Request) {
  try {
    const user = await requirePermission('tm.reward.approve');
    const body = (await req.json()) as { id?: number; decision?: 'APPROVED' | 'REJECTED' };
    if (!body.id || !body.decision) {
      return NextResponse.json({ error: 'Pick a reward and a decision.' }, { status: 400 });
    }

    await execute(
      'UPDATE tm_reward_assignments SET status = ?, approved_by = ?, approved_at = NOW() WHERE id = ?',
      [body.decision, user.id, body.id],
    );

    if (body.decision === 'APPROVED') {
      const rows = await query<{ user_id: number; reward_name: string }>(
        `SELECT ra.user_id, r.name AS reward_name FROM tm_reward_assignments ra
           JOIN tm_rewards r ON r.id = ra.reward_id WHERE ra.id = ?`,
        [body.id],
      );
      if (rows[0]) {
        await notify({
          userId: rows[0].user_id,
          type: 'REWARD_AWARDED',
          title: `You earned ${rows[0].reward_name}`,
          body: 'Congratulations — see the details on the Rewards page.',
          link: '/tm/rewards',
          actorId: user.id,
          priority: 'HIGH',
        });
      }
    }

    await audit(user.id, `REWARD_${body.decision}`, 'REWARD_ASSIGNMENT', body.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
