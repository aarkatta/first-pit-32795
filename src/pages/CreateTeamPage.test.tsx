import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), createTeam: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-service', () => ({ createTeam: mocks.createTeam }));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }));

import { CreateTeamPage } from './CreateTeamPage';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'coach-1' } });
  mocks.createTeam.mockResolvedValue({ teamId: 'team-1' });
});

describe('CreateTeamPage', () => {
  it('submits the team name to the server', async () => {
    render(<MemoryRouter><CreateTeamPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Robotics Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith('Robotics Team'));
  });

  it('shows a retryable error message from the server', async () => {
    mocks.createTeam
      .mockRejectedValueOnce(new Error('The server is unavailable.'))
      .mockResolvedValueOnce({ teamId: 'team-1' });
    render(<MemoryRouter><CreateTeamPage /></MemoryRouter>);
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Robotics Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(await screen.findByText('The server is unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledTimes(2));
  });
});
