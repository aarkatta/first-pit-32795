import { isCoachOrLeader } from '@/lib/domain';
import { useTeamContext } from '@/lib/team-context';
import { TeamAdminPage } from './TeamAdminPage';
import { TeamHubPage } from './TeamHubPage';

/**
 * "Manage team" is one page: the team overview every member sees, followed for
 * coaches and team leaders by the administration sections. Leaving those out
 * for everyone else is presentation only — `TeamAdminPage` refuses non-coaches
 * on its own, and every administrative callable re-checks the role.
 */
export function ManageTeamPage() {
  const { status, teams, activeTeam } = useTeamContext();
  const administering = status === 'ready' && teams.length > 0 && isCoachOrLeader(activeTeam);
  return (
    <div className="page-stack">
      <TeamHubPage />
      {administering ? <TeamAdminPage /> : null}
    </div>
  );
}
