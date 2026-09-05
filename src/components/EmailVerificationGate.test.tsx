import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resendVerificationEmail: vi.fn(),
  signOutCurrentUser: vi.fn()
}));

vi.mock('@/lib/auth', () => mocks);

import { EmailVerificationGate } from './EmailVerificationGate';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    email: 'coach@example.com',
    emailVerified: false,
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resendVerificationEmail.mockResolvedValue(undefined);
});

afterEach(cleanup);

describe('EmailVerificationGate', () => {
  it('resends the verification email and confirms where it went', async () => {
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(screen.getByText(/on its way to coach@example.com/i)).toBeInTheDocument());
  });

  it('reports a still-unverified address instead of letting the user through', async () => {
    const user = makeUser();
    render(<EmailVerificationGate user={user as never} auth={{} as never} online />);
    fireEvent.click(screen.getByRole('button', { name: /i have verified/i }));
    await waitFor(() => expect(screen.getByText(/still unverified/i)).toBeInTheDocument());
    expect(user.reload).toHaveBeenCalled();
  });

  it('surfaces a failed resend rather than claiming success', async () => {
    mocks.resendVerificationEmail.mockRejectedValue(new Error('mail down'));
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(screen.getByText(/could not be sent/i)).toBeInTheDocument());
  });

  it('offers sign-out as the way out and disables actions offline', () => {
    const auth = {} as never;
    render(<EmailVerificationGate user={makeUser() as never} auth={auth} online={false} />);
    expect(screen.getByText(/you are offline/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /i have verified/i })).toBeDisabled();
    // Signing out must stay available offline, or an unverified user is stuck.
    const signOut = screen.getByRole('button', { name: /sign out/i });
    expect(signOut).not.toBeDisabled();
    fireEvent.click(signOut);
    expect(mocks.signOutCurrentUser).toHaveBeenCalledWith(auth);
  });
});
