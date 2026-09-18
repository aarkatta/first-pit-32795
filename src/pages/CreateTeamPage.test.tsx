import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ useAuth: vi.fn(), createTeam: vi.fn(), useAccountType: vi.fn(), setAccountType: vi.fn(), useTeamContext: vi.fn() }));
vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-service', () => ({ createTeam: mocks.createTeam }));
vi.mock('@/lib/account-type', () => ({ useAccountType: mocks.useAccountType, setAccountType: mocks.setAccountType }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/use-online-status', () => ({ useOnlineStatus: () => true }));

import { CreateTeamPage } from './CreateTeamPage';

function renderPage() {
  return render(<MemoryRouter><CreateTeamPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'coach-1' } });
  mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'coach' });
  mocks.createTeam.mockResolvedValue({ teamId: 'team-1' });
  mocks.useTeamContext.mockReturnValue({ teams: [] });
  mocks.setAccountType.mockResolvedValue({ accountType: 'coach', changed: true });
});

describe('CreateTeamPage', () => {
  it('submits the team name to the server', async () => {
    renderPage();
    expect(mocks.useAccountType).toHaveBeenCalledWith('coach-1');
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Robotics Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledWith('Robotics Team'));
  });

  it('lets a mentor account create a team too', () => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'mentor' });
    renderPage();
    expect(screen.getByRole('button', { name: 'Create team' })).toBeInTheDocument();
  });

  it('shows a retryable error message from the server', async () => {
    mocks.createTeam
      .mockRejectedValueOnce(new Error('The server is unavailable.'))
      .mockResolvedValueOnce({ teamId: 'team-1' });
    renderPage();
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'Robotics Team' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create team' }));
    expect(await screen.findByText('The server is unavailable.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.createTeam).toHaveBeenCalledTimes(2));
  });

  it.each(['student', 'parent'])('turns a %s account away and points to invitations', (accountType) => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType });
    renderPage();
    expect(screen.getByText('Coaches and mentors create teams')).toBeInTheDocument();
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Accept an invitation' })).toHaveAttribute('href', '/join');
  });

  it('turns away an account with no type that is already a student on a team', () => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    mocks.useTeamContext.mockReturnValue({ teams: [{ teamId: 'team-1', role: 'student', status: 'active' }] });
    renderPage();
    expect(screen.getByText('Coaches and mentors create teams')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Continue' })).not.toBeInTheDocument();
  });

  it('asks an account without a type to choose one before the form', async () => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    renderPage();
    expect(screen.queryByLabelText('Team name')).not.toBeInTheDocument();
    const continueButton = screen.getByRole('button', { name: 'Continue' });
    expect(continueButton).toBeDisabled();
    fireEvent.change(screen.getByLabelText('I am a'), { target: { value: 'mentor' } });
    fireEvent.click(continueButton);
    await waitFor(() => expect(mocks.setAccountType).toHaveBeenCalledWith('mentor'));
  });

  it('explains a refused account-type change', async () => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    mocks.setAccountType.mockRejectedValueOnce(new Error('Your account type is already set. Ask an administrator to change it.'));
    renderPage();
    fireEvent.change(screen.getByLabelText('I am a'), { target: { value: 'coach' } });
    fireEvent.click(screen.getByRole('button', { name: 'Continue' }));
    expect(await screen.findByText(/already set/)).toBeInTheDocument();
  });

  it('waits for the account type, and falls back to the form when it cannot be read', () => {
    mocks.useAccountType.mockReturnValue({ status: 'loading', accountType: null });
    const { rerender } = renderPage();
    expect(screen.getByText('Checking your account')).toBeInTheDocument();
    mocks.useAccountType.mockReturnValue({ status: 'error', accountType: null });
    rerender(<MemoryRouter><CreateTeamPage /></MemoryRouter>);
    expect(screen.getByLabelText('Team name')).toBeInTheDocument();
  });
});
