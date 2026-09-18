import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { StatePanel } from './StatePanel';
import type { NotificationRecord } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';
import {
  formatRecordDate,
  formatUnreadBadge,
  subscribeRecentNotifications,
  subscribeUnreadNotificationCount
} from '@/lib/coordination-data';
import { markNotificationRead } from '@/lib/phase3-service';
import { safeInternalRoute } from '@/lib/notification-route';
import { getRequestState, type RequestState } from '@/lib/request-state';

type NotificationBellProps = {
  teamId: string;
  userId: string;
  online: boolean;
};

const RECENT_LIMIT = 8;

/**
 * Top-bar bell: a live unread count for the active team, and a short list of
 * the latest notifications. The full mailbox stays at `/notifications`.
 */
export function NotificationBell({ teamId, userId, online }: NotificationBellProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const panelId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(0);
  const [recent, setRecent] = useState<NotificationRecord[] | null>(null);
  const [listState, setListState] = useState<RequestState | null>(null);
  const [actionState, setActionState] = useState<RequestState | null>(null);

  // The count is always live; a failed listener simply shows no badge.
  useEffect(() => {
    setUnread(0);
    return subscribeUnreadNotificationCount(getFirebaseServices().firestore, teamId, userId, setUnread, () => setUnread(0));
  }, [teamId, userId]);

  // The list is only read while the panel is open.
  useEffect(() => {
    if (!open) return undefined;
    setRecent(null);
    setListState(null);
    return subscribeRecentNotifications(getFirebaseServices().firestore, teamId, userId, RECENT_LIMIT, setRecent, (error) => setListState(getRequestState(error, online)));
  }, [open, teamId, userId, online]);

  // Navigating anywhere closes the panel.
  useEffect(() => { setOpen(false); }, [location.pathname, teamId]);

  useEffect(() => {
    if (!open) return undefined;
    function onPointerDown(event: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    }
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  function openNotification(notification: NotificationRecord) {
    setActionState(null);
    setOpen(false);
    // Marking read must not stop the user reaching what the notification is about.
    if (!notification.readAt) {
      void markNotificationRead(teamId, notification.id).catch((error: unknown) => setActionState(getRequestState(error, online)));
    }
    navigate(safeInternalRoute(notification.deepLink));
  }

  const badge = unread > 0 ? formatUnreadBadge(unread) : null;
  const label = badge ? `Notifications, ${badge} unread` : 'Notifications';

  return (
    <div className="notification-bell" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="top-action notification-bell__button"
        aria-label={label}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((value) => !value)}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        {badge ? <span className="notification-bell__badge" aria-hidden="true">{badge}</span> : null}
      </button>

      {actionState && !open ? (
        <div className="notification-bell__panel" role="alert">
          <StatePanel {...actionState} actionLabel="Dismiss" onAction={() => setActionState(null)} />
        </div>
      ) : null}

      {open ? (
        <div className="notification-bell__panel" id={panelId} role="region" aria-label="Recent notifications">
          <div className="notification-bell__head">
            <strong>Notifications</strong>
            <small>{unread ? `${formatUnreadBadge(unread)} unread` : 'All caught up'}</small>
          </div>

          {!online ? <p className="notification-bell__note">You are offline; this list may be stale.</p> : null}

          {listState ? <StatePanel {...listState} actionLabel="Close" onAction={() => setOpen(false)} /> : null}
          {!listState && recent === null ? <p className="notification-bell__note">Loading…</p> : null}
          {!listState && recent?.length === 0 ? <p className="notification-bell__note">Nothing has needed your attention on this team so far.</p> : null}

          {!listState && recent?.length ? (
            <ul className="notification-list notification-list--compact">
              {recent.map((notification) => (
                <li key={notification.id} className={notification.readAt ? undefined : 'is-unread'}>
                  <button type="button" onClick={() => openNotification(notification)}>
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
          ) : null}

          <Link className="notification-bell__all" to="/notifications">See all notifications</Link>
        </div>
      ) : null}
    </div>
  );
}
