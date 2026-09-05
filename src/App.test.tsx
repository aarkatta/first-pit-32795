import { MemoryRouter, useLocation } from 'react-router-dom';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClientEnv } from '@/lib/env';

import { AppRoutes } from './App';

const testClientEnv: ClientEnv = {
  appName: 'Runtime Team Hub',
  appTagline: 'Configured tagline',
  firebase: {
    apiKey: 'test-api-key',
    authDomain: 'test.firebaseapp.com',
    projectId: 'test-project',
    storageBucket: 'test.appspot.com',
    messagingSenderId: '1234567890',
    appId: 'test-app-id'
  },
  useFirebaseEmulators: true,
  emulatorHosts: {
    auth: { host: '127.0.0.1', port: 19099 },
    firestore: { host: '127.0.0.1', port: 18080 },
    storage: { host: '127.0.0.1', port: 19199 },
    functions: { host: '127.0.0.1', port: 15001 }
  }
};

function LocationProbe() {
  const location = useLocation();
  return <div hidden data-testid="location" data-pathname={location.pathname} data-search={location.search} data-hash={location.hash} />;
}

function renderRoutes(initialEntry: string) {
  return render(
    <MemoryRouter initialEntries={[initialEntry]}>
      <AppRoutes clientEnv={testClientEnv} />
      <LocationProbe />
    </MemoryRouter>
  );
}

describe('AppRoutes', () => {
  it('shows an accessible fallback, renders the public overview, and navigates to another lazy route', async () => {
    renderRoutes('/');

    const fallback = screen.getByRole('status');
    expect(fallback).toHaveTextContent('Loading page');
    expect(fallback).toHaveAttribute('aria-live', 'polite');
    expect(fallback).toHaveAttribute('aria-busy', 'true');

    expect(await screen.findByRole('heading', { name: /students and coaches working as one team/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText('Runtime Team Hub')).toBeInTheDocument();
    // The QA state catalogue is not linked from any public surface.
    expect(screen.queryByRole('link', { name: /state lab/i })).not.toBeInTheDocument();
  });

  it('renders the state lab page', async () => {
    renderRoutes('/states');

    expect(await screen.findByRole('heading', { name: /loading, empty, error, permission, and offline/i })).toBeInTheDocument();
    expect(screen.getByText(/permission denied/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByText(/retry selected for the loading state example/i)).toBeInTheDocument();
  });

  it('redirects the legacy home route to the overview', async () => {
    renderRoutes('/home');

    expect(await screen.findByRole('heading', { name: /students and coaches working as one team/i }, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByTestId('location')).toHaveAttribute('data-pathname', '/');
  });

  it('renders the not-found page for unknown routes', async () => {
    renderRoutes('/does-not-exist');

    expect(await screen.findByRole('heading', { name: /we could not find that page/i })).toBeInTheDocument();
    expect(screen.queryByText(/phase 1 foundation/i)).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /back to overview/i })).toHaveAttribute('href', '/');
  });

  it('renders the emulator route', async () => {
    renderRoutes('/emulators');

    expect(await screen.findByRole('heading', { name: /local services are wired before feature work starts/i })).toBeInTheDocument();
    expect(screen.getByText('Firestore').closest('li')).toHaveTextContent('8080');
  });

  it('preserves the full protected deep link when redirecting to the lazy auth route', async () => {
    renderRoutes('/scorer?session=session-1#history');

    expect(await screen.findByRole('heading', { name: /sign in to first pit/i })).toBeInTheDocument();
    const location = screen.getByTestId('location');
    expect(location).toHaveAttribute('data-pathname', '/auth');
    expect(new URLSearchParams(location.getAttribute('data-search') ?? '').get('next')).toBe('/scorer?session=session-1#history');
  });

  it('keeps the invitation id when a signed-out invitee opens a join link', async () => {
    renderRoutes('/join?invite=invitation-1');

    expect(await screen.findByRole('heading', { name: /sign in to first pit/i })).toBeInTheDocument();
    const location = screen.getByTestId('location');
    expect(location).toHaveAttribute('data-pathname', '/auth');
    expect(new URLSearchParams(location.getAttribute('data-search') ?? '').get('next')).toBe('/join?invite=invitation-1');
  });

  it('preserves query and hash through a legacy coordination alias before authentication', async () => {
    renderRoutes('/tracker?task=task-1#details');

    expect(await screen.findByRole('heading', { name: /sign in to first pit/i })).toBeInTheDocument();
    const location = screen.getByTestId('location');
    expect(location).toHaveAttribute('data-pathname', '/auth');
    expect(new URLSearchParams(location.getAttribute('data-search') ?? '').get('next')).toBe('/coordination?task=task-1#details');
  });
});
