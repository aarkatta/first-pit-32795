import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const useAuth = vi.hoisted(() => vi.fn());
vi.mock('@/lib/auth-context', () => ({ useAuth }));

import { ProtectedRoute } from './ProtectedRoute';

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
  beforeEach(() => vi.clearAllMocks());

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

  it('blocks an authenticated password user whose email is still unverified', () => {
    // An unverified address is how a team invitation could be accepted by
    // someone who does not control it, so this gates the whole app, not a banner.
    useAuth.mockReturnValue({
      status: 'authenticated',
      error: null,
      auth: {},
      user: { email: 'coach@example.com', emailVerified: false, providerData: [{ providerId: 'password' }] }
    });
    renderRoute();
    expect(screen.getByText(/confirm coach@example.com/i)).toBeInTheDocument();
    expect(screen.queryByText('Private screen')).not.toBeInTheDocument();
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
});
