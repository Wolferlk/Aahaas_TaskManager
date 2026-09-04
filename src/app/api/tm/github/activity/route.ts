import { NextResponse } from 'next/server';
import { execute, query } from '@/lib/db';
import { badRequest, requireUser, searchParams, toErrorResponse } from '@/lib/api';
import { enrichCommit, getToken, listCommits, type GithubCommit } from '@/lib/github';
import { itemsFromCommits, type CommitInput } from '@/lib/ai';

/**
 * Pulls the signed-in developer's commits for one day across their selected
 * repositories and drafts daily work items from them.
 *
 * Nothing is saved as a task here — the drafts go to the review screen, and
 * only what the developer confirms is written. This is the "review before
 * submit" step the module requires for every AI-assisted flow.
 */
export async function GET(req: Request) {
  try {
    const user = await requireUser();
    const sp = searchParams(req);

    const date = sp.get('date') ?? new Date().toISOString().slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw badRequest('Pick a valid date.');

    const creds = await getToken(user.id);
    if (!creds) {
      return NextResponse.json(
        { connected: false, error: 'Connect your GitHub account in Settings first.' },
        { status: 400 },
      );
    }

    let repos = await query<{ id: number; owner: string; repo: string; default_branch: string | null; project_id: number | null; project_name: string | null }>(
      `SELECT r.id, r.owner, r.repo, r.default_branch, r.project_id, p.name AS project_name
         FROM tm_github_repos r
         LEFT JOIN tm_projects p ON p.id = r.project_id
        WHERE r.user_id = ? AND r.is_selected = 1`,
      [user.id],
    );

    // Allow a one-off scope override, e.g. "only this project's repos".
    const projectFilter = sp.get('project_id');
    if (projectFilter) repos = repos.filter((r) => String(r.project_id) === projectFilter);

    if (!repos.length) {
      return NextResponse.json({
        connected: true,
        commits: [],
        items: [],
        repos: [],
        message: 'No repositories selected yet. Link some in Settings → GitHub.',
      });
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
    const enriched = await Promise.all(
      collected
        .sort((a, b) => a.committed_at.localeCompare(b.committed_at))
        .map((c, i) => (i < 30 ? enrichCommit(creds.token, c) : Promise.resolve(c))),
    );

    const repoProject = new Map(repos.map((r) => [`${r.owner}/${r.repo}`, r]));

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
          user.id,
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

    await execute('UPDATE tm_github_connections SET last_synced_at = NOW() WHERE user_id = ?', [user.id]);

    if (!enriched.length) {
      return NextResponse.json({
        connected: true,
        commits: [],
        items: [],
        repos: repos.map((r) => `${r.owner}/${r.repo}`),
        errors,
        message: `No commits found for ${date} across ${repos.length} repositor${repos.length === 1 ? 'y' : 'ies'}.`,
      });
    }

    const [projects, openTasks] = await Promise.all([
      query<{ name: string }>("SELECT name FROM tm_projects WHERE deleted_at IS NULL AND status IN ('PLANNING','ACTIVE') LIMIT 60"),
      query<{ task_number: string; title: string }>(
        `SELECT task_number, title FROM tm_tasks
          WHERE assignee_id = ? AND deleted_at IS NULL AND status NOT IN ('COMPLETED','CANCELLED')
          ORDER BY updated_at DESC LIMIT 40`,
        [user.id],
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

    const drafted = await itemsFromCommits(commitInput, user.id, {
      projects: projects.map((p) => p.name),
      openTasks,
    });

    // Attach each drafted item to a project when its repo maps to one.
    const projectByName = new Map(
      (
        await query<{ id: number; name: string }>('SELECT id, name FROM tm_projects WHERE deleted_at IS NULL')
      ).map((p) => [p.name.toLowerCase(), p.id]),
    );

    const items = drafted.data.map((item) => ({
      ...item,
      project_id: item.project ? (projectByName.get(item.project.toLowerCase()) ?? null) : null,
    }));

    return NextResponse.json({
      connected: true,
      date,
      commits: enriched.map((c) => ({
        sha: c.sha,
        short_sha: c.sha.slice(0, 7),
        message: c.message.split('\n')[0],
        repo: `${c.owner}/${c.repo}`,
        html_url: c.html_url,
        committed_at: c.committed_at,
        additions: c.additions ?? null,
        deletions: c.deletions ?? null,
        files_changed: c.files_changed ?? null,
      })),
      items,
      repos: repos.map((r) => `${r.owner}/${r.repo}`),
      errors,
      ai_used: drafted.ok,
      message:
        drafted.message ??
        `Drafted ${items.length} work item${items.length === 1 ? '' : 's'} from ${enriched.length} commit${enriched.length === 1 ? '' : 's'}. Review before saving.`,
    });
  } catch (err) {
    return toErrorResponse(err);
  }
}
