import { nameOf, type TeamMember } from './directory';
import { reportReasonLabel } from './safety-reports';

/** One `auditEvents` document, as the Administrative record reads it. */
export type AuditEventRow = {
  id: string;
  type: string;
  actorUserId: string;
  targetUserId: string | null;
  targetResource: string | null;
  metadata: Record<string, unknown>;
  createdAt: unknown;
};

export type AuditLookups = {
  members: Map<string, TeamMember>;
  /** Invitation id → invited email, so invitation lines can name the person. */
  invitationEmails: Map<string, string>;
};

export function parseAuditEvent(id: string, data: Record<string, unknown>): AuditEventRow {
  const metadata = data.metadata;
  return {
    id,
    type: typeof data.type === 'string' ? data.type : '',
    actorUserId: typeof data.actorUserId === 'string' ? data.actorUserId : '',
    targetUserId: typeof data.targetUserId === 'string' ? data.targetUserId : null,
    targetResource: typeof data.targetResource === 'string' ? data.targetResource : null,
    metadata: metadata && typeof metadata === 'object' ? metadata as Record<string, unknown> : {},
    createdAt: data.createdAt
  };
}

/**
 * Task, milestone and card edits are recorded too, but they are everyday board
 * work by students as well as coaches; listing them would bury the people and
 * settings changes the record is for.
 */
const BOARD_ACTIVITY = /^(kanban\.task\.|task\.|goal\.)/;

const BOARD_SETUP: Record<string, string> = {
  'kanban.default-project.seeded': 'set up the board with the standard season plan',
  'kanban.default-project.created': 'set up the board',
  'kanban.project.createdFromTemplate': 'set up the board from a template',
  'kanban.project.created': 'created a board',
  'kanban.project.updated': 'updated the board',
  'kanban.project.archived': 'archived a board',
  'kanban.column.created': 'added a board column',
  'kanban.column.updated': 'renamed a board column',
  'kanban.columns.reordered': 'reordered the board columns',
  'kanban.column.removed': 'removed a board column',
  'kanban.categories.updated': 'updated the board categories',
  'kanban.template.created': 'saved a board template',
  'kanban.template.deleted': 'deleted a board template'
};

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function roleLabel(role: string): string {
  if (role === 'teamLeader') return 'team leader';
  return role || 'member';
}

/** "a student", "an admin", "a team leader". */
function withArticle(role: string): string {
  const label = roleLabel(role);
  return `${/^[aeiou]/.test(label) ? 'an' : 'a'} ${label}`;
}

/**
 * Plain-language line for one audit event, or null when it is board activity
 * the Administrative record leaves out.
 */
export function describeAuditEvent(event: AuditEventRow, { members, invitationEmails }: AuditLookups): string | null {
  const action = text(event.metadata.action);
  const role = text(event.metadata.role);
  const status = text(event.metadata.status);
  const actor = nameOf(members, event.actorUserId);
  const target = event.targetUserId ? nameOf(members, event.targetUserId) : 'someone';
  const self = event.targetUserId !== null && event.targetUserId === event.actorUserId;
  const invitationId = event.targetResource?.startsWith('invitations/') ? event.targetResource.slice('invitations/'.length) : null;
  const invitee = invitationId ? invitationEmails.get(invitationId) ?? 'someone' : 'someone';

  switch (event.type) {
    case 'team.created':
      return `${actor} created the team`;
    case 'invitation.created':
      return `${actor} invited ${invitee} as ${withArticle(role)}`;
    case 'role.changed':
      if (action === 'transfer-leadership') return `${actor} made ${target} team leader`;
      return `${actor} changed ${target}'s role from ${roleLabel(text(event.metadata.previousRole))} to ${roleLabel(role)}`;
    case 'membership.changed':
      if (invitationId && status === 'revoked') return `${actor} revoked the invitation for ${invitee}`;
      if (self && status === 'active') return `${actor} joined as ${withArticle(role)}`;
      if (self && status === 'pending') return `${actor} asked to join the team`;
      if (self && status === 'removed') return `${actor} left the team`;
      if (status === 'approved') return `${actor} approved ${event.targetUserId && members.has(event.targetUserId) ? target : 'an applicant'}'s request to join`;
      if (status === 'rejected') return `${actor} turned down a request to join`;
      if (status === 'suspended') return `${actor} suspended ${target}`;
      if (status === 'active' && text(event.metadata.previousStatus) === 'suspended') return `${actor} restored ${target}`;
      return `${actor} changed ${target}'s membership to ${status || 'a new status'}`;
    case 'sensitive.updated':
      if (action === 'team.details.updated') return `${actor} edited the team name or number`;
      if (action === 'policy.updated') return `${actor} changed the team settings`;
      if (action === 'privacy.updated') return `${actor} updated their privacy settings`;
      if (action === 'account-deletion.requested') return `${actor} asked to delete their account`;
      return `${actor} changed a sensitive setting`;
    case 'report.created':
      // The reporter stays anonymous here, as it does in the moderation queue.
      return `A safety report was filed${event.metadata.reasonCode ? ` (${reportReasonLabel(text(event.metadata.reasonCode))})` : ''}`;
    case 'moderation.updated':
      if (action === 'remove-content') return `${actor} removed a reported question`;
      return `${actor} marked a safety report ${text(event.metadata.caseStatus) || 'updated'}`;
    case 'administrative.action':
      if (BOARD_ACTIVITY.test(action)) return null;
      if (action === 'file.upload.blocked') return 'A file upload was blocked by the safety check';
      if (BOARD_SETUP[action]) return `${actor} ${BOARD_SETUP[action]}`;
      return `${actor} made an administrative change`;
    default:
      return `${actor} made an administrative change`;
  }
}
