import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { ClientEnv } from '@/lib/env';
import { EmulatorPage } from './EmulatorPage';

const testClientEnv: ClientEnv = {
  appName: 'Test Hub',
  appTagline: 'Test environment',
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

describe('EmulatorPage', () => {
  it('displays ports from the supplied client configuration', async () => {
    render(<EmulatorPage clientEnv={testClientEnv} />);

    expect(screen.getByText('Auth').closest('li')).toHaveTextContent('19099');
    expect(screen.getByText('Firestore').closest('li')).toHaveTextContent('18080');
    expect(screen.getByText('Storage').closest('li')).toHaveTextContent('19199');
    expect(screen.getByText('Functions').closest('li')).toHaveTextContent('15001');
    // The Emulator UI port is the only value outside the validated client env,
    // so it arrives from a lazily imported firebase.json.
    await waitFor(() => expect(screen.getByText('Emulator UI').closest('li')).toHaveTextContent('4000'));
  });

  it('renders configuration filenames as code rather than literal backticks', () => {
    render(<EmulatorPage clientEnv={testClientEnv} />);

    expect(screen.getByText('.env.example').tagName).toBe('CODE');
    expect(screen.getByText('.env.local').tagName).toBe('CODE');
    expect(screen.queryByText(/`\.env/)).not.toBeInTheDocument();
  });
});
