import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { useAuth } from '@/lib/auth-context';
import type { NotificationRecord } from '@/lib/domain';
import { markNotificationRead } from '@/lib/phase3-service';
import { formatRecordDate, loadTeamNotifications } from '@/lib/coordination-data';
import { safeInternalRoute } from '@/lib/notification-route';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * This member's notifications for the active team. Notifications are
 * recipient-isolated by the Firestore rules, so this screen shows one person's
 * mailbox and never the team's.
 */
export function NotificationsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { activeTeam, status: teamStatus } = useTeamContext();
  const online = useOnlineStatus();
  const firestore = getFirebaseServices().firestore;
  const teamId = activeTeam?.teamId ?? null;
  const [notifications, setNotifications] = useState<NotificationRecord[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    if (!teamId || !user) return;
    setStatus('loading');
    setError(null);
    try {
      const next = await loadTeamNotifications(firestore, teamId, user.uid);
      if (attempt !== generation.current) return;
      setNotifications(next);
      setStatus('ready');
    } catch (nextError) {
      if (attempt !== generation.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Notifications could not be loaded.'));
      setStatus('error');
    }
  }, [firestore, teamId, user]);

  useEffect(() => { void refresh(); }, [refresh]);

  function open(notification: NotificationRecord) {
    if (!teamId) return;
    setBusy(true);
    setRequestState(null);
    void (async () => {
      try {
        // Marking read must not stop the user reaching what the notification is
        // about, so the navigation happens either way.
        if (!notification.readAt) await markNotificationRead(teamId, notification.id);
      } catch (nextError) {
        setRequestState(getRequestState(nextError, online));
      } finally {
        setBusy(false);
        navigate(safeInternalRoute(notification.deepLink));
      }
    })();
  }

  if (teamStatus === 'loading') return <StatePanel variant="loading" title="Loading notifications" message="Checking your active team membership." />;
  if (!teamId || !user) return <StatePanel variant="empty" title="Choose a team" message="Notifications become available after an active team membership is selected." />;
  if (status === 'loading' && !notifications.length) return <StatePanel variant="loading" title="Loading notifications" message="Fetching your most recent team updates." />;
  if (status === 'error') return <StatePanel variant="error" title="Notifications could not load" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void refresh()} autoFocus />;

  const unread = notifications.filter((notification) => !notification.readAt).length;

  return (
    <div className="reference-page monday">
      {!online ? <StatePanel variant="offline" title="You are offline" message="This list may be stale until you reconnect." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}

      <article className="feature-panel" aria-labelledby="team-updates-heading">
        <span className="eyebrow">NOTIFICATIONS</span>
        <h3 id="team-updates-heading">Team updates</h3>
        <p>{notifications.length ? `${unread} unread of ${notifications.length}. Opening one marks it read and takes you to it.` : 'Assignments, card moves and safety notices appear here.'}</p>

        {notifications.length ? (
          <ul className="notification-list">
            {notifications.map((notification) => (
              <li key={notification.id} className={notification.readAt ? undefined : 'is-unread'}>
                <button type="button" disabled={busy} onClick={() => open(notification)}>
                  <span className="notification-title">
                    {notification.title}
                    {notification.readAt ? null : <span className="notification-dot" aria-label="Unread">New</span>}
                  </span>
                  {notification.body ? <small className="notification-body">{notification.body}</small> : null}
                  <small className="notification-meta">{formatRecordDate(notification.createdAt)}</small>
                </button>
              </li>
            ))}
          </ul>
        ) : <StatePanel variant="empty" title="No notifications yet" message="Nothing has needed your attention on this team so far." />}
      </article>
    </div>
  );
}
