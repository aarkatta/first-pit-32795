import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { LandingPage } from '@/features/landing/landing-page';
import { useAuth } from '@/lib/auth-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';
import { useTeamContext } from '@/lib/team-context';
import { getDashboard, type DashboardResult } from '@/lib/phase7-service';
import { markNotificationRead } from '@/lib/phase3-service';
import { safeInternalRoute } from '@/lib/notification-route';
import { formatDateLabel, toDate } from '@/lib/dates';
import { dueTone } from '@/lib/board-view';
import { initialsOf, listTeamMembers, memberMap, nameOf, type TeamMember } from '@/lib/directory';

function roleLabel(role: string | undefined) {
  return role === 'teamLeader' ? 'Team leader' : role ? role[0].toUpperCase() + role.slice(1) : 'Member';
}

function displayDate(value: unknown) {
  const date = toDate(value);
  return date ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date) : 'Date not set';
}

function roleEmptyCopy(role: string | undefined) {
  if (role === 'coach' || role === 'teamLeader') return { title: 'Make this team useful', message: 'Create the first task, event, goal, or score session so everyone has a clear next step.', action: '/coordination', label: 'Open coordination' };
  if (role === 'student') return { title: 'Nothing is assigned yet', message: 'Your coach or team leader has not assigned work yet. You can still browse team knowledge and chat.', action: '/knowledge', label: 'Open knowledge' };
  if (role === 'parent') return { title: 'Follow the team safely', message: 'Visibility follows the team policy set by the coach.', action: '/hub', label: 'Open team hub' };
  return { title: 'Support the next milestone', message: 'Follow authorized work, knowledge, chat, and scoring activity.', action: '/hub', label: 'Open team hub' };
}

function taskStatus(status: unknown) {
  if (status === 'inProgress') return { label: 'Working', className: 'working' };
  if (status === 'review') return { label: 'Review', className: 'review' };
  if (status === 'completed') return { label: 'Done', className: 'done' };
  return { label: 'To do', className: 'to-do' };
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
  const readiness = summary.taskCount ? Math.round((summary.completedTaskCount / summary.taskCount) * 100) : 0;
  const nextEvent = dashboard.events[0];

  function openDeepLink(deepLink: string, teamId: string, notificationId: string, unread: boolean) {
    if (teams.some((team) => team.teamId === teamId)) setActiveTeamId(teamId);
    if (unread) void markNotificationRead(teamId, notificationId).catch((readError: unknown) => setRequestState(getRequestState(readError, online)));
    navigate(safeInternalRoute(deepLink));
  }

  const widgets = [
    ['Assigned tasks', `${summary.taskCount - summary.completedTaskCount} open`],
    ['Upcoming events', `${summary.upcomingEventCount} next events shown`],
    ['Practice scores', `${summary.scoreCount} recorded`],
    ['Messages', `${summary.unreadMessageCount}${summary.unreadSummaryTruncated ? '+' : ''} in the newest ${summary.unreadSummaryLimit} unread notifications`],
    ['Announcements', `${summary.announcementCount}${summary.unreadSummaryTruncated ? '+' : ''} in the newest ${summary.unreadSummaryLimit} unread notifications`],
    ['Notifications', `${summary.unreadNotificationCount} need attention`]
  ];

  return (
    <div className="reference-page">
      {!online ? <StatePanel variant="offline" title="You are offline" message="Showing the last available dashboard summary. Reconnect before saving changes." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}

      <section className="hero-grid">
        <article className="mission-card">
          <div><span className="eyebrow light">{nextEvent ? `NEXT UP · ${displayDate(nextEvent.startsAt)}` : 'TEAM DASHBOARD'}</span><h3>{nextEvent ? nextEvent.title || 'Team event' : dashboard.team.name}</h3><p>{nextEvent ? `Your next ${nextEvent.eventType ?? 'team event'} is ready in the calendar.` : 'Create the first task or event so everyone has a clear next step.'}</p><Link to="/coordination">Open project board →</Link></div>
          <div className="mission-visual"><span>{String(summary.upcomingEventCount).padStart(2, '0')}</span><small>EVENTS</small><div className="mini-bot">▣</div></div>
        </article>
        <article className="score-card"><span className="eyebrow">TASK COMPLETION</span><div className="ring" role="img" aria-label={`${readiness}% of team tasks complete`} style={{ '--value': String(readiness) } as CSSProperties}><strong>{readiness}%</strong></div><p><b>{summary.completedTaskCount} complete.</b> {summary.taskCount} team tasks tracked.</p></article>
      </section>

      <section className="section-heading"><div><span className="eyebrow">DASHBOARD</span><h3>Today’s command center</h3></div><Link to="/coordination">Open calendar <span>→</span></Link></section>
      <div className="widget-grid">{widgets.map(([title, detail]) => <article key={title}><strong>{title}</strong><small>{detail}</small></article>)}</div>

      <section className="section-heading"><div><span className="eyebrow">FOCUS</span><h3>Assigned tasks</h3></div><Link to="/coordination">View full board <span>→</span></Link></section>
      {dashboard.tasks.length ? <div className="task-list">{dashboard.tasks.slice(0, 5).map((task) => {
        const taskState = taskStatus(task.status);
        const project = task.projectId ? `project=${encodeURIComponent(task.projectId)}&` : '';
        const assignedTo = task.assignedTo ?? null;
        const assigneeName = nameOf(members, assignedTo);
        const dueDate = toDate(task.dueAt);
        return <Link to={`/coordination?${project}task=${encodeURIComponent(task.id)}`} key={task.id}><article><span className={`status-dot ${taskState.className}`} /><div className="task-copy"><strong>{task.title || 'Task'}</strong><small>{assignedTo ? `Assigned to ${assigneeName}` : 'Unassigned'}</small></div><span className={`status-pill ${taskState.className}`}>{taskState.label}</span><span className="avatar" title={assigneeName} aria-hidden="true">{initialsOf(members, assignedTo)}</span><span className={`due due--${dueTone(dueDate, new Date())}`}>{formatDateLabel(task.dueAt, 'No due date')}</span></article></Link>;
      })}</div> : <div className="board-tip"><span>START</span><p>{emptyCopy.message}</p><Link to={emptyCopy.action}>{emptyCopy.label}</Link></div>}

      <section className="section-heading"><div><span className="eyebrow">ROLE INTERFACE</span><h3>{roleLabel(dashboard.role)} dashboard</h3></div><Link to="/profile">Manage profile <span>→</span></Link></section>
      <div className="role-interface-grid"><article className="active"><strong>{emptyCopy.title}</strong><p>{emptyCopy.message}</p></article><article><strong>Goal progress</strong><p>{summary.goalCount} team goal{summary.goalCount === 1 ? '' : 's'}; showing up to 20 recently updated.</p></article><article><strong>Recent scoring</strong><p>{dashboard.scores.length ? `${dashboard.scores[0].totalPoints ?? 0} points in the latest session.` : 'No score recorded yet.'}</p></article><article><strong>Team privacy</strong><p>Only authorized active team members can see this dashboard.</p></article></div>

      <section className="chip-panel"><div><span className="eyebrow">NOTIFICATIONS</span><h3>Notifications</h3></div><div>{dashboard.notifications.length ? dashboard.notifications.slice(0, 8).map((notification) => <button key={notification.id} type="button" onClick={() => openDeepLink(notification.deepLink ?? '/coordination', notification.teamId || activeTeam.teamId, notification.id, notification.readAt == null)}>{notification.title || 'Notification'}{notification.readAt ? '' : ' · New'}</button>) : <span>Nothing needs your attention</span>}</div></section>
    </div>
  );
}
