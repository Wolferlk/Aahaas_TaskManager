import { NextResponse } from 'next/server';
import { z } from 'zod';
import { execute, query, queryOne } from '@/lib/db';
import { audit, badRequest, parseBody, requireUser, toErrorResponse } from '@/lib/api';
import { encryptSecret } from '@/lib/crypto';
import { getToken, listRepos, verifyToken } from '@/lib/github';

/** Connection status plus the repositories this developer has linked. */
export async function GET() {
  try {
    const user = await requireUser();

    const connection = await queryOne<{
      github_login: string;
      github_name: string | null;
      github_avatar: string | null;
      token_last4: string | null;
      last_synced_at: string | null;
      created_at: string;
    }>(
      `SELECT github_login, github_name, github_avatar, token_last4, last_synced_at, created_at
         FROM tm_github_connections WHERE user_id = ? AND is_active = 1`,
      [user.id],
    );

    if (!connection) return NextResponse.json({ connected: false, repos: [], available: [] });

    const repos = await query(
      `SELECT r.*, p.name AS project_name, p.code AS project_code
         FROM tm_github_repos r
         LEFT JOIN tm_projects p ON p.id = r.project_id
        WHERE r.user_id = ? ORDER BY r.owner, r.repo`,
      [user.id],
    );

    // The live repo list is best-effort; a revoked token should still render the page.
    let available: unknown[] = [];
    let warning: string | null = null;
    try {
      const creds = await getToken(user.id);
      if (creds) available = await listRepos(creds.token);
    } catch (err) {
      warning = err instanceof Error ? err.message : 'Could not reach GitHub.';
    }

    return NextResponse.json({ connected: true, connection, repos, available, warning });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const connectSchema = z.object({
  token: z.string().trim().min(20, 'That does not look like a GitHub token.').max(500),
});

/** Connects (or re-connects) the signed-in user's GitHub account with a PAT. */
export async function POST(req: Request) {
  try {
    const user = await requireUser();
    const { token } = await parseBody(req, connectSchema);

    // GitHub's own rejection message is the useful one here — surface it as a
    // 400 rather than letting it fall through to a generic 500.
    let identity;
    try {
      identity = await verifyToken(token);
    } catch (err) {
      throw badRequest(err instanceof Error ? err.message : 'Could not verify that token with GitHub.');
    }

    await execute(
      `INSERT INTO tm_github_connections
         (user_id, github_login, github_name, github_avatar, github_emails, token_cipher, token_last4, is_active)
       VALUES (?,?,?,?,?,?,?,1)
       ON DUPLICATE KEY UPDATE
         github_login = VALUES(github_login), github_name = VALUES(github_name),
         github_avatar = VALUES(github_avatar), github_emails = VALUES(github_emails),
         token_cipher = VALUES(token_cipher), token_last4 = VALUES(token_last4), is_active = 1`,
      [
        user.id,
        identity.login,
        identity.name,
        identity.avatar_url,
        JSON.stringify(identity.emails),
        encryptSecret(token),
        token.slice(-4),
      ],
    );

    // The token itself is never audited — only the identity it resolved to.
    await audit(user.id, 'GITHUB_CONNECTED', 'USER', user.id, null, { login: identity.login });

    return NextResponse.json({ ok: true, login: identity.login, name: identity.name });
  } catch (err) {
    return toErrorResponse(err);
  }
}

const repoSchema = z.object({
  action: z.enum(['link', 'unlink', 'set_project', 'toggle']),
  owner: z.string().trim().max(120).optional(),
  repo: z.string().trim().max(160).optional(),
  default_branch: z.string().trim().max(120).nullable().optional(),
  repo_id: z.coerce.number().int().positive().optional(),
  project_id: z.coerce.number().int().positive().nullable().optional(),
  is_selected: z.boolean().optional(),
});

export async function PATCH(req: Request) {
  try {
    const user = await requireUser();
    const body = await parseBody(req, repoSchema);

    switch (body.action) {
      case 'link': {
        if (!body.owner || !body.repo) throw badRequest('Pick a repository.');
        await execute(
          `INSERT INTO tm_github_repos (user_id, project_id, owner, repo, default_branch, is_selected)
           VALUES (?,?,?,?,?,1)
           ON DUPLICATE KEY UPDATE project_id = VALUES(project_id), is_selected = 1,
                                   default_branch = VALUES(default_branch)`,
          [user.id, body.project_id ?? null, body.owner, body.repo, body.default_branch ?? null],
        );
        break;
      }
      case 'unlink': {
        if (!body.repo_id) throw badRequest('Missing repository.');
        await execute('DELETE FROM tm_github_repos WHERE id = ? AND user_id = ?', [body.repo_id, user.id]);
        break;
      }
      case 'set_project': {
        if (!body.repo_id) throw badRequest('Missing repository.');
        await execute('UPDATE tm_github_repos SET project_id = ? WHERE id = ? AND user_id = ?', [
          body.project_id ?? null,
          body.repo_id,
          user.id,
        ]);
        break;
      }
      case 'toggle': {
        if (!body.repo_id) throw badRequest('Missing repository.');
        await execute('UPDATE tm_github_repos SET is_selected = ? WHERE id = ? AND user_id = ?', [
          body.is_selected ? 1 : 0,
          body.repo_id,
          user.id,
        ]);
        break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}

/** Disconnects GitHub and destroys the stored token. */
export async function DELETE() {
  try {
    const user = await requireUser();
    await execute('DELETE FROM tm_github_connections WHERE user_id = ?', [user.id]);
    await execute('DELETE FROM tm_github_repos WHERE user_id = ?', [user.id]);
    await audit(user.id, 'GITHUB_DISCONNECTED', 'USER', user.id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return toErrorResponse(err);
  }
}
