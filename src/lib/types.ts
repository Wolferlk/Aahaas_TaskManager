export type Role = 'MANAGER' | 'LEADER' | 'EMPLOYEE';
export type UserStatus = 'PENDING_APPROVAL' | 'ACTIVE' | 'REJECTED' | 'DISABLED';
export type Priority = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
export type TaskStatus =
  | 'DRAFT' | 'TODO' | 'IN_PROGRESS' | 'BLOCKED' | 'WAITING'
  | 'REVIEW' | 'COMPLETED' | 'REJECTED' | 'CANCELLED';
export type Visibility = 'PRIVATE' | 'TEAM' | 'DEPARTMENT' | 'MANAGER' | 'PUBLIC';
export type Availability = 'AVAILABLE' | 'BUSY' | 'ON_LEAVE' | 'REMOTE' | 'OFFLINE';
export type ProjectStatus = 'PLANNING' | 'ACTIVE' | 'ON_HOLD' | 'COMPLETED' | 'CANCELLED';
export type Health = 'HEALTHY' | 'NEEDS_ATTENTION' | 'AT_RISK' | 'CRITICAL';
export type ApprovalType =
  | 'USER_SIGNUP' | 'TASK_COMPLETION' | 'DEADLINE_EXTENSION'
  | 'TASK_REASSIGNMENT' | 'LEADER_REQUEST' | 'REWARD';

export const PRIORITIES: Priority[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const TASK_STATUSES: TaskStatus[] = [
  'DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED',
];
export const BOARD_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'REVIEW', 'COMPLETED'];
export const OPEN_STATUSES: TaskStatus[] = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW'];

export const STATUS_LABEL: Record<TaskStatus, string> = {
  DRAFT: 'Draft', TODO: 'To Do', IN_PROGRESS: 'In Progress', BLOCKED: 'Blocked',
  WAITING: 'Waiting', REVIEW: 'Review', COMPLETED: 'Completed',
  REJECTED: 'Rejected', CANCELLED: 'Cancelled',
};

export interface SessionUser {
  id: number;
  uuid: string;
  full_name: string;
  email: string;
  role: Role;
  status: UserStatus;
  department_id: number | null;
  team_id: number | null;
  job_title: string | null;
  avatar_url: string | null;
  availability: Availability;
  must_change_password: boolean;
  department_name?: string | null;
  team_name?: string | null;
}

export interface TaskRow {
  id: number;
  task_number: string;
  title: string;
  description: string | null;
  task_type: string;
  project_id: number | null;
  department_id: number | null;
  team_id: number | null;
  assignee_id: number | null;
  created_by: number;
  leader_id: number | null;
  category_id: number | null;
  parent_task_id: number | null;
  priority: Priority;
  status: TaskStatus;
  visibility: Visibility;
  is_personal: 0 | 1;
  start_date: string | null;
  deadline: string | null;
  original_deadline: string | null;
  estimated_hours: string | null;
  actual_hours: string | null;
  progress: number;
  approval_required: 0 | 1;
  blocked_reason: string | null;
  completion_notes: string | null;
  ai_summary: string | null;
  completed_at: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}
