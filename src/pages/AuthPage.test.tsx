import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  useAuth: vi.fn(),
  signInWithEmail: vi.fn(),
  signUpWithEmail: vi.fn(),
  signInWithGoogle: vi.fn(),
  isDismissedPopup: vi.fn(),
  resendVerificationEmail: vi.fn(),
  sendPasswordRecovery: vi.fn(),
  bootstrapUserProfile: vi.fn(),
  VerificationEmailDeliveryError: class VerificationEmailDeliveryError extends Error {
    user: unknown;

    constructor(user: unknown) {
      super('verification failed');
      this.user = user;
    }
  }
}));

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));
vi.mock('@/lib/auth', () => ({
  signInWithEmail: mocks.signInWithEmail,
  signUpWithEmail: mocks.signUpWithEmail,
  signInWithGoogle: mocks.signInWithGoogle,
  isDismissedPopup: mocks.isDismissedPopup,
  resendVerificationEmail: mocks.resendVerificationEmail,
  VerificationEmailDeliveryError: mocks.VerificationEmailDeliveryError,
  sendPasswordRecovery: mocks.sendPasswordRecovery
}));
vi.mock('@/lib/profile', () => ({ bootstrapUserProfile: mocks.bootstrapUserProfile }));

import { AuthPage } from './AuthPage';

function renderPage() {
  return render(<MemoryRouter><AuthPage /></MemoryRouter>);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.useAuth.mockReturnValue({ auth: {}, user: null, status: 'unauthenticated', error: null, retry: vi.fn() });
  mocks.signInWithEmail.mockResolvedValue({});
  mocks.signUpWithEmail.mockResolvedValue({ user: { uid: 'new-user' } });
  mocks.sendPasswordRecovery.mockResolvedValue(undefined);
  mocks.resendVerificationEmail.mockResolvedValue(undefined);
  mocks.bootstrapUserProfile.mockResolvedValue(undefined);
  mocks.signInWithGoogle.mockResolvedValue({ user: { uid: 'google-user' } });
  mocks.isDismissedPopup.mockReturnValue(false);
});

describe('AuthPage', () => {
  it('signs in with Google and bootstraps the profile', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalledWith({}));
    expect(mocks.bootstrapUserProfile).toHaveBeenCalledWith({ uid: 'google-user' });
  });

  it('offers Google from the create-account mode too', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));

    fireEvent.click(screen.getByRole('button', { name: /sign up with google/i }));
    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalled());
  });

  it('stays silent when the user closes the Google popup', async () => {
    mocks.signInWithGoogle.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/popup-closed-by-user' }));
    mocks.isDismissedPopup.mockReturnValue(true);
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    await waitFor(() => expect(mocks.signInWithGoogle).toHaveBeenCalled());
    expect(screen.queryByText(/google sign-in failed/i)).toBeNull();
  });

  it('reports a blocked popup with an actionable message', async () => {
    mocks.signInWithGoogle.mockRejectedValue(Object.assign(new Error('x'), { code: 'auth/popup-blocked' }));
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: /continue with google/i }));

    expect(await screen.findByText(/blocked the google sign-in window/i)).toBeTruthy();
  });

  it('hides Google sign-in while recovering a password', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));

    expect(screen.queryByRole('button', { name: /google/i })).toBeNull();
  });

  it('signs in with email and password', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(mocks.signInWithEmail).toHaveBeenCalledWith({}, 'coach@example.com', 'password'));
  });

  it('creates an account and offers password recovery', async () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    await waitFor(() => expect(mocks.signUpWithEmail).toHaveBeenCalled());
    expect(mocks.bootstrapUserProfile).toHaveBeenCalledWith({ uid: 'new-user' });

    cleanup();
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'recover@example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send recovery email' }));
    await waitFor(() => expect(mocks.sendPasswordRecovery).toHaveBeenCalledWith({}, 'recover@example.com'));
    expect(screen.getByText(/recovery email has been sent/i)).toBeInTheDocument();
  });

  it('shows a plain-language auth error', async () => {
    mocks.signInWithEmail.mockRejectedValue(new Error('auth/invalid-credential'));
    renderPage();
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'coach@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(/email or password is not correct/i)).toBeInTheDocument();
  });

  it('retries profile bootstrap without repeating account creation', async () => {
    mocks.bootstrapUserProfile
      .mockRejectedValueOnce(new Error('Profile service unavailable.'))
      .mockResolvedValueOnce(undefined);
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/private profile could not be saved/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(mocks.bootstrapUserProfile).toHaveBeenCalledTimes(2));
    expect(mocks.signUpWithEmail).toHaveBeenCalledTimes(1);
  });

  it('retries verification delivery without repeating account creation', async () => {
    const user = { uid: 'created-user' };
    mocks.signUpWithEmail.mockRejectedValueOnce(new mocks.VerificationEmailDeliveryError(user));
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Create an account' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'new@example.com' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'password' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText(/account was created, but the verification email could not be sent/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry verification email' }));
    await waitFor(() => expect(mocks.resendVerificationEmail).toHaveBeenCalledWith(user));
    expect(mocks.bootstrapUserProfile).toHaveBeenCalledWith(user);
    expect(mocks.signUpWithEmail).toHaveBeenCalledTimes(1);
  });

  it('offers a resend action to a signed-in password user with an unverified email', async () => {
    const user = { emailVerified: false, providerData: [{ providerId: 'password' }] };
    mocks.useAuth.mockReturnValue({ auth: {}, user, status: 'authenticated', error: null, retry: vi.fn() });
    renderPage();

    fireEvent.click(screen.getByRole('button', { name: 'Resend verification email' }));
    await waitFor(() => expect(mocks.resendVerificationEmail).toHaveBeenCalledWith(user));
    expect(screen.getByRole('status')).toHaveTextContent(/new verification email has been sent/i);
  });
});
