import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ setInitialPassword: vi.fn(), signOutCurrentUser: vi.fn() }));

// The pure helpers (describePasswordProblem, the length constants) stay real;
// only the callable is replaced.
vi.mock('@/lib/team-members', async (importOriginal) => {
  const actual = await importOriginal() as Record<string, unknown>;
  return { ...actual, setInitialPassword: mocks.setInitialPassword };
});
vi.mock('@/lib/auth', () => ({ signOutCurrentUser: mocks.signOutCurrentUser }));

import { PasswordSetupGate } from './PasswordSetupGate';

const user = { email: 'ada@example.com' } as never;

function renderGate(online = true) {
  return render(<PasswordSetupGate user={user} auth={{} as never} online={online} />);
}

function type(label: RegExp, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

describe('PasswordSetupGate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.setInitialPassword.mockResolvedValue({ userId: 'member-1' });
    mocks.signOutCurrentUser.mockResolvedValue(undefined);
  });

  it('names the account the coach set up', () => {
    renderGate();
    expect(screen.getByText(/ada@example.com/)).toBeInTheDocument();
  });

  it('does not open by telling a child they did something wrong', () => {
    renderGate();
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeDisabled();
  });

  it('explains a password that is too short and one that is the email address', () => {
    renderGate();
    type(/new password/i, 'short');
    expect(screen.getByText(/at least 10 characters/i)).toBeInTheDocument();
    type(/new password/i, 'ada@example.com');
    expect(screen.getByText(/cannot be your email address/i)).toBeInTheDocument();
  });

  it('will not submit until both fields match', async () => {
    renderGate();
    type(/new password/i, 'my robot is fast');
    type(/type it again/i, 'my robot is slow');
    expect(screen.getByText(/do not match yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeDisabled();

    type(/type it again/i, 'my robot is fast');
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    await waitFor(() => expect(mocks.setInitialPassword).toHaveBeenCalledWith('my robot is fast'));
  });

  it('refuses to save while offline', () => {
    renderGate(false);
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /save and continue/i })).toBeDisabled();
  });

  it('surfaces a server refusal instead of pretending it worked', async () => {
    mocks.setInitialPassword.mockRejectedValue(new Error('Your password has already been set.'));
    renderGate();
    type(/new password/i, 'my robot is fast');
    type(/type it again/i, 'my robot is fast');
    fireEvent.click(screen.getByRole('button', { name: /save and continue/i }));
    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(mocks.setInitialPassword).toHaveBeenCalledTimes(1);
  });

  it('offers a way out when the account is not theirs', () => {
    renderGate();
    fireEvent.click(screen.getByRole('button', { name: /not you\? sign out/i }));
    expect(mocks.signOutCurrentUser).toHaveBeenCalled();
  });
});
