import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { AddMemberDialog } from '@/features/team/AddMemberDialog';
import { CredentialsCard } from '@/features/team/CredentialsCard';
import { RosterTable } from '@/features/team/RosterTable';
import { useAuth } from '@/lib/auth-context';
import { formatDateLabel } from '@/lib/dates';
import { listTeamMembers, type TeamMember } from '@/lib/directory';
import { avatarTone } from '@/lib/board-view';
import { isCoachOrLeader, mayOfferTeamCreation, nameInitials, roleLabel } from '@/lib/domain';
import { useAccountType } from '@/lib/account-type';
import { assignTeamRole, updateMembershipStatus } from '@/lib/phase2-service';
import { resetTeamMemberPassword, type ProvisionedMember } from '@/lib/team-members';
import { updateTeamDetails, type TeamDetails } from '@/lib/team-service';
import { useTeamContext } from '@/lib/team-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

type RosterEntry = { status: 'loading' | 'ready' | 'error'; members: TeamMember[]; truncated: boolean };
type RoleFilter = 'all' | 'coach' | 'teamLeader' | 'student' | 'mentor' | 'parent';

/** The chip that summarises a card's roster, whatever state its read is in. */
function memberCountLabel(entry: RosterEntry | undefined, count: number): string {
  if (entry?.status === 'ready') return `${count} member${count === 1 ? '' : 's'}`;
  if (entry?.status === 'error') return 'Members unavailable';
  return 'Loading…';
}

/**
 * Manage teams: pick a team, then manage its people.
 *
 * Every team the viewer belongs to is a card at the top; choosing one makes it
 * the active team (so the top-bar switcher and the rest of the app follow) and
 * loads its roster below. Starting another team is offered here too. The page
 * still stays clean: only active members are listed — suspended, removed and
 * pending people are Administration's business — and leaving a team or accepting
 * an invitation remain on the profile (`MembershipsPanel`).
 *
 * The roster shows each member's role, whether they have finished signing in,
 * and the coach actions that were always here — change role, suspend, reset the
 * password of an account this team created (`PasswordSetupGate` forces the
 * replacement at first sign-in).
 */
export function ManageTeamPage() {
  const { user } = useAuth();
  const { status, activeTeam, teams, error, retry, patchTeam, setActiveTeamId } = useTeamContext();
  const online = useOnlineStatus();
  const teamId = activeTeam?.teamId ?? null;
  const account = useAccountType(user?.uid);
  const mayCreateTeam = mayOfferTeamCreation(account.accountType, teams);
  const canAdminister = isCoachOrLeader(activeTeam);

  const [rosters, setRosters] = useState<Record<string, RosterEntry>>({});
  const [credentials, setCredentials] = useState<ProvisionedMember | null>(null);
  const [credentialsKind, setCredentialsKind] = useState<'added' | 'reset'>('added');
  const [adding, setAdding] = useState(false);
  const [savedDetails, setSavedDetails] = useState<Record<string, TeamDetails>>({});
  const [detailsDraft, setDetailsDraft] = useState<{ name: string; teamNumber: string } | null>(null);
  const [savingDetails, setSavingDetails] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RoleFilter>('all');
  /** The member just suspended, so the notice can offer Undo before the row is forgotten. */
  const [justSuspended, setJustSuspended] = useState<TeamMember | null>(null);
  /** A coach about to change their own role away from coach, awaiting confirmation. */
  const [selfDemotion, setSelfDemotion] = useState<'student' | 'parent' | 'mentor' | null>(null);
  const locked = busy || !online;

  const loadRoster = useCallback(async (id: string) => {
    setRosters((current) => ({
      ...current,
      [id]: { status: 'loading', members: current[id]?.members ?? [], truncated: current[id]?.truncated ?? false }
    }));
    try {
      const roster = await listTeamMembers(id);
      setRosters((current) => ({ ...current, [id]: { status: 'ready', members: roster.members, truncated: roster.truncated } }));
    } catch {
      setRosters((current) => ({ ...current, [id]: { status: 'error', members: [], truncated: false } }));
    }
  }, []);

  // Every card shows its own member counts, so each team's roster is fetched
  // once and cached. A team already loading or loaded is skipped.
  useEffect(() => {
    for (const membership of teams) {
      if (!rosters[membership.teamId]) void loadRoster(membership.teamId);
    }
  }, [teams, rosters, loadRoster]);

  // Changing which team is active resets the member filters and any open dialog.
  useEffect(() => {
    setAdding(false);
    setCredentials(null);
    setJustSuspended(null);
    setSelfDemotion(null);
    setSearch('');
    setFilter('all');
    setDetailsDraft(null);
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
      if (teamId) await loadRoster(teamId);
    } catch (mutationError) {
      setRequestState(getRequestState(mutationError, online));
    } finally {
      setBusy(false);
    }
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

  const activeMembers = useMemo(
    () => (teamId ? (rosters[teamId]?.members ?? []).filter((member) => member.status === 'active') : []),
    [rosters, teamId]
  );
  const counts = useMemo(() => ({
    all: activeMembers.length,
    coach: activeMembers.filter((member) => member.role === 'coach').length,
    teamLeader: activeMembers.filter((member) => member.role === 'teamLeader').length,
    student: activeMembers.filter((member) => member.role === 'student').length,
    mentor: activeMembers.filter((member) => member.role === 'mentor').length,
    parent: activeMembers.filter((member) => member.role === 'parent').length,
    notSignedIn: activeMembers.filter((member) => member.mustSetPassword === true).length
  }), [activeMembers]);
  const coachCount = counts.coach + counts.teamLeader;

  const query = search.trim().toLowerCase();
  const filteredMembers = activeMembers
    .filter((member) => (filter === 'all' ? true : member.role === filter))
    .filter((member) => (query ? member.displayName.toLowerCase().includes(query) : true));

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
  const createdLabel = formatDateLabel(activeTeam?.team?.createdAt, '');
  const ownerId = activeTeam?.team?.createdBy ?? null;
  const rosterStatus = teamId ? rosters[teamId]?.status ?? 'loading' : 'loading';

  const roleChips: Array<{ id: RoleFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'coach', label: 'Coaches', count: counts.coach },
    { id: 'teamLeader', label: 'Team leaders', count: counts.teamLeader },
    { id: 'student', label: 'Students', count: counts.student },
    { id: 'mentor', label: 'Mentors', count: counts.mentor },
    { id: 'parent', label: 'Parents', count: counts.parent }
  ];

  return (
    <div className="page-stack manage-teams">
      {!online ? (
        <StatePanel
          variant="offline"
          title="You are offline"
          message="Team details may be out of date, and adding or changing members is disabled until the connection returns."
          actionLabel="Try again"
          onAction={() => { retry(); if (teamId) void loadRoster(teamId); }}
        />
      ) : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}

      <section aria-labelledby="teams-heading">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR TEAMS · {teams.length}</span>
            <h3 id="teams-heading" className="visually-hidden">Your teams</h3>
          </div>
        </div>
        <ul className="team-picker">
          {teams.map((membership) => {
            const id = membership.teamId;
            const entry = rosters[id];
            const name = (savedDetails[id]?.name ?? membership.team?.name) ?? 'Unnamed team';
            const number = savedDetails[id] ? savedDetails[id].teamNumber : membership.team?.teamNumber ?? null;
            const members = (entry?.members ?? []).filter((member) => member.status === 'active');
            const notSignedIn = members.filter((member) => member.mustSetPassword === true).length;
            const selected = id === teamId;
            return (
              <li key={id}>
                <button
                  type="button"
                  className={`team-card${selected ? ' team-card--active' : ''}`}
                  aria-pressed={selected}
                  onClick={() => {
                    // A card whose read failed retries when chosen; the panel
                    // below also offers Retry once it is the active team.
                    if (entry?.status === 'error') void loadRoster(id);
                    setActiveTeamId(id);
                  }}
                >
                  <span className="team-card__top">
                    <span className={`team-badge color-${avatarTone(id)}`} aria-hidden="true">{nameInitials(name, 'T')}</span>
                    <span className="team-card__title">
                      <strong>{name}</strong>
                      <small>Team {number ? `#${number}` : '—'}</small>
                    </span>
                    {selected ? <span className="team-card__badge">Viewing</span> : null}
                  </span>
                  <span className="team-card__chips">
                    <span className={`pill${entry?.status === 'error' ? ' pill--warn' : ''}`}>{memberCountLabel(entry, members.length)}</span>
                    <span className="pill">You: {roleLabel(membership.role)}</span>
                    {notSignedIn > 0 ? <span className="pill pill--warn">{notSignedIn} not signed in</span> : null}
                  </span>
                </button>
              </li>
            );
          })}
          {mayCreateTeam ? (
            <li>
              <Link className="team-card team-card--create" to="/teams/new">
                <span className="team-card__plus" aria-hidden="true">+</span>
                <strong>Create a new team</strong>
              </Link>
            </li>
          ) : null}
        </ul>
      </section>

      {credentials ? (
        <CredentialsCard
          member={credentials}
          kind={credentialsKind}
          teamName={teamName}
          teamNumber={teamNumber}
          coachName={user?.displayName ?? null}
          onDone={() => setCredentials(null)}
        />
      ) : null}

      {adding && teamId ? (
        <AddMemberDialog
          teamId={teamId}
          teamName={teamName}
          teamNumber={teamNumber}
          coachName={user?.displayName ?? null}
          online={online}
          onAdded={(member) => {
            setAdding(false);
            setCredentialsKind('added');
            setCredentials(member);
            void loadRoster(teamId);
          }}
          onCancel={() => setAdding(false)}
        />
      ) : null}

      <section className="team-panel" aria-labelledby="roster-heading">
        <div className="team-panel__hero">
          <span className={`team-badge team-badge--lg color-${avatarTone(teamId)}`} aria-hidden="true">{nameInitials(teamName, 'T')}</span>
          <div className="team-panel__id">
            {detailsDraft === null ? (
              <>
                <h3 id="roster-heading">{teamName}{teamNumber ? <span className="team-number"> #{teamNumber}</span> : null}</h3>
                <p>
                  {activeTeam?.role === 'teamLeader' ? "You're the team leader" : `You're a ${activeTeam?.role ?? 'member'}`}
                  {createdLabel ? ` · created ${createdLabel}` : ''}
                </p>
              </>
            ) : (
              <form className="team-number-form" onSubmit={(event) => activeTeam && void saveDetails(event, activeTeam.teamId)}>
                <label>Team name
                  <input className="team-name-input" value={detailsDraft.name} onChange={(event) => setDetailsDraft({ ...detailsDraft, name: event.target.value })} minLength={2} maxLength={80} required autoFocus />
                </label>
                <label>Team number
                  <input value={detailsDraft.teamNumber} onChange={(event) => setDetailsDraft({ ...detailsDraft, teamNumber: event.target.value })} inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} placeholder="e.g. 12345" title="Your FIRST LEGO League team number: up to 8 digits." required />
                </label>
                <button className="button button--small" type="submit" disabled={savingDetails || !online}>{savingDetails ? 'Saving…' : 'Save'}</button>
                <button className="button button--ghost button--small" type="button" disabled={savingDetails} onClick={() => setDetailsDraft(null)}>Cancel</button>
              </form>
            )}
          </div>
          {canAdminister && detailsDraft === null ? (
            <div className="team-panel__actions">
              <button className="button button--ghost" type="button" disabled={!online} onClick={() => setDetailsDraft({ name: activeTeam?.team ? teamName : '', teamNumber: teamNumber ?? '' })}>Edit team details</button>
              <button className="button" type="button" disabled={!online || adding} onClick={() => { setCredentials(null); setAdding(true); }}>Add a member</button>
            </div>
          ) : null}
        </div>

        <div className="team-stats">
          <div className="team-stat"><strong>{counts.all}</strong><span>Members</span></div>
          <div className="team-stat"><strong>{coachCount}</strong><span>Coaches &amp; leaders</span></div>
          <div className="team-stat"><strong>{counts.student}</strong><span>Students</span></div>
          <div className="team-stat"><strong>{counts.notSignedIn}</strong><span>Not signed in yet</span></div>
        </div>

        <div className="team-panel__body">
          {teams.length > 1 ? (
            <p className="team-panel__scope"><small>Showing {teamName} only. Roles and actions here apply to this team.</small></p>
          ) : null}

          {canAdminister && coachCount === 1 && rosterStatus === 'ready' ? (
            <div className="roster-notice roster-notice--warn" role="status">
              <span>
                <strong>You're the only coach on {teamName}.</strong> Add a second coach or team leader so someone can
                manage the team when you're away. Change anyone's role below.
              </span>
            </div>
          ) : null}

          {selfDemotion && teamId && user ? (
            <div className="roster-notice" role="alert">
              <span>
                <strong>Change your own role to {selfDemotion}?</strong> You will stop being a coach of
                {' '}{teamName} straight away, and lose access to adding members and Administration.
                Another coach would have to change it back.
              </span>
              <span className="form-actions">
                <button className="button button--small" type="button" disabled={locked} onClick={() => void run(async () => {
                  await assignTeamRole(teamId, user.uid, selfDemotion);
                  setSelfDemotion(null);
                })}>Yes, make me a {selfDemotion}</button>
                <button className="button button--ghost button--small" type="button" disabled={busy} onClick={() => setSelfDemotion(null)}>Cancel</button>
              </span>
            </div>
          ) : null}
          {justSuspended && teamId ? (
            <div className="roster-notice" role="status">
              <span>
                <strong>{justSuspended.displayName} is suspended</strong> and no longer listed here. Restore
                them any time from <Link to="/admin?tab=suspended">Administration → Suspended</Link>.
              </span>
              <span className="form-actions">
                <button className="button button--ghost button--small" type="button" disabled={locked} onClick={() => void run(async () => {
                  await updateMembershipStatus(teamId, justSuspended.userId, 'active');
                  setJustSuspended(null);
                })}>Undo</button>
                <button className="text-button" type="button" onClick={() => setJustSuspended(null)}>Dismiss</button>
              </span>
            </div>
          ) : null}

          {rosterStatus === 'ready' && activeMembers.length > 0 ? (
            <div className="roster-toolbar">
              <label className="roster-search">
                <span className="visually-hidden">Search members</span>
                <input type="search" value={search} placeholder="Search members" onChange={(event) => setSearch(event.target.value)} />
              </label>
              <div className="chip-filter" role="group" aria-label="Filter by role">
                {roleChips.map((chip) => (
                  <button
                    key={chip.id}
                    type="button"
                    className={`chip${filter === chip.id ? ' chip--active' : ''}`}
                    aria-pressed={filter === chip.id}
                    onClick={() => setFilter(chip.id)}
                  >
                    {chip.label} {chip.count}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {rosterStatus === 'loading' ? <p><small>Loading the roster…</small></p> : null}
          {rosterStatus === 'error' ? (
            <StatePanel
              variant="error"
              title="Roster unavailable"
              message="The team roster could not load. Everything else on this page still works."
              actionLabel="Retry"
              onAction={() => { if (teamId) void loadRoster(teamId); }}
            />
          ) : null}
          {rosterStatus === 'ready' && activeMembers.length === 0 ? (
            <StatePanel
              variant="empty"
              title="Just you so far"
              message={canAdminister ? 'Add a student to start the roster. First Pit creates their account and gives you a password to pass on.' : 'Your coach has not added anyone else yet.'}
            />
          ) : null}
          {rosterStatus === 'ready' && activeMembers.length > 0 && filteredMembers.length === 0 ? (
            <StatePanel variant="empty" title="No matches" message="No members match your search or filter." />
          ) : null}
          {rosterStatus === 'ready' && filteredMembers.length > 0 && teamId ? (
            <>
              <RosterTable
                members={filteredMembers}
                truncated={rosters[teamId]?.truncated ?? false}
                currentUserId={user?.uid ?? ''}
                ownerId={ownerId}
                canAdminister={canAdminister}
                locked={locked}
                coachCount={coachCount}
                onRoleChange={(member, role) => {
                  // Demoting yourself ends your coach access the moment it saves,
                  // so it is confirmed first. Anyone else's change applies at once.
                  const demotingSelf = member.userId === user?.uid && ['coach', 'teamLeader'].includes(member.role) && role !== 'coach';
                  if (demotingSelf) {
                    setSelfDemotion(role as 'student' | 'parent' | 'mentor');
                    return;
                  }
                  void run(() => assignTeamRole(teamId, member.userId, role));
                }}
                onSuspend={(member) => void run(async () => {
                  await updateMembershipStatus(teamId, member.userId, 'suspended');
                  setJustSuspended(member);
                })}
                onResetPassword={(member) => void run(async () => {
                  const reset = await resetTeamMemberPassword(teamId, member.userId);
                  setCredentialsKind('reset');
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
              <p className="roster-footer">
                <small>Showing {filteredMembers.length} of {activeMembers.length} on {teamName}</small>
                <small>Roles apply to this team only</small>
              </p>
            </>
          ) : null}
        </div>
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
        {mayCreateTeam ? <Link className="button" to="/teams/new">Create a team</Link> : <Link className="button" to="/join">Accept an invitation</Link>}
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
