'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/client';

export interface MetaUser {
  id: number;
  full_name: string;
  email: string;
  role: string;
  avatar_url: string | null;
  department_id: number | null;
  team_id: number | null;
  job_title: string | null;
  availability: string;
}

export interface MetaDepartment {
  id: number;
  name: string;
  code: string;
  color: string | null;
  status: string;
  manager_user_id: number | null;
}

export interface MetaTeam {
  id: number;
  name: string;
  code: string;
  department_id: number;
  leader_user_id: number | null;
  status: string;
}

export interface MetaProject {
  id: number;
  name: string;
  code: string;
  status: string;
  color: string | null;
  department_id: number | null;
}

interface MetaResponse {
  departments: MetaDepartment[];
  teams: MetaTeam[];
  projects: MetaProject[];
  categories: Array<{ id: number; name: string; color: string | null }>;
  users: MetaUser[];
  tags: Array<{ id: number; name: string; color: string | null }>;
}

export function useMeta() {
  const { data, isLoading, mutate } = useSWR<MetaResponse>('/api/tm/meta', fetcher, {
    revalidateOnFocus: false,
    dedupingInterval: 30000,
  });

  return {
    departments: data?.departments ?? [],
    teams: data?.teams ?? [],
    projects: data?.projects ?? [],
    categories: data?.categories ?? [],
    users: data?.users ?? [],
    tags: data?.tags ?? [],
    loading: isLoading,
    refresh: () => mutate(),
  };
}
