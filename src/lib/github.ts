import 'server-only';
import { queryOne } from './db';
import { decryptSecret } from './crypto';

/**
 * GitHub read-only integration.
 *
 * A developer connects a fine-grained or classic PAT with `repo` (or public
 * `repo:status`) read scope. The module only ever reads — it lists repositories
 * and commits so a Daily Update can be drafted from real work. Nothing is
 * written back to GitHub.
 */

const API = 'https://api.github.com';

export interface GithubIdentity {
  login: string;
  name: string | null;
  avatar_url: string | null;
  emails: string[];
}

export interface GithubRepo {
  owner: string;
  repo: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  language: string | null;
}

export interface GithubCommit {
  sha: string;
  message: string;
  html_url: string;
  committed_at: string;
  owner: string;
  repo: string;
  additions?: number;
  deletions?: number;
  files_changed?: number;
}

async function gh<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'aahaas-task-management',
      ...(init?.headers ?? {}),
    },
    cache: 'no-store',
  });

  if (!res.ok) {
    let message = `GitHub request failed (${res.status})`;
    if (res.status === 401) message = 'GitHub rejected this token. Generate a new one and reconnect.';
    else if (res.status === 403) {
      message = res.headers.get('x-ratelimit-remaining') === '0'
        ? 'GitHub rate limit reached. Try again shortly.'
        : 'This token does not have access to that resource.';
    } else if (res.status === 404) message = 'Not found, or the token cannot see this repository.';
    else {
      const text = await res.text().catch(() => '');
      try {
        const parsed = JSON.parse(text) as { message?: string };
        if (parsed.message) message = parsed.message;
      } catch {
        /* keep the generic message */
      }
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

/** Validates a token and returns the identity it belongs to. */
export async function verifyToken(token: string): Promise<GithubIdentity> {
  const user = await gh<{ login: string; name: string | null; avatar_url: string | null }>(token, '/user');

  let emails: string[] = [];
  try {
    const list = await gh<Array<{ email: string; verified: boolean }>>(token, '/user/emails');
    emails = list.filter((e) => e.verified).map((e) => e.email);
  } catch {
    // user:email scope is optional — commit matching falls back to the login.
  }

  return { login: user.login, name: user.name, avatar_url: user.avatar_url, emails };
}

export async function getToken(userId: number): Promise<{ token: string; login: string; emails: string[] } | null> {
  const row = await queryOne<{ token_cipher: string; github_login: string; github_emails: string | null }>(
    'SELECT token_cipher, github_login, github_emails FROM tm_github_connections WHERE user_id = ? AND is_active = 1',
    [userId],
  );
  if (!row) return null;
  try {
    return {
      token: decryptSecret(row.token_cipher),
      login: row.github_login,
      emails: row.github_emails ? (JSON.parse(row.github_emails) as string[]) : [],
    };
  } catch (err) {
    console.error('[tm] could not decrypt GitHub token:', err);
    return null;
  }
}

/** Repositories the token can see, most recently pushed first. */
export async function listRepos(token: string): Promise<GithubRepo[]> {
  const rows = await gh<
    Array<{
      name: string;
      full_name: string;
      private: boolean;
      default_branch: string;
      pushed_at: string | null;
      language: string | null;
      owner: { login: string };
    }>
  >(token, '/user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member');

  return rows.map((r) => ({
    owner: r.owner.login,
    repo: r.name,
    full_name: r.full_name,
    private: r.private,
    default_branch: r.default_branch,
    pushed_at: r.pushed_at,
    language: r.language,
  }));
}

/**
 * Commits authored by `author` in one repository within a date window.
 * `since`/`until` are ISO strings; GitHub treats them as inclusive bounds.
 */
export async function listCommits(
  token: string,
  owner: string,
  repo: string,
  opts: { author?: string; since: string; until: string; branch?: string },
): Promise<GithubCommit[]> {
  const params = new URLSearchParams({ since: opts.since, until: opts.until, per_page: '100' });
  if (opts.author) params.set('author', opts.author);
  if (opts.branch) params.set('sha', opts.branch);

  let rows: Array<{ sha: string; html_url: string; commit: { message: string; author: { date: string } } }>;
  try {
    rows = await gh(token, `/repos/${owner}/${repo}/commits?${params}`);
  } catch (err) {
    // An empty repository returns 409; treat it as "no activity" rather than failing the sync.
    if (err instanceof Error && /\(409\)/.test(err.message)) return [];
    throw err;
  }

  return rows.map((c) => ({
    sha: c.sha,
    message: c.commit.message,
    html_url: c.html_url,
    committed_at: c.commit.author.date,
    owner,
    repo,
  }));
}

/** Adds line-change stats to a commit. Best-effort — never throws. */
export async function enrichCommit(token: string, commit: GithubCommit): Promise<GithubCommit> {
  try {
    const detail = await gh<{
      stats?: { additions: number; deletions: number };
      files?: Array<unknown>;
    }>(token, `/repos/${commit.owner}/${commit.repo}/commits/${commit.sha}`);
    return {
      ...commit,
      additions: detail.stats?.additions,
      deletions: detail.stats?.deletions,
      files_changed: detail.files?.length,
    };
  } catch {
    return commit;
  }
}

/** Commit subjects only, with merge/noise commits dropped. */
export function meaningfulSubjects(commits: GithubCommit[]): string[] {
  return commits
    .map((c) => c.message.split('\n')[0].trim())
    .filter((m) => m && !/^(merge (branch|pull request)|revert |bump version|wip$)/i.test(m));
}
