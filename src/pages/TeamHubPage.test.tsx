import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useTeamContext: vi.fn(), useAccountType: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/account-type', () => ({ useAccountType: mocks.useAccountType }));

import { TeamHubPage } from './TeamHubPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'user-1', email: 'coach@example.com' } });
  mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'coach' });
});

describe('TeamHubPage', () => {
  it('offers team creation to coach accounts and to accounts with no type yet', () => {
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    const { rerender } = render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /create a team/i }).length).toBeGreaterThan(0);
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    rerender(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /create a team/i }).length).toBeGreaterThan(0);
  });

  it.each(['student', 'parent'])('hides Create another team from an older account with no type that is a %s on the team', (role) => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    const membership = { teamId: 'team-1', role, status: 'active', team: { name: 'Robotics', id: 'team-1' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Robotics' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create another team/i })).not.toBeInTheDocument();
  });

  it('still offers Create another team to a coach on the team', () => {
    const membership = { teamId: 'team-1', role: 'coach', status: 'active', team: { name: 'Robotics', id: 'team-1' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /create another team/i })).toHaveAttribute('href', '/teams/new');
  });

  it.each(['student', 'parent'])('never offers team creation to a %s account', (accountType) => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType });
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    const { unmount } = render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /create a team/i })).not.toBeInTheDocument();
    expect(screen.getByText('Ask your coach')).toBeInTheDocument();
    unmount();
    const membership = { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics', id: 'team-1' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: /create another team/i })).not.toBeInTheDocument();
  });

  it('renders loading, error, and empty membership states', () => {
    mocks.useTeamContext.mockReturnValue({ status: 'loading', teams: [], activeTeam: null });
    const { rerender } = render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByText(/loading your teams/i)).toBeInTheDocument();
    mocks.useTeamContext.mockReturnValue({ status: 'error', teams: [], activeTeam: null, error: new Error('Network error'), retry: vi.fn() });
    rerender(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByText(/teams could not load/i)).toBeInTheDocument();
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    rerender(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByText(/no active team memberships/i)).toBeInTheDocument();
  });

  it('renders active team context and coach status', () => {
    mocks.useTeamContext.mockReturnValue({
      status: 'ready',
      teams: [{ teamId: 'team-1', role: 'coach', status: 'active', team: { name: 'Robotics', id: 'team-1' } }],
      activeTeam: { teamId: 'team-1', role: 'coach', status: 'active', team: { name: 'Robotics', id: 'team-1' } }
    });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Robotics' })).toBeInTheDocument();
    // The administration sections sit below the overview on the same page now.
    expect(screen.queryByRole('link', { name: /manage roster and invitations/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open' }).length).toBeGreaterThan(0);
  });

  it('requires a confirmation step before leaving a team', () => {
    mocks.useTeamContext.mockReturnValue({
      status: 'ready',
      teams: [{ teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics', id: 'team-1' } }],
      activeTeam: { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics', id: 'team-1' } }
    });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.queryByRole('button', { name: /yes, leave robotics/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /leave team/i }));
    expect(screen.getByRole('button', { name: /yes, leave robotics/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /yes, leave robotics/i })).not.toBeInTheDocument();
  });
});
