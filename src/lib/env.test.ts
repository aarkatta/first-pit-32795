import { describe, expect, it } from 'vitest';
import { parseClientEnv } from './env';

const validEnv = {
  VITE_APP_NAME: 'First Pit',
  VITE_APP_TAGLINE: 'Phase 0 foundation',
  VITE_FIREBASE_API_KEY: 'demo-api-key',
  VITE_FIREBASE_AUTH_DOMAIN: 'demo.firebaseapp.com',
  VITE_FIREBASE_PROJECT_ID: 'demo-project',
  VITE_FIREBASE_STORAGE_BUCKET: 'demo.appspot.com',
  VITE_FIREBASE_MESSAGING_SENDER_ID: '1234567890',
  VITE_FIREBASE_APP_ID: '1:1234567890:web:abc123',
  VITE_FIREBASE_MEASUREMENT_ID: '',
  VITE_USE_FIREBASE_EMULATORS: 'true',
  VITE_FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_AUTH_EMULATOR_PORT: '9099',
  VITE_FIREBASE_FIRESTORE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_FIRESTORE_EMULATOR_PORT: '8080',
  VITE_FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1',
  VITE_FIREBASE_STORAGE_EMULATOR_PORT: '9199'
};

describe('parseClientEnv', () => {
  it('parses valid client env and normalizes booleans', () => {
    const env = parseClientEnv(validEnv);

    expect(env.appName).toBe('First Pit');
    expect(env.useFirebaseEmulators).toBe(true);
    expect(env.emulatorHosts.firestore.port).toBe(8080);
    expect(env.firebase.measurementId).toBeUndefined();
  });

  it('throws when a required firebase value is missing', () => {
    expect(() =>
      parseClientEnv({
        ...validEnv,
        VITE_FIREBASE_PROJECT_ID: ''
      })
    ).toThrowError(/Invalid First Pit client environment/);
  });
});
