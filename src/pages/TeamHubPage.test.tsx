import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useTeamContext: vi.fn(), useAccountType: vi.fn(), updateTeamDetails: vi.fn(), listTeamMembers: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/account-type', () => ({ useAccountType: mocks.useAccountType }));
vi.mock('@/lib/team-service', () => ({ updateTeamDetails: mocks.updateTeamDetails }));
vi.mock('@/lib/directory', () => ({ listTeamMembers: mocks.listTeamMembers }));

import { TeamHubPage } from './TeamHubPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'user-1', email: 'coach@example.com' } });
  mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'coach' });
  mocks.listTeamMembers.mockResolvedValue({ members: [] });
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
    // Coaches see the full roster in administration, so no teammates row or
    // workspace-links panel here.
    expect(screen.queryByRole('region', { name: 'Teammates' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Open' })).not.toBeInTheDocument();
  });

  it('shows only the active team when the coach has several', () => {
    const robotics = { teamId: 'team-1', role: 'coach', status: 'active', team: { name: 'Robotics', id: 'team-1' } };
    const builders = { teamId: 'team-2', role: 'coach', status: 'active', team: { name: 'Builders', id: 'team-2' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [robotics, builders], activeTeam: robotics });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Robotics' })).toBeInTheDocument();
    expect(screen.queryByText('Builders')).not.toBeInTheDocument();
    expect(screen.getByText(/One of your 2 teams\. Everything below is for Robotics only/)).toBeInTheDocument();
  });

  it('shows a student a compact teammates row', async () => {
    const membership = { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics', id: 'team-1' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership });
    mocks.listTeamMembers.mockResolvedValue({ members: [
      { userId: 'coach-1', displayName: 'Coach Kim', role: 'coach', status: 'active' },
      { userId: 'user-1', displayName: 'Ava', role: 'student', status: 'active' }
    ] });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    const row = await screen.findByRole('region', { name: 'Teammates' });
    expect(await within(row).findByText('Coach Kim')).toBeInTheDocument();
    expect(within(row).getByText('Ava')).toBeInTheDocument();
    expect(screen.queryByText(/CURRENT MEMBERSHIP/)).not.toBeInTheDocument();
  });

  it('lets a coach edit the team name and number together', async () => {
    const patchTeam = vi.fn();
    const membership = { teamId: 'team-1', role: 'coach', status: 'active', team: { name: 'Robotics', id: 'team-1', teamNumber: null } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership, patchTeam });
    mocks.updateTeamDetails.mockResolvedValue({ teamId: 'team-1', name: 'TechSummer', teamNumber: '12345' });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Edit team name & number' }));
    expect(screen.getByLabelText('Team name')).toHaveValue('Robotics');
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'TechSummer' } });
    fireEvent.change(screen.getByLabelText('Team number'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateTeamDetails).toHaveBeenCalledWith('team-1', { name: 'TechSummer', teamNumber: '12345' }));
    expect(await screen.findByRole('heading', { name: 'TechSummer · Team #12345' })).toBeInTheDocument();
    expect(patchTeam).toHaveBeenCalledWith('team-1', { name: 'TechSummer', teamNumber: '12345' });
  });

  it('shows the team number to a student without an edit control', () => {
    const membership = { teamId: 'team-1', role: 'student', status: 'active', team: { name: 'Robotics', id: 'team-1', teamNumber: '777' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [membership], activeTeam: membership });
    render(<MemoryRouter><TeamHubPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Robotics · Team #777' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /team number/i })).not.toBeInTheDocument();
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
