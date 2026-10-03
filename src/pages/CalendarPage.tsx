import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { TrackerTabs } from '@/features/kanban/TrackerTabs';
import { useAuth } from '@/lib/auth-context';
import {
  addMonths,
  calendarEntries,
  dayKey,
  filterEntriesForMember,
  groupEntriesByDay,
  monthGrid,
  monthLabel,
  startOfMonth,
  undatedTaskCount,
  weekdayLabels,
  type CalendarEntry
} from '@/lib/calendar-view';
import { loadTeamGoals } from '@/lib/coordination-data';
import { isCoachOrLeader, type TeamGoal, type TrackerTask } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import { subscribeProjectTasks } from '@/lib/kanban-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useOnlineStatus } from '@/lib/use-online-status';
import { useTeamBoard } from '@/lib/use-team-board';

/** Chips drawn in a day cell before the rest collapse into "+N more". */
const MAX_CHIPS_PER_DAY = 3;

function EntryChip({ entry }: { entry: CalendarEntry }) {
  const kind = entry.kind === 'milestone' ? 'Milestone' : 'Task';
  return (
    <Link
      to={entry.href}
      className={`cal-chip cal-chip--${entry.kind} mb-color-${entry.color}${entry.done ? ' is-done' : ''}`}
      title={entry.title}
      aria-label={`${kind}: ${entry.title}${entry.done ? ' (done)' : ''}`}
    >
      <span aria-hidden="true">{entry.kind === 'milestone' ? '◎' : ''}</span>
      {entry.title}
    </Link>
  );
}

/**
 * The tracker by date. It adds no data of its own: the cards are the board's,
 * placed on their deadline, and the milestones are the ones on the Milestones
 * tab, placed on their target date. Everything opens back where it is edited.
 */
export function CalendarPage() {
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const canManage = isCoachOrLeader(activeTeam);
  const { project, status: boardStatus, requestState: boardError, refresh } = useTeamBoard(teamId, online);
  const [tasks, setTasks] = useState<TrackerTask[]>([]);
  const [tasksReady, setTasksReady] = useState(false);
  const [goals, setGoals] = useState<TeamGoal[]>([]);
  const [notice, setNotice] = useState<RequestState | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState(() => dayKey(new Date()));
  const [onlyMine, setOnlyMine] = useState(false);
  // Read by the listener's error handler, which must not resubscribe on reconnect.
  const onlineRef = useRef(online);
  onlineRef.current = online;

  useEffect(() => {
    if (!teamId || !project) return;
    let active = true;
    setTasks([]);
    setTasksReady(false);
    setNotice(null);
    const unsubscribe = subscribeProjectTasks(firestore, teamId, project, (next) => {
      if (!active) return;
      setTasks(next);
      setTasksReady(true);
    }, (error) => {
      if (active) setNotice({ ...getRequestState(error, onlineRef.current), title: 'Some tasks could not load' });
    });
    return () => {
      active = false;
      unsubscribe();
    };
    // `attempt` is the retry handle for the notice: bumping it rebuilds the listeners.
  }, [attempt, firestore, project, teamId]);

  useEffect(() => {
    if (!teamId) return;
    let active = true;
    setGoals([]);
    // The calendar is still useful without milestones, so a failed read leaves
    // them off rather than replacing the tasks with an error.
    loadTeamGoals(firestore, teamId)
      .then((next) => { if (active) setGoals(next); })
      .catch(() => { if (active) setGoals([]); });
    return () => { active = false; };
  }, [attempt, firestore, teamId]);

  const now = useMemo(() => new Date(), []);
  const days = useMemo(() => monthGrid(month, now), [month, now]);
  const weekdays = useMemo(() => weekdayLabels(), []);
  const entries = useMemo(() => {
    const all = calendarEntries(tasks, goals, project);
    return onlyMine && user ? filterEntriesForMember(all, user.uid) : all;
  }, [goals, onlyMine, project, tasks, user]);
  const byDay = useMemo(() => groupEntriesByDay(entries), [entries]);
  const undated = useMemo(() => undatedTaskCount(tasks), [tasks]);
  const monthHasEntries = days.some((day) => day.inMonth && byDay.has(day.key));
  const selectedDay = days.find((day) => day.key === selectedKey) ?? null;
  const selectedEntries = byDay.get(selectedKey) ?? [];

  function showMonth(next: Date, select?: Date) {
    setMonth(startOfMonth(next));
    setSelectedKey(dayKey(select ?? startOfMonth(next)));
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading the calendar" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="The calendar becomes available after an active team membership is selected." />;
  if (boardStatus === 'error' && boardError) {
    return <TrackerTabs canManage={canManage}><StatePanel {...boardError} actionLabel="Retry" onAction={() => void refresh()} autoFocus /></TrackerTabs>;
  }
  if (boardStatus !== 'ready' || (project && !tasksReady && !notice)) {
    return <TrackerTabs canManage={canManage}><StatePanel variant="loading" title="Loading the calendar" message="Fetching this team's tasks and milestones." /></TrackerTabs>;
  }

  return (
    <TrackerTabs canManage={canManage}>
      {!online ? <StatePanel variant="offline" title="You are offline" message="Existing data may be stale. The calendar updates once you reconnect." /> : null}
      {notice ? <StatePanel {...notice} actionLabel="Retry" onAction={() => setAttempt((current) => current + 1)} /> : null}

      <article className="feature-panel cal" aria-labelledby="calendar-heading">
        <header className="cal-header">
          <div>
            <span className="eyebrow">CALENDAR</span>
            <h3 id="calendar-heading" aria-live="polite">{monthLabel(month)}</h3>
          </div>
          <div className="cal-actions">
            <label className="cal-toggle">
              <input type="checkbox" checked={onlyMine} onChange={(event) => setOnlyMine(event.target.checked)} />
              Only my tasks
            </label>
            <button type="button" className="cal-nav" onClick={() => showMonth(addMonths(month, -1))} aria-label="Previous month">‹</button>
            <button type="button" className="cal-nav" onClick={() => showMonth(now, now)}>Today</button>
            <button type="button" className="cal-nav" onClick={() => showMonth(addMonths(month, 1))} aria-label="Next month">›</button>
          </div>
        </header>

        {!project ? (
          <p>This team has no board yet, so only milestones appear here. Open the Board tab to set one up.</p>
        ) : !monthHasEntries ? (
          <p>
            Nothing is dated in {monthLabel(month)}{onlyMine ? ' for you' : ''}. Give a task a due date on the Board, or a milestone a target date, and it appears here.
          </p>
        ) : null}

        <div className="cal-grid" role="list" aria-label={`Days of ${monthLabel(month)}`}>
          {weekdays.map((weekday) => <div key={weekday} className="cal-weekday" aria-hidden="true">{weekday}</div>)}
          {days.map((day) => {
            const dayEntries = byDay.get(day.key) ?? [];
            const shown = dayEntries.slice(0, MAX_CHIPS_PER_DAY);
            const hidden = dayEntries.length - shown.length;
            const label = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(day.date);
            return (
              <div
                key={day.key}
                role="listitem"
                className={`cal-day${day.inMonth ? '' : ' is-outside'}${day.isToday ? ' is-today' : ''}${day.key === selectedKey ? ' is-selected' : ''}`}
              >
                <button
                  type="button"
                  className="cal-day__number"
                  aria-pressed={day.key === selectedKey}
                  aria-label={`${label}, ${dayEntries.length} ${dayEntries.length === 1 ? 'item' : 'items'}`}
                  onClick={() => setSelectedKey(day.key)}
                >
                  {day.date.getDate()}
                  {dayEntries.length ? <span className="cal-day__count" aria-hidden="true">{dayEntries.length}</span> : null}
                </button>
                <div className="cal-day__entries">
                  {shown.map((entry) => <EntryChip key={entry.key} entry={entry} />)}
                  {hidden > 0 ? (
                    <button type="button" className="cal-more" onClick={() => setSelectedKey(day.key)}>+{hidden} more</button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <section className="cal-agenda" aria-labelledby="calendar-day-heading" aria-live="polite">
          <h4 id="calendar-day-heading">
            {selectedDay
              ? new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(selectedDay.date)
              : 'Pick a day'}
          </h4>
          {selectedEntries.length ? (
            <ul>
              {selectedEntries.map((entry) => <li key={entry.key}><EntryChip entry={entry} /></li>)}
            </ul>
          ) : (
            <p>Nothing due on this day.</p>
          )}
        </section>

        {undated > 0 ? (
          <p className="cal-footnote">
            {undated} {undated === 1 ? 'task has' : 'tasks have'} no date and {undated === 1 ? 'is' : 'are'} not shown.{' '}
            <Link to="/coordination">Add dates on the Board</Link>.
          </p>
        ) : null}
      </article>
    </TrackerTabs>
  );
}
