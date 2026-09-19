import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth, indexedDBLocalPersistence, initializeAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { parseClientEnv } from './env';
import { isNativeShell } from './native-shell';

let emulatorsConnected = false;

function readClientEnv() {
  const rawEnv = import.meta.env as Record<string, string | undefined>;

  return parseClientEnv(rawEnv, {
    isProduction: import.meta.env.PROD
  });
}

function getEmulatorUrl(host: string, port: number) {
  const formattedHost = host.includes(':') ? `[${host}]` : host;

  return `http://${formattedHost}:${port}`;
}

export function getFirebaseApp() {
  const env = readClientEnv();
  const existingApp = getApps()[0];
  const app = existingApp ?? initializeApp(env.firebase);

  // In the iOS shell, Auth must be created with initializeAuth before anything
  // calls getAuth. getAuth's browser build loads the popup/redirect resolver
  // iframe from authDomain, which never answers at a capacitor:// origin, so
  // the first auth-state event never fires and the app sits on its loading
  // screen. Every later getAuth(app) returns this same instance.
  if (!existingApp && isNativeShell()) {
    initializeAuth(app, { persistence: indexedDBLocalPersistence });
  }

  if (!emulatorsConnected && env.useFirebaseEmulators) {
    const auth = getAuth(app);
    const firestore = getFirestore(app);
    const functions = getFunctions(app);
    const storage = getStorage(app);

    connectAuthEmulator(
      auth,
      getEmulatorUrl(env.emulatorHosts.auth.host, env.emulatorHosts.auth.port),
      { disableWarnings: true }
    );
    connectFirestoreEmulator(
      firestore,
      env.emulatorHosts.firestore.host,
      env.emulatorHosts.firestore.port
    );
    connectFunctionsEmulator(
      functions,
      env.emulatorHosts.functions.host,
      env.emulatorHosts.functions.port
    );
    connectStorageEmulator(
      storage,
      env.emulatorHosts.storage.host,
      env.emulatorHosts.storage.port
    );

    emulatorsConnected = true;
  }

  return app;
}

export function getFirebaseServices() {
  const app = getFirebaseApp();

  return {
    app,
    auth: getAuth(app),
    firestore: getFirestore(app),
    storage: getStorage(app),
    functions: getFunctions(app)
  };
}
