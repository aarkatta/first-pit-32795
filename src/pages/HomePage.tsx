import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { StatePanel } from '@/components/StatePanel';
import { LandingPage } from '@/features/landing/landing-page';
import { useAuth } from '@/lib/auth-context';
import { areaRows, dashboardHighlights, percentOf } from '@/lib/dashboard-view';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';
import { useTeamContext } from '@/lib/team-context';
import { getDashboard, type DashboardResult, type DashboardTask } from '@/lib/phase7-service';
import { markNotificationRead } from '@/lib/phase3-service';
import { safeInternalRoute } from '@/lib/notification-route';
import { formatDateLabel, formatDueDate, toDate } from '@/lib/dates';
import { dueTone } from '@/lib/board-view';
import { initialsOf, listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';
import '@/styles/dashboard.css';

function roleLabel(role: string | undefined) {
  return role === 'teamLeader' ? 'Team leader' : role ? role[0].toUpperCase() + role.slice(1) : 'Member';
}

function roleEmptyCopy(role: string | undefined) {
  if (role === 'coach' || role === 'teamLeader') return { title: 'Make this team useful', message: 'Create the first task or milestone so everyone has a clear next step.', action: '/coordination', label: 'Open coordination' };
  if (role === 'student') return { title: 'Nothing is assigned yet', message: 'Your coach or team leader has not assigned work yet. You can still browse team knowledge.', action: '/knowledge', label: 'Open knowledge' };
  if (role === 'parent') return { title: 'Follow the team safely', message: 'Visibility follows the team policy set by the coach.', action: '/team', label: 'Open your team' };
  return { title: 'Support the next milestone', message: 'Follow authorized work and team knowledge.', action: '/team', label: 'Open your team' };
}

function taskStatus(status: unknown) {
  if (status === 'inProgress') return { label: 'Working', className: 'working' };
  if (status === 'review') return { label: 'Review', className: 'review' };
  if (status === 'completed') return { label: 'Done', className: 'done' };
  return { label: 'To do', className: 'to-do' };
}

function taskLink(task: DashboardTask) {
  const project = task.projectId ? `project=${encodeURIComponent(task.projectId)}&` : '';
  return `/coordination?${project}task=${encodeURIComponent(task.id)}`;
}

export function HomePage() {
  const { status: authStatus, user } = useAuth();
  const { status: teamStatus, teams, activeTeam, setActiveTeamId } = useTeamContext();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [dashboard, setDashboard] = useState<DashboardResult | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [members, setMembers] = useState<Map<string, TeamMember>>(() => new Map());
  const dashboardRequest = useRef(0);
  const rosterRequest = useRef(0);

  const refresh = useCallback(async () => {
    if (!user || !activeTeam?.teamId) return;
    const requestId = ++dashboardRequest.current;
    setStatus('loading');
    setError(null);
    try {
      const nextDashboard = await getDashboard(activeTeam.teamId);
      if (requestId !== dashboardRequest.current) return;
      setDashboard(nextDashboard);
      setStatus('ready');
    } catch (nextError) {
      if (requestId !== dashboardRequest.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Dashboard could not load.'));
      setStatus('error');
    }
  }, [activeTeam?.teamId, user]);

  useEffect(() => {
    let current = true;
    if (!user || !activeTeam?.teamId) {
      dashboardRequest.current += 1;
      setDashboard(null);
      setStatus('idle');
      return () => { current = false; };
    }
    setStatus('loading');
    setError(null);
    const requestId = ++dashboardRequest.current;
    void getDashboard(activeTeam.teamId).then((nextDashboard) => {
      if (!current || requestId !== dashboardRequest.current) return;
      setDashboard(nextDashboard);
      setStatus('ready');
    }).catch((nextError: unknown) => {
      if (!current || requestId !== dashboardRequest.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Dashboard could not load.'));
      setStatus('error');
    });
    return () => { current = false; };
  }, [activeTeam?.teamId, user]);

  // `users/{uid}` is owner-readable, so assignees only become names through the
  // roster callable. Without it every task row printed a raw Firebase UID.
  useEffect(() => {
    let current = true;
    const requestId = ++rosterRequest.current;
    if (!user || !activeTeam?.teamId) {
      setMembers(new Map());
      return () => { current = false; };
    }
    void listTeamMembers(activeTeam.teamId).then((roster) => {
      if (current && requestId === rosterRequest.current) setMembers(memberMap(roster.members));
    }).catch((rosterError: unknown) => {
      if (!current || requestId !== rosterRequest.current) return;
      setMembers(new Map());
      setRequestState(getRequestState(rosterError, navigator.onLine));
    });
    return () => { current = false; };
  }, [activeTeam?.teamId, user]);

  if (authStatus === 'loading' || teamStatus === 'loading') return <StatePanel variant="loading" title="Loading your dashboard" message="First Pit is checking your secure session and active team memberships." />;

  if (authStatus !== 'authenticated' || !user) {
    return (
      <LandingPage />
    );
  }

  if (teamStatus === 'error') return <StatePanel variant="error" title="Your team shell could not load" message="First Pit could not verify your active team memberships." actionLabel="Retry" onAction={() => window.location.reload()} autoFocus />;
  if (!teams.length || !activeTeam) return <section className="feature-panel"><span className="eyebrow">TEAM DASHBOARD</span><h1>No active team yet</h1><p>Your private account is ready. A coach can invite you, or you can create the first team workspace.</p><div className="hero-actions"><Link className="button" to="/teams/new">Create a team</Link><Link className="button button--ghost" to="/profile">Complete profile</Link></div></section>;
  if (status === 'loading') return <StatePanel variant="loading" title="Loading your team dashboard" message={`Fetching a bounded summary for ${activeTeam.team?.name ?? 'your active team'}.`} />;
  if (status === 'error') {
    const state = getRequestState(error, online);
    return <StatePanel {...state} title={state.variant === 'permission' ? state.title : 'Dashboard could not load'} message={state.variant === 'permission' ? state.message : error?.message ?? state.message} actionLabel="Retry" onAction={() => void refresh()} autoFocus />;
  }
  if (!dashboard) return null;

  const emptyCopy = roleEmptyCopy(dashboard.role);
  const summary = dashboard.summary;
  const readiness = percentOf(summary.completedTaskCount, summary.taskCount);
  const openTaskCount = Math.max(0, summary.taskCount - summary.completedTaskCount);
  const completedGoalCount = summary.completedGoalCount ?? 0;
  const areas = areaRows(dashboard.areas);
  const taggedAreaCount = areas.filter((area) => area.taskCount > 0).length;
  const highlights = dashboardHighlights(dashboard);
  const upcomingTasks = dashboard.upcomingTasks ?? [];
  const now = new Date();

  function openDeepLink(deepLink: string, teamId: string, notificationId: string, unread: boolean) {
    if (teams.some((team) => team.teamId === teamId)) setActiveTeamId(teamId);
    if (unread) void markNotificationRead(teamId, notificationId).catch((readError: unknown) => setRequestState(getRequestState(readError, online)));
    navigate(safeInternalRoute(deepLink));
  }

  return (
    <div className="reference-page dashboard-page">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Showing the last available dashboard summary. Reconnect before saving changes." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}

      <header className="dashboard-header">
        <div>
          <span className="eyebrow">TEAM DASHBOARD</span>
          <h1>{dashboard.team.name}</h1>
          <p>{roleLabel(dashboard.role)} view · {summary.taskCount} task{summary.taskCount === 1 ? '' : 's'} · {summary.goalCount} milestone{summary.goalCount === 1 ? '' : 's'}</p>
        </div>
        <div className="dashboard-header__actions">
          <Link className="button button--ghost" to="/scorer">Open scorer</Link>
          <Link className="button" to="/coordination">Open project board</Link>
        </div>
      </header>

      <div className="dash-grid">
        <article className="dash-card dash-card--progress" aria-labelledby="dash-progress-title">
          <h2 id="dash-progress-title">Overall season progress</h2>
          <div className="ring ring--large" role="img" aria-label={`${readiness}% of team tasks complete`} style={{ '--value': String(readiness) } as CSSProperties}>
            <strong>{readiness}%</strong>
            <small>complete</small>
          </div>
          <dl className="dash-stats">
            <div><dt>Tasks complete</dt><dd>{summary.completedTaskCount} / {summary.taskCount}</dd></div>
            <div><dt>Milestones achieved</dt><dd>{completedGoalCount} / {summary.goalCount}</dd></div>
            <div><dt>Open tasks</dt><dd>{openTaskCount}</dd></div>
          </dl>
          {summary.taskCount === 0 ? <p className="dash-empty">{emptyCopy.message} <Link to={emptyCopy.action}>{emptyCopy.label}</Link></p> : null}
        </article>

        <article className="dash-card dash-card--areas" aria-labelledby="dash-areas-title">
          <h2 id="dash-areas-title">Progress by area</h2>
          <ul className="area-list">
            {areas.map((area) => (
              <li key={area.id}>
                <div className="area-list__head"><span>{area.label}</span><strong>{area.taskCount ? `${area.percent}%` : '—'}</strong></div>
                <div
                  className="meter"
                  role="progressbar"
                  aria-label={`${area.label} tasks complete`}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={area.percent}
                  aria-valuetext={area.taskCount ? `${area.completedTaskCount} of ${area.taskCount} tasks complete` : 'No tasks labelled yet'}
                >
                  <span style={{ '--value': String(area.percent) } as CSSProperties} />
                </div>
                <small>{area.taskCount ? `${area.completedTaskCount} of ${area.taskCount} tasks` : 'No tasks yet'}</small>
              </li>
            ))}
          </ul>
          {taggedAreaCount === 0 ? (
            <p className="dash-note">
              Add an area label to a task to track it here: {areas.map((area, index) => <span key={area.id}>{index ? ', ' : ''}<code>{area.id}</code></span>)}.
            </p>
          ) : null}
        </article>

        <article className="dash-card dash-card--highlights" aria-labelledby="dash-highlights-title">
          <h2 id="dash-highlights-title">Top achievements</h2>
          {highlights.length ? (
            <ul className="highlight-list">
              {highlights.map((highlight) => (
                <li key={highlight.id} className="highlight highlight--goal">
                  <span className="highlight__icon" aria-hidden="true"><Flag size={16} /></span>
                  <span><strong>{highlight.title}</strong><small>{highlight.detail}</small></span>
                </li>
              ))}
            </ul>
          ) : <p className="dash-empty">Achieve a milestone and it shows up here. <Link to="/milestones">Open milestones</Link></p>}
        </article>

        <article className="dash-card dash-card--upcoming" aria-labelledby="dash-upcoming-title">
          <div className="dash-card__heading"><h2 id="dash-upcoming-title">Upcoming tasks</h2><Link to="/coordination">View board →</Link></div>
          {upcomingTasks.length ? (
            <ul className="upcoming-list">
              {upcomingTasks.map((task) => {
                const due = toDate(task.dueAt);
                const tone = dueTone(due, now);
                const assignedTo = task.assignedTo ?? null;
                return (
                  <li key={task.id}>
                    <Link to={taskLink(task)}>
                      <span className={`status-dot ${taskStatus(task.status).className}`} aria-hidden="true" />
                      <span className="upcoming-list__copy">
                        <strong>{task.title || 'Task'}</strong>
                        <small>
                          <span className={`due due--${tone}`}>{tone === 'overdue' ? 'Overdue · ' : ''}Due {formatDueDate(due)}</span>
                          {' · '}{assignedTo ? nameOf(members, assignedTo) : 'Unassigned'}
                        </small>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : <p className="dash-empty">No open tasks have a due date. <Link to="/coordination">Plan the next task</Link></p>}
        </article>

      </div>

      <section className="section-heading"><div><span className="eyebrow">FOCUS</span><h3>Recently updated tasks</h3></div><Link to="/coordination">View full board <span>→</span></Link></section>
      {dashboard.tasks.length ? <div className="task-list">{dashboard.tasks.slice(0, 5).map((task) => {
        const taskState = taskStatus(task.status);
        const assignedTo = task.assignedTo ?? null;
        const assigneeName = nameOf(members, assignedTo);
        const dueDate = toDate(task.dueAt);
        return <Link to={taskLink(task)} key={task.id}><article><span className={`status-dot ${taskState.className}`} /><div className="task-copy"><strong>{task.title || 'Task'}</strong><small>{assignedTo ? `Assigned to ${assigneeName}` : 'Unassigned'}</small></div><span className={`status-pill ${taskState.className}`}>{taskState.label}</span><span className="avatar" title={assigneeName} aria-hidden="true">{initialsOf(members, assignedTo)}</span><span className={`due due--${dueTone(dueDate, now)}`}>{formatDateLabel(task.dueAt, 'No due date')}</span></article></Link>;
      })}</div> : <div className="board-tip"><span>START</span><p>{emptyCopy.message}</p><Link to={emptyCopy.action}>{emptyCopy.label}</Link></div>}

      <section className="chip-panel"><div><span className="eyebrow">NOTIFICATIONS</span><h3>Notifications</h3></div><div>{dashboard.notifications.length ? dashboard.notifications.slice(0, 8).map((notification) => <button key={notification.id} type="button" onClick={() => openDeepLink(notification.deepLink ?? '/coordination', notification.teamId || activeTeam.teamId, notification.id, notification.readAt == null)}>{notification.title || 'Notification'}{notification.readAt ? '' : ' · New'}</button>) : <span>Nothing needs your attention</span>}</div></section>
    </div>
  );
}
