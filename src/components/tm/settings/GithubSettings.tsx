'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { Github, Plus, Trash2, Link2, CheckCircle2, AlertTriangle, ExternalLink, RefreshCw } from 'lucide-react';
import { fetcher, apiPost, apiPatch, apiDelete, ApiClientError } from '@/lib/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label, Select, FieldHint } from '@/components/ui/Field';
import { Skeleton, EmptyState } from '@/components/ui/Misc';
import { useToast } from '@/components/ui/Toast';
import { useMeta } from '@/hooks/useMeta';
import { timeAgo } from '@/lib/format';

interface LinkedRepo {
  id: number;
  owner: string;
  repo: string;
  default_branch: string | null;
  is_selected: 0 | 1;
  project_id: number | null;
  project_name: string | null;
}

interface AvailableRepo {
  owner: string;
  repo: string;
  full_name: string;
  private: boolean;
  default_branch: string;
  pushed_at: string | null;
  language: string | null;
}

interface GithubData {
  connected: boolean;
  connection?: {
    github_login: string;
    github_name: string | null;
    github_avatar: string | null;
    token_last4: string | null;
    last_synced_at: string | null;
  };
  repos: LinkedRepo[];
  available: AvailableRepo[];
  warning?: string | null;
}

export function GithubSettings() {
  const { data, isLoading, mutate } = useSWR<GithubData>('/api/tm/github', fetcher);
  const { projects } = useMeta();
  const toast = useToast();

  const [token, setToken] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [pickRepo, setPickRepo] = useState('');
  const [pickProject, setPickProject] = useState('');
  const [busy, setBusy] = useState(false);

  const connect = async (e: React.FormEvent) => {
    e.preventDefault();
    setConnecting(true);
    try {
      const res = await apiPost('/api/tm/github', { token: token.trim() });
      toast({ kind: 'success', title: `Connected as ${res.login}` });
      setToken('');
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not connect to GitHub' });
    } finally {
      setConnecting(false);
    }
  };

  const disconnect = async () => {
    if (!confirm('Disconnect GitHub? Your stored token will be deleted.')) return;
    try {
      await apiDelete('/api/tm/github');
      toast({ kind: 'success', title: 'GitHub disconnected' });
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not disconnect' });
    }
  };

  const linkRepo = async () => {
    const repo = data?.available.find((r) => r.full_name === pickRepo);
    if (!repo) return;
    setBusy(true);
    try {
      await apiPatch('/api/tm/github', {
        action: 'link',
        owner: repo.owner,
        repo: repo.repo,
        default_branch: repo.default_branch,
        project_id: pickProject ? Number(pickProject) : null,
      });
      toast({ kind: 'success', title: `${repo.full_name} linked` });
      setPickRepo('');
      setPickProject('');
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not link repository' });
    } finally {
      setBusy(false);
    }
  };

  const update = async (payload: Record<string, unknown>) => {
    try {
      await apiPatch('/api/tm/github', payload);
      mutate();
    } catch (err) {
      toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not update' });
    }
  };

  if (isLoading) return <Skeleton className="h-80" />;

  if (!data?.connected) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Github className="h-4 w-4 text-muted" /> Connect GitHub
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted">
            Link your GitHub account so the platform can read your commits and draft your Daily Update for you.
            Access is read-only — nothing is ever pushed or changed in your repositories.
          </p>

          <form onSubmit={connect} className="mt-4 space-y-3">
            <div>
              <Label htmlFor="gh-token">Personal access token</Label>
              <Input
                id="gh-token"
                type="password"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="ghp_… or github_pat_…"
                autoComplete="off"
                required
              />
              <FieldHint>
                Create one at{' '}
                <a
                  href="https://github.com/settings/tokens"
                  target="_blank"
                  rel="noreferrer"
                  className="text-brand hover:underline"
                >
                  github.com/settings/tokens
                </a>{' '}
                with read access to the repositories you work in (classic: <code>repo</code>). Your token is
                encrypted before it is stored and is never shown again.
              </FieldHint>
            </div>
            <Button type="submit" loading={connecting}>
              <Github className="h-4 w-4" /> Connect GitHub
            </Button>
          </form>
        </CardContent>
      </Card>
    );
  }

  const linkedNames = new Set(data.repos.map((r) => `${r.owner}/${r.repo}`));
  const unlinked = data.available.filter((r) => !linkedNames.has(r.full_name));

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="flex flex-wrap items-center gap-3 p-5">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {data.connection?.github_avatar ? (
            <img
              src={data.connection.github_avatar}
              alt=""
              className="h-11 w-11 rounded-full ring-2 ring-line"
            />
          ) : (
            <div className="flex h-11 w-11 items-center justify-center rounded-full bg-line/50">
              <Github className="h-5 w-5 text-muted" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-ink">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              {data.connection?.github_name ?? data.connection?.github_login}
            </p>
            <p className="text-xs text-muted">
              @{data.connection?.github_login} · token ••••{data.connection?.token_last4}
              {data.connection?.last_synced_at && ` · synced ${timeAgo(data.connection.last_synced_at)}`}
            </p>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => mutate()}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
            <Button size="sm" variant="ghost" className="text-red-500" onClick={disconnect}>
              Disconnect
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.warning && (
        <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-3 text-sm text-amber-700 dark:text-amber-400">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          {data.warning}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-1.5">
            <Link2 className="h-4 w-4 text-muted" /> Tracked repositories
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 pt-0">
          {data.repos.length === 0 ? (
            <EmptyState
              icon={Github}
              title="No repositories tracked yet"
              description="Link the repositories you commit to, and map each one to a project."
            />
          ) : (
            <div className="divide-y divide-line rounded-xl border border-line">
              {data.repos.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center gap-3 p-3">
                  <input
                    type="checkbox"
                    checked={!!r.is_selected}
                    onChange={(e) => update({ action: 'toggle', repo_id: r.id, is_selected: e.target.checked })}
                    className="h-4 w-4 shrink-0 rounded accent-[rgb(var(--brand))]"
                    aria-label={`Include ${r.owner}/${r.repo}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {r.owner}/{r.repo}
                    </p>
                    <p className="text-xs text-faint">{r.default_branch ?? 'default branch'}</p>
                  </div>
                  <Select
                    value={r.project_id ? String(r.project_id) : ''}
                    onChange={(e) =>
                      update({
                        action: 'set_project',
                        repo_id: r.id,
                        project_id: e.target.value ? Number(e.target.value) : null,
                      })
                    }
                    className="!h-8 !w-auto text-xs"
                  >
                    <option value="">No project</option>
                    {projects.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                  <a
                    href={`https://github.com/${r.owner}/${r.repo}`}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-lg p-1.5 text-faint hover:bg-line/30 hover:text-ink"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                  </a>
                  <button
                    onClick={() => update({ action: 'unlink', repo_id: r.id })}
                    className="rounded-lg p-1.5 text-faint hover:bg-red-500/10 hover:text-red-500"
                    aria-label="Unlink"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
            <div className="min-w-[200px] flex-1">
              <Label className="text-xs">Add a repository</Label>
              <Select value={pickRepo} onChange={(e) => setPickRepo(e.target.value)} className="!h-9 text-sm">
                <option value="">Select a repository…</option>
                {unlinked.map((r) => (
                  <option key={r.full_name} value={r.full_name}>
                    {r.full_name}
                    {r.private ? ' (private)' : ''}
                  </option>
                ))}
              </Select>
            </div>
            <div className="min-w-[150px]">
              <Label className="text-xs">Map to project</Label>
              <Select value={pickProject} onChange={(e) => setPickProject(e.target.value)} className="!h-9 text-sm">
                <option value="">No project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </Select>
            </div>
            <Button size="sm" onClick={linkRepo} loading={busy} disabled={!pickRepo}>
              <Plus className="h-3.5 w-3.5" /> Link
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
