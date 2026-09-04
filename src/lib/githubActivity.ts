import 'server-only';
import { execute, query } from './db';
import { enrichCommit, getToken, listCommits, type GithubCommit } from './github';
import { itemsFromCommits, type CommitInput, type ParsedItem } from './ai';

/**
 * One day of a developer's GitHub activity, turned into draft work items.
 *
 * This is the single implementation behind both entry points: the Import from
 * GitHub button on the Daily Update screen, and the unattended 22:00 sweep that
 * files an update for anyone who did not submit one. Keeping them on the same
 * function is what makes an auto-filed update indistinguishable in content from
 * one the developer imported themselves.
 *
 * Nothing here writes a task or a daily update — it only reads GitHub and
 * caches the commits it saw.
 */

export interface ActivityCommit {
  sha: string;
  short_sha: string;
  message: string;
  repo: string;
  html_url: string;
  committed_at: string;
  additions: number | null;
  deletions: number | null;
  files_changed: number | null;
}

export type DraftedItem = ParsedItem & {
  project_id: number | null;
  links?: Array<{ label: string; url: string }>;
};

export interface GithubDayResult {
  connected: boolean;
  date: string;
  commits: ActivityCommit[];
  items: DraftedItem[];
  repos: string[];
  errors: string[];
  ai_used: boolean;
  message: string;
  metrics: {
    commits: number;
    repos: string[];
    additions: number;
    deletions: number;
    files_changed: number;
    first_commit_at: string | null;
    last_commit_at: string | null;
  };
}

const emptyMetrics = (repos: string[] = []) => ({
  commits: 0,
  repos,
  additions: 0,
  deletions: 0,
  files_changed: 0,
  first_commit_at: null,
  last_commit_at: null,
});

/**
 * @param opts.projectId  Restrict to the repositories mapped to one project.
 * @param opts.enrichLimit How many commits get a second call for line stats.
 */
export async function collectGithubDay(
  userId: number,
  date: string,
  opts: { projectId?: string | null; enrichLimit?: number } = {},
): Promise<GithubDayResult> {
  const creds = await getToken(userId);
  if (!creds) {
    return {
      connected: false,
      date,
      commits: [],
      items: [],
      repos: [],
      errors: [],
      ai_used: false,
      message: 'Connect your GitHub account in Settings first.',
      metrics: emptyMetrics(),
    };
  }

  let repos = await query<{
    id: number;
    owner: string;
    repo: string;
    default_branch: string | null;
    project_id: number | null;
    project_name: string | null;
  }>(
    `SELECT r.id, r.owner, r.repo, r.default_branch, r.project_id, p.name AS project_name
       FROM tm_github_repos r
       LEFT JOIN tm_projects p ON p.id = r.project_id
      WHERE r.user_id = ? AND r.is_selected = 1`,
    [userId],
  );

  if (opts.projectId) repos = repos.filter((r) => String(r.project_id) === opts.projectId);

  if (!repos.length) {
    return {
      connected: true,
      date,
      commits: [],
      items: [],
      repos: [],
      errors: [],
      ai_used: false,
      message: 'No repositories selected yet. Link some in Settings → GitHub.',
      metrics: emptyMetrics(),
    };
  }

  // The day in the user's local window, sent to GitHub as an inclusive range.
  const since = new Date(`${date}T00:00:00`).toISOString();
  const until = new Date(`${date}T23:59:59.999`).toISOString();

  const errors: string[] = [];
  const collected: GithubCommit[] = [];

  await Promise.all(
    repos.map(async (r) => {
      try {
        // GitHub matches `author` on login or email; login covers the common case.
        const commits = await listCommits(creds.token, r.owner, r.repo, {
          author: creds.login,
          since,
          until,
        });
        collected.push(...commits);
      } catch (err) {
        errors.push(`${r.owner}/${r.repo}: ${err instanceof Error ? err.message : 'failed'}`);
      }
    }),
  );

  // Line-change stats make the drafted items far more accurate; cap the calls.
  const enrichLimit = opts.enrichLimit ?? 30;
  const enriched = await Promise.all(
    collected
      .sort((a, b) => a.committed_at.localeCompare(b.committed_at))
      .map((c, i) => (i < enrichLimit ? enrichCommit(creds.token, c) : Promise.resolve(c))),
  );

  const repoProject = new Map(repos.map((r) => [`${r.owner}/${r.repo}`, r]));
  const repoNames = repos.map((r) => `${r.owner}/${r.repo}`);

  // Cache the commits so the same day is not re-fetched and so an imported
  // update can be traced back to real activity.
  for (const c of enriched) {
    const meta = repoProject.get(`${c.owner}/${c.repo}`);
    await execute(
      `INSERT INTO tm_github_activity
         (user_id, repo_id, owner, repo, commit_sha, message, additions, deletions, files_changed,
          html_url, committed_at, activity_date)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE message = VALUES(message), additions = VALUES(additions),
                               deletions = VALUES(deletions), files_changed = VALUES(files_changed)`,
      [
        userId,
        meta?.id ?? null,
        c.owner,
        c.repo,
        c.sha,
        c.message.slice(0, 4000),
        c.additions ?? null,
        c.deletions ?? null,
        c.files_changed ?? null,
        c.html_url,
        new Date(c.committed_at),
        date,
      ],
    );
  }

  await execute('UPDATE tm_github_connections SET last_synced_at = NOW() WHERE user_id = ?', [userId]);

  const commits: ActivityCommit[] = enriched.map((c) => ({
    sha: c.sha,
    short_sha: c.sha.slice(0, 7),
    message: c.message.split('\n')[0],
    repo: `${c.owner}/${c.repo}`,
    html_url: c.html_url,
    committed_at: c.committed_at,
    additions: c.additions ?? null,
    deletions: c.deletions ?? null,
    files_changed: c.files_changed ?? null,
  }));

  const metrics = {
    commits: enriched.length,
    repos: [...new Set(enriched.map((c) => `${c.owner}/${c.repo}`))],
    additions: enriched.reduce((s, c) => s + (c.additions ?? 0), 0),
    deletions: enriched.reduce((s, c) => s + (c.deletions ?? 0), 0),
    files_changed: enriched.reduce((s, c) => s + (c.files_changed ?? 0), 0),
    first_commit_at: enriched[0]?.committed_at ?? null,
    last_commit_at: enriched[enriched.length - 1]?.committed_at ?? null,
  };

  if (!enriched.length) {
    return {
      connected: true,
      date,
      commits: [],
      items: [],
      repos: repoNames,
      errors,
      ai_used: false,
      message: `No commits found for ${date} across ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.`,
      metrics: emptyMetrics(repoNames),
    };
  }

  const [projects, openTasks] = await Promise.all([
    query<{ name: string }>(
      "SELECT name FROM tm_projects WHERE deleted_at IS NULL AND status IN ('PLANNING','ACTIVE') LIMIT 60",
    ),
    query<{ task_number: string; title: string }>(
      `SELECT task_number, title FROM tm_tasks
        WHERE assignee_id = ? AND deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED')
        ORDER BY updated_at DESC LIMIT 40`,
      [userId],
    ),
  ]);

  const commitInput: CommitInput[] = enriched.map((c) => ({
    sha: c.sha,
    message: c.message,
    owner: c.owner,
    repo: c.repo,
    committed_at: c.committed_at,
    additions: c.additions,
    deletions: c.deletions,
    files_changed: c.files_changed,
    project_name: repoProject.get(`${c.owner}/${c.repo}`)?.project_name ?? null,
  }));

  const drafted = await itemsFromCommits(commitInput, userId, {
    projects: projects.map((p) => p.name),
    openTasks,
  });

  // Attach each drafted item to a project when its repo maps to one.
  const projectByName = new Map(
    (await query<{ id: number; name: string }>('SELECT id, name FROM tm_projects WHERE deleted_at IS NULL')).map((p) => [
      p.name.toLowerCase(),
      p.id,
    ]),
  );

  const commitUrl = new Map(enriched.map((c) => [c.sha.slice(0, 7), c.html_url]));

  const items: DraftedItem[] = drafted.data.map((item) => ({
    ...item,
    project_id: item.project ? (projectByName.get(item.project.toLowerCase()) ?? null) : null,
    // Keep a resolvable link per grouped commit so the saved detail can be
    // opened straight from the update months later.
    links: (item.commit_shas ?? [])
      .map((sha) => ({ label: sha, url: commitUrl.get(sha) ?? '' }))
      .filter((l) => l.url),
  }));

  return {
    connected: true,
    date,
    commits,
    items,
    repos: repoNames,
    errors,
    ai_used: drafted.ok,
    message:
      drafted.message ??
      `Drafted ${items.length} work item${items.length === 1 ? '' : 's'} from ${enriched.length} commit${
        enriched.length === 1 ? '' : 's'
      }. Review before saving.`,
    metrics,
  };
}
