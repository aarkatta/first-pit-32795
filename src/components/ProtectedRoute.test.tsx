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
});
