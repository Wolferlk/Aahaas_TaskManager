/**
 * Backfill for tasks created before team resolution was fixed.
 *
 * Tasks used to inherit only the creator's team, so anything raised by someone
 * without a team was stored with team_id NULL. Every team-scoped view (the
 * Leader portal, team boards, team task counts) filters on team_id, so those
 * tasks were invisible to the people responsible for them.
 *
 * This sets team_id from the assignee's team — their profile team first, then
 * their active membership row — and never touches a task that already has one
 * or that is marked personal. Re-running is a no-op.
 *
 * Pass --dry to report what would change without writing.
 */
import mysql from 'mysql2/promise';
import { loadDbConfig } from './db-config.mjs';

const dry = process.argv.includes('--dry');

const OWNER_TEAM = `
  COALESCE((SELECT u.team_id FROM tm_users u WHERE u.id = t.assignee_id),
           (SELECT m.team_id FROM tm_team_members m
             WHERE m.user_id = t.assignee_id AND m.is_active = 1
             ORDER BY (m.role_in_team = 'LEADER') DESC, m.team_id LIMIT 1))`;

const TARGET = `
  FROM tm_tasks t
 WHERE t.deleted_at IS NULL AND t.team_id IS NULL AND t.is_personal = 0
   AND ${OWNER_TEAM} IS NOT NULL`;

const conn = await mysql.createConnection(loadDbConfig());
try {
  // Resolve the pairs first: MySQL will not let an UPDATE subquery read the
  // table being written, and an explicit list keeps the write auditable.
  const [pairs] = await conn.query(`SELECT t.id, ${OWNER_TEAM} AS team_id ${TARGET}`);

  if (pairs.length === 0) {
    console.log('Nothing to backfill: every non-personal task already has a team.');
  } else if (dry) {
    const byTeam = pairs.reduce((acc, p) => ({ ...acc, [p.team_id]: (acc[p.team_id] ?? 0) + 1 }), {});
    console.log(`Dry run: ${pairs.length} task(s) would be given a team_id.`);
    console.table(Object.entries(byTeam).map(([team_id, tasks]) => ({ team_id, tasks })));
  } else {
    let done = 0;
    for (const { id, team_id } of pairs) {
      const [res] = await conn.query(
        'UPDATE tm_tasks SET team_id = ? WHERE id = ? AND team_id IS NULL',
        [team_id, id],
      );
      done += res.affectedRows;
    }
    console.log(`Backfilled ${done} task(s) with their assignee's team.`);
  }

  // The responsible leader is derived from the team, so refresh it in step.
  if (!dry && pairs.length > 0) {
    const [res2] = await conn.query(
      `UPDATE tm_tasks t JOIN tm_teams tm ON tm.id = t.team_id
          SET t.leader_id = tm.leader_user_id
        WHERE t.deleted_at IS NULL AND t.leader_id IS NULL AND tm.leader_user_id IS NOT NULL`,
    );
    console.log(`Set leader_id on ${res2.affectedRows} task(s).`);
  }
} finally {
  await conn.end();
}
