import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), useTeamContext: vi.fn(), useAccountType: vi.fn(), useOnlineStatus: vi.fn(), leaveTeam: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/account-type', () => ({ useAccountType: mocks.useAccountType }));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: mocks.useOnlineStatus }));
vi.mock('@/lib/phase2-service', () => ({ leaveTeam: mocks.leaveTeam }));

import { MembershipsPanel } from './MembershipsPanel';

const robotics = { teamId: 'team-1', role: 'coach', status: 'active', team: { id: 'team-1', name: 'Robotics', teamNumber: '12345' } };
const builders = { teamId: 'team-2', role: 'student', status: 'active', team: { id: 'team-2', name: 'Builders' } };

function renderPanel() {
  return render(<MemoryRouter><MembershipsPanel /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'user-1' } });
  mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'coach' });
  mocks.useOnlineStatus.mockReturnValue(true);
  mocks.useTeamContext.mockReturnValue({ teams: [robotics, builders] });
  mocks.leaveTeam.mockResolvedValue({});
});

describe('MembershipsPanel', () => {
  it('lists every team with its role, not just the active one', () => {
    renderPanel();
    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0]).getByText('Robotics · Team #12345')).toBeInTheDocument();
    expect(within(rows[0]).getByText('Coach')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Builders')).toBeInTheDocument();
    expect(within(rows[1]).getByText('Student')).toBeInTheDocument();
  });

  it('requires a confirmation before leaving, and leaves only that team', async () => {
    renderPanel();
    const builderRow = screen.getAllByRole('listitem')[1];
    fireEvent.click(within(builderRow).getByRole('button', { name: 'Leave…' }));
    expect(mocks.leaveTeam).not.toHaveBeenCalled();
    fireEvent.click(within(builderRow).getByRole('button', { name: 'Cancel' }));
    expect(within(builderRow).queryByRole('button', { name: /yes, leave/i })).not.toBeInTheDocument();

    fireEvent.click(within(builderRow).getByRole('button', { name: 'Leave…' }));
    fireEvent.click(within(builderRow).getByRole('button', { name: 'Yes, leave Builders' }));
    await waitFor(() => expect(mocks.leaveTeam).toHaveBeenCalledWith('team-2'));
    expect(await screen.findByText('You left Builders.')).toBeInTheDocument();
  });

  it('warns a coach about leadership before they leave', () => {
    renderPanel();
    fireEvent.click(within(screen.getAllByRole('listitem')[0]).getByRole('button', { name: 'Leave…' }));
    expect(screen.getByText(/transfer leadership on Manage team first/i)).toBeInTheDocument();
  });

  it('shows the server refusal verbatim, since it says what to do', async () => {
    mocks.leaveTeam.mockRejectedValue(new Error('A team must keep at least one active coach. Transfer leadership before leaving or changing this role.'));
    renderPanel();
    const row = screen.getAllByRole('listitem')[0];
    fireEvent.click(within(row).getByRole('button', { name: 'Leave…' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Yes, leave Robotics' }));
    expect(await screen.findByText(/transfer leadership before leaving/i)).toBeInTheDocument();
  });

  it('offers joining another team always, and creating one only to coach accounts', () => {
    mocks.useTeamContext.mockReturnValue({ teams: [robotics] });
    const { unmount } = renderPanel();
    expect(screen.getByRole('link', { name: 'Accept an invitation' })).toHaveAttribute('href', '/join');
    expect(screen.getByRole('link', { name: 'Create another team' })).toHaveAttribute('href', '/teams/new');
    unmount();
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'student' });
    renderPanel();
    expect(screen.queryByRole('link', { name: /create/i })).not.toBeInTheDocument();
  });

  it('never offers team creation to someone who is a student on any team, whatever their account says', () => {
    // Mirrors teamCreationRefusal on the server: robotics + builders makes this
    // coach account a student on Builders.
    renderPanel();
    expect(screen.getByRole('link', { name: 'Accept an invitation' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /create/i })).not.toBeInTheDocument();
  });

  it('disables leaving while offline', () => {
    mocks.useOnlineStatus.mockReturnValue(false);
    renderPanel();
    for (const button of screen.getAllByRole('button', { name: 'Leave…' })) expect(button).toBeDisabled();
  });

  it('handles having no teams', () => {
    mocks.useTeamContext.mockReturnValue({ teams: [] });
    renderPanel();
    expect(screen.getByText(/not on any team right now/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create a team' })).toBeInTheDocument();
  });
});
