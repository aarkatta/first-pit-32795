import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useTeamContext: vi.fn(),
  doc: vi.fn(() => 'profile-ref'),
  onSnapshot: vi.fn(),
  unsubscribe: vi.fn(),
  getFirebaseServices: vi.fn(() => ({ firestore: 'firestore' }))
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/firebase', () => ({ getFirebaseServices: mocks.getFirebaseServices }));
vi.mock('firebase/firestore', () => ({ doc: mocks.doc, onSnapshot: mocks.onSnapshot }));
vi.mock('./NotificationBell', () => ({
  NotificationBell: ({ teamId, userId }: { teamId: string; userId: string }) => <button type="button">{`Bell ${teamId} ${userId}`}</button>
}));

import { AppShell } from './AppShell';

describe('AppShell route and canonical profile metadata', () => {
  const signOut = vi.fn();
  const setActiveTeamId = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useAuth.mockReturnValue({ status: 'authenticated', user: { uid: 'user-1', email: 'auth@example.com', displayName: 'Stale Auth' }, signOut });
    mocks.useTeamContext.mockReturnValue({
      teams: [
        { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics' } },
        { teamId: 'team-2', role: 'coach', status: 'active', team: { name: 'Builders' } }
      ],
      activeTeamId: 'team-1',
      setActiveTeamId
    });
    mocks.onSnapshot.mockImplementation((_ref, next) => {
      next({ data: () => ({ displayName: 'Saved Profile', photoURL: null }) });
      return mocks.unsubscribe;
    });
  });

  it('names and exposes Knowledge in desktop/mobile navigation and shows the Firestore profile', () => {
    const { unmount } = render(<MemoryRouter initialEntries={['/knowledge']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Knowledge content</p></AppShell></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Knowledge' })).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Knowledge' })).toHaveLength(2);
    expect(screen.getByText('Saved Profile')).toBeInTheDocument();
    expect(document.title).toBe('Knowledge | First Pit');
    unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('switches teams, hides admin for students, and signs out once', async () => {
    render(<MemoryRouter initialEntries={['/knowledge']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Knowledge content</p></AppShell></MemoryRouter>);
    // Administration is a coach-only tab inside Manage team, not a sidebar entry.
    expect(screen.queryByRole('link', { name: 'Team admin' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Manage team' })).toHaveLength(2);
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch active team' }), { target: { value: 'team-2' } });
    expect(setActiveTeamId).toHaveBeenCalledWith('team-2');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(signOut).toHaveBeenCalledOnce());
  });

  it('keeps four primary mobile destinations and exposes all permitted secondary actions', () => {
    mocks.useTeamContext.mockReturnValue({
      teams: [
        { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics' } },
        { teamId: 'team-2', role: 'coach', status: 'active', team: { name: 'Builders' } }
      ],
      activeTeamId: 'team-2',
      setActiveTeamId
    });
    render(<MemoryRouter initialEntries={['/scorer']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Scorer content</p></AppShell></MemoryRouter>);
    const primary = screen.getByRole('navigation', { name: 'Mobile navigation' });
    expect(within(primary).getAllByRole('link')).toHaveLength(4);
    expect(within(primary).getAllByRole('link').map((link) => link.textContent)).toEqual(['⌂Home', '▤Manage team', '▦Tracker', '?Knowledge']);

    fireEvent.click(screen.getByLabelText('Open workspace menu'));
    const secondary = screen.getByRole('navigation', { name: 'Mobile secondary navigation' });
    expect(within(secondary).getByRole('link', { name: 'Scorer' })).toBeInTheDocument();
    expect(within(secondary).getByRole('link', { name: 'Team files' })).toBeInTheDocument();
    // Notifications moved to the top-bar bell.
    expect(within(secondary).queryByRole('link', { name: 'Notifications' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bell team-2 user-1' })).toBeInTheDocument();
    // Milestones, Import tasks and Board setup are tabs of the tracker, not
    // destinations of their own.
    expect(within(secondary).queryByRole('link', { name: 'Milestones' })).not.toBeInTheDocument();
    expect(within(secondary).queryByRole('link', { name: 'Board setup' })).not.toBeInTheDocument();
    expect(within(secondary).queryByRole('link', { name: 'Search' })).not.toBeInTheDocument();
    expect(within(secondary).queryByRole('link', { name: 'Team admin' })).not.toBeInTheDocument();
    expect(within(secondary).getByRole('link', { name: 'Profile & settings' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('combobox', { name: 'Switch active team from mobile menu' }), { target: { value: 'team-1' } });
    expect(setActiveTeamId).toHaveBeenCalledWith('team-1');
    expect(screen.getByRole('button', { name: 'Sign out from mobile menu' })).toBeInTheDocument();
  });

  it('renders an offline retry state when sign-out fails', async () => {
    signOut.mockRejectedValueOnce(new Error('network failed'));
    render(<MemoryRouter initialEntries={['/profile']}><AppShell online={false} appName="First Pit" appTagline="Team hub"><p>Profile content</p></AppShell></MemoryRouter>);
    expect(screen.getByText('Offline')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('falls back to Auth metadata when the profile listener errors', () => {
    mocks.onSnapshot.mockImplementation((_ref, _next, error) => {
      error(new Error('profile denied'));
      return mocks.unsubscribe;
    });
    render(<MemoryRouter initialEntries={['/']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Home content</p></AppShell></MemoryRouter>);
    expect(screen.getByText('Stale Auth')).toBeInTheDocument();
  });

  it('titles routes without a navigation entry and falls back to not found', () => {
    render(<MemoryRouter initialEntries={['/profile']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Profile content</p></AppShell></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Profile & settings' })).toBeInTheDocument();
    expect(document.title).toBe('Profile & settings | First Pit');
  });

  it('labels an unknown route as not found instead of Home', () => {
    render(<MemoryRouter initialEntries={['/does-not-exist']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Missing</p></AppShell></MemoryRouter>);
    expect(screen.getByRole('heading', { level: 1, name: 'Not found' })).toBeInTheDocument();
    expect(document.title).toBe('Not found | First Pit');
  });

  it('lists only product destinations: no State lab, Emulators or Search', () => {
    render(<MemoryRouter initialEntries={['/team']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Team content</p></AppShell></MemoryRouter>);
    const primary = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(primary).getAllByRole('link').map((link) => link.textContent)).toEqual(['⌂Home', '▤Manage team', '▦Tracker', '🗎Team files', '?Knowledge', '◫Scorer']);
    expect(screen.queryByRole('link', { name: 'Search team workspace' })).not.toBeInTheDocument();
  });

  it('keeps public auth content outside the workspace shell while signed out', () => {
    mocks.useAuth.mockReturnValue({ status: 'unauthenticated', user: null, signOut });
    mocks.useTeamContext.mockReturnValue({ teams: [], activeTeamId: null, setActiveTeamId });
    render(<MemoryRouter initialEntries={['/auth']}><AppShell online appName="First Pit" appTagline="Team hub"><p>Sign-in form</p></AppShell></MemoryRouter>);
    expect(screen.getByText('Sign-in form')).toBeInTheDocument();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });
});
