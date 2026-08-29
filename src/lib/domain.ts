import type { User } from 'firebase/auth';

export const TEAM_ROLES = ['student', 'parent', 'mentor', 'coach', 'teamLeader'] as const;
export type TeamRole = (typeof TEAM_ROLES)[number];
export type MembershipStatus = 'active' | 'pending' | 'suspended' | 'removed';
export type InvitationStatus = 'pending' | 'accepted' | 'revoked' | 'expired';
export type ReportTargetType = 'user' | 'content';
export type ModerationSeverity = 'low' | 'medium' | 'high' | 'critical';
export type ModerationStatus = 'open' | 'investigating' | 'resolved' | 'dismissed';
export type ModerationAction = 'none' | 'warning' | 'remove-content' | 'suspend-member' | 'remove-member' | 'escalate';

export type PrivacySettings = {
  userId: string;
  profileVisibility: 'teamOnly';
  searchable: false;
  allowParentVisibility: false;
  privateConversations: false;
  isMinor?: boolean;
  updatedAt?: unknown;
};

export type Team = {
  id: string;
  name: string;
  normalizedName: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Invitation = {
  id: string;
  teamId: string;
  email: string;
  role: Exclude<TeamRole, 'teamLeader'>;
  invitedBy: string;
  status: InvitationStatus;
  expiresAt?: unknown;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Membership = {
  id: string;
  teamId: string;
  userId: string;
  role: TeamRole;
  status: MembershipStatus;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TeamRecord = {
  id: string;
  teamId: string;
  createdBy: string;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type TrackerTaskStatus = 'todo' | 'inProgress' | 'review' | 'completed';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type ChecklistItem = { id: string; label: string; completed: boolean };

export type TrackerTask = TeamRecord & {
  title: string;
  description: string;
  status: TrackerTaskStatus;
  priority: TaskPriority;
  assignedTo: string | null;
  watcherUserIds: string[];
  goalId: string | null;
  labels: string[];
  checklist: ChecklistItem[];
  attachmentFileIds: string[];
  dueAt?: unknown;
  historyCount: number;
  projectId?: string;
  columnId?: string;
  orderKey?: number;
  version?: number;
  completedAt?: unknown | null;
};

export type ProjectColumn = {
  id: string;
  name: string;
  color: 'blue' | 'purple' | 'orange' | 'green' | 'slate' | 'pink';
};

export type KanbanProject = TeamRecord & {
  name: string;
  description: string;
  columns: ProjectColumn[];
  completedColumnId: string;
  archived: boolean;
  archivedAt?: unknown | null;
  /**
   * Optimistic-concurrency token for the workflow. Every column mutation rewrites
   * the whole `columns` array, so the server rejects an edit based on a stale
   * version. Projects written before the field existed count as version 1.
   */
  version?: number;
};

export type TeamGoal = TeamRecord & {
  title: string;
  description: string;
  status: 'active' | 'completed' | 'archived';
  dueAt?: unknown;
  taskCount: number;
  completedTaskCount: number;
  /** Same optimistic-concurrency contract as tasks; a goal without one is version 1. */
  version?: number;
};

export type RecurrenceRule = {
  frequency: 'weekly' | 'monthly';
  interval: number;
  count?: number;
  until?: unknown;
};

export type CalendarEvent = TeamRecord & {
  title: string;
  description: string;
  startsAt: unknown;
  endsAt: unknown;
  location: string | null;
  eventType: 'meeting' | 'practice' | 'competition' | 'deadline' | 'reminder';
  recurrence: RecurrenceRule | null;
  occurrenceOf: string | null;
  reminderMinutes: number[];
  linkedTaskIds: string[];
};

export type NotificationRecord = TeamRecord & {
  recipientUserId: string;
  type: 'task.assigned' | 'task.updated' | 'event.reminder' | 'file.ready' | 'system';
  title: string;
  body: string;
  deepLink: string;
  dedupeKey: string;
  mandatory: boolean;
  readAt: unknown | null;
};

export type Folder = TeamRecord & {
  name: string;
  parentFolderId: string | null;
};

export type Notification = TeamRecord & {
  recipientUserId: string;
  type: string;
  title: string;
  readAt?: unknown;
};

export type ContentVisibility = 'team' | 'community';

export type Question = {
  id: string;
  teamId: string | null;
  visibility: ContentVisibility;
  createdBy: string;
  title: string;
  body: string;
  category: string;
  tags: string[];
  attachmentFileIds: string[];
  status: 'open' | 'solved' | 'closed';
  moderationStatus: 'published' | 'removed';
  answerCount: number;
  commentCount: number;
  voteCount: number;
  /** Set by acceptAnswer so the thread can mark the accepted answer without scanning. */
  acceptedAnswerId?: string | null;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Answer = {
  id: string;
  teamId: string | null;
  visibility: ContentVisibility;
  createdBy: string;
  questionId: string;
  body: string;
  accepted: boolean;
  moderationStatus: 'published' | 'removed';
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type VideoCategory = 'Drivetrain' | 'Programming' | 'CAD' | 'Electronics' | 'Autonomous' | 'Pit Tips';

export type Video = {
  id: string;
  teamId: string | null;
  visibility: ContentVisibility;
  createdBy: string;
  category: VideoCategory;
  title: string;
  description: string;
  externalUrl: string | null;
  storagePath: string | null;
  sourceAttribution: string;
  captionTracks: Array<{ language: string; url: string; kind: 'captions' | 'transcript' }>;
  transcriptAvailable: boolean;
  relatedVideoIds: string[];
  publicationStatus: 'draft' | 'published' | 'unpublished' | 'removed';
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Poll = {
  id: string;
  teamId: string | null;
  visibility: ContentVisibility;
  createdBy: string;
  question: string;
  options: Array<{ id: string; label: string }>;
  selection: 'single' | 'multiple';
  anonymous: boolean;
  audienceRoles: string[];
  resultsVisibility: 'never' | 'afterVote' | 'afterClose' | 'always';
  expiresAt: unknown | null;
  status: 'open' | 'closed';
  totalVotes: number;
  optionVoteCounts: Record<string, number>;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export type Vote = {
  id: string;
  teamId: string | null;
  pollId: string;
  voterUserId: string;
  selectedOptionIds: string[];
  anonymous: boolean;
  createdAt?: unknown;
};

export type ScoreMissionResult = { missionId: string; points: number; completed: boolean };
export type ScoreDeductionResult = { deductionId: string; points: number };
export type ScoreSession = TeamRecord & {
  id: string;
  scoreDefinitionId: string;
  scoringSeason: string;
  scoringSourceType: 'team-defined' | 'official-curated';
  scoringSourceLabel: string;
  title: string;
  scoreType: 'practice' | 'match';
  sessionDate: unknown;
  eventId: string | null;
  missions: ScoreMissionResult[];
  deductions: ScoreDeductionResult[];
  totalPoints: number;
  notes: string;
  participantUserIds: string[];
  runTimeSeconds: number | null;
  robotProgramContext: string;
  version: number;
};

export function isValidFirestoreId(value: string): boolean {
  return value.trim().length > 0 && !value.includes('/');
}

export type TeamPolicy = {
  teamId: string;
  parentVisibility: 'none' | 'teamMembers';
  directMessaging: 'disabled' | 'coachesOnly';
  contentAudience: 'teamOnly';
  membershipApproval: 'inviteOnly' | 'coachApproval';
  fileSharing: 'disabled' | 'teamOnly';
  discoverability: 'private';
  messageRetentionDays: 30 | 90 | 365;
  updatedAt?: unknown;
};

export type Report = {
  id: string;
  teamId: string;
  reporterUserId: string;
  targetType: ReportTargetType;
  targetUserId?: string;
  targetResource?: string;
  reasonCode: string;
  description?: string;
  createdAt?: unknown;
};

export type ModerationCase = {
  id: string;
  teamId: string;
  reportId: string;
  reporterUserId: string;
  targetType: ReportTargetType;
  targetUserId?: string;
  targetResource?: string;
  reasonCode: string;
  description?: string;
  severity: ModerationSeverity;
  status: ModerationStatus;
  assignedTo?: string | null;
  evidenceRef?: string | null;
  action: ModerationAction;
  escalated: boolean;
  createdAt?: unknown;
  updatedAt?: unknown;
};

export function isAuthenticatedUser(user: User | null | undefined): user is User {
  return Boolean(user?.uid);
}

export function isTeamMember(
  membership: Pick<Membership, 'status'> | null | undefined
): boolean {
  return membership?.status === 'active';
}

export function hasTeamRole(
  membership: Pick<Membership, 'role' | 'status'> | null | undefined,
  roles: readonly TeamRole[]
): boolean {
  return Boolean(membership && isTeamMember(membership) && roles.includes(membership.role));
}

export function isCoachOrLeader(
  membership: Pick<Membership, 'role' | 'status'> | null | undefined
): boolean {
  return hasTeamRole(membership, ['coach', 'teamLeader']);
}

export type AuthorizationClaims = { platformAdmin?: boolean };

export type Permission =
  | 'profile.update'
  | 'team.read'
  | 'membership.request'
  | 'membership.invite'
  | 'membership.approve'
  | 'membership.manage'
  | 'role.assign'
  | 'policy.update'
  | 'report.create'
  | 'moderation.read'
  | 'moderation.manage'
  | 'audit.read'
  | 'task.create'
  | 'task.assign'
  | 'task.updateAssignedFields'
  | 'goal.manage'
  | 'event.manage'
  | 'file.upload'
  | 'file.read'
  | 'notification.read'
  | 'score.read'
  | 'score.create'
  | 'score.correct'
  | 'score.config.manage'
  | 'score.export';

const ROLE_PERMISSIONS: Record<TeamRole, readonly Permission[]> = {
  student: ['profile.update', 'team.read', 'membership.request', 'report.create', 'task.updateAssignedFields', 'file.read', 'notification.read', 'score.read', 'score.create'],
  parent: ['profile.update', 'team.read', 'report.create', 'file.read', 'notification.read', 'score.read', 'score.create'],
  mentor: ['profile.update', 'team.read', 'report.create', 'file.read', 'notification.read', 'score.read', 'score.create'],
  coach: ['profile.update', 'team.read', 'membership.invite', 'membership.approve', 'membership.manage', 'role.assign', 'policy.update', 'report.create', 'moderation.read', 'moderation.manage', 'audit.read', 'task.create', 'task.assign', 'task.updateAssignedFields', 'goal.manage', 'event.manage', 'file.upload', 'file.read', 'notification.read', 'score.read', 'score.create', 'score.correct', 'score.config.manage', 'score.export'],
  teamLeader: ['profile.update', 'team.read', 'membership.invite', 'membership.approve', 'membership.manage', 'role.assign', 'policy.update', 'report.create', 'moderation.read', 'moderation.manage', 'audit.read', 'task.create', 'task.assign', 'task.updateAssignedFields', 'goal.manage', 'event.manage', 'file.upload', 'file.read', 'notification.read', 'score.read', 'score.create', 'score.correct', 'score.config.manage', 'score.export']
};

export function canRole(role: TeamRole | 'platformAdmin', permission: Permission): boolean {
  if (role === 'platformAdmin') return true;
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function isPlatformAdmin(claims: AuthorizationClaims | null | undefined): boolean {
  return claims?.platformAdmin === true;
}
