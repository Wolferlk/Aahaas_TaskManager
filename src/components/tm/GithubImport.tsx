'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Github, Sparkles, GitCommit, RefreshCw, AlertTriangle, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react';
import { fetcher, ApiClientError } from '@/lib/client';
import { Card, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Field';
import { useToast } from '@/components/ui/Toast';
import { fmtDateTime } from '@/lib/format';

export interface ImportedItem {
  title: string;
  description: string | null;
  status: string;
  priority: string;
  progress: number;
  hours: number | null;
  work_type: string | null;
  project: string | null;
  project_id: number | null;
  tags: string[];
  confidence: number;
  ai_generated_fields: string[];
}

interface Commit {
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

interface ActivityResponse {
  connected: boolean;
  commits: Commit[];
  items: ImportedItem[];
  repos: string[];
  errors?: string[];
  ai_used?: boolean;
  message?: string;
  error?: string;
}

/**
 * Pulls a developer's commits for a chosen day and hands the drafted work items
 * to the caller's review list. Nothing is saved from here — the daily update
 * screen still owns the confirm-and-save step.
 */
export function GithubImport({
  date,
  onImported,
}: {
  date: string;
  onImported: (items: ImportedItem[], meta: { commits: number; aiUsed: boolean }) => void;
}) {
  const [day, setDay] = useState(date);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ActivityResponse | null>(null);
  const [showCommits, setShowCommits] = useState(false);
  const [notConnected, setNotConnected] = useState(false);
  const toast = useToast();

  const load = async () => {
    setLoading(true);
    setResult(null);
    setNotConnected(false);
    try {
      const res: ActivityResponse = await fetcher(`/api/tm/github/activity?date=${day}`);
      setResult(res);
      if (res.items.length) {
        onImported(res.items, { commits: res.commits.length, aiUsed: !!res.ai_used });
      }
    } catch (err) {
      if (err instanceof ApiClientError && err.status === 400) {
        setNotConnected(true);
      } else {
        toast({ kind: 'error', title: err instanceof ApiClientError ? err.message : 'Could not reach GitHub.' });
      }
    } finally {
      setLoading(false);
    }
  };

  if (notConnected) {
    return (
      <Card className="border-brand/25 bg-brand-soft/25">
        <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
          <div className="flex items-center gap-3">
            <Github className="h-5 w-5 text-brand" />
            <div>
              <p className="text-sm font-medium text-ink">Connect GitHub first</p>
              <p className="text-xs text-muted">
                Link your account and pick repositories, then your commits can draft this update.
              </p>
            </div>
          </div>
          <Link href="/tm/settings?tab=github">
            <Button size="sm">Open GitHub settings</Button>
          </Link>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <Label htmlFor="gh-date" className="text-xs">
              Day to import
            </Label>
            <Input
              id="gh-date"
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              className="!h-9 !w-auto text-sm"
            />
          </div>
          <Button onClick={load} loading={loading}>
            <Github className="h-4 w-4" /> Pull my commits
          </Button>
          {result && (
            <Button variant="ghost" size="sm" onClick={load} loading={loading}>
              <RefreshCw className="h-3.5 w-3.5" /> Refresh
            </Button>
          )}
        </div>

        {result?.message && (
          <div
            className={`flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-sm ${
              result.items.length
                ? 'bg-brand-soft text-brand'
                : 'bg-line/40 text-muted'
            }`}
          >
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{result.message}</span>
          </div>
        )}

        {!!result?.errors?.length && (
          <div className="flex items-start gap-2 rounded-xl bg-amber-500/10 px-3.5 py-2.5 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              {result.errors.map((e) => (
                <p key={e}>{e}</p>
              ))}
            </div>
          </div>
        )}

        {!!result?.commits.length && (
          <div>
            <button
              onClick={() => setShowCommits((v) => !v)}
              className="flex items-center gap-1.5 text-sm font-medium text-brand"
            >
              {showCommits ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
              {result.commits.length} commit{result.commits.length === 1 ? '' : 's'} across{' '}
              {result.repos.length} repositor{result.repos.length === 1 ? 'y' : 'ies'}
            </button>

            {showCommits && (
              <div className="mt-2 max-h-64 space-y-1.5 overflow-y-auto rounded-xl border border-line p-2">
                {result.commits.map((c) => (
                  <a
                    key={c.sha}
                    href={c.html_url}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-start gap-2.5 rounded-lg px-2 py-1.5 hover:bg-line/25"
                  >
                    <GitCommit className="mt-0.5 h-3.5 w-3.5 shrink-0 text-faint" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-ink">{c.message}</p>
                      <p className="text-[11px] text-faint">
                        {c.repo} · {c.short_sha} · {fmtDateTime(c.committed_at)}
                        {c.additions !== null && ` · +${c.additions}/-${c.deletions ?? 0}`}
                      </p>
                    </div>
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-faint" />
                  </a>
                ))}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
