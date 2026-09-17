import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type * as AuthModule from '@/lib/auth';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  applyEmailActionCode: vi.fn(),
  checkPasswordResetCode: vi.fn(),
  completePasswordReset: vi.fn(),
  refreshVerificationStatus: vi.fn(),
  useAuth: vi.fn()
}));

vi.mock('@/lib/auth', async () => {
  const actual = await vi.importActual<typeof AuthModule>('@/lib/auth');
  return {
    ...actual,
    applyEmailActionCode: mocks.applyEmailActionCode,
    checkPasswordResetCode: mocks.checkPasswordResetCode,
    completePasswordReset: mocks.completePasswordReset,
    refreshVerificationStatus: mocks.refreshVerificationStatus
  };
});

vi.mock('@/lib/auth-context', () => ({ useAuth: mocks.useAuth }));

import { AuthActionPage } from './AuthActionPage';

function firebaseError(code: string) {
  return Object.assign(new Error(code), { code });
}

function renderAt(search: string) {
  return render(
    <MemoryRouter initialEntries={[`/auth/action${search}`]}>
      <Routes>
        <Route path="/auth/action" element={<AuthActionPage />} />
        <Route path="/hub" element={<p>Team hub</p>} />
      </Routes>
    </MemoryRouter>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.applyEmailActionCode.mockResolvedValue(undefined);
  mocks.refreshVerificationStatus.mockResolvedValue(true);
  mocks.useAuth.mockReturnValue({ auth: {}, user: { emailVerified: false }, status: 'authenticated', error: null });
});

afterEach(cleanup);

describe('AuthActionPage', () => {
  it('applies a verification code and refreshes the stale session', async () => {
    renderAt('?mode=verifyEmail&oobCode=code-1');
    expect(await screen.findByText(/email confirmed/i)).toBeInTheDocument();
    expect(mocks.applyEmailActionCode).toHaveBeenCalledWith(expect.anything(), 'code-1');
    // Without this the signed-in User keeps the persisted `emailVerified:
    // false` and the gate reappears on the very next route.
    expect(mocks.refreshVerificationStatus).toHaveBeenCalled();
  });

  it('continues into the app at the path the email carried', async () => {
    renderAt('?mode=verifyEmail&oobCode=code-1&next=%2Fhub');
    fireEvent.click(await screen.findByRole('button', { name: /continue/i }));
    await waitFor(() => expect(screen.getByText('Team hub')).toBeInTheDocument());
  });

  it('treats a code-less landing as the hosted handler having already run', async () => {
    renderAt('?continueUrl=https%3A%2F%2Fexample.com');
    expect(await screen.findByText(/email confirmed/i)).toBeInTheDocument();
    expect(mocks.applyEmailActionCode).not.toHaveBeenCalled();
    expect(mocks.refreshVerificationStatus).toHaveBeenCalled();
  });

  it('asks a signed-out visitor to sign in rather than dead-ending', async () => {
    mocks.useAuth.mockReturnValue({ auth: {}, user: null, status: 'unauthenticated', error: null });
    renderAt('?mode=verifyEmail&oobCode=code-1');
    expect(await screen.findByRole('link', { name: /sign in/i })).toBeInTheDocument();
  });

  it('explains a spent or expired code instead of a generic failure', async () => {
    mocks.applyEmailActionCode.mockRejectedValue(firebaseError('auth/expired-action-code'));
    renderAt('?mode=verifyEmail&oobCode=stale');
    expect(await screen.findByText(/no longer valid/i)).toBeInTheDocument();
  });

  it('completes a password reset sent to the same handler', async () => {
    mocks.checkPasswordResetCode.mockResolvedValue('coach@example.com');
    mocks.completePasswordReset.mockResolvedValue(undefined);
    renderAt('?mode=resetPassword&oobCode=reset-1');

    const field = await screen.findByLabelText(/new password/i);
    fireEvent.change(field, { target: { value: 'newpassword' } });
    fireEvent.click(screen.getByRole('button', { name: /save new password/i }));

    await waitFor(() => expect(screen.getByText(/password updated/i)).toBeInTheDocument());
    expect(mocks.completePasswordReset).toHaveBeenCalledWith(expect.anything(), 'reset-1', 'newpassword');
  });

  it('rejects a mode it cannot complete', async () => {
    renderAt('?mode=signIn&oobCode=code-1');
    expect(await screen.findByText(/unrecognized link/i)).toBeInTheDocument();
    expect(mocks.applyEmailActionCode).not.toHaveBeenCalled();
  });
});
