import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type * as DirectoryModule from '@/lib/directory';
import type { TeamRoster } from '@/lib/directory';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useTeamContext: vi.fn(),
  listTeamMembers: vi.fn(),
  getDocs: vi.fn(),
  getDoc: vi.fn(),
  revokeInvitation: vi.fn(),
  createInvitation: vi.fn(),
  approveJoinRequest: vi.fn(),
  updateModerationCase: vi.fn(),
  updateTeamPolicy: vi.fn()
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/firebase', () => ({ getFirebaseServices: () => ({ firestore: 'firestore' }) }));
vi.mock('firebase/firestore', () => ({
  collection: (_firestore: unknown, name: string) => ({ name }),
  doc: (_firestore: unknown, name: string, id: string) => ({ name, id }),
  getDoc: mocks.getDoc,
  getDocs: mocks.getDocs,
  limit: () => ({ type: 'limit' }),
  orderBy: (field: string, direction: string) => ({ type: 'orderBy', field, direction }),
  query: (source: { name: string }, ...constraints: unknown[]) => ({ name: source.name, constraints }),
  startAfter: (cursor: unknown) => ({ type: 'startAfter', cursor }),
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
  updateTeamPolicy: mocks.updateTeamPolicy
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
  mocks.getDoc.mockResolvedValue({ exists: () => true, data: () => ({ title: 'Why is our robot slow?' }) });
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
        { id: 'case-1', data: { teamId: 'team-1', reasonCode: 'unkind', description: 'Mean words about Amir', targetType: 'content', targetResource: 'questions/q-1', severity: 'medium', status: 'open', version: 3 } }
      ]));
    }
    if (builtQuery.name === 'auditEvents') {
      return Promise.resolve(snapshot([
        { id: 'a3', data: { type: 'administrative.action', actorUserId: 'student-1', metadata: { action: 'kanban.task.moved' } } },
        { id: 'a2', data: { type: 'role.changed', actorUserId: 'coach-1', targetUserId: 'student-1', metadata: { previousRole: 'student', role: 'mentor' } } },
        { id: 'a1', data: { type: 'invitation.created', actorUserId: 'coach-1', targetResource: 'invitations/team-1_abc', metadata: { role: 'mentor' } } }
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
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'student@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    await waitFor(() => expect(mocks.createInvitation).toHaveBeenCalledWith('team-1', 'student@example.com', 'student'));
    const link = `${window.location.origin}/join?invite=team-1_c3R1ZGVudA`;
    const notice = await screen.findByText(/Invitation created for student@example\.com\. First Pit does not send email itself/);
    expect(notice).toHaveTextContent(link);
    expect(notice).toHaveTextContent('already copied to your clipboard');
    expect(writeText).toHaveBeenCalledWith(link);
    // Gmail compose opens in a new tab with the invitation already written.
    const gmailInvite = screen.getByRole('link', { name: '✉ Email invite with Gmail to student@example.com' });
    expect(gmailInvite).toHaveAttribute('target', '_blank');
    const gmail = new URL(gmailInvite.getAttribute('href') ?? '');
    expect(gmail.host).toBe('mail.google.com');
    expect(gmail.searchParams.get('to')).toBe('student@example.com');
    expect(gmail.searchParams.get('su')).toBe('Join Robotics on First Pit');
    expect(gmail.searchParams.get('body')).toContain(link);
    expect(screen.queryByRole('link', { name: 'Use another email app' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Invitation sent/)).not.toBeInTheDocument();
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('still shows the invite link when the clipboard is unavailable', async () => {
    mocks.createInvitation.mockResolvedValue({ invitationId: 'team-1_abc' });
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    fireEvent.change(await screen.findByRole('textbox', { name: 'Email' }), { target: { value: 'parent@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invite link' }));
    const notice = await screen.findByText(/or send them this link:/);
    expect(notice).toHaveTextContent(`${window.location.origin}/join?invite=team-1_abc`);
    expect(notice).not.toHaveTextContent('copied');
  });

  it('lays the roster out as a table with one row per member', async () => {
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Member', 'Role', 'Status', 'Actions']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('Dana Ruiz')).toBeInTheDocument();
    expect(within(rows[0]).getByText('(you)')).toBeInTheDocument();
    // You cannot suspend yourself, so that action is not offered on your own row.
    expect(within(rows[0]).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('combobox', { name: 'Role for Amir Khan' })).toHaveValue('student');
    expect(within(rows[1]).getByRole('button', { name: 'Suspend' })).toBeInTheDocument();
  });

  it('renders display names rather than raw user ids', async () => {
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    expect(await screen.findByText('Dana Ruiz')).toBeInTheDocument();
    expect(screen.getByText('Amir Khan')).toBeInTheDocument();
    expect(screen.queryByText('student-1')).not.toBeInTheDocument();
    expect(screen.queryByText('applicant-9876543210')).not.toBeInTheDocument();
    expect(screen.getByText('Priya Nair')).toBeInTheDocument();
  });

  it('sends the stored version with a moderation update', async () => {
    mocks.updateModerationCase.mockResolvedValue({ caseId: 'case-1', version: 4 });
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep and resolve' }));
    await waitFor(() => expect(mocks.updateModerationCase).toHaveBeenCalledWith({
      teamId: 'team-1',
      caseId: 'case-1',
      expectedVersion: 3,
      status: 'resolved',
      action: 'none'
    }));
  });

  it('shows what was reported and removes the question after a confirmation', async () => {
    mocks.updateModerationCase.mockResolvedValue({ caseId: 'case-1', version: 4 });
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    const link = await screen.findByRole('link', { name: 'Why is our robot slow?' });
    expect(link).toHaveAttribute('href', '/knowledge?question=q-1');
    expect(screen.getByText(/Unkind or bullying/)).toBeInTheDocument();
    expect(screen.getByText('“Mean words about Amir”')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Remove question' }));
    expect(mocks.updateModerationCase).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Yes, remove it' }));
    await waitFor(() => expect(mocks.updateModerationCase).toHaveBeenCalledWith({
      teamId: 'team-1', caseId: 'case-1', expectedVersion: 3, status: 'resolved', action: 'remove-content'
    }));
  });

  it('keeps the queue working when a reported question can no longer be read', async () => {
    mocks.getDoc.mockRejectedValue(new Error('permission-denied'));
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    expect(await screen.findByText('Reported content (no longer available)')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove question' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Keep and resolve' })).toBeInTheDocument();
  });

  it('explains a concurrent moderation edit instead of failing generically', async () => {
    mocks.updateModerationCase.mockRejectedValue(Object.assign(new Error('aborted'), { code: 'functions/aborted' }));
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button', { name: 'Keep and resolve' }));
    expect(await screen.findByText(/another coach updated this case/i)).toBeInTheDocument();
    expect(screen.getByText(/refreshed with their change/i)).toBeInTheDocument();
  });

  it('lists pending invitations with a working revoke action', async () => {
    mocks.revokeInvitation.mockResolvedValue({ invitationId: 'team-1_abc', status: 'revoked' });
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    expect(await screen.findByText('new@example.com')).toBeInTheDocument();
    expect(screen.getByText(/mentor · pending/i)).toBeInTheDocument();
    const emailInvite = screen.getByRole('link', { name: 'Email invite to new@example.com with Gmail (opens in a new tab)' });
    expect(new URL(emailInvite.getAttribute('href') ?? '').searchParams.get('body')).toContain('as a mentor.');
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() => expect(mocks.revokeInvitation).toHaveBeenCalledWith('team-1', 'team-1_abc'));
  });

  it('shows each team setting with its state and flips only that setting', async () => {
    mocks.updateTeamPolicy.mockResolvedValue({});
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    const files = await screen.findByRole('switch', { name: 'Team files' });
    expect(files).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByText('Team files: Off')).toBeInTheDocument();
    expect(screen.getByRole('switch', { name: 'Join requests' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByText('Join requests: On')).toBeInTheDocument();
    // Planned settings are greyed-out placeholders that cannot be switched on.
    for (const name of ['Team messaging (coming soon)', 'Message history limit (coming soon)', 'Team discovery (coming soon)']) {
      const placeholder = screen.getByRole('switch', { name });
      expect(placeholder).toBeDisabled();
      expect(placeholder).toHaveAttribute('aria-checked', 'false');
    }
    fireEvent.click(files);
    await waitFor(() => expect(mocks.updateTeamPolicy).toHaveBeenCalledWith('team-1', { fileSharing: 'teamOnly' }));
    fireEvent.click(await screen.findByRole('switch', { name: 'Join requests' }));
    await waitFor(() => expect(mocks.updateTeamPolicy).toHaveBeenCalledWith('team-1', { membershipApproval: 'inviteOnly' }));
  });

  it('lists administrative changes in plain language and skips task activity', async () => {
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    expect(await screen.findByText("Dana Ruiz changed Amir Khan's role from student to mentor")).toBeInTheDocument();
    expect(screen.getByText('Dana Ruiz invited new@example.com as a mentor')).toBeInTheDocument();
    expect(screen.queryByText(/moved|administrative change/)).not.toBeInTheDocument();
    // Three events fit on one page and the read was not capped, so nothing more to load.
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
  });

  it('orders the audit history newest first', async () => {
    render(<MemoryRouter><TeamAdminPage /></MemoryRouter>);
    await screen.findByText('Dana Ruiz');
    const auditQuery = mocks.getDocs.mock.calls.map(([value]) => value).find((value) => value.name === 'auditEvents');
    expect(auditQuery.constraints).toContainEqual({ type: 'orderBy', field: 'createdAt', direction: 'desc' });
  });
});
