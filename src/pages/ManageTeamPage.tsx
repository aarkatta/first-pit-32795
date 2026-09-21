import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { AddMemberDialog } from '@/features/team/AddMemberDialog';
import { CredentialsCard } from '@/features/team/CredentialsCard';
import { RosterTable } from '@/features/team/RosterTable';
import { useAuth } from '@/lib/auth-context';
import { formatDateLabel } from '@/lib/dates';
import { listTeamMembers, type TeamMember } from '@/lib/directory';
import { isCoachOrLeader, mayOfferTeamCreation, teamNumberSuffix } from '@/lib/domain';
import { useAccountType } from '@/lib/account-type';
import { assignTeamRole, leaveTeam, transferTeamLeadership, updateMembershipStatus } from '@/lib/phase2-service';
import { resetTeamMemberPassword, type ProvisionedMember } from '@/lib/team-members';
import { updateTeamDetails, type TeamDetails } from '@/lib/team-service';
import { useTeamContext } from '@/lib/team-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * Manage team: who is on the team, and how someone joins it.
 *
 * Everything a coach reaches for occasionally — invitations, joining policy,
 * safety reports, the audit record — moved to `/admin`. What is left is the one
 * task that happens every season: adding people. A coach fills in a name and an
 * email, First Pit creates the account, and the coach passes on the starter
 * password; the member replaces it at their first sign-in
 * (`PasswordSetupGate`).
 */
export function ManageTeamPage() {
  const { user } = useAuth();
  const { status, activeTeam, teams, error, retry, patchTeam } = useTeamContext();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const teamId = activeTeam?.teamId ?? null;
  const account = useAccountType(user?.uid);
  const mayCreateTeam = mayOfferTeamCreation(account.accountType, teams);
  const canAdminister = isCoachOrLeader(activeTeam);

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [membersTruncated, setMembersTruncated] = useState(false);
  const [rosterStatus, setRosterStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [adding, setAdding] = useState(false);
  const [credentials, setCredentials] = useState<ProvisionedMember | null>(null);
  const [savedDetails, setSavedDetails] = useState<Record<string, TeamDetails>>({});
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; teamNumber: string } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const locked = busy || !online;

  const loadRoster = useCallback(async () => {
    if (!teamId) return;
    setRosterStatus('loading');
    try {
      const roster = await listTeamMembers(teamId);
      setMembers(roster.members);
      setMembersTruncated(roster.truncated);
      setRosterStatus('ready');
    } catch {
      // A roster that cannot load is a section failure, not a page failure —
      // the team banner and Leave team still have to render.
      setMembers([]);
      setRosterStatus('error');
    }
  }, [teamId]);

  useEffect(() => { void loadRoster(); }, [loadRoster]);
  useEffect(() => {
    setConfirmingLeave(false);
    setAdding(false);
    setCredentials(null);
  }, [teamId]);

  /** Runs a membership mutation, then re-reads the roster it changed. */
  async function run(action: () => Promise<unknown>) {
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      await loadRoster();
    } catch (mutationError) {
      setRequestState(getRequestState(mutationError, online));
    } finally {
      setBusy(false);
    }
  }

  function confirmLeave() {
    if (!teamId) return;
    void run(async () => {
      await leaveTeam(teamId);
      setConfirmingLeave(false);
      // The membership subscription drops the team on its own; land the user
      // somewhere that reflects the change immediately.
      navigate('/team', { replace: true });
    });
  }

  async function saveDetails(event: FormEvent<HTMLFormElement>, id: string) {
    event.preventDefault();
    if (detailsDraft === null) return;
    setSavingDetails(true);
    setRequestState(null);
    try {
      const result = await updateTeamDetails(id, detailsDraft);
      const details = { name: result.name, teamNumber: result.teamNumber };
      setSavedDetails((current) => ({ ...current, [id]: details }));
      // Updates the top-bar team switcher and Home too, without a re-read.
      patchTeam(id, details);
      setDetailsDraft(null);
    } catch (saveError) {
      setRequestState(getRequestState(saveError, online));
    } finally {
      setSavingDetails(false);
    }
  }

  if (status === 'loading') {
    return <StatePanel variant="loading" title="Loading your teams" message="First Pit is checking active memberships." />;
  }
  if (status === 'error') {
    const teamsState = getRequestState(error, online);
    return <StatePanel {...teamsState} title={teamsState.variant === 'permission' ? teamsState.title : 'Teams could not load'} actionLabel="Retry" onAction={retry} autoFocus />;
  }
  if (!teams.length) return <NoTeamsYet mayCreateTeam={mayCreateTeam} online={online} retry={retry} />;

  // The callable's answer wins until the team context re-reads the document.
  const saved = activeTeam ? savedDetails[activeTeam.teamId] : undefined;
  const teamName = saved?.name ?? activeTeam?.team?.name ?? 'Your team';
  const teamNumber = saved ? saved.teamNumber : activeTeam?.team?.teamNumber ?? null;
  const activeMembers = members.filter((member) => member.status === 'active');
  const coachCount = activeMembers.filter((member) => ['coach', 'teamLeader'].includes(member.role)).length;
  const createdLabel = formatDateLabel(activeTeam?.team?.createdAt, '');

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div>
          <span className="eyebrow light">TEAM ACCOUNT</span>
          <h3>{teamName}{teamNumber ? <span className="team-number">{teamNumberSuffix(teamNumber)}</span> : null}</h3>
          <p>
            {activeTeam?.role === 'teamLeader' ? 'You are the team leader' : `You are a ${activeTeam?.role ?? 'member'}`}
            {rosterStatus === 'ready' ? ` · ${activeMembers.length} active member${activeMembers.length === 1 ? '' : 's'}` : ''}
            {createdLabel ? ` · created ${createdLabel}` : ''}
          </p>
          {teams.length > 1 ? (
            <p className="team-hero__scope">One of your {teams.length} teams. Everything below is for {teamName} only — switch teams from the team menu at the top of the page.</p>
          ) : null}
          {activeTeam && canAdminister ? (
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
        {canAdminister ? <Link className="button button--ghost" to="/admin">Administration</Link> : null}
      </section>

      {!online ? (
        <StatePanel
          variant="offline"
          title="You are offline"
          message="Team details may be out of date, and adding or changing members is disabled until the connection returns."
          actionLabel="Try again"
          onAction={() => { retry(); void loadRoster(); }}
        />
      ) : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}

      {credentials ? (
        <CredentialsCard
          member={credentials}
          teamName={teamName}
          teamNumber={teamNumber}
          coachName={user?.displayName ?? null}
          onDone={() => setCredentials(null)}
        />
      ) : null}

      {adding && teamId ? (
        <AddMemberDialog
          teamId={teamId}
          online={online}
          onAdded={(member) => {
            setAdding(false);
            setCredentials(member);
            void loadRoster();
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <section aria-labelledby="roster-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">TEAM MEMBERS</span>
            <h3 id="roster-heading">{members.length} {members.length === 1 ? 'person' : 'people'} on {teamName}</h3>
          </div>
          {canAdminister && !adding ? (
            <button className="button" type="button" disabled={!online} onClick={() => { setCredentials(null); setAdding(true); }}>＋ Add a member</button>
          ) : null}
        </div>

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
        {rosterStatus === 'ready' && members.length === 0 ? (
          <StatePanel
            variant="empty"
            title="Just you so far"
            message={canAdminister ? 'Add a student to start the roster. First Pit creates their account and gives you a password to pass on.' : 'Your coach has not added anyone else yet.'}
          />
        ) : null}
        {rosterStatus === 'ready' && members.length > 0 && teamId ? (
          <RosterTable
            members={members}
            truncated={membersTruncated}
            currentUserId={user?.uid ?? ''}
            canAdminister={canAdminister}
            locked={locked}
            onRoleChange={(member, role) => void run(() => assignTeamRole(teamId, member.userId, role))}
            onSuspendToggle={(member) => void run(() => updateMembershipStatus(teamId, member.userId, member.status === 'suspended' ? 'active' : 'suspended'))}
            onMakeLeader={(member) => void run(() => transferTeamLeadership(teamId, member.userId))}
            onResetPassword={(member) => void run(async () => {
              const reset = await resetTeamMemberPassword(teamId, member.userId);
              setCredentials({
                userId: member.userId,
                email: '',
                displayName: member.displayName,
                role: 'student',
                temporaryPassword: reset.temporaryPassword,
                replayed: reset.replayed
              });
            })}
          />
        ) : null}

        {canAdminister ? (
          <p className="roster-footnote">
            <small>
              Someone who already has a First Pit account — another coach, a mentor — joins by
              invitation instead, on <Link to="/admin">the Administration page</Link>.
            </small>
          </p>
        ) : null}
      </section>

      <section className="split-panels">
        <article className="feature-panel">
          <span className="eyebrow">LEAVE THIS TEAM</span>
          <h3>Leave {teamName}</h3>
          <p>
            Leaving removes your access to this team's tasks and files. A coach has to invite you back.
            {coachCount === 1 && canAdminister ? ' You are currently the only coach, so transfer leadership before leaving.' : ''}
          </p>
          {confirmingLeave ? (
            <div className="form-actions">
              <button className="button" type="button" disabled={locked} onClick={confirmLeave}>
                {busy ? 'Leaving…' : `Yes, leave ${teamName}`}
              </button>
              <button className="button button--ghost" type="button" disabled={busy} onClick={() => setConfirmingLeave(false)}>Cancel</button>
            </div>
          ) : (
            <div className="form-actions">
              <button className="button button--ghost" type="button" disabled={locked} onClick={() => setConfirmingLeave(true)}>Leave team…</button>
            </div>
          )}
        </article>
        <article className="feature-panel">
          <span className="eyebrow">ANOTHER TEAM</span>
          <h3>Joining or starting another team</h3>
          <p>You can belong to more than one team. An invitation from another coach is accepted on its own screen.</p>
          <div className="form-actions">
            <Link className="button button--ghost" to="/join">Accept an invitation</Link>
            {mayCreateTeam ? <Link className="button button--ghost" to="/teams/new">Create another team</Link> : null}
          </div>
        </article>
      </section>
    </div>
  );
}

type NoTeamsYetProps = { mayCreateTeam: boolean; online: boolean; retry: () => void };

/** Someone signed in with no active membership: the only route in is an invitation. */
function NoTeamsYet({ mayCreateTeam, online, retry }: NoTeamsYetProps) {
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
