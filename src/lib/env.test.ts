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

  it('keeps an explicitly configured production client out of emulator mode', () => {
    const env = parseClientEnv({
      ...validEnv,
      VITE_USE_FIREBASE_EMULATORS: 'false'
    });

    expect(env.useFirebaseEmulators).toBe(false);
  });

  it('defaults to emulators in development when the flag is omitted', () => {
    const devEnv = {
      ...validEnv,
      VITE_USE_FIREBASE_EMULATORS: undefined
    };

    expect(parseClientEnv(devEnv).useFirebaseEmulators).toBe(true);
  });

  it('defaults to production Firebase services when the flag is omitted in a production build', () => {
    const productionEnv = {
      ...validEnv,
      VITE_USE_FIREBASE_EMULATORS: undefined
    };

    expect(parseClientEnv(productionEnv, { isProduction: true }).useFirebaseEmulators).toBe(false);
  });

  it('rejects emulator activation in production mode', () => {
    expect(() =>
      parseClientEnv(validEnv, {
        isProduction: true
      })
    ).toThrowError(/cannot be enabled in production/);
  });

  it('detects production mode from the Vite mode value', () => {
    expect(() =>
      parseClientEnv({
        ...validEnv,
        MODE: 'production'
      })
    ).toThrowError(/cannot be enabled in production/);
  });

  it('rejects non-loopback emulator hosts', () => {
    expect(() =>
      parseClientEnv({
        ...validEnv,
        VITE_FIREBASE_AUTH_EMULATOR_HOST: 'emulator.example.com'
      })
    ).toThrowError(/must be a loopback host/);
  });

  it('rejects invalid emulator ports', () => {
    expect(() =>
      parseClientEnv({
        ...validEnv,
        VITE_FIREBASE_STORAGE_EMULATOR_PORT: '65536'
      })
    ).toThrowError(/less than or equal to 65535/);
  });
});
