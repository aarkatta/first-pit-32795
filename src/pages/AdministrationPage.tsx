import { collection, doc, getDoc, getDocs, limit, orderBy, query, startAfter, where, type Firestore, type QueryDocumentSnapshot } from 'firebase/firestore';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '@/lib/auth-context';
import { StatePanel } from '@/components/StatePanel';
import { formatDateTimeLabel, toDate } from '@/lib/dates';
import { describeAuditEvent, parseAuditEvent, type AuditEventRow } from '@/lib/audit-log';
import { listTeamMembers, memberMap, type TeamMember } from '@/lib/directory';
import { getFirebaseServices } from '@/lib/firebase';
import {
  isCoachOrLeader,
  type InvitationStatus,
  type ModerationCase,
  type ModerationStatus,
  type TeamPolicy
} from '@/lib/domain';
import { useTeamContext } from '@/lib/team-context';
import { copyToClipboard } from '@/lib/clipboard';
import { inviteEmailBody, inviteEmailSubject, inviteGmailHref, inviteLink, type InviteEmailInput } from '@/lib/invite-email';
import { shareText } from '@/lib/native-links';
import { isNativeShell } from '@/lib/native-shell';
import {
  approveJoinRequest,
  rejectJoinRequest,
  revokeInvitation,
  updateMembershipStatus,
  updateModerationCase,
  updateTeamPolicy
} from '@/lib/phase2-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { reportNote, reportReasonLabel, reportedQuestionId } from '@/lib/safety-reports';
import { useOnlineStatus } from '@/lib/use-online-status';

type InvitationRow = {
  id: string;
  email: string;
  role: string;
  status: InvitationStatus;
  expiresAt: unknown;
};
type JoinRequestRow = { id: string; userId: string; displayName: string; status: string };
/** `version` drives the optimistic-concurrency check on every moderation write. */
type ModerationCaseRow = ModerationCase & { version: number };
type AdminData = {
  members: TeamMember[];
  invitations: InvitationRow[];
  requests: JoinRequestRow[];
  cases: ModerationCaseRow[];
  /** Reported question id → its title; absent when it was removed or can't be read. */
  reportedTitles: Map<string, string>;
  policy: TeamPolicy | null;
  auditEvents: AuditEventRow[];
  /** Last audit document read, for loading the next older page. */
  auditCursor: QueryDocumentSnapshot | null;
  truncated: { invitations: boolean; requests: boolean; cases: boolean; audit: boolean };
};

const emptyData: AdminData = {
  members: [],
  invitations: [],
  requests: [],
  cases: [],
  reportedTitles: new Map(),
  policy: null,
  auditEvents: [],
  auditCursor: null,
  truncated: { invitations: false, requests: false, cases: false, audit: false }
};

/**
 * Bounded reads. Every list is capped and ordered newest-first so a large team
 * loses the *oldest* tail predictably instead of an arbitrary slice ordered by
 * document key, and the UI says so out loud when the cap is hit.
 */
const LIST_LIMIT = 50;
const AUDIT_LIMIT = 100;

/**
 * The composite indexes for these collections are (teamId, status, createdAt),
 * so an equality filter on `status` has to be part of the query for the ordered
 * read to be servable. Enumerating every status keeps the result set complete
 * while matching the index that already exists.
 */
const INVITATION_STATUSES: InvitationStatus[] = ['pending', 'accepted', 'revoked', 'expired'];
const MODERATION_STATUSES: ModerationStatus[] = ['open', 'investigating', 'resolved', 'dismissed'];

function parseInvitation(id: string, data: Record<string, unknown>): InvitationRow {
  return {
    id,
    email: String(data.email ?? ''),
    role: String(data.role ?? 'student'),
    status: (data.status ?? 'pending') as InvitationStatus,
    expiresAt: data.expiresAt
  };
}

function parseCase(id: string, data: Record<string, unknown>): ModerationCaseRow {
  return {
    id,
    ...(data as Omit<ModerationCase, 'id'>),
    // Cases created before the version field existed count as version 1, which
    // is what the server assumes for them too.
    version: typeof data.version === 'number' ? data.version : 1
  };
}

function invitationExpiry(invitation: InvitationRow): string {
  const expiry = toDate(invitation.expiresAt);
  if (!expiry) return 'No expiry recorded';
  if (invitation.status === 'pending' && expiry.getTime() < Date.now()) return `Expired ${formatDateTimeLabel(expiry)}`;
  return `Expires ${formatDateTimeLabel(expiry)}`;
}

/**
 * A join requester has no membership yet, so the roster callable cannot resolve
 * their name. `requestToJoinTeam` denormalizes `displayName` onto the request
 * for exactly this reason; the roster and the short id are fallbacks for
 * requests written before that field existed.
 */
function requesterLabel(members: Map<string, TeamMember>, request: JoinRequestRow): string {
  if (request.displayName) return request.displayName;
  const member = members.get(request.userId);
  if (member) return member.displayName;
  return `New applicant · ${request.userId.slice(0, 6)}…`;
}

/**
 * The server rejects a moderation write whose `expectedVersion` is stale. That
 * is a collision with another coach, not a broken request, so it gets its own
 * explanation instead of the generic failure copy.
 */
function isVersionConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) return false;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && code.toLowerCase().includes('aborted');
}

async function loadAdminData(firestore: Firestore, teamId: string): Promise<AdminData> {
  const [roster, invitations, requests, cases, policy, audit] = await Promise.all([
    listTeamMembers(teamId),
    getDocs(query(
      collection(firestore, 'invitations'),
      where('teamId', '==', teamId),
      where('status', 'in', INVITATION_STATUSES),
      orderBy('createdAt', 'desc'),
      limit(LIST_LIMIT)
    )),
    getDocs(query(
      collection(firestore, 'joinRequests'),
      where('teamId', '==', teamId),
      where('status', '==', 'pending'),
      orderBy('createdAt', 'desc'),
      limit(LIST_LIMIT)
    )),
    getDocs(query(
      collection(firestore, 'moderationCases'),
      where('teamId', '==', teamId),
      where('status', 'in', MODERATION_STATUSES),
      orderBy('createdAt', 'desc'),
      limit(LIST_LIMIT)
    )),
    getDocs(query(collection(firestore, 'teamPolicies'), where('__name__', '==', teamId), limit(1))),
    getDocs(query(
      collection(firestore, 'auditEvents'),
      where('teamId', '==', teamId),
      orderBy('createdAt', 'desc'),
      limit(AUDIT_LIMIT)
    ))
  ]);
  const policyDoc = policy.docs[0];
  const parsedCases = cases.docs.map((document) => parseCase(document.id, document.data() as Record<string, unknown>));
  return {
    members: roster.members,
    invitations: invitations.docs.map((document) => parseInvitation(document.id, document.data() as Record<string, unknown>)),
    requests: requests.docs.map((document) => ({
      id: document.id,
      userId: String(document.data().userId ?? ''),
      displayName: String(document.data().displayName ?? ''),
      status: String(document.data().status ?? '')
    })),
    cases: parsedCases,
    reportedTitles: await loadReportedTitles(firestore, parsedCases),
    policy: policyDoc ? { teamId, ...(policyDoc.data() as Omit<TeamPolicy, 'teamId'>) } : null,
    auditEvents: audit.docs.map((document) => parseAuditEvent(document.id, document.data() as Record<string, unknown>)),
    auditCursor: audit.docs.at(-1) ?? null,
    truncated: {
      invitations: invitations.size === LIST_LIMIT,
      requests: requests.size === LIST_LIMIT,
      cases: cases.size === LIST_LIMIT,
      audit: audit.size === AUDIT_LIMIT
    }
  };
}

/**
 * Titles of the questions the reports point at, so a coach knows what to look
 * at. A removed question is no longer readable (the rules hide it), and that
 * read failing must not break the page, so it simply has no title.
 */
async function loadReportedTitles(firestore: Firestore, cases: ModerationCaseRow[]): Promise<Map<string, string>> {
  const ids = [...new Set(cases.map((moderationCase) => reportedQuestionId(moderationCase.targetResource)).filter((id): id is string => Boolean(id)))];
  const entries = await Promise.all(ids.map(async (id) => {
    try {
      const snapshot = await getDoc(doc(firestore, 'questions', id));
      const title = snapshot.exists() ? snapshot.data()?.title : null;
      return typeof title === 'string' ? [id, title] as const : null;
    } catch {
      return null;
    }
  }));
  return new Map(entries.filter((entry): entry is readonly [string, string] => entry !== null));
}

/** The next older page of the team's audit history, after `cursor`. */
async function loadOlderAudit(firestore: Firestore, teamId: string, cursor: QueryDocumentSnapshot) {
  const page = await getDocs(query(
    collection(firestore, 'auditEvents'),
    where('teamId', '==', teamId),
    orderBy('createdAt', 'desc'),
    startAfter(cursor),
    limit(AUDIT_LIMIT)
  ));
  return {
    events: page.docs.map((document) => parseAuditEvent(document.id, document.data() as Record<string, unknown>)),
    cursor: page.docs.at(-1) ?? null,
    more: page.size === AUDIT_LIMIT
  };
}

/** Lines shown per step of the Administrative record's "Show more". */
const AUDIT_PAGE = 10;

/** Team settings that are planned but not built yet. */
const PLANNED_SETTINGS = [
  { label: 'Team messaging', hint: 'Coach-led messages to the whole team.' },
  { label: 'Message history limit', hint: 'Delete team messages after 30, 90 or 365 days.' },
  { label: 'Team discovery', hint: 'Let other FLL teams find this team. Off keeps it invisible.' }
];

/** The administration sections, as tabs. Only one loads into view at a time. */
const ADMIN_TABS = [
  { id: 'invitations', label: 'Invitations' },
  { id: 'requests', label: 'Join requests' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'settings', label: 'Team settings' },
  { id: 'safety', label: 'Safety' },
  { id: 'audit', label: 'Audit' }
] as const;
type AdminTab = (typeof ADMIN_TABS)[number]['id'];

function isAdminTab(value: string | null): value is AdminTab {
  return ADMIN_TABS.some((entry) => entry.id === value);
}

export function AdministrationPage() {
  const { user } = useAuth();
  const { activeTeam } = useTeamContext();
  const online = useOnlineStatus();
  // In the iOS shell, invites go through the share sheet (Mail, Messages,
  // Gmail…) instead of Gmail's web compose screen.
  const nativeShell = isNativeShell();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canAdminister = isCoachOrLeader(activeTeam);
  const [data, setData] = useState<AdminData>(emptyData);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `?tab=` lets another page land on a section — Manage team's "suspended"
  // notice links straight to the Suspended tab.
  const [searchParams] = useSearchParams();
  const requestedTab = searchParams.get('tab');
  const [tab, setTab] = useState<AdminTab>(isAdminTab(requestedTab) ? requestedTab : 'invitations');
  const requestGeneration = useRef(0);
  const currentTeamId = useRef(teamId);
  currentTeamId.current = teamId;
  const locked = busy || !online;
  // Only these two policy fields still drive a feature; the messaging and
  // retention fields outlived team chat and are no longer shown.
  const filesOn = data.policy?.fileSharing === 'teamOnly';
  const requestsOn = data.policy?.membershipApproval === 'coachApproval';

  const refresh = useCallback(async () => {
    const generation = ++requestGeneration.current;
    if (!teamId || !canAdminister) return;
    setStatus('loading');
    setError(null);
    try {
      const nextData = await loadAdminData(firestore, teamId);
      if (generation !== requestGeneration.current) return;
      setData(nextData);
      setStatus('ready');
    } catch (nextError) {
      if (generation !== requestGeneration.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Could not load team administration.'));
      setStatus('error');
    }
  }, [canAdminister, firestore, teamId]);

  useEffect(() => { void refresh(); }, [refresh]);

  const members = useMemo(() => memberMap(data.members), [data.members]);
  const [auditShown, setAuditShown] = useState(AUDIT_PAGE);
  const [loadingOlder, setLoadingOlder] = useState(false);
  // Removing reported content asks once more before it happens.
  const [confirmingRemoval, setConfirmingRemoval] = useState<string | null>(null);
  useEffect(() => setAuditShown(AUDIT_PAGE), [teamId]);
  const auditLines = useMemo(() => {
    const invitationEmails = new Map(data.invitations.map((invitation) => [invitation.id, invitation.email]));
    return data.auditEvents.flatMap((event) => {
      const line = describeAuditEvent(event, { members, invitationEmails });
      return line ? [{ id: event.id, line, at: formatDateTimeLabel(event.createdAt, '') }] : [];
    });
  }, [data.auditEvents, data.invitations, members]);

  async function showMoreAudit() {
    if (auditShown < auditLines.length) {
      setAuditShown((shown) => shown + AUDIT_PAGE);
      return;
    }
    if (!teamId || !data.auditCursor || !data.truncated.audit) return;
    setLoadingOlder(true);
    try {
      const older = await loadOlderAudit(firestore, teamId, data.auditCursor);
      if (currentTeamId.current !== teamId) return;
      setData((current) => ({
        ...current,
        auditEvents: [...current.auditEvents, ...older.events],
        auditCursor: older.cursor ?? current.auditCursor,
        truncated: { ...current.truncated, audit: older.more }
      }));
      setAuditShown((shown) => shown + AUDIT_PAGE);
    } catch (olderError) {
      setRequestState(getRequestState(olderError, online));
    } finally {
      setLoadingOlder(false);
    }
  }
  const pendingInvitations = data.invitations.filter((invitation) => invitation.status === 'pending');
  const pendingRequests = data.requests.filter((request) => request.status === 'pending');
  const suspendedMembers = data.members.filter((member) => member.status === 'suspended');

  async function run(action: () => Promise<unknown>) {
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    setNotice(null);
    try { await action(); if (currentTeamId.current === teamId) await refresh(); }
    catch (nextError) {
      if (isVersionConflict(nextError)) {
        setRequestState({
          variant: 'error',
          title: 'Another coach updated this case',
          message: 'Another coach changed this moderation case while you were reviewing it. The queue has been refreshed with their change — check it before saving again.'
        });
        if (currentTeamId.current === teamId) await refresh();
      } else {
        setRequestState(getRequestState(nextError, online));
      }
    }
    finally { setBusy(false); }
  }

  function inviteEmailFor(invitation: { id: string; email: string; role: string }): InviteEmailInput {
    return {
      email: invitation.email,
      link: inviteLink(invitation.id),
      role: invitation.role,
      teamName: activeTeam?.team?.name ?? 'our team',
      teamNumber: activeTeam?.team?.teamNumber ?? null,
      inviterName: user?.displayName ?? null
    };
  }

  async function shareInvite(invitation: { id: string; email: string; role: string }) {
    const message = inviteEmailFor(invitation);
    try {
      await shareText({ title: inviteEmailSubject(message), text: inviteEmailBody(message) });
    } catch (shareError) {
      setRequestState(getRequestState(shareError, online));
    }
  }

  async function copyInviteLink(invitationId: string) {
    const link = inviteLink(invitationId);
    setNotice(await copyToClipboard(link) ? `Invite link copied: ${link}` : `Invite link: ${link}`);
  }

  if (!user || !teamId) return <StatePanel variant="empty" title="Choose a team" message="Administration becomes available after you join or create a team." />;
  if (!canAdminister) return <StatePanel variant="permission" title="Coach access required" message="Only an active Coach or Team Leader can administer invitations, settings and safety." />;
  if (status === 'loading') return <StatePanel variant="loading" title="Loading team administration" message="Checking the roster, invitations, safety policy, reports, and audit history." />;
  if (status === 'error') return <StatePanel variant="error" title="Administration could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} />;

  return (
    <div className="page-stack">
      {/* Everyday team work — the roster, adding a member — lives on Manage
          team. What is left here is the administration a coach reaches for
          occasionally, so it is tabbed rather than one long scroll. */}
      <div className="section-heading">
        <div>
          <span className="eyebrow">ADMINISTRATION</span>
          <h3>{activeTeam?.team?.name ?? 'Your team'}</h3>
          <p>{online ? 'Invitations, joining, settings, safety and the audit record. Only coaches and team leaders see this page.' : 'Read-only while offline: invitations, policy updates and moderation are disabled.'}</p>
        </div>
        <Link className="button button--ghost" to="/team">Back to Manage team</Link>
      </div>

      {!online ? <StatePanel variant="offline" title="You are offline" message="This page is read-only until the connection returns." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      {notice ? <StatePanel variant="success" title="Invitation" message={notice} actionLabel="Dismiss" onAction={() => setNotice(null)} /> : null}
      <div className="admin-tabs" role="tablist" aria-label="Administration sections">
        {ADMIN_TABS.map((entry) => (
          <button
            key={entry.id}
            className={`admin-tabs__tab${tab === entry.id ? ' admin-tabs__tab--active' : ''}`}
            type="button"
            role="tab"
            id={`admin-tab-${entry.id}`}
            aria-selected={tab === entry.id}
            aria-controls={`admin-panel-${entry.id}`}
            onClick={() => setTab(entry.id)}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'invitations' ? (
        <section role="tabpanel" id="admin-panel-invitations" aria-labelledby="admin-tab-invitations">
          <article className="feature-panel">
        <span className="eyebrow">INVITATIONS</span>
        <h3>{pendingInvitations.length} pending invitation{pendingInvitations.length === 1 ? '' : 's'}</h3>
        <p>
          To add someone, use <Link to="/team">Manage team → ＋ Add a member</Link>. It invites an
          address that already has a First Pit account and creates the account for one that does
          not. This list is where you track, resend and revoke invitations.
        </p>
        {data.invitations.length === 0 ? <p>No invitations have been sent for this team yet.</p> : null}
        {data.invitations.map((invitation) => (
          <div className="list-row" key={invitation.id}>
            <span>
              <strong>{invitation.email}</strong>
              <small>{invitation.role} · {invitation.status} · {invitationExpiry(invitation)}</small>
            </span>
            <span>
              {invitation.status === 'pending' ? (
                <>
                  {nativeShell
                    ? <button className="text-button" type="button" onClick={() => void shareInvite(invitation)} aria-label={`Send invite to ${invitation.email}`}>Send invite</button>
                    : <a className="text-button" href={inviteGmailHref(inviteEmailFor(invitation))} target="_blank" rel="noopener noreferrer" aria-label={`Email invite to ${invitation.email} with Gmail (opens in a new tab)`}>Email invite</a>}
                  <button className="text-button" type="button" disabled={busy} onClick={() => void copyInviteLink(invitation.id)}>Copy link</button>
                  <button className="text-button" type="button" disabled={locked} onClick={() => void run(() => revokeInvitation(teamId, invitation.id))}>Revoke</button>
                </>
              ) : <small>{invitation.status}</small>}
            </span>
          </div>
        ))}
        {data.truncated.invitations ? <p><small>Showing the {LIST_LIMIT} most recent invitations.</small></p> : null}
        </article>
        </section>
      ) : null}

      {tab === 'requests' ? (
        <section role="tabpanel" id="admin-panel-requests" aria-labelledby="admin-tab-requests">
          <article className="feature-panel">
        <span className="eyebrow">JOIN APPROVALS</span>
        <h3>Pending requests</h3>
        {data.policy?.membershipApproval !== 'coachApproval' ? <p><small>This team is invite-only, so requests to join are refused. Turn on join requests above to accept them.</small></p> : null}
        {pendingRequests.length === 0 ? <p>No pending join requests.</p> : pendingRequests.map((request) => (
          <div className="list-row" key={request.id}>
            <span>{requesterLabel(members, request)}</span>
            <span>
              <button className="text-button" type="button" disabled={locked} onClick={() => void run(() => approveJoinRequest(teamId, request.id))}>Approve</button>
              <button className="text-button" type="button" disabled={locked} onClick={() => void run(() => rejectJoinRequest(teamId, request.id))}>Reject</button>
            </span>
          </div>
        ))}
        {data.truncated.requests ? <p><small>Showing the {LIST_LIMIT} most recent requests.</small></p> : null}
        <p><small>Your team ID for join requests: <code>{teamId}</code></small></p>
        </article>
        </section>
      ) : null}

      {tab === 'suspended' ? (
        <section role="tabpanel" id="admin-panel-suspended" aria-labelledby="admin-tab-suspended">
          <article className="feature-panel">
            <span className="eyebrow">SUSPENDED MEMBERS</span>
            <h3>{suspendedMembers.length} suspended</h3>
            <p>
              A suspended member keeps their account but loses access to this team, and is not listed on
              Manage team. Restoring them puts them straight back on the roster with the role they had.
            </p>
            {suspendedMembers.length === 0 ? <p>Nobody is suspended.</p> : suspendedMembers.map((member) => (
              <div className="list-row" key={member.userId}>
                <span>
                  <strong>{member.displayName}</strong>
                  <small>{member.role === 'teamLeader' ? 'Team leader' : member.role}</small>
                </span>
                <span>
                  <button className="text-button" type="button" disabled={locked} onClick={() => void run(() => updateMembershipStatus(teamId, member.userId, 'active'))}>
                    Restore
                  </button>
                </span>
              </div>
            ))}
          </article>
        </section>
      ) : null}

      {tab === 'settings' ? (
        <section role="tabpanel" id="admin-panel-settings" aria-labelledby="admin-tab-settings">
          <article className="feature-panel">
        <span className="eyebrow">TEAM SETTINGS</span>
        <h3>Files and joining</h3>
        <p>The team is always private: it can't be found by searching, and nobody joins without a coach.</p>
        <div className="list-row policy-row">
          <span>
            <strong>Team files: {filesOn ? 'On' : 'Off'}</strong>
            <small>{filesOn ? 'Members can attach files to task cards.' : 'File attachments on task cards are turned off.'}</small>
          </span>
          <button className="button button--ghost button--small" type="button" role="switch" aria-checked={filesOn} aria-label="Team files" disabled={locked} onClick={() => teamId && void run(() => updateTeamPolicy(teamId, { fileSharing: filesOn ? 'disabled' : 'teamOnly' }))}>{filesOn ? 'Turn off' : 'Turn on'}</button>
        </div>
        <div className="list-row policy-row">
          <span>
            <strong>Join requests: {requestsOn ? 'On' : 'Off'}</strong>
            <small>{requestsOn ? 'Besides invite links, people can ask to join with your team ID. You approve each one below.' : 'People join only through an invite link.'}</small>
          </span>
          <button className="button button--ghost button--small" type="button" role="switch" aria-checked={requestsOn} aria-label="Join requests" disabled={locked} onClick={() => teamId && void run(() => updateTeamPolicy(teamId, { membershipApproval: requestsOn ? 'inviteOnly' : 'coachApproval' }))}>{requestsOn ? 'Turn off' : 'Turn on'}</button>
        </div>
        {/* Placeholders for settings that are not built yet: shown greyed out and
            always off, and they send nothing to the server. */}
        {PLANNED_SETTINGS.map((setting) => (
          <div className="list-row policy-row policy-row--planned" key={setting.label}>
            <span>
              <strong>{setting.label}: Off <span className="coming-soon-pill">Coming soon</span></strong>
              <small>{setting.hint}</small>
            </span>
            <button className="button button--ghost button--small" type="button" role="switch" aria-checked={false} aria-label={`${setting.label} (coming soon)`} disabled>Turn on</button>
          </div>
        ))}
        </article>
        </section>
      ) : null}

      {tab === 'safety' ? (
        <section role="tabpanel" id="admin-panel-safety" aria-labelledby="admin-tab-safety">
          <article className="feature-panel">
        <span className="eyebrow">MODERATION QUEUE</span>
        <h3>Safety reports</h3>
        <p><small>Content team members reported with the Report button. Reporters stay anonymous.</small></p>
        {data.cases.length === 0 ? <p>No reports in the queue.</p> : <ul className="report-list">{data.cases.map((moderationCase) => {
          const questionId = reportedQuestionId(moderationCase.targetResource);
          const title = questionId ? data.reportedTitles.get(questionId) : undefined;
          const note = reportNote(moderationCase.description);
          const open = moderationCase.status === 'open' || moderationCase.status === 'investigating';
          const removed = moderationCase.action === 'remove-content';
          const resolve = (action: 'none' | 'remove-content') => void run(() => updateModerationCase({ teamId, caseId: moderationCase.id, expectedVersion: moderationCase.version, status: 'resolved', action }));
          return (
            <li key={moderationCase.id} className={open ? undefined : 'report-list__done'}>
              <strong>{title ? <>Question: {questionId && !removed ? <Link to={`/knowledge?question=${questionId}`}>{title}</Link> : title}</> : removed ? 'A question that has been removed' : 'Reported content (no longer available)'}</strong>
              <small>{reportReasonLabel(moderationCase.reasonCode)}{moderationCase.createdAt ? ` · ${formatDateTimeLabel(moderationCase.createdAt, '')}` : ''}</small>
              {note ? <p className="report-list__note">“{note}”</p> : null}
              {open ? (
                confirmingRemoval === moderationCase.id ? (
                  <div className="form-actions">
                    <span>Remove this question for everyone?</span>
                    <button className="button button--small" type="button" disabled={locked} onClick={() => { setConfirmingRemoval(null); resolve('remove-content'); }}>Yes, remove it</button>
                    <button className="button button--ghost button--small" type="button" disabled={locked} onClick={() => setConfirmingRemoval(null)}>Cancel</button>
                  </div>
                ) : (
                  <div className="form-actions">
                    {questionId && title ? <button className="button button--small" type="button" disabled={locked} onClick={() => setConfirmingRemoval(moderationCase.id)}>Remove question</button> : null}
                    <button className="button button--ghost button--small" type="button" disabled={locked} onClick={() => resolve('none')}>Keep and resolve</button>
                  </div>
                )
              ) : <small className="report-list__outcome">{removed ? 'Resolved · question removed' : `Resolved · ${moderationCase.status === 'dismissed' ? 'dismissed' : 'kept'}`}</small>}
            </li>
          );
        })}</ul>}
        {data.truncated.cases ? <p><small>Showing the {LIST_LIMIT} most recent reports.</small></p> : null}
        </article>
        </section>
      ) : null}

      {tab === 'audit' ? (
        <section role="tabpanel" id="admin-panel-audit" aria-labelledby="admin-tab-audit">
          <article className="feature-panel">
        <span className="eyebrow">AUDIT HISTORY</span>
        <h3>Administrative record</h3>
        <p><small>Who changed what on this team: invitations, roles, members, settings and board setup. Nobody can edit or delete these entries. Everyday task edits are not listed.</small></p>
        {auditLines.length === 0 ? <p>No changes recorded yet.</p> : (
          <ul className="audit-list">
            {auditLines.slice(0, auditShown).map((entry) => (
              <li key={entry.id}><span>{entry.line}</span>{entry.at ? <small>{entry.at}</small> : null}</li>
            ))}
          </ul>
        )}
        {auditShown < auditLines.length || data.truncated.audit ? (
          <button className="text-button" type="button" disabled={loadingOlder} onClick={() => void showMoreAudit()}>{loadingOlder ? 'Loading…' : 'Show more'}</button>
        ) : null}
        </article>
        </section>
      ) : null}
    </div>
  );
}
