import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  getDoc: vi.fn(),
  acceptInvitation: vi.fn(),
  requestToJoinTeam: vi.fn(),
  resendVerificationEmail: vi.fn()
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/firebase', () => ({ getFirebaseServices: () => ({ firestore: 'firestore' }) }));
vi.mock('firebase/firestore', () => ({
  doc: (_firestore: unknown, collection: string, id: string) => ({ collection, id }),
  getDoc: mocks.getDoc
}));
vi.mock('@/lib/phase2-service', () => ({
  acceptInvitation: mocks.acceptInvitation,
  requestToJoinTeam: mocks.requestToJoinTeam
}));
vi.mock('@/lib/auth', () => ({ resendVerificationEmail: mocks.resendVerificationEmail }));

import { JoinTeamPage } from './JoinTeamPage';

function invitationSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    id: 'team-1_abc',
    exists: () => true,
    data: () => ({ teamId: 'team-1', teamName: 'Robotics', email: 'student@example.com', role: 'student', status: 'pending', expiresAt: null, ...overrides })
  };
}

function renderPage(invite = 'team-1_abc') {
  return render(
    <MemoryRouter initialEntries={[`/join?invite=${invite}`]}>
      <JoinTeamPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDoc.mockImplementation((reference: { collection: string }) =>
    reference.collection === 'invitations' ? Promise.resolve(invitationSnapshot()) : Promise.reject(new Error('permission-denied'))
  );
});

describe('JoinTeamPage', () => {
  it('explains the email-verification requirement instead of failing with a permission error', () => {
    mocks.useAuth.mockReturnValue({ user: { email: 'student@example.com', emailVerified: false } });
    renderPage();
    expect(screen.getByRole('heading', { name: /confirm student@example.com first/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resend verification email/i })).toBeInTheDocument();
    expect(mocks.getDoc).not.toHaveBeenCalled();
  });

  it('loads the invitation from the query string and accepts it', async () => {
    mocks.useAuth.mockReturnValue({ user: { email: 'student@example.com', emailVerified: true } });
    mocks.acceptInvitation.mockResolvedValue({ teamId: 'team-1' });
    renderPage();
    const accept = await screen.findByRole('button', { name: /accept and join as student/i });
    expect(screen.getByText('Robotics')).toBeInTheDocument();
    expect(screen.getByText(/role offered: student/i)).toBeInTheDocument();
    fireEvent.click(accept);
    await waitFor(() => expect(mocks.acceptInvitation).toHaveBeenCalledWith('team-1_abc'));
  });

  it('falls back to the team id when an older invitation carries no team name', async () => {
    mocks.useAuth.mockReturnValue({ user: { email: 'student@example.com', emailVerified: true } });
    mocks.getDoc.mockImplementation((reference: { collection: string }) =>
      reference.collection === 'invitations'
        ? Promise.resolve(invitationSnapshot({ teamName: undefined }))
        : Promise.reject(new Error('permission-denied'))
    );
    renderPage();
    expect(await screen.findByText('Team team-1')).toBeInTheDocument();
  });

  it('reports a revoked invitation in plain language', async () => {
    mocks.useAuth.mockReturnValue({ user: { email: 'student@example.com', emailVerified: true } });
    mocks.getDoc.mockImplementation((reference: { collection: string }) =>
      reference.collection === 'invitations'
        ? Promise.resolve(invitationSnapshot({ status: 'revoked' }))
        : Promise.reject(new Error('permission-denied'))
    );
    renderPage();
    expect(await screen.findByText(/a coach revoked this invitation/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /accept and join/i })).not.toBeInTheDocument();
  });

  it('sends a join request for a team id shared by a coach', async () => {
    mocks.useAuth.mockReturnValue({ user: { email: 'student@example.com', emailVerified: true } });
    mocks.requestToJoinTeam.mockResolvedValue({ requestId: 'team-2_user-1' });
    renderPage();
    fireEvent.change(screen.getByLabelText(/team id/i), { target: { value: 'team-2' } });
    fireEvent.click(screen.getByRole('button', { name: /request to join/i }));
    await waitFor(() => expect(mocks.requestToJoinTeam).toHaveBeenCalledWith('team-2'));
    expect(await screen.findByText(/a coach reviews it/i)).toBeInTheDocument();
  });

  it('requires a signed-in account', () => {
    mocks.useAuth.mockReturnValue({ user: null });
    renderPage();
    expect(screen.getByRole('heading', { name: /sign in to join a team/i })).toBeInTheDocument();
  });
});
