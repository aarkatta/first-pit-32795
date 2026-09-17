import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authEmailSender: vi.fn(() => 'noreply@first-pit.firebaseapp.com'),
  refreshVerificationStatus: vi.fn(),
  resendVerificationEmail: vi.fn(),
  signOutCurrentUser: vi.fn(),
  latestVerificationLink: vi.fn(),
  usingAuthEmulator: vi.fn()
}));

vi.mock('@/lib/auth', () => ({
  authEmailSender: mocks.authEmailSender,
  refreshVerificationStatus: mocks.refreshVerificationStatus,
  resendVerificationEmail: mocks.resendVerificationEmail,
  signOutCurrentUser: mocks.signOutCurrentUser
}));

vi.mock('@/lib/auth-emulator', () => ({
  latestVerificationLink: mocks.latestVerificationLink,
  usingAuthEmulator: mocks.usingAuthEmulator
}));

import { EmailVerificationGate } from './EmailVerificationGate';

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    email: 'coach@example.com',
    emailVerified: false,
    reload: vi.fn().mockResolvedValue(undefined),
    ...overrides
  };
}

const assign = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resendVerificationEmail.mockResolvedValue(undefined);
  mocks.refreshVerificationStatus.mockResolvedValue(false);
  mocks.usingAuthEmulator.mockReturnValue(false);
  mocks.latestVerificationLink.mockResolvedValue(null);
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, assign }
  });
});

afterEach(cleanup);

describe('EmailVerificationGate', () => {
  // Every tester found the verification mail in spam and reported it as never
  // sent, so the gate has to say where to look and name the sender.
  it('points at the spam folder and names the sender', () => {
    mocks.usingAuthEmulator.mockReturnValue(false);
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);

    expect(screen.getByText(/spam or junk folder/i).textContent).toContain('noreply@first-pit.firebaseapp.com');
  });

  it('resends the verification email and confirms where it went', async () => {
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online next="/join?invite=abc" />);
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(screen.getByText(/on its way to coach@example.com/i)).toBeInTheDocument());
    // The link has to carry the deep link, or an invitee loses it on the way back.
    expect(mocks.resendVerificationEmail).toHaveBeenCalledWith(expect.anything(), '/join?invite=abc');
  });

  it('reports a still-unverified address instead of letting the user through', async () => {
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);
    fireEvent.click(screen.getByRole('button', { name: /i have verified/i }));
    await waitFor(() => expect(screen.getByText(/still unverified/i)).toBeInTheDocument());
    expect(mocks.refreshVerificationStatus).toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
  });

  it('admits a user who verified elsewhere, without a button press', async () => {
    mocks.refreshVerificationStatus.mockResolvedValue(true);
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online next="/hub" />);
    // The poll re-asks the server on focus, which is what covers verifying on
    // a phone while this tab sits open.
    fireEvent.focus(window);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/hub'));
  });

  it('surfaces a failed resend rather than claiming success', async () => {
    mocks.resendVerificationEmail.mockRejectedValue(new Error('mail down'));
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);
    fireEvent.click(screen.getByRole('button', { name: /resend verification email/i }));
    await waitFor(() => expect(screen.getByText(/could not be sent/i)).toBeInTheDocument());
  });

  it('offers the emulator link locally, where no mail is delivered', async () => {
    mocks.usingAuthEmulator.mockReturnValue(true);
    mocks.latestVerificationLink.mockResolvedValue('http://localhost:5173/auth/action?mode=verifyEmail&oobCode=code-1');
    render(<EmailVerificationGate user={makeUser() as never} auth={{} as never} online />);
    const link = await screen.findByRole('link', { name: /open the verification link/i });
    expect(link).toHaveAttribute('href', 'http://localhost:5173/auth/action?mode=verifyEmail&oobCode=code-1');
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
