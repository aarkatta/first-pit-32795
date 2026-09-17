import { useEffect, useState } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { TrackerTabs } from '@/features/kanban/TrackerTabs';
import { BoardSetup } from '@/features/kanban/BoardSetup';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader, type TeamGoal } from '@/lib/domain';
import { listActiveTeamGoals } from '@/lib/phase3-service';
import { useTeamBoard } from '@/lib/use-team-board';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * Board structure: the workflow columns, and the categories that are the work
 * packages of the breakdown. Coach-only, and on its own screen because it is
 * something a team sets up occasionally rather than reads daily.
 */
export function BoardSetupPage() {
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const { project, status, requestState, setRequestState, refresh } = useTeamBoard(teamId, online);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Milestones fill the picker that puts a category under one.
    if (!teamId || !canManage) return undefined;
    let active = true;
    void listActiveTeamGoals(firestore, teamId)
      .then((next) => { if (active) setGoals(next); })
      .catch(() => { if (active) setGoals([]); });
    return () => { active = false; };
  }, [canManage, firestore, teamId]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      await refresh();
      return true;
    } catch (error) {
      setRequestState(getRequestState(error, online));
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading board setup" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Board setup becomes available after an active team membership is selected." />;
  if (!canManage) return <TrackerTabs canManage={canManage}><StatePanel variant="permission" title="Coach access is required" message="Only a coach or team leader can change the board's columns and categories." /></TrackerTabs>;
  if (status === 'loading' && !project) return <TrackerTabs canManage={canManage}><StatePanel variant="loading" title="Loading board setup" message="Fetching this team's board." /></TrackerTabs>;
  if (status === 'error' && !project) return <TrackerTabs canManage={canManage}><StatePanel variant="error" title="Board setup could not load" message={requestState?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus /></TrackerTabs>;
  if (!project) return <TrackerTabs canManage={canManage}><StatePanel variant="empty" title="No board yet" message="Open the Tracker once to create this team's board, then come back." /></TrackerTabs>;

  return (
    <TrackerTabs canManage={canManage}>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Changes are saved once you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      <BoardSetup teamId={teamId} project={project} goals={goals} busy={busy} onRun={run} />
    </TrackerTabs>
  );
}
