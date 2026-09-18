import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { formatDateLabel } from '@/lib/dates';
import { listTeamMembers, type TeamMember } from '@/lib/directory';
import { isCoachOrLeader, mayOfferTeamCreation } from '@/lib/domain';
import { useAccountType } from '@/lib/account-type';
import { leaveTeam } from '@/lib/phase2-service';
import { useTeamContext } from '@/lib/team-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * The hub is the first screen after sign-in, so everything on it has to describe
 * *this* team. It used to print a fixed motto and a static list of module names,
 * which meant two different teams rendered identical copy and none of the chips
 * went anywhere.
 */
const WORKSPACE_LINKS = [
  { to: '/coordination', label: 'Coordination', hint: 'Tracker, goals, and team files' },
  { to: '/knowledge', label: 'Knowledge', hint: 'Questions, how-to videos, and polls' },
  { to: '/scorer', label: 'Scorer', hint: 'Official FIRST robot game scoresheet' },
  { to: '/profile', label: 'Profile & settings', hint: 'Your account and notification choices' }
];

export function TeamHubPage() {
  const { user } = useAuth();
  const { status, activeTeam, teams, error, retry } = useTeamContext();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const teamId = activeTeam?.teamId ?? null;
  const account = useAccountType(user?.uid);
  const mayCreateTeam = mayOfferTeamCreation(account.accountType, teams);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [rosterStatus, setRosterStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);

  const loadRoster = useCallback(async () => {
    if (!teamId) return;
    setRosterStatus('loading');
    try {
      const roster = await listTeamMembers(teamId);
      setMembers(roster.members);
      setRosterStatus('ready');
    } catch {
      // A roster that cannot load is a decoration failure, not a page failure —
      // the hub still has to render the team and its links.
      setMembers([]);
      setRosterStatus('error');
    }
  }, [teamId]);

  useEffect(() => { void loadRoster(); }, [loadRoster]);
  useEffect(() => { setConfirmingLeave(false); }, [teamId]);

  function confirmLeave() {
    if (!teamId) return;
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    void leaveTeam(teamId)
      .then(() => {
        setConfirmingLeave(false);
        // The membership subscription drops the team on its own; land the user
        // somewhere that reflects the change immediately.
        navigate('/team', { replace: true });
      })
      .catch((leaveError: unknown) => {
        // The server refuses to let the last active coach leave. That message is
        // the actionable one ("transfer leadership first"), so show it verbatim.
        setRequestState(getRequestState(leaveError, online));
      })
      .finally(() => setBusy(false));
  }

  if (status === 'loading') {
    return <StatePanel variant="loading" title="Loading your teams" message="First Pit is checking active memberships." />;
  }
  if (status === 'error') {
    const teamsState = getRequestState(error, online);
    return <StatePanel {...teamsState} title={teamsState.variant === 'permission' ? teamsState.title : 'Teams could not load'} actionLabel="Retry" onAction={retry} autoFocus />;
  }
  if (!teams.length) {
    return (
      <div className="page-stack">
        {!online ? <StatePanel variant="offline" title="You are offline" message="Reconnect to load your team memberships." actionLabel="Try again" onAction={retry} /> : null}
        <section className="team-hero">
          <div>
            <span className="eyebrow light">TEAM ACCOUNT</span>
            <h3>No active team memberships yet.</h3>
            <p>Your account only sees teams where an authorized active membership exists.</p>
          </div>
          {mayCreateTeam ? <Link className="button" to="/teams/new">＋ Create a team</Link> : <Link className="button" to="/join">Accept an invitation</Link>}
        </section>
        <section className="split-panels">
          <article className="feature-panel">
            <span className="eyebrow">JOIN AN EXISTING TEAM</span>
            <h3>Were you invited?</h3>
            <p>Open the invitation link a coach sent you, or paste the invitation ID to accept it.</p>
            <Link className="button button--ghost" to="/join">Accept an invitation</Link>
          </article>
          {mayCreateTeam ? (
            <article className="feature-panel">
              <span className="eyebrow">START FRESH</span>
              <h3>Create your own team</h3>
              <p>A new team starts private, invite-only, and with you as its coach. Coach and mentor accounts can create teams.</p>
              <Link className="button button--ghost" to="/teams/new">Create a team</Link>
            </article>
          ) : (
            <article className="feature-panel">
              <span className="eyebrow">NO INVITATION YET?</span>
              <h3>Ask your coach</h3>
              <p>Students and parents join a team through an invite link from its coach. Ask them to create one for your email address.</p>
            </article>
          )}
        </section>
      </div>
    );
  }

  const teamName = activeTeam?.team?.name ?? 'Your team';
  const activeMemberCount = members.filter((member) => member.status === 'active').length;
  const coachCount = members.filter((member) => member.status === 'active' && ['coach', 'teamLeader'].includes(member.role)).length;
  const createdLabel = formatDateLabel(activeTeam?.team?.createdAt, '');

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div>
          <span className="eyebrow light">TEAM ACCOUNT</span>
          <h3>{teamName}</h3>
          <p>
            {activeTeam?.role === 'teamLeader' ? 'You are the team leader' : `You are a ${activeTeam?.role ?? 'member'}`}
            {rosterStatus === 'ready' ? ` · ${activeMemberCount} active member${activeMemberCount === 1 ? '' : 's'}` : ''}
            {rosterStatus === 'ready' && coachCount > 0 ? ` · ${coachCount} coach${coachCount === 1 ? '' : 'es'}` : ''}
            {createdLabel ? ` · created ${createdLabel}` : ''}
          </p>
        </div>
        {mayCreateTeam ? <Link className="button" to="/teams/new">＋ Create another team</Link> : null}
      </section>

      {!online ? (
        <StatePanel
          variant="offline"
          title="You are offline"
          message="Team details may be out of date, and leaving a team is disabled until the connection returns."
          actionLabel="Try again"
          onAction={() => { retry(); void loadRoster(); }}
        />
      ) : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}

      <section className="member-grid" aria-label="Your team memberships">
        {teams.map((membership, index) => (
          <article key={membership.teamId}>
            <span className={`big-avatar color-${index % 6}`}>
              {(membership.team?.name ?? 'Team').split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase()}
            </span>
            <strong>{membership.team?.name ?? 'Unnamed team'}</strong>
            <small>{membership.role} · active</small>
          </article>
        ))}
      </section>

      <section className="split-panels">
        <article className="feature-panel">
          <span className="eyebrow">CURRENT MEMBERSHIP</span>
          <h3>{activeTeam?.role ?? 'Member'} workspace</h3>
          <p>Signed in as {user?.email ?? 'a team member'}. Only verified active memberships enter this team context.</p>
          {rosterStatus === 'loading' ? <p><small>Loading the roster…</small></p> : null}
          {rosterStatus === 'error' ? (
            <StatePanel
              variant="error"
              title="Roster unavailable"
              message="The team roster could not load. Everything else on this page still works."
              actionLabel="Retry"
              onAction={() => void loadRoster()}
            />
          ) : null}
          {/* Coaches get the full roster in the administration section below. */}
          {rosterStatus === 'ready' && members.length > 0 && !isCoachOrLeader(activeTeam) ? (
            <div>
              {members.slice(0, 8).map((member) => (
                <span key={member.userId}>{member.displayName} · {member.role}</span>
              ))}
              {members.length > 8 ? <span>+{members.length - 8} more</span> : null}
            </div>
          ) : null}
          {rosterStatus === 'ready' && members.length === 0 ? (
            <p><small>You are the only person on this team so far.</small></p>
          ) : null}
        </article>
        <article className="feature-panel">
          <span className="eyebrow">WORKSPACE ACCESS</span>
          <h3>Everything scoped to {teamName}</h3>
          <p>Authentication, database rules, and server authorization keep each team workspace isolated.</p>
          {WORKSPACE_LINKS.map((link) => (
            <div className="list-row" key={link.to}>
              <span>
                <strong>{link.label}</strong>
                <small>{link.hint}</small>
              </span>
              <Link className="text-button" to={link.to}>Open</Link>
            </div>
          ))}
        </article>
      </section>

      <section className="split-panels">
        <article className="feature-panel">
          <span className="eyebrow">LEAVE THIS TEAM</span>
          <h3>Leave {teamName}</h3>
          <p>
            Leaving removes your access to this team's tasks and files. A coach has to invite you back.
            {coachCount === 1 && isCoachOrLeader(activeTeam) ? ' You are currently the only coach, so transfer leadership before leaving.' : ''}
          </p>
          {confirmingLeave ? (
            <div className="form-actions">
              <button className="button" type="button" disabled={busy || !online} onClick={confirmLeave}>
                {busy ? 'Leaving…' : `Yes, leave ${teamName}`}
              </button>
              <button className="button button--ghost" type="button" disabled={busy} onClick={() => setConfirmingLeave(false)}>Cancel</button>
            </div>
          ) : (
            <div className="form-actions">
              <button className="button button--ghost" type="button" disabled={busy || !online} onClick={() => setConfirmingLeave(true)}>Leave team…</button>
            </div>
          )}
        </article>
        <article className="feature-panel">
          <span className="eyebrow">INVITATIONS</span>
          <h3>Joining another team</h3>
          <p>An invitation from another coach is accepted on its own screen — you can belong to more than one team.</p>
          <div className="form-actions"><Link className="button button--ghost" to="/join">Accept an invitation</Link></div>
        </article>
      </section>
    </div>
  );
}
