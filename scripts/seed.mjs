/**
 * Idempotent seeder. Every write is an INSERT ... ON DUPLICATE KEY UPDATE id=id
 * (a true no-op on re-run) or an existence check first, so running this twice
 * never overwrites data a real user has since changed.
 */
import crypto from 'node:crypto';
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import { loadDbConfig } from './db-config.mjs';

const conn = await mysql.createConnection(loadDbConfig());
const log = (m) => console.log('  ' + m);

async function insertIgnore(table, cols, rows) {
  if (!rows.length) return;
  const placeholders = '(' + cols.map(() => '?').join(',') + ')';
  const sql = `INSERT INTO \`${table}\` (${cols.map((c) => `\`${c}\``).join(',')})
               VALUES ${rows.map(() => placeholders).join(',')}
               ON DUPLICATE KEY UPDATE \`${cols[0]}\` = VALUES(\`${cols[0]}\`)`;
  await conn.query(sql, rows.flat());
}

console.log('Seeding Task Management reference data...');

// --- Departments -----------------------------------------------------------
await insertIgnore('tm_departments', ['code', 'name', 'description', 'color'], [
  ['OPS', 'Operations', 'Day to day operational delivery', '#6366f1'],
  ['ACC', 'Accounts', 'Finance, invoicing and reconciliation', '#10b981'],
  ['IT', 'IT', 'Engineering, infrastructure and internal tools', '#3b82f6'],
  ['BKG', 'Booking', 'Booking desk and reservations', '#f59e0b'],
  ['CX', 'Customer Experience', 'Customer support and experience', '#ec4899'],
  ['TX', 'Travel Experience', 'Travel product and experience design', '#14b8a6'],
  ['GRD', 'Ground Operations', 'On-ground execution and transport', '#f97316'],
  ['MKT', 'Marketing', 'Brand, campaigns and growth', '#a855f7'],
  ['MGT', 'Management', 'Leadership and administration', '#64748b'],
]);
log('departments');

// --- Task categories -------------------------------------------------------
await insertIgnore('tm_task_categories', ['name', 'color'], [
  ['Development', '#3b82f6'], ['Bug Fix', '#ef4444'], ['Operations', '#6366f1'],
  ['Reporting', '#10b981'], ['Client Request', '#f59e0b'], ['Meeting', '#8b5cf6'],
  ['Documentation', '#14b8a6'], ['Testing', '#ec4899'], ['Deployment', '#f97316'],
  ['Research', '#64748b'],
]);
log('task categories');

// --- Rewards ---------------------------------------------------------------
await insertIgnore('tm_rewards', ['code', 'name', 'description', 'icon', 'metric_key'], [
  ['TOP_PERFORMER', 'Top Performer', 'Highest overall performance score for the month', 'trophy', 'score'],
  ['DEADLINE_MASTER', 'Deadline Master', 'Highest deadline reliability across completed work', 'timer', 'deadline_reliability'],
  ['BEST_TEAM_PLAYER', 'Best Team Player', 'Strongest collaboration through comments and reviews', 'users', 'collaboration'],
  ['MOST_CONSISTENT', 'Most Consistent', 'Most consistent daily delivery across the month', 'activity', 'consistency'],
  ['PROBLEM_SOLVER', 'Problem Solver', 'Cleared the most blocked and critical work', 'wrench', 'blockers_cleared'],
  ['HIGH_IMPACT', 'High Impact Contributor', 'Completed the most critical-priority tasks', 'zap', 'critical_completed'],
  ['BEST_IMPROVEMENT', 'Best Improvement', 'Largest month-over-month score improvement', 'trending-up', 'improvement'],
]);
log('reward categories');

// --- Badges ----------------------------------------------------------------
await insertIgnore('tm_badges', ['code', 'name', 'description', 'icon', 'tier', 'rule_key', 'rule_threshold'], [
  ['FIRST_10', 'First 10 Tasks', 'Completed your first 10 tasks', 'star', 'BRONZE', 'tasks_completed', 10],
  ['HUNDRED', '100 Tasks Completed', 'Completed 100 tasks', 'award', 'GOLD', 'tasks_completed', 100],
  ['ZERO_OVERDUE', 'Zero Overdue Month', 'Finished a full month with no overdue task', 'shield', 'SILVER', 'zero_overdue_month', 1],
  ['DEADLINE_MASTER_B', 'Deadline Master', 'Met 95% of deadlines in a month', 'timer', 'GOLD', 'deadline_rate', 95],
  ['FAST_RESOLVER', 'Fast Resolver', 'Average completion well inside estimate', 'zap', 'SILVER', 'fast_resolver', 1],
  ['CRITICAL_FIXER', 'Critical Fixer', 'Completed 10 critical priority tasks', 'flame', 'GOLD', 'critical_completed', 10],
  ['CONSISTENCY', 'Consistency Streak', '14 day delivery streak', 'activity', 'SILVER', 'streak_days', 14],
  ['UPDATES_30', '30 Daily Updates', 'Submitted 30 daily updates', 'calendar-check', 'SILVER', 'daily_updates', 30],
  ['TEAM_PLAYER', 'Team Player', 'Left 50 helpful comments', 'users', 'BRONZE', 'comments', 50],
  ['PROJECT_FINISHER', 'Project Finisher', 'Saw a project through to completion', 'flag', 'PLATINUM', 'projects_completed', 1],
]);
log('achievement badges');

// --- Settings --------------------------------------------------------------
const settings = [
  ['performance_weights', JSON.stringify({
    completion: 25, deadline_reliability: 20, quality: 20,
    consistency: 15, collaboration: 10, daily_updates: 10,
  }), 'Weights used by the transparent performance score (must total 100)'],
  ['deadline_alerts', JSON.stringify({ days: [3, 1], hours: [3], on_due: true, on_overdue: true }),
    'When deadline notifications fire'],
  ['leaderboard', JSON.stringify({ visible: true }), 'Show the internal leaderboard to non-managers'],
  ['ai', JSON.stringify({ enabled: true, model: 'gpt-4o-mini' }), 'AI assistance configuration'],
  ['email_notifications', JSON.stringify({ enabled: false }), 'Outbound email is off until explicitly approved'],
];
for (const [k, v, d] of settings) {
  await conn.query(
    'INSERT INTO tm_settings (setting_key, value, description) VALUES (?, CAST(? AS JSON), ?) ON DUPLICATE KEY UPDATE setting_key = setting_key',
    [k, v, d]
  );
}
log('system settings');

// --- Default manager account (never overwrites an existing one) ------------
const MANAGER_EMAIL = 'sasi@aahaas.com';
const [[existing]] = await conn.query('SELECT id, role, status FROM tm_users WHERE email = ?', [MANAGER_EMAIL]);
if (existing) {
  log(`manager account already exists (id ${existing.id}) — left untouched`);
} else {
  const [[mgtDept]] = await conn.query("SELECT id FROM tm_departments WHERE code = 'MGT'");
  const hash = bcrypt.hashSync('sasi123#', 12);
  const [res] = await conn.query(
    `INSERT INTO tm_users (uuid, full_name, email, password_hash, role, requested_role, status,
       department_id, job_title, availability, approved_at, must_change_password)
     VALUES (?,?,?,?,'MANAGER','MANAGER','ACTIVE',?,?, 'AVAILABLE', NOW(), 0)`,
    [crypto.randomUUID(), 'Sasindu Diluranga', MANAGER_EMAIL, hash, mgtDept?.id ?? null, 'Operations Manager']
  );
  await conn.query('INSERT INTO tm_user_preferences (user_id) VALUES (?) ON DUPLICATE KEY UPDATE user_id = user_id', [res.insertId]);
  log(`manager account created: ${MANAGER_EMAIL} (change this password after first login)`);
}

console.log('Seed complete.');
await conn.end();
