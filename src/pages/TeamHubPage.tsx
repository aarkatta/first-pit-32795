import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { formatDateLabel } from '@/lib/dates';
import { listTeamMembers, type TeamMember } from '@/lib/directory';
import { isCoachOrLeader, mayOfferTeamCreation, teamNumberSuffix } from '@/lib/domain';
import { useAccountType } from '@/lib/account-type';
import { leaveTeam } from '@/lib/phase2-service';
import { updateTeamDetails, type TeamDetails } from '@/lib/team-service';
import { useTeamContext } from '@/lib/team-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

type TeamHubPageProps = {
  /** Rendered after the team's own content and before Leave / Join, which sit at the bottom of the page. */
  children?: ReactNode;
};

export function TeamHubPage({ children }: TeamHubPageProps = {}) {
  const { user } = useAuth();
  const { status, activeTeam, teams, error, retry, patchTeam } = useTeamContext();
  const [savedDetails, setSavedDetails] = useState<Record<string, TeamDetails>>({});
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; teamNumber: string } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
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

  // The callable's answer wins until the team context re-reads the document.
  const saved = activeTeam ? savedDetails[activeTeam.teamId] : undefined;
  const teamName = saved?.name ?? activeTeam?.team?.name ?? 'Your team';
  const teamNumber = saved ? saved.teamNumber : activeTeam?.team?.teamNumber ?? null;
  const activeMemberCount = members.filter((member) => member.status === 'active').length;
  const coachCount = members.filter((member) => member.status === 'active' && ['coach', 'teamLeader'].includes(member.role)).length;
  const createdLabel = formatDateLabel(activeTeam?.team?.createdAt, '');

  async function saveDetails(event: FormEvent<HTMLFormElement>, teamId: string) {
    event.preventDefault();
    if (detailsDraft === null) return;
    setSavingDetails(true);
    setRequestState(null);
    try {
      const result = await updateTeamDetails(teamId, detailsDraft);
      const details = { name: result.name, teamNumber: result.teamNumber };
      setSavedDetails((current) => ({ ...current, [teamId]: details }));
      // Updates the top-bar team switcher and Home too, without a re-read.
      patchTeam(teamId, details);
      setDetailsDraft(null);
    } catch (saveError) {
      setRequestState(getRequestState(saveError, online));
    } finally {
      setSavingDetails(false);
    }
  }

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div>
          <span className="eyebrow light">TEAM ACCOUNT</span>
          <h3>{teamName}{teamNumber ? <span className="team-number">{teamNumberSuffix(teamNumber)}</span> : null}</h3>
          <p>
            {activeTeam?.role === 'teamLeader' ? 'You are the team leader' : `You are a ${activeTeam?.role ?? 'member'}`}
            {rosterStatus === 'ready' ? ` · ${activeMemberCount} active member${activeMemberCount === 1 ? '' : 's'}` : ''}
            {rosterStatus === 'ready' && coachCount > 0 ? ` · ${coachCount} coach${coachCount === 1 ? '' : 'es'}` : ''}
            {createdLabel ? ` · created ${createdLabel}` : ''}
          </p>
          {/* Everything on this page belongs to the active team only; a coach with
              several teams switches from the top bar. */}
          {teams.length > 1 ? <p className="team-hero__scope">One of your {teams.length} teams. Everything below is for {teamName} only — switch teams from the team menu at the top of the page.</p> : null}
          {activeTeam && isCoachOrLeader(activeTeam) ? (
            detailsDraft === null ? (
              <button className="button button--ghost button--small team-number-edit" type="button" disabled={!online} onClick={() => setDetailsDraft({ name: activeTeam.team ? teamName : '', teamNumber: teamNumber ?? '' })}>
                Edit team name &amp; number
              </button>
            ) : (
              <form className="team-number-form" onSubmit={(event) => void saveDetails(event, activeTeam.teamId)}>
                <label>Team name
                  <input className="team-name-input" value={detailsDraft.name} onChange={(event) => setDetailsDraft({ ...detailsDraft, name: event.target.value })} minLength={2} maxLength={80} required autoFocus />
                </label>
                <label>Team number
                  <input value={detailsDraft.teamNumber} onChange={(event) => setDetailsDraft({ ...detailsDraft, teamNumber: event.target.value })} inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} placeholder="e.g. 12345" title="Up to 8 digits. Leave empty to remove it." />
                </label>
                <button className="button button--small" type="submit" disabled={savingDetails || !online}>{savingDetails ? 'Saving…' : 'Save'}</button>
                <button className="button button--ghost button--small" type="button" disabled={savingDetails} onClick={() => setDetailsDraft(null)}>Cancel</button>
              </form>
            )
          ) : null}
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

      {/* Coaches and team leaders get the full roster in the administration
          section below, so only other members see this compact list. */}
      {!isCoachOrLeader(activeTeam) ? (
        <section className="card teammates" aria-label="Teammates">
          <span className="eyebrow">TEAMMATES</span>
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
          {rosterStatus === 'ready' && members.length > 0 ? (
            <ul className="teammates__list">
              {members.slice(0, 12).map((member) => <li key={member.userId}>{member.displayName} <small>{member.role}</small></li>)}
              {members.length > 12 ? <li><small>+{members.length - 12} more</small></li> : null}
            </ul>
          ) : null}
          {rosterStatus === 'ready' && members.length === 0 ? <p><small>You are the only person on this team so far.</small></p> : null}
        </section>
      ) : null}

      {children}

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
