import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamRoster } from '@/lib/directory';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  useTeamContext: vi.fn(),
  useAccountType: vi.fn(),
  updateTeamDetails: vi.fn(),
  listTeamMembers: vi.fn(),
  leaveTeam: vi.fn(),
  assignTeamRole: vi.fn(),
  updateMembershipStatus: vi.fn(),
  transferTeamLeadership: vi.fn(),
  createInvitation: vi.fn(),
  provisionTeamMember: vi.fn(),
  resetTeamMemberPassword: vi.fn()
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/team-context', () => ({ useTeamContext: mocks.useTeamContext }));
vi.mock('@/lib/account-type', () => ({ useAccountType: mocks.useAccountType }));
vi.mock('@/lib/team-service', () => ({ updateTeamDetails: mocks.updateTeamDetails }));
vi.mock('@/lib/directory', () => ({ listTeamMembers: mocks.listTeamMembers }));
vi.mock('@/lib/phase2-service', () => ({
  assignTeamRole: mocks.assignTeamRole,
  createInvitation: mocks.createInvitation,
  leaveTeam: mocks.leaveTeam,
  transferTeamLeadership: mocks.transferTeamLeadership,
  updateMembershipStatus: mocks.updateMembershipStatus
}));
vi.mock('@/lib/team-members', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, provisionTeamMember: mocks.provisionTeamMember, resetTeamMemberPassword: mocks.resetTeamMemberPassword };
});

import { ManageTeamPage } from './ManageTeamPage';

function membership(role: string, team: Record<string, unknown> = { name: 'Robotics', id: 'team-1' }) {
  return { teamId: 'team-1', role, status: 'active', team };
}

function withTeam(role: string, extra: Record<string, unknown> = {}) {
  const active = membership(role, (extra.team as Record<string, unknown>) ?? { name: 'Robotics', id: 'team-1' });
  mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [active], activeTeam: active, ...extra });
  return active;
}

const roster: TeamRoster = {
  members: [
    { userId: 'coach-1', role: 'coach', status: 'active', displayName: 'Dana Ruiz', photoURL: null, initials: 'DR', provisionedByThisTeam: false, mustSetPassword: false },
    { userId: 'student-1', role: 'student', status: 'active', displayName: 'Amir Khan', photoURL: null, initials: 'AK', provisionedByThisTeam: true, mustSetPassword: true },
    { userId: 'student-9', role: 'student', status: 'suspended', displayName: 'Sam Suspended', photoURL: null, initials: 'SS', provisionedByThisTeam: true, mustSetPassword: false },
    { userId: 'student-8', role: 'student', status: 'removed', displayName: 'Rae Removed', photoURL: null, initials: 'RR', provisionedByThisTeam: false, mustSetPassword: false }
  ],
  truncated: false
};

function renderPage() {
  return render(<MemoryRouter><ManageTeamPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ user: { uid: 'coach-1', email: 'coach@example.com', displayName: 'Dana Ruiz' } });
  mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: 'coach' });
  mocks.listTeamMembers.mockResolvedValue({ members: [], truncated: false });
});

describe('ManageTeamPage team overview', () => {
  it('renders loading, error, and empty membership states', () => {
    mocks.useTeamContext.mockReturnValue({ status: 'loading', teams: [], activeTeam: null });
    const { rerender } = renderPage();
    expect(screen.getByText(/loading your teams/i)).toBeInTheDocument();
    mocks.useTeamContext.mockReturnValue({ status: 'error', teams: [], activeTeam: null, error: new Error('Network error'), retry: vi.fn() });
    rerender(<MemoryRouter><ManageTeamPage /></MemoryRouter>);
    expect(screen.getByText(/teams could not load/i)).toBeInTheDocument();
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    rerender(<MemoryRouter><ManageTeamPage /></MemoryRouter>);
    expect(screen.getByText(/no active team memberships/i)).toBeInTheDocument();
  });

  it('offers team creation to coach accounts and to accounts with no type yet', () => {
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    const { rerender } = renderPage();
    expect(screen.getAllByRole('link', { name: /create a team/i }).length).toBeGreaterThan(0);
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType: null });
    rerender(<MemoryRouter><ManageTeamPage /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: /create a team/i }).length).toBeGreaterThan(0);
  });

  it.each(['student', 'parent'])('never offers team creation to a %s account', (accountType) => {
    mocks.useAccountType.mockReturnValue({ status: 'ready', accountType });
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [], activeTeam: null });
    const { unmount } = renderPage();
    expect(screen.queryByRole('link', { name: /create a team/i })).not.toBeInTheDocument();
    expect(screen.getByText('Ask your coach')).toBeInTheDocument();
    unmount();
    withTeam('student');
    renderPage();
    expect(screen.queryByRole('link', { name: /create another team/i })).not.toBeInTheDocument();
  });

  it('shows only the active team when the coach has several', () => {
    const robotics = membership('coach');
    const builders = { teamId: 'team-2', role: 'coach', status: 'active', team: { name: 'Builders', id: 'team-2' } };
    mocks.useTeamContext.mockReturnValue({ status: 'ready', teams: [robotics, builders], activeTeam: robotics });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Robotics' })).toBeInTheDocument();
    expect(screen.queryByText('Builders')).not.toBeInTheDocument();
    expect(screen.getByText(/One of your 2 teams\. Everything below is for Robotics only/)).toBeInTheDocument();
  });

  it('lets a coach edit the team name and number together', async () => {
    const patchTeam = vi.fn();
    withTeam('coach', { team: { name: 'Robotics', id: 'team-1', teamNumber: null }, patchTeam });
    mocks.updateTeamDetails.mockResolvedValue({ teamId: 'team-1', name: 'TechSummer', teamNumber: '12345' });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Edit team name & number' }));
    fireEvent.change(screen.getByLabelText('Team name'), { target: { value: 'TechSummer' } });
    fireEvent.change(screen.getByLabelText('Team number'), { target: { value: '12345' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(mocks.updateTeamDetails).toHaveBeenCalledWith('team-1', { name: 'TechSummer', teamNumber: '12345' }));
    expect(await screen.findByRole('heading', { name: 'TechSummer · Team #12345' })).toBeInTheDocument();
    expect(patchTeam).toHaveBeenCalledWith('team-1', { name: 'TechSummer', teamNumber: '12345' });
  });

  it('shows the team number to a student without an edit control or admin link', () => {
    withTeam('student', { team: { name: 'Robotics', id: 'team-1', teamNumber: '777' } });
    renderPage();
    expect(screen.getByRole('heading', { name: 'Robotics · Team #777' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /team name/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Administration' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /add a member/i })).not.toBeInTheDocument();
  });

  it('requires a confirmation step before leaving a team', () => {
    withTeam('student');
    renderPage();
    expect(screen.queryByRole('button', { name: /yes, leave robotics/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /leave team/i }));
    expect(screen.getByRole('button', { name: /yes, leave robotics/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(screen.queryByRole('button', { name: /yes, leave robotics/i })).not.toBeInTheDocument();
  });
});

describe('ManageTeamPage roster', () => {
  it('shows the roster as a table and sends administration elsewhere', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Member', 'Role', 'Status', 'Actions']);
    const rows = within(table).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(within(rows[0]).getByText('(you)')).toBeInTheDocument();
    // You cannot suspend yourself.
    expect(within(rows[0]).queryByRole('button', { name: 'Suspend' })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('combobox', { name: 'Role for Amir Khan' })).toHaveValue('student');
    expect(screen.getByRole('link', { name: 'Administration' })).toHaveAttribute('href', '/admin');
  });

  it('lists active members only, so Manage team stays clean', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    renderPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1);
    expect(rows).toHaveLength(2);
    expect(screen.queryByText('Sam Suspended')).not.toBeInTheDocument();
    expect(screen.queryByText('Rae Removed')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '2 people on Robotics' })).toBeInTheDocument();
    // Every row is active, so there is nothing to Restore here.
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument();
  });

  it('takes a suspended member off the list and offers Undo', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    mocks.updateMembershipStatus.mockResolvedValue({});
    renderPage();
    const amirRow = within(await screen.findByRole('table')).getAllByRole('row')[2];
    mocks.listTeamMembers.mockResolvedValue({ ...roster, members: roster.members.map((member) => member.userId === 'student-1' ? { ...member, status: 'suspended' } : member) });
    fireEvent.click(within(amirRow).getByRole('button', { name: 'Suspend' }));
    await waitFor(() => expect(mocks.updateMembershipStatus).toHaveBeenCalledWith('team-1', 'student-1', 'suspended'));

    const notice = await screen.findByRole('status');
    expect(notice).toHaveTextContent('Amir Khan is suspended');
    expect(within(notice).getByRole('link', { name: /administration → suspended/i })).toHaveAttribute('href', '/admin?tab=suspended');
    await waitFor(() => expect(within(screen.getByRole('table')).queryByText('Amir Khan')).not.toBeInTheDocument());

    fireEvent.click(within(notice).getByRole('button', { name: 'Undo' }));
    await waitFor(() => expect(mocks.updateMembershipStatus).toHaveBeenLastCalledWith('team-1', 'student-1', 'active'));
    await waitFor(() => expect(screen.queryByText(/is suspended/)).not.toBeInTheDocument());
  });

  it('offers Reset password only for accounts this team created', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    renderPage();
    const rows = within(await screen.findByRole('table')).getAllByRole('row').slice(1);
    // Dana signed up herself, so a coach has no password lever over her account.
    expect(within(rows[0]).queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
    expect(within(rows[1]).getByRole('button', { name: 'Reset password' })).toBeInTheDocument();
    expect(within(rows[1]).getByText(/has not signed in yet/i)).toBeInTheDocument();
  });

  it('shows a student the roster without any membership controls', async () => {
    withTeam('student');
    mocks.listTeamMembers.mockResolvedValue(roster);
    renderPage();
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Member', 'Role', 'Status']);
    expect(screen.queryByRole('combobox', { name: /role for/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reset password' })).not.toBeInTheDocument();
  });

  it('keeps the page usable when the roster cannot load', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockRejectedValue(new Error('permission-denied'));
    renderPage();
    expect(await screen.findByText(/roster unavailable/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Robotics' })).toBeInTheDocument();
  });

  it('changes a role through the callable and re-reads the roster', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    mocks.assignTeamRole.mockResolvedValue({});
    renderPage();
    fireEvent.change(await screen.findByRole('combobox', { name: 'Role for Amir Khan' }), { target: { value: 'mentor' } });
    await waitFor(() => expect(mocks.assignTeamRole).toHaveBeenCalledWith('team-1', 'student-1', 'mentor'));
    await waitFor(() => expect(mocks.listTeamMembers).toHaveBeenCalledTimes(2));
  });
});

describe('ManageTeamPage adding a member', () => {
  it('creates the account and shows the starter password exactly once', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockResolvedValue({
      userId: 'student-2', email: 'ada@example.com', displayName: 'Ada Lovelace',
      role: 'student', temporaryPassword: 'Falcon-Gear-Orbit-4821', replayed: false
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    // The address is typed twice: here a typo creates a working account, where
    // an invitation would simply have been unreadable and expired.
    fireEvent.change(screen.getByLabelText('Type the email again'), { target: { value: 'ada@examp1e.com' } });
    expect(screen.getByText(/do not match/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Type the email again'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mocks.provisionTeamMember).toHaveBeenCalledWith(
      'team-1',
      { displayName: 'Ada Lovelace', email: 'ada@example.com', role: 'student' },
      expect.stringContaining('provision')
    ));

    expect(await screen.findByText('Falcon-Gear-Orbit-4821')).toBeInTheDocument();
    expect(screen.getByText(/only time the password is shown/i)).toBeInTheDocument();
    // Dismissing it takes the password away for good.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByText('Falcon-Gear-Orbit-4821')).not.toBeInTheDocument();
  });

  it('copies the message for the coach to paste, and never builds a URL with the password in it', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockResolvedValue({
      userId: 'student-2', email: 'ada@example.com', displayName: 'Ada Lovelace',
      role: 'student', temporaryPassword: 'Falcon-Gear-Orbit-4821', replayed: false
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Ada Lovelace' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: 'ada@example.com' } });
    fireEvent.change(screen.getByLabelText('Type the email again'), { target: { value: 'ada@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    fireEvent.click(await screen.findByRole('button', { name: /copy the whole message/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    const copied = String(writeText.mock.calls[0][0]);
    expect(copied).toContain('Falcon-Gear-Orbit-4821');
    expect(copied).toContain('ada@example.com');
    expect(copied).toContain('Dana Ruiz');

    // A live password must never reach a link — it would land in the coach's
    // browser history. Every link on the page has to be free of it.
    for (const link of screen.queryAllByRole('link')) {
      expect(link.getAttribute('href') ?? '').not.toContain('Falcon-Gear-Orbit-4821');
    }
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  function fillDialog(email: string) {
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Dana Ruiz' } });
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: email } });
    fireEvent.change(screen.getByLabelText('Type the email again'), { target: { value: email } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
  }

  const existingAccount = Object.assign(new Error('That email address already has a First Pit account.'), { code: 'functions/already-exists' });

  it('turns an existing account into an invitation in the same dialog', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockRejectedValue(existingAccount);
    mocks.createInvitation.mockResolvedValue({ invitationId: 'team-1_ZGFuYQ' });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));
    fireEvent.click(screen.getByRole('radio', { name: /mentor/i }));
    fillDialog('dana@example.com');

    // No error sending the coach elsewhere: the next step is offered right here.
    expect(await screen.findByText(/dana@example.com already has a First Pit account/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Invite dana@example.com as a mentor' }));
    await waitFor(() => expect(mocks.createInvitation).toHaveBeenCalledWith('team-1', 'dana@example.com', 'mentor'));

    const link = `${window.location.origin}/join?invite=team-1_ZGFuYQ`;
    expect(await screen.findByText(link)).toBeInTheDocument();
    expect(writeText).toHaveBeenCalledWith(link);
    expect(screen.getByText(/already on your clipboard/i)).toBeInTheDocument();
    const gmail = new URL(screen.getByRole('link', { name: /email invite with gmail/i }).getAttribute('href') ?? '');
    expect(gmail.searchParams.get('to')).toBe('dana@example.com');
    expect(gmail.searchParams.get('body')).toContain(link);
    expect(gmail.searchParams.get('body')).toContain('as a mentor');
    Reflect.deleteProperty(navigator, 'clipboard');
  });

  it('still shows the invite link when the clipboard is unavailable', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockRejectedValue(existingAccount);
    mocks.createInvitation.mockResolvedValue({ invitationId: 'team-1_abc' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));
    fillDialog('dana@example.com');
    fireEvent.click(await screen.findByRole('button', { name: /invite dana@example.com/i }));
    expect(await screen.findByText(`${window.location.origin}/join?invite=team-1_abc`)).toBeInTheDocument();
    expect(screen.queryByText(/already on your clipboard/i)).not.toBeInTheDocument();
  });

  it('lets the coach fix the address instead of inviting', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockRejectedValue(existingAccount);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));
    fillDialog('dana@example.com');
    fireEvent.click(await screen.findByRole('button', { name: 'Use a different address' }));
    expect(screen.queryByText(/already has a First Pit account/i)).not.toBeInTheDocument();
    expect(mocks.createInvitation).not.toHaveBeenCalled();
  });

  it('reports any other refusal plainly', async () => {
    withTeam('coach');
    mocks.provisionTeamMember.mockRejectedValue(new Error('The member account could not be created. Try again.'));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /add a member/i }));
    fillDialog('ada@example.com');
    expect(await screen.findByText(/could not be created/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /invite ada@example.com/i })).not.toBeInTheDocument();
  });

  it('issues a fresh password from the roster and says nothing was kept on a replay', async () => {
    withTeam('coach');
    mocks.listTeamMembers.mockResolvedValue(roster);
    mocks.resetTeamMemberPassword.mockResolvedValue({ userId: 'student-1', temporaryPassword: null, replayed: true });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Reset password' }));
    await waitFor(() => expect(mocks.resetTeamMemberPassword).toHaveBeenCalledWith('team-1', 'student-1'));
    expect(await screen.findByText(/already has an account/i)).toBeInTheDocument();
    expect(screen.getByText(/no new password to show/i)).toBeInTheDocument();
  });
});
