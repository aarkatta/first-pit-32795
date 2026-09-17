import { StatePanel } from '@/components/StatePanel';
import { KanbanBoard } from '@/features/kanban/KanbanBoard';
import { TrackerTabs } from '@/features/kanban/TrackerTabs';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader } from '@/lib/domain';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * The project tracker: the board and nothing else.
 *
 * Milestones, team files and notifications used to share this screen. They are
 * their own routes now — each is a separate concern with its own reads, and
 * stacking them under the board made the page the team works in every day read
 * as a dumping ground.
 */
export function CoordinationPage() {
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading the tracker" message="Checking your active team membership before loading the board." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="The tracker becomes available after an active team membership is selected." />;

  return (
    <TrackerTabs canManage={canManage}>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Existing data may be stale. Mutations will be retried only after you reconnect." /> : null}
      <KanbanBoard teamId={teamId} canManage={canManage} actorRole={activeTeam?.role ?? 'parent'} actorUserId={user.uid} online={online} />
    </TrackerTabs>
  );
}
