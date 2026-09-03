import type { Role } from './types';

/**
 * Centralised permission table. Every API route resolves its guard from here —
 * the UI hides controls as a convenience only, never as the enforcement point.
 */
export const PERMISSIONS = [
  'tm.task.create', 'tm.task.assign', 'tm.task.assign_any', 'tm.task.edit_own',
  'tm.task.edit_any', 'tm.task.delete', 'tm.task.approve', 'tm.task.reopen',
  'tm.task.cancel', 'tm.task.change_deadline',
  'tm.user.view', 'tm.user.approve', 'tm.user.manage', 'tm.user.change_role',
  'tm.team.view', 'tm.team.manage',
  'tm.department.view', 'tm.department.manage',
  'tm.project.view', 'tm.project.manage',
  'tm.daily_update.submit', 'tm.daily_update.view_team', 'tm.daily_update.view_all',
  'tm.approval.decide', 'tm.approval.request',
  'tm.report.self', 'tm.report.team', 'tm.report.company', 'tm.report.export',
  'tm.performance.view_self', 'tm.performance.view_team', 'tm.performance.view_all',
  'tm.performance.configure',
  'tm.reward.view', 'tm.reward.approve',
  'tm.settings.manage', 'tm.audit.view', 'tm.template.manage',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const EMPLOYEE: Permission[] = [
  'tm.task.create', 'tm.task.edit_own',
  'tm.user.view', 'tm.team.view', 'tm.department.view', 'tm.project.view',
  'tm.daily_update.submit', 'tm.approval.request',
  'tm.report.self', 'tm.performance.view_self', 'tm.reward.view',
];

const LEADER: Permission[] = [
  ...EMPLOYEE,
  'tm.task.assign', 'tm.task.approve', 'tm.task.reopen', 'tm.task.change_deadline',
  'tm.daily_update.view_team', 'tm.approval.decide',
  'tm.report.team', 'tm.report.export',
  'tm.performance.view_team', 'tm.template.manage',
];

const MANAGER: Permission[] = [...PERMISSIONS];

const MATRIX: Record<Role, Permission[]> = {
  EMPLOYEE,
  LEADER,
  MANAGER,
};

export function can(role: Role, permission: Permission): boolean {
  return MATRIX[role].includes(permission);
}

export function permissionsFor(role: Role): Permission[] {
  return MATRIX[role];
}

export function isManager(role: Role) {
  return role === 'MANAGER';
}

export function isLeaderOrAbove(role: Role) {
  return role === 'MANAGER' || role === 'LEADER';
}
