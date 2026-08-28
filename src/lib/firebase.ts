import { initializeApp, getApps } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import { connectFirestoreEmulator, getFirestore } from 'firebase/firestore';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { parseClientEnv } from './env';

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
  const app = getApps()[0] ?? initializeApp(env.firebase);

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
