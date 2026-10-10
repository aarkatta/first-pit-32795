import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-context', () => ({ useAuth }));

const useProvisionedAccount = vi.hoisted(() => vi.fn());
vi.mock('@/lib/account-type', () => ({ useProvisionedAccount }));

import { ProtectedRoute } from './ProtectedRoute';

/** A self-registered account: nothing provisioned, no password owed. */
const OWN_ACCOUNT = { status: 'ready', mustSetPassword: false, provisionedByTeamId: null };

function renderRoute() {
  return render(
    <MemoryRouter initialEntries={['/private']}>
      <Routes>
        <Route path="/private" element={<ProtectedRoute><p>Private screen</p></ProtectedRoute>} />
        <Route path="/auth" element={<p>Auth screen</p>} />
      </Routes>
    </MemoryRouter>
  );
}

describe('ProtectedRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useProvisionedAccount.mockReturnValue(OWN_ACCOUNT);
  });

  it('renders loading and error states', () => {
    useAuth.mockReturnValue({ status: 'loading', error: null });
    renderRoute();
    expect(screen.getByText(/checking your session/i)).toBeInTheDocument();
    useAuth.mockReturnValue({ status: 'error', error: new Error('Session error') });
    renderRoute();
    expect(screen.getByText(/could not verify your session/i)).toBeInTheDocument();
  });

  it('redirects signed-out users and renders signed-in content', () => {
    useAuth.mockReturnValue({ status: 'unauthenticated', error: null });
    renderRoute();
    expect(screen.getByText('Auth screen')).toBeInTheDocument();
    useAuth.mockReturnValue({ status: 'authenticated', error: null });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();
  });

  it('lets an unverified password account into the app', () => {
    // Verification is no longer a condition of entry. Accepting an email
    // invitation still needs a proven mailbox, and JoinTeamPage asks there.
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { email: 'coach@example.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();
  });

  it('lets a verified user and a Google user straight through', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { email: 'coach@example.com', emailVerified: true, providerData: [{ providerId: 'password' }] }
    });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();

    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { email: 'coach@example.com', emailVerified: false, providerData: [{ providerId: 'google.com' }] }
    });
    renderRoute();
    expect(screen.getAllByText('Private screen').length).toBeGreaterThan(0);
  });

  it('waits for the profile before deciding, and fails open if it cannot be read', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { uid: 'member-1', email: 'ada@example.com', emailVerified: true, providerData: [{ providerId: 'password' }] }
    });
    useProvisionedAccount.mockReturnValue({ status: 'loading', mustSetPassword: false, provisionedByTeamId: null });
    renderRoute();
    expect(screen.getByText(/checking your account/i)).toBeInTheDocument();
    expect(screen.queryByText('Private screen')).not.toBeInTheDocument();

    // A profile that cannot be read must not lock a member out: the server
    // re-checks the flag, so failing open costs a prompt and nothing more.
    useProvisionedAccount.mockReturnValue({ status: 'error', mustSetPassword: false, provisionedByTeamId: null });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();
  });

  it('makes a provisioned member replace the password their coach gave them', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { uid: 'member-1', email: 'ada@example.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    });
    useProvisionedAccount.mockReturnValue({ status: 'ready', mustSetPassword: true, provisionedByTeamId: 'team-1' });
    renderRoute();
    expect(screen.getByRole('heading', { name: /choose your own password/i })).toBeInTheDocument();
    expect(screen.queryByText('Private screen')).not.toBeInTheDocument();
  });

  it('lets a provisioned member through once their password is theirs', () => {
    // Nobody ever mailed them a verification link, and `emailVerified` stays
    // false on purpose — see useProvisionedAccount.
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { uid: 'member-1', email: 'ada@example.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    });
    useProvisionedAccount.mockReturnValue({ status: 'ready', mustSetPassword: false, provisionedByTeamId: 'team-1' });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();
  });

  it('never asks a Google member for a password they do not have', () => {
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { uid: 'member-1', email: 'ada@example.com', emailVerified: true, providerData: [{ providerId: 'google.com' }] }
    });
    useProvisionedAccount.mockReturnValue({ status: 'ready', mustSetPassword: true, provisionedByTeamId: 'team-1' });
    renderRoute();
    expect(screen.getByText('Private screen')).toBeInTheDocument();
  });
});
