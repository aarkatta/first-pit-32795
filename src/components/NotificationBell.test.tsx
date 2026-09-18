import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { NotificationRecord } from '@/lib/domain';
import type * as CoordinationData from '@/lib/coordination-data';

const mocks = vi.hoisted(() => ({
  subscribeUnreadNotificationCount: vi.fn(),
  subscribeRecentNotifications: vi.fn(),
  markNotificationRead: vi.fn(),
  unsubscribeCount: vi.fn(),
  unsubscribeRecent: vi.fn()
}));

vi.mock('@/lib/firebase', () => ({ getFirebaseServices: () => ({ firestore: 'firestore' }) }));
vi.mock('@/lib/phase3-service', () => ({ markNotificationRead: mocks.markNotificationRead }));
vi.mock('@/lib/coordination-data', async () => {
  const actual = await vi.importActual<typeof CoordinationData>('@/lib/coordination-data');
  return {
    ...actual,
    subscribeUnreadNotificationCount: mocks.subscribeUnreadNotificationCount,
    subscribeRecentNotifications: mocks.subscribeRecentNotifications
  };
});

import { NotificationBell } from './NotificationBell';

function notification(overrides: Partial<NotificationRecord>): NotificationRecord {
  return {
    id: 'n-1',
    teamId: 'team-1',
    createdBy: 'coach-1',
    recipientUserId: 'user-1',
    type: 'task.assigned',
    title: 'You were assigned a task',
    body: 'Build the attachment',
    deepLink: '/coordination?task=t-1',
    dedupeKey: 'n-1',
    mandatory: false,
    readAt: null,
    ...overrides
  };
}

function Where() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderBell() {
  return render(
    <MemoryRouter initialEntries={['/hub']}>
      <NotificationBell teamId="team-1" userId="user-1" online />
      <Routes><Route path="*" element={<Where />} /></Routes>
    </MemoryRouter>
  );
}

describe('NotificationBell', () => {
  let pushCount: (count: number) => void;
  let pushRecent: (records: NotificationRecord[]) => void;
  let failRecent: (error: Error) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.markNotificationRead.mockResolvedValue({ notificationId: 'n-1', read: true });
    mocks.subscribeUnreadNotificationCount.mockImplementation((_firestore, _teamId, _userId, onNext) => {
      pushCount = onNext;
      return mocks.unsubscribeCount;
    });
    mocks.subscribeRecentNotifications.mockImplementation((_firestore, _teamId, _userId, _max, onNext, onError) => {
      pushRecent = onNext;
      failRecent = onError;
      return mocks.unsubscribeRecent;
    });
  });

  it('shows no badge with nothing unread and a live badge once there is', () => {
    renderBell();
    expect(mocks.subscribeUnreadNotificationCount).toHaveBeenCalledWith('firestore', 'team-1', 'user-1', expect.any(Function), expect.any(Function));
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();

    act(() => pushCount(3));
    expect(screen.getByRole('button', { name: 'Notifications, 3 unread' })).toHaveTextContent('3');

    act(() => pushCount(100));
    expect(screen.getByRole('button', { name: 'Notifications, 99+ unread' })).toHaveTextContent('99+');
  });

  it('reads the recent list only while open, and opening an unread item marks it read and navigates', async () => {
    renderBell();
    expect(mocks.subscribeRecentNotifications).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    expect(screen.getByRole('region', { name: 'Recent notifications' })).toBeInTheDocument();
    expect(screen.getByText('Loading…')).toBeInTheDocument();

    act(() => pushRecent([notification({}), notification({ id: 'n-2', title: 'Already seen', readAt: new Date(), deepLink: '/files' })]));
    expect(screen.getByText('New')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'See all notifications' })).toHaveAttribute('href', '/notifications');

    fireEvent.click(screen.getByRole('button', { name: /You were assigned a task/ }));
    expect(mocks.markNotificationRead).toHaveBeenCalledWith('team-1', 'n-1');
    expect(screen.getByTestId('location')).toHaveTextContent('/coordination?task=t-1');
    expect(screen.queryByRole('region', { name: 'Recent notifications' })).not.toBeInTheDocument();
    expect(mocks.unsubscribeRecent).toHaveBeenCalled();
  });

  it('does not re-mark a read notification', () => {
    renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    act(() => pushRecent([notification({ readAt: new Date(), deepLink: '/files' })]));
    fireEvent.click(screen.getByRole('button', { name: /You were assigned a task/ }));
    expect(mocks.markNotificationRead).not.toHaveBeenCalled();
    expect(screen.getByTestId('location')).toHaveTextContent('/files');
  });

  it('shows empty and error states, and closes on Escape', () => {
    renderBell();
    const bell = screen.getByRole('button', { name: 'Notifications' });
    fireEvent.click(bell);
    act(() => pushRecent([]));
    expect(screen.getByText('Nothing has needed your attention on this team so far.')).toBeInTheDocument();

    act(() => failRecent(Object.assign(new Error('denied'), { code: 'permission-denied' })));
    expect(screen.queryByText('Nothing has needed your attention on this team so far.')).not.toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Recent notifications' })).not.toBeInTheDocument();
    expect(bell).toHaveFocus();
  });

  it('closes when clicking outside and unsubscribes on unmount', () => {
    const { unmount } = renderBell();
    fireEvent.click(screen.getByRole('button', { name: 'Notifications' }));
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('region', { name: 'Recent notifications' })).not.toBeInTheDocument();
    unmount();
    expect(mocks.unsubscribeCount).toHaveBeenCalled();
  });
});
