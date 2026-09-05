import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useTeamContext: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));

import { TeamHubPage } from './TeamHubPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { email: 'coach@example.com' } });
});

describe('TeamHubPage', () => {
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
    expect(screen.getByRole('link', { name: /manage roster and invitations/i })).toBeInTheDocument();
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
