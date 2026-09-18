import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ClientEnv } from './env';

const mocks = vi.hoisted(() => ({
  app: { name: 'first-pit-test-app' },
  env: undefined as ClientEnv | undefined,
  getApps: vi.fn(),
  initializeApp: vi.fn(),
  getAuth: vi.fn(() => ({ name: 'auth' })),
  initializeAuth: vi.fn(),
  isNativeShell: vi.fn(() => false),
  getFirestore: vi.fn(() => ({ name: 'firestore' })),
  getFunctions: vi.fn(() => ({ name: 'functions' })),
  getStorage: vi.fn(() => ({ name: 'storage' })),
  connectAuthEmulator: vi.fn(),
  connectFirestoreEmulator: vi.fn(),
  connectFunctionsEmulator: vi.fn(),
  connectStorageEmulator: vi.fn()
}));

vi.mock('firebase/app', () => ({
  getApps: mocks.getApps,
  initializeApp: mocks.initializeApp
}));

vi.mock('firebase/auth', () => ({
  connectAuthEmulator: mocks.connectAuthEmulator,
  getAuth: mocks.getAuth,
  indexedDBLocalPersistence: { type: 'LOCAL' },
  initializeAuth: mocks.initializeAuth
}));

vi.mock('./native-shell', () => ({ isNativeShell: mocks.isNativeShell }));

vi.mock('firebase/firestore', () => ({
  connectFirestoreEmulator: mocks.connectFirestoreEmulator,
  getFirestore: mocks.getFirestore
}));

vi.mock('firebase/functions', () => ({
  connectFunctionsEmulator: mocks.connectFunctionsEmulator,
  getFunctions: mocks.getFunctions
}));

vi.mock('firebase/storage', () => ({
  connectStorageEmulator: mocks.connectStorageEmulator,
  getStorage: mocks.getStorage
}));

vi.mock('./env', () => ({
  parseClientEnv: vi.fn(() => mocks.env)
}));

function makeEnv(useFirebaseEmulators: boolean): ClientEnv {
  return {
    appName: 'First Pit',
    appTagline: 'Phase 0 foundation',
    firebase: {
      apiKey: 'demo-api-key',
      authDomain: 'demo.firebaseapp.com',
      projectId: 'demo-project',
      storageBucket: 'demo.appspot.com',
      messagingSenderId: '1234567890',
      appId: '1:1234567890:web:abc123'
    },
    useFirebaseEmulators,
    emulatorHosts: {
      auth: { host: '127.0.0.1', port: 9099 },
      firestore: { host: '127.0.0.1', port: 8080 },
      storage: { host: '127.0.0.1', port: 9199 },
      functions: { host: '127.0.0.1', port: 5001 }
    }
  };
}

describe('Firebase bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.env = makeEnv(false);
    mocks.getApps.mockReturnValue([]);
    mocks.initializeApp.mockReturnValue(mocks.app);
    mocks.getAuth.mockReturnValue({ name: 'auth' });
    mocks.isNativeShell.mockReturnValue(false);
    mocks.getFirestore.mockReturnValue({ name: 'firestore' });
    mocks.getFunctions.mockReturnValue({ name: 'functions' });
    mocks.getStorage.mockReturnValue({ name: 'storage' });
  });

  it('initializes the app and returns all Firebase services', async () => {
    const { getFirebaseServices } = await import('./firebase');

    const services = getFirebaseServices();

    expect(mocks.initializeApp).toHaveBeenCalledWith(mocks.env?.firebase);
    expect(services).toEqual({
      app: mocks.app,
      auth: { name: 'auth' },
      firestore: { name: 'firestore' },
      storage: { name: 'storage' },
      functions: { name: 'functions' }
    });
    expect(mocks.connectAuthEmulator).not.toHaveBeenCalled();
    expect(mocks.connectFirestoreEmulator).not.toHaveBeenCalled();
    expect(mocks.connectStorageEmulator).not.toHaveBeenCalled();
    expect(mocks.connectFunctionsEmulator).not.toHaveBeenCalled();
  });

  it('connects each service to its configured emulator when enabled', async () => {
    mocks.env = makeEnv(true);
    const { getFirebaseServices } = await import('./firebase');

    getFirebaseServices();

    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(
      { name: 'auth' },
      'http://127.0.0.1:9099',
      { disableWarnings: true }
    );
    expect(mocks.connectFirestoreEmulator).toHaveBeenCalledWith({ name: 'firestore' }, '127.0.0.1', 8080);
    expect(mocks.connectStorageEmulator).toHaveBeenCalledWith({ name: 'storage' }, '127.0.0.1', 9199);
    expect(mocks.connectFunctionsEmulator).toHaveBeenCalledWith({ name: 'functions' }, '127.0.0.1', 5001);
  });

  it('formats IPv6 loopback addresses safely for Auth emulator URLs', async () => {
    mocks.env = {
      ...makeEnv(true),
      emulatorHosts: {
        ...makeEnv(true).emulatorHosts,
        auth: { host: '::1', port: 9099 }
      }
    };
    const { getFirebaseServices } = await import('./firebase');

    getFirebaseServices();

    expect(mocks.connectAuthEmulator).toHaveBeenCalledWith(
      { name: 'auth' },
      'http://[::1]:9099',
      { disableWarnings: true }
    );
  });

  it('leaves Auth to getAuth on the web', async () => {
    const { getFirebaseServices } = await import('./firebase');

    getFirebaseServices();

    expect(mocks.initializeAuth).not.toHaveBeenCalled();
  });

  it('initializes Auth once with IndexedDB persistence in the iOS shell', async () => {
    mocks.isNativeShell.mockReturnValue(true);
    const { getFirebaseServices } = await import('./firebase');

    getFirebaseServices();
    mocks.getApps.mockReturnValue([mocks.app]);
    getFirebaseServices();

    expect(mocks.initializeAuth).toHaveBeenCalledOnce();
    expect(mocks.initializeAuth).toHaveBeenCalledWith(mocks.app, { persistence: { type: 'LOCAL' } });
  });
});
