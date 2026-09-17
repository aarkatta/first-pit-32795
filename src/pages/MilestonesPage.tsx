import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { TrackerTabs } from '@/features/kanban/TrackerTabs';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import { isCoachOrLeader, type TeamGoal } from '@/lib/domain';
import { createGoal, goalVersion, updateGoal } from '@/lib/phase3-service';
import { formatRecordDate, loadTeamGoal, loadTeamGoals } from '@/lib/coordination-data';
import { useOnlineStatus } from '@/lib/use-online-status';
import { createOperationId } from '@/lib/ids';

/**
 * The top of the work breakdown: the deliverables a season is working toward.
 * Board categories are placed under a milestone in Board setup, and their cards
 * roll up into it — which is why this screen shows progress it never computes
 * itself, only the counters the server maintains.
 */
export function MilestonesPage() {
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dueAt, setDueAt] = useState('');
  const generation = useRef(0);
  const linkedGoalId = searchParams.get('goal');

  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    if (!teamId) return;
    setStatus('loading');
    setError(null);
    try {
      const next = await loadTeamGoals(firestore, teamId);
      if (attempt !== generation.current) return;
      setGoals(next);
      setStatus('ready');
    } catch (nextError) {
      if (attempt !== generation.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Milestones could not be loaded.'));
      setStatus('error');
    }
  }, [firestore, teamId]);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    // A `?goal=` link from search must resolve even when the milestone is older
    // than the page this screen loaded.
    if (status !== 'ready' || !teamId || !linkedGoalId || goals.some((goal) => goal.id === linkedGoalId)) return;
    const attempt = generation.current;
    void loadTeamGoal(firestore, teamId, linkedGoalId)
      .then((goal) => {
        if (attempt !== generation.current) return;
        if (!goal) throw new Error('The linked milestone was not found in this team.');
        setGoals((current) => [goal, ...current]);
      })
      .catch((nextError: unknown) => { if (attempt === generation.current) setRequestState(getRequestState(nextError, online)); });
  }, [firestore, goals, linkedGoalId, online, status, teamId]);

  useEffect(() => {
    if (status !== 'ready' || !linkedGoalId) return;
    const node = document.getElementById(`goal-${linkedGoalId}`);
    node?.scrollIntoView({ block: 'center' });
    node?.focus();
  }, [goals, linkedGoalId, status]);

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setRequestState(null);
    try {
      await action();
      await refresh();
    } catch (nextError) {
      setRequestState(getRequestState(nextError, online));
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!teamId || !title.trim()) return;
    void run(async () => {
      await createGoal({
        teamId,
        operationId: createOperationId(),
        title: title.trim(),
        ...(description.trim() ? { description: description.trim() } : {}),
        dueAt: dueAt ? new Date(dueAt).toISOString() : null
      });
      setTitle('');
      setDescription('');
      setDueAt('');
    });
  }

  /**
   * Marking a milestone achieved is the state the feature exists to reach: the
   * dashboard's "milestones achieved" and its highlights both read it. The
   * milestone's own version goes back with the edit, so two coaches acting at
   * once conflict instead of overwriting each other.
   */
  function setStatusOf(goal: TeamGoal, next: TeamGoal['status']) {
    if (!teamId) return;
    void run(() => updateGoal({ teamId, goalId: goal.id, operationId: createOperationId(), expectedVersion: goalVersion(goal), status: next }));
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading milestones" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Milestones become available after an active team membership is selected." />;
  if (status === 'loading' && !goals.length) return <TrackerTabs canManage={canManage}><StatePanel variant="loading" title="Loading milestones" message="Fetching this team's milestones." /></TrackerTabs>;
  if (status === 'error') return <TrackerTabs canManage={canManage}><StatePanel variant="error" title="Milestones could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus /></TrackerTabs>;

  return (
    <TrackerTabs canManage={canManage}>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Existing data may be stale. Changes are only saved once you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}

      <article className="feature-panel" aria-labelledby="team-goals-heading">
        <span className="eyebrow">MILESTONES</span>
        <h3 id="team-goals-heading">Team milestones</h3>
        <p>
          {goals.length
            ? 'The deliverables this season is working toward. Put a board category under a milestone in Board setup and its cards roll up here.'
            : 'No milestones yet. Add one, then put board categories under it from the Tracker’s Board setup.'}
        </p>

        <ul className="goal-list">
          {goals.map((goal) => {
            const percent = goal.taskCount ? Math.round((goal.completedTaskCount / goal.taskCount) * 100) : 0;
            const done = goal.status === 'completed';
            return (
              <li id={`goal-${goal.id}`} tabIndex={-1} key={goal.id} className={`goal-item${done ? ' is-complete' : ''}`}>
                <div className="goal-item__head">
                  <strong>{goal.title}</strong>
                  <span className={`goal-status goal-status--${goal.status}`}>{done ? 'Achieved' : goal.status === 'archived' ? 'Archived' : 'Active'}</span>
                </div>
                {goal.description ? <p className="goal-item__description">{goal.description}</p> : null}
                <div
                  className="goal-progress"
                  role="progressbar"
                  aria-valuenow={percent}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${goal.title} progress`}
                >
                  <span style={{ width: `${percent}%` }} />
                </div>
                <p className="goal-item__meta">
                  {goal.taskCount ? `${goal.completedTaskCount}/${goal.taskCount} tasks done` : 'No tasks linked yet'}
                  {goal.dueAt ? ` · due ${formatRecordDate(goal.dueAt)}` : ''}
                </p>
                {canManage ? (
                  <button className="text-button" type="button" disabled={busy || !online} onClick={() => setStatusOf(goal, done ? 'active' : 'completed')}>
                    {done ? 'Reopen milestone' : 'Mark achieved'}
                  </button>
                ) : null}
              </li>
            );
          })}
        </ul>

        {canManage ? (
          <form className="inline-create goal-create" onSubmit={submit}>
            <label>New milestone<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Innovation project ready for the expert demo" maxLength={160} required /></label>
            <label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What counts as done" maxLength={4000} /></label>
            <label>Target date<input type="date" value={dueAt} onChange={(event) => setDueAt(event.target.value)} /></label>
            <button className="button" disabled={busy} type="submit">Add milestone</button>
          </form>
        ) : null}
      </article>
    </TrackerTabs>
  );
}
