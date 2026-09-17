import { useEffect, useMemo, useState } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { TrackerTabs } from '@/features/kanban/TrackerTabs';
import { TaskImportPanel } from '@/features/kanban/TaskImportPanel';
import { getRequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader } from '@/lib/domain';
import { listTeamMembers, memberMap, type TeamMember } from '@/lib/directory';
import { useTeamBoard } from '@/lib/use-team-board';
import { useOnlineStatus } from '@/lib/use-online-status';
import { createOperationId } from '@/lib/ids';

/**
 * Spreadsheet import on its own screen: downloading the template, checking a
 * preview and importing is a task in itself, and it has no business competing
 * with the board for room.
 */
export function ImportTasksPage() {
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const { project, status, requestState, setRequestState, refresh } = useTeamBoard(teamId, online);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [busy, setBusy] = useState(false);
  const directory = useMemo(() => memberMap(members), [members]);

  useEffect(() => {
    // Matched assignees are shown by name; a failure degrades the labels only.
    if (!teamId || !canManage) return undefined;
    let active = true;
    void listTeamMembers(teamId)
      .then((roster) => { if (active) setMembers(roster.members); })
      .catch(() => { if (active) setMembers([]); });
    return () => { active = false; };
  }, [canManage, teamId]);

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

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading import" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Importing tasks becomes available after an active team membership is selected." />;
  if (!canManage) return <TrackerTabs canManage={canManage}><StatePanel variant="permission" title="Coach access is required" message="Only a coach or team leader can import tasks onto the board." /></TrackerTabs>;
  if (status === 'loading' && !project) return <TrackerTabs canManage={canManage}><StatePanel variant="loading" title="Loading import" message="Fetching this team's board." /></TrackerTabs>;
  if (status === 'error' && !project) return <TrackerTabs canManage={canManage}><StatePanel variant="error" title="Import could not load" message={requestState?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus /></TrackerTabs>;
  if (!project) return <TrackerTabs canManage={canManage}><StatePanel variant="empty" title="No board yet" message="Open the Tracker once to create this team's board, then come back." /></TrackerTabs>;

  return (
    <TrackerTabs canManage={canManage}>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Reconnect before importing; the preview still works." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
      <TaskImportPanel
        teamId={teamId}
        project={project}
        busy={busy}
        online={online}
        directory={directory}
        onRun={run}
        newOperationId={createOperationId}
      />
    </TrackerTabs>
  );
}
