import { z } from 'zod';

export const email = z.string().trim().toLowerCase().email('Enter a valid email address.').max(190);

export const password = z
  .string()
  .min(8, 'Password must be at least 8 characters.')
  .max(200)
  .refine((v) => /[A-Za-z]/.test(v) && /[0-9!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(v), {
    message: 'Password must contain a letter and a number or symbol.',
  });

export const signupSchema = z
  .object({
    full_name: z.string().trim().min(2, 'Enter your full name.').max(150),
    email,
    password,
    confirm_password: z.string(),
    department_id: z.coerce.number().int().positive().nullable().optional(),
    team_id: z.coerce.number().int().positive().nullable().optional(),
    requested_role: z.enum(['LEADER', 'EMPLOYEE']),
    job_title: z.string().trim().max(120).optional().nullable(),
    employee_code: z.string().trim().max(60).optional().nullable(),
    phone: z.string().trim().max(40).optional().nullable(),
    avatar_url: z.string().trim().max(500).optional().nullable(),
  })
  .refine((v) => v.password === v.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

export const loginSchema = z.object({
  email,
  password: z.string().min(1, 'Enter your password.'),
});

export const forgotSchema = z.object({ email });

export const resetSchema = z
  .object({ token: z.string().min(10), password, confirm_password: z.string() })
  .refine((v) => v.password === v.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

export const changePasswordSchema = z
  .object({ current_password: z.string().min(1), password, confirm_password: z.string() })
  .refine((v) => v.password === v.confirm_password, {
    message: 'Passwords do not match.',
    path: ['confirm_password'],
  });

const nullableId = z.coerce.number().int().positive().nullable().optional();
const isoDate = z.string().trim().min(1).nullable().optional();

export const taskCreateSchema = z.object({
  title: z.string().trim().min(3, 'Give the task a title.').max(255),
  description: z.string().max(20000).nullable().optional(),
  task_type: z.enum(['TASK', 'BUG', 'FEATURE', 'SUPPORT', 'MEETING', 'REPORT', 'OTHER']).default('TASK'),
  project_id: nullableId,
  department_id: nullableId,
  team_id: nullableId,
  assignee_id: nullableId,
  category_id: nullableId,
  parent_task_id: nullableId,
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).default('MEDIUM'),
  status: z
    .enum(['DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED'])
    .default('TODO'),
  visibility: z.enum(['PRIVATE', 'TEAM', 'DEPARTMENT', 'MANAGER', 'PUBLIC']).default('TEAM'),
  is_personal: z.boolean().default(false),
  start_date: isoDate,
  deadline: isoDate,
  estimated_hours: z.coerce.number().min(0).max(9999).nullable().optional(),
  approval_required: z.boolean().default(false),
  tags: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
  checklist: z.array(z.string().trim().min(1).max(300)).max(50).optional(),
  template_id: nullableId,
  recurring: z
    .object({
      frequency: z.enum(['DAILY', 'WEEKDAYS', 'WEEKLY', 'MONTHLY', 'CUSTOM']),
      interval_count: z.coerce.number().int().min(1).max(52).default(1),
      weekdays: z.string().max(30).nullable().optional(),
      day_of_month: z.coerce.number().int().min(1).max(31).nullable().optional(),
      ends_on: isoDate,
    })
    .nullable()
    .optional(),
});

export const taskUpdateSchema = z.object({
  title: z.string().trim().min(3).max(255).optional(),
  description: z.string().max(20000).nullable().optional(),
  task_type: z.enum(['TASK', 'BUG', 'FEATURE', 'SUPPORT', 'MEETING', 'REPORT', 'OTHER']).optional(),
  project_id: nullableId,
  department_id: nullableId,
  team_id: nullableId,
  assignee_id: nullableId,
  category_id: nullableId,
  priority: z.enum(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW']).optional(),
  status: z
    .enum(['DRAFT', 'TODO', 'IN_PROGRESS', 'BLOCKED', 'WAITING', 'REVIEW', 'COMPLETED', 'REJECTED', 'CANCELLED'])
    .optional(),
  visibility: z.enum(['PRIVATE', 'TEAM', 'DEPARTMENT', 'MANAGER', 'PUBLIC']).optional(),
  start_date: isoDate,
  deadline: isoDate,
  estimated_hours: z.coerce.number().min(0).max(9999).nullable().optional(),
  actual_hours: z.coerce.number().min(0).max(9999).nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).optional(),
  approval_required: z.boolean().optional(),
  blocked_reason: z.string().max(500).nullable().optional(),
  completion_notes: z.string().max(5000).nullable().optional(),
  reason: z.string().max(600).nullable().optional(),
  tags: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
});

export const commentSchema = z.object({
  body: z.string().trim().min(1, 'Write something first.').max(10000),
  parent_id: nullableId,
});

export const departmentSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash or underscore.'),
  description: z.string().max(2000).nullable().optional(),
  manager_user_id: nullableId,
  color: z.string().max(20).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
});

export const teamSchema = z.object({
  name: z.string().trim().min(2).max(120),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash or underscore.'),
  department_id: z.coerce.number().int().positive(),
  leader_user_id: nullableId,
  description: z.string().max(2000).nullable().optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).default('ACTIVE'),
});

export const projectSchema = z.object({
  name: z.string().trim().min(2).max(160),
  code: z.string().trim().min(2).max(30).regex(/^[A-Za-z0-9_-]+$/, 'Use letters, numbers, dash or underscore.'),
  description: z.string().max(5000).nullable().optional(),
  department_id: nullableId,
  owner_user_id: nullableId,
  leader_user_id: nullableId,
  start_date: isoDate,
  target_date: isoDate,
  status: z.enum(['PLANNING', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'CANCELLED']).default('PLANNING'),
  color: z.string().max(20).nullable().optional(),
  member_ids: z.array(z.coerce.number().int().positive()).max(100).optional(),
});

/**
 * Per-item depth. Everything here is optional — a one-line item stays a
 * one-line item — but when it is supplied it is stored verbatim next to the
 * item rather than being folded into the description.
 */
export const dailyUpdateItemDetailSchema = z.object({
  work_detail: z.string().max(20000).nullable().optional(),
  technical_notes: z.string().max(6000).nullable().optional(),
  impact: z.string().max(4000).nullable().optional(),
  next_steps: z.string().max(4000).nullable().optional(),
  collaborators: z.string().max(400).nullable().optional(),
  repos: z.string().max(400).nullable().optional(),
  links: z
    .array(z.object({ label: z.string().max(200), url: z.string().max(600) }))
    .max(30)
    .nullable()
    .optional(),
  commit_shas: z.array(z.string().max(40)).max(100).nullable().optional(),
  commit_count: z.coerce.number().int().min(0).nullable().optional(),
  additions: z.coerce.number().int().min(0).nullable().optional(),
  deletions: z.coerce.number().int().min(0).nullable().optional(),
  files_changed: z.coerce.number().int().min(0).nullable().optional(),
  source: z.enum(['MANUAL', 'AI', 'GITHUB']).default('MANUAL'),
});

export const dailyUpdateItemSchema = z.object({
  id: z.coerce.number().int().positive().optional(),
  task_id: nullableId,
  topic: z.string().max(160).nullable().optional(),
  title: z.string().trim().min(2).max(255),
  project_id: nullableId,
  description: z.string().max(5000).nullable().optional(),
  work_type: z.string().max(60).nullable().optional(),
  status: z.string().max(30).nullable().optional(),
  priority: z.string().max(20).nullable().optional(),
  progress: z.coerce.number().int().min(0).max(100).nullable().optional(),
  start_time: z.string().max(8).nullable().optional(),
  end_time: z.string().max(8).nullable().optional(),
  hours: z.coerce.number().min(0).max(24).nullable().optional(),
  blockers: z.string().max(2000).nullable().optional(),
  outcome: z.string().max(2000).nullable().optional(),
  tags: z.string().max(300).nullable().optional(),
  confidence: z.coerce.number().min(0).max(1).nullable().optional(),
  ai_generated: z.boolean().default(false),
  linked_action: z.enum(['NONE', 'ATTACHED', 'CREATED']).default('NONE'),
  detail: dailyUpdateItemDetailSchema.partial().optional(),
});

/**
 * Day-level narrative. Whatever the submitter writes here is authoritative;
 * AI only ever fills a field that was left empty.
 */
export const dailyUpdateDetailSchema = z.object({
  detailed_summary: z.string().max(20000).nullable().optional(),
  highlights: z.string().max(6000).nullable().optional(),
  achievements: z.string().max(6000).nullable().optional(),
  challenges: z.string().max(6000).nullable().optional(),
  learnings: z.string().max(6000).nullable().optional(),
  collaboration: z.string().max(4000).nullable().optional(),
  next_day_plan: z.string().max(6000).nullable().optional(),
  focus_area: z.string().max(200).nullable().optional(),
});

/**
 * A day may be recorded late — that is the point of backfilling a missed one —
 * but never early. Tomorrow is allowed as the boundary so a submitter whose
 * clock is ahead of the server's is not turned away at midnight.
 */
const recordableDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a valid date.')
  .refine((value) => {
    const limit = new Date(Date.now() + 864e5);
    const pad = (n: number) => String(n).padStart(2, '0');
    return value <= `${limit.getFullYear()}-${pad(limit.getMonth() + 1)}-${pad(limit.getDate())}`;
  }, 'You cannot record a day that has not happened yet.');

export const dailyUpdateSchema = z.object({
  update_date: recordableDate,
  raw_text: z.string().max(50000).nullable().optional(),
  source: z.enum(['MANUAL', 'AI_PARSED', 'MIXED']).default('MANUAL'),
  status: z.enum(['DRAFT', 'SUBMITTED']).default('SUBMITTED'),
  blockers: z.string().max(4000).nullable().optional(),
  mood: z.string().max(30).nullable().optional(),
  detail: dailyUpdateDetailSchema.optional(),
  // A full end-of-day report is pasted as one document; every bullet in it
  // becomes an item, so the cap sits well above a typical day.
  items: z.array(dailyUpdateItemSchema).max(200),
});

export const approvalDecisionSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  comment: z.string().max(2000).nullable().optional(),
  overrides: z
    .object({
      role: z.enum(['MANAGER', 'LEADER', 'EMPLOYEE']).optional(),
      department_id: nullableId,
      team_id: nullableId,
    })
    .optional(),
});

export const userUpdateSchema = z.object({
  full_name: z.string().trim().min(2).max(150).optional(),
  role: z.enum(['MANAGER', 'LEADER', 'EMPLOYEE']).optional(),
  status: z.enum(['ACTIVE', 'DISABLED']).optional(),
  department_id: nullableId,
  team_id: nullableId,
  job_title: z.string().max(120).nullable().optional(),
  employee_code: z.string().max(60).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  avatar_url: z.string().max(500).nullable().optional(),
  availability: z.enum(['AVAILABLE', 'BUSY', 'ON_LEAVE', 'REMOTE', 'OFFLINE']).optional(),
});

export const weightsSchema = z.object({
  completion: z.coerce.number().min(0).max(100),
  deadline_reliability: z.coerce.number().min(0).max(100),
  quality: z.coerce.number().min(0).max(100),
  consistency: z.coerce.number().min(0).max(100),
  collaboration: z.coerce.number().min(0).max(100),
  daily_updates: z.coerce.number().min(0).max(100),
});

export const savedViewSchema = z.object({
  name: z.string().trim().min(1).max(120),
  route: z.string().max(120).default('/tm/tasks'),
  filters: z.record(z.string(), z.unknown()),
  columns: z.array(z.string()).optional(),
  is_shared: z.boolean().default(false),
});

export const extensionRequestSchema = z.object({
  task_id: z.coerce.number().int().positive(),
  requested_deadline: z.string().min(1),
  reason: z.string().trim().min(5, 'Explain why the extension is needed.').max(2000),
});
