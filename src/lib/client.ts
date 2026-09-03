'use client';

export class ApiClientError extends Error {
  status: number;
  code?: string;
  issues?: unknown;
  constructor(status: number, message: string, code?: string, issues?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

async function handle(res: Response) {
  const isJson = res.headers.get('content-type')?.includes('application/json');
  const body = isJson ? await res.json().catch(() => ({})) : null;
  if (!res.ok) {
    throw new ApiClientError(res.status, body?.error ?? 'Something went wrong. Please try again.', body?.code, body?.issues);
  }
  return body;
}

export const fetcher = (url: string) => fetch(url, { credentials: 'same-origin' }).then(handle);

export async function apiPost(url: string, data?: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: data !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: data !== undefined ? JSON.stringify(data) : undefined,
    credentials: 'same-origin',
  });
  return handle(res);
}

export async function apiPatch(url: string, data?: unknown) {
  const res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
    credentials: 'same-origin',
  });
  return handle(res);
}

export async function apiPut(url: string, data?: unknown) {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data ?? {}),
    credentials: 'same-origin',
  });
  return handle(res);
}

export async function apiDelete(url: string) {
  const res = await fetch(url, { method: 'DELETE', credentials: 'same-origin' });
  return handle(res);
}
