/**
 * One-off repairs for rows written before the matching bug was fixed.
 *
 * The code fixes only change what happens from now on. These three passes bring
 * existing rows in line with them. Every pass is idempotent — re-running is a
 * no-op — and `--dry` reports what would change without writing anything.
 *
 *   node scripts/repair-data.mjs --dry
 *   node scripts/repair-data.mjs
 *
 * 1. Tasks sitting in REVIEW with no TASK_COMPLETION approval row. They were
 *    submitted through the status dropdown, which used to move the task without
 *    raising a request, so the Approval Center never heard about them.
 * 2. tm_projects.progress / health, recomputed from the projects' own tasks.
 * 3. Task leader_id, refreshed from whatever team the task carries.
 *
 * Giving team-less tasks a team is a separate, larger rewrite — see
 * scripts/backfill-task-teams.mjs.
 */
import mysql from 'mysql2/promise';
import { loadDbConfig } from './db-config.mjs';

const dry = process.argv.includes('--dry');
const conn = await mysql.createConnection(loadDbConfig());

const say = (msg) => console.log(`${dry ? '[dry] ' : ''}${msg}`);

try {
  /* 1 — REVIEW tasks with no pending completion request ------------------- */

  const [orphans] = await conn.query(
    `SELECT t.id, t.task_number, t.title, t.assignee_id, t.created_by, t.status,
            COALESCE(tm.leader_user_id, t.created_by) AS reviewer_id
       FROM tm_tasks t
       LEFT JOIN tm_teams tm ON tm.id = t.team_id AND tm.deleted_at IS NULL
      WHERE t.deleted_at IS NULL AND t.status = 'REVIEW'
        AND NOT EXISTS (SELECT 1 FROM tm_approval_requests a
                         WHERE a.type = 'TASK_COMPLETION' AND a.entity_type = 'TASK'
                           AND a.entity_id = t.id AND a.status = 'PENDING')`,
  );

  if (!orphans.length) {
    say('Completion approvals: nothing to raise — every task in review already has a request.');
  } else {
    say(`Completion approvals: ${orphans.length} task(s) in review with no request.`);
    console.table(orphans.map((t) => ({ task: t.task_number, title: t.title.slice(0, 40) })));
    if (!dry) {
      for (const t of orphans) {
        await conn.query(
          `INSERT INTO tm_approval_requests
             (type, requester_id, assigned_to, entity_type, entity_id, payload, reason, status)
           VALUES ('TASK_COMPLETION', ?, ?, 'TASK', ?, CAST(? AS JSON), ?, 'PENDING')`,
          [
            t.assignee_id ?? t.created_by,
            t.reviewer_id,
            t.id,
            JSON.stringify({ submitted_from: 'REVIEW', raised_by: 'repair-data' }),
            `Completion review for ${t.title}`.slice(0, 500),
          ],
        );
      }
      say(`Raised ${orphans.length} completion request(s).`);
    }
  }

  /* 2 — project progress and health --------------------------------------- */

  const [projects] = await conn.query(
    `SELECT p.id, p.name, p.progress AS stored_progress,
            COUNT(t.id) AS total,
            COALESCE(SUM(t.status = 'COMPLETED'), 0) AS completed
       FROM tm_projects p
       LEFT JOIN tm_tasks t ON t.project_id = p.id AND t.deleted_at IS NULL AND t.status <> 'CANCELLED'
      WHERE p.deleted_at IS NULL
      GROUP BY p.id, p.name, p.progress`,
  );

  const drifted = projects
    .map((p) => ({
      ...p,
      fresh: Number(p.total) ? Math.round((Number(p.completed) / Number(p.total)) * 100) : 0,
    }))
    .filter((p) => p.fresh !== Number(p.stored_progress));

  if (!drifted.length) {
    say('Project progress: every stored percentage already matches its tasks.');
  } else {
    say(`Project progress: ${drifted.length} project(s) out of date.`);
    console.table(drifted.map((p) => ({ project: p.name, stored: p.stored_progress, recomputed: p.fresh })));
    if (!dry) {
      for (const p of drifted) {
        await conn.query('UPDATE tm_projects SET progress = ? WHERE id = ?', [p.fresh, p.id]);
      }
      say(`Updated ${drifted.length} project percentage(s).`);
    }
  }

  /* 3 — leader_id on tasks that carry a team ------------------------------ */

  const [[{ c: staleLeaders }]] = await conn.query(
    `SELECT COUNT(*) AS c FROM tm_tasks t
       JOIN tm_teams tm ON tm.id = t.team_id
      WHERE t.deleted_at IS NULL AND t.leader_id IS NULL AND tm.leader_user_id IS NOT NULL`,
  );

  if (!staleLeaders) {
    say('Task leaders: nothing to set.');
  } else if (dry) {
    say(`Task leaders: ${staleLeaders} task(s) would get their team's leader.`);
  } else {
    const [res] = await conn.query(
      `UPDATE tm_tasks t JOIN tm_teams tm ON tm.id = t.team_id
          SET t.leader_id = tm.leader_user_id
        WHERE t.deleted_at IS NULL AND t.leader_id IS NULL AND tm.leader_user_id IS NOT NULL`,
    );
    say(`Task leaders: set on ${res.affectedRows} task(s).`);
  }
} finally {
  await conn.end();
}
