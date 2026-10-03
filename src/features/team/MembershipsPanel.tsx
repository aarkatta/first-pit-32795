import { useState } from 'react';
import { Link } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAccountType } from '@/lib/account-type';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader, mayOfferTeamCreation, roleLabel, teamNumberSuffix } from '@/lib/domain';
import { leaveTeam } from '@/lib/phase2-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * The teams you belong to, on your profile.
 *
 * Leaving a team and joining or starting another are about the person, not
 * about whichever team is active, so they live here rather than on Manage team
 * — which is about one team and stays clean. Listing every membership also
 * means someone on three teams can leave the one they are not looking at.
 */
export function MembershipsPanel() {
  const { user } = useAuth();
  const { teams } = useTeamContext();
  const online = useOnlineStatus();
  const account = useAccountType(user?.uid);
  const mayCreateTeam = mayOfferTeamCreation(account.accountType, teams);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [left, setLeft] = useState<string | null>(null);

  function leave(teamId: string, teamName: string) {
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setLeaving(true);
    setRequestState(null);
    setLeft(null);
    void leaveTeam(teamId)
      .then(() => {
        // The membership subscription drops the team on its own.
        setConfirming(null);
        setLeft(teamName);
      })
      // The server refuses to let the last active coach leave, and that message
      // is the actionable one ("make another member a coach first"), so it is
      // shown as is.
      .catch((error: unknown) => setRequestState(getRequestState(error, online)))
      .finally(() => setLeaving(false));
  }

  return (
    <article className="feature-panel" aria-labelledby="memberships-heading">
      <span className="eyebrow">MEMBERSHIPS</span>
      <h3 id="memberships-heading">Your teams</h3>
      <p>You can belong to more than one team. Leaving one removes your access to its tasks and files, and a coach has to add you back.</p>

      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      {left ? <p role="status"><small>You left {left}.</small></p> : null}

      {teams.length === 0 ? <p><small>You are not on any team right now.</small></p> : (
        <ul className="memberships-list">
          {teams.map((membership) => {
            const name = membership.team?.name ?? 'Unnamed team';
            const label = `${name}${teamNumberSuffix(membership.team?.teamNumber ?? null)}`;
            return (
              <li key={membership.teamId} className="list-row">
                <span>
                  <strong>{label}</strong>
                  <small>{roleLabel(membership.role)}</small>
                </span>
                {confirming === membership.teamId ? (
                  <span className="form-actions">
                    <span>
                      Leave {name}?
                      {isCoachOrLeader(membership) ? <small> If you are its only coach, make another member a coach on Manage team first.</small> : null}
                    </span>
                    <button className="button button--small" type="button" disabled={leaving || !online} onClick={() => leave(membership.teamId, name)}>
                      {leaving ? 'Leaving…' : `Yes, leave ${name}`}
                    </button>
                    <button className="button button--ghost button--small" type="button" disabled={leaving} onClick={() => setConfirming(null)}>Cancel</button>
                  </span>
                ) : (
                  <button className="text-button" type="button" disabled={leaving || !online} onClick={() => { setConfirming(membership.teamId); setRequestState(null); }}>
                    Leave…
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <div className="form-actions">
        <Link className="button button--ghost" to="/join">Accept an invitation</Link>
        {mayCreateTeam ? <Link className="button button--ghost" to="/teams/new">{teams.length ? 'Create another team' : 'Create a team'}</Link> : null}
      </div>
    </article>
  );
}
