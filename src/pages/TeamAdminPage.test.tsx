import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DirectoryModule from '@/lib/directory';
import type { TeamRoster } from '@/lib/directory';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useTeamContext: vi.fn(),
  listTeamMembers: vi.fn(),
  getDocs: vi.fn(),
  revokeInvitation: vi.fn(),
  createInvitation: vi.fn(),
  approveJoinRequest: vi.fn(),
  updateModerationCase: vi.fn()
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/firebase', () => ({ getFirebaseServices: () => ({ firestore: 'firestore' }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, name: string) => ({ name }),
  getDocs: mocks.getDocs,
  limit: () => ({ type: 'limit' }),
  orderBy: (field: string, direction: string) => ({ type: 'orderBy', field, direction }),
  query: (source: { name: string }, ...constraints: unknown[]) => ({ name: source.name, constraints }),
  where: (field: string, op: string, value: unknown) => ({ type: 'where', field, op, value })
}));
vi.mock('@/lib/directory', async (importOriginal) => ({
  ...(await importOriginal<typeof DirectoryModule>()),
  listTeamMembers: mocks.listTeamMembers
}));
vi.mock('@/lib/phase2-service', () => ({
  approveJoinRequest: mocks.approveJoinRequest,
  assignTeamRole: vi.fn(),
  createInvitation: mocks.createInvitation,
  rejectJoinRequest: vi.fn(),
  revokeInvitation: mocks.revokeInvitation,
  transferTeamLeadership: vi.fn(),
  updateMembershipStatus: vi.fn(),
  updateModerationCase: mocks.updateModerationCase,
  updateTeamPolicy: vi.fn()
}));

import { TeamAdminPage } from './TeamAdminPage';

const roster: TeamRoster = {
  members: [
    { userId: 'coach-1', role: 'coach', status: 'active', displayName: 'Dana Ruiz', photoURL: null, initials: 'DR' },
    { userId: 'student-1', role: 'student', status: 'active', displayName: 'Amir Khan', photoURL: null, initials: 'AK' }
  ],
  truncated: false
};

function snapshot(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { size: docs.length, docs: docs.map((entry) => ({ id: entry.id, data: () => entry.data })) };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'coach-1' } });
  mocks.useTeamContext.mockReturnValue({
    activeTeam: { teamId: 'team-1', userId: 'coach-1', role: 'coach', status: 'active', team: { id: 'team-1', name: 'Robotics' } }
  });
  mocks.listTeamMembers.mockResolvedValue(roster);
  mocks.getDocs.mockImplementation((builtQuery: { name: string }) => {
    if (builtQuery.name === 'invitations') {
      return Promise.resolve(snapshot([
        { id: 'team-1_abc', data: { email: 'new@example.com', role: 'mentor', status: 'pending', expiresAt: null } }
      ]));
    }
    if (builtQuery.name === 'joinRequests') {
      return Promise.resolve(snapshot([{ id: 'team-1_applicant', data: { userId: 'applicant-9876543210', displayName: 'Priya Nair', status: 'pending' } }]));
    }
    if (builtQuery.name === 'moderationCases') {
      return Promise.resolve(snapshot([
        { id: 'case-1', data: { teamId: 'team-1', reasonCode: 'unsafe-content', severity: 'high', status: 'open', version: 3 } }
      ]));
    }
    if (builtQuery.name === 'teamPolicies') {
      return Promise.resolve(snapshot([{ id: 'team-1', data: { membershipApproval: 'coachApproval' } }]));
    }
    return Promise.resolve(snapshot([]));
  });
});

describe('TeamAdminPage membership administration', () => {
  it('creates an invite link, says no email was sent, and copies the link', async () => {
    mocks.createInvitation.mockResolvedValue({ invitationId: 'team-1_c3R1ZGVudA' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<TeamAdminPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'student@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(mocks.createInvitation).toHaveBeenCalledWith('team-1', 'student@example.com', 'student'));
    const link = `${window.location.origin}/join?invite=team-1_c3R1ZGVudA`;
    expect(await screen.findByText(/Invitation created for student@example\.com\. No email is sent/)).toHaveTextContent(link);
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('still shows the invite link when the clipboard is unavailable', async () => {
    mocks.createInvitation.mockResolvedValue({ invitationId: 'team-1_abc' });
    render(<TeamAdminPage />);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'parent@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    const notice = await screen.findByText(/No email is sent — send them this link/);
    expect(notice).toHaveTextContent(`${window.location.origin}/join?invite=team-1_abc`);
    expect(notice).not.toHaveTextContent('copied');
  });

  it('renders display names rather than raw user ids', async () => {
    render(<TeamAdminPage />);
    expect(await screen.findByText('Dana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Amir Khan')).toBeInTheDocument();
    expect(screen.queryByText('student-1')).not.toBeInTheDocument();
    expect(screen.queryByText('applicant-9876543210')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
  });

  it('sends the stored version with a moderation update', async () => {
    mocks.updateModerationCase.mockResolvedValue({ caseId: 'case-1', version: 4 });
    render(<TeamAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    await waitFor(() => expect(mocks.updateModerationCase).toHaveBeenCalledWith({
      teamId: 'team-1',
      caseId: 'case-1',
      expectedVersion: 3,
      status: 'resolved',
      action: 'none'
    }));
  });

  it('explains a concurrent moderation edit instead of failing generically', async () => {
    mocks.updateModerationCase.mockRejectedValue(Object.assign(new Error('aborted'), { code: 'functions/aborted' }));
    render(<TeamAdminPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Resolve' }));
    expect(await screen.findByText(/another coach updated this case/i)).toBeInTheDocument();
    expect(screen.getByText(/refreshed with their change/i)).toBeInTheDocument();
  });

  it('lists pending invitations with a working revoke action', async () => {
    mocks.revokeInvitation.mockResolvedValue({ invitationId: 'team-1_abc', status: 'revoked' });
    render(<TeamAdminPage />);
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText(/mentor · pending/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(mocks.revokeInvitation).toHaveBeenCalledWith('team-1', 'team-1_abc'));
  });

  it('orders the audit history newest first', async () => {
    render(<TeamAdminPage />);
    await screen.findByText('Dana Ruiz');
    const auditQuery = mocks.getDocs.mock.calls.map(([value]) => value).find((value) => value.name === 'auditEvents');
    expect(auditQuery.constraints).toContainEqual({ type: 'orderBy', field: 'createdAt', direction: 'desc' });
  });
});
