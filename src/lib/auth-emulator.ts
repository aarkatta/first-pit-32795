import { parseClientEnv } from './env';
import { EMAIL_ACTION_PATH } from './auth';

type OobCode = {
  email?: string;
  requestType?: string;
  oobCode?: string;
};

function clientEnv() {
  return parseClientEnv(import.meta.env as Record<string, string | undefined>, {
    isProduction: import.meta.env.PROD
  });
}

export function usingAuthEmulator(): boolean {
  try {
    return clientEnv().useFirebaseEmulators;
  } catch {
    return false;
  }
}

/**
 * The verification link the Auth emulator generated for `email`.
 *
 * The emulator never delivers mail — it only records the out-of-band codes it
 * would have sent — so without this there is no way to complete verification
 * locally and the gate is a dead end for every developer and every emulator
 * test run. Returns an in-app `/auth/action` URL so local testing exercises
 * the real handler rather than the emulator's own stand-in page.
 */
export async function latestVerificationLink(email: string): Promise<string | null> {
  const env = clientEnv();
  if (!env.useFirebaseEmulators) return null;

  const { host, port } = env.emulatorHosts.auth;
  const formattedHost = host.includes(':') ? `[${host}]` : host;
  const response = await fetch(`http://${formattedHost}:${port}/emulator/v1/projects/${env.firebase.projectId}/oobCodes`);
  if (!response.ok) return null;

  const body = (await response.json()) as { oobCodes?: OobCode[] };
  const wanted = email.trim().toLowerCase();
  // The emulator appends, so the last match is the most recently issued code.
  const match = (body.oobCodes ?? [])
    .filter((entry) => entry.requestType === 'VERIFY_EMAIL' && entry.email?.toLowerCase() === wanted)
    .pop();
  if (!match?.oobCode) return null;

  const url = new URL(EMAIL_ACTION_PATH, window.location.origin);
  url.searchParams.set('mode', 'verifyEmail');
  url.searchParams.set('oobCode', match.oobCode);
  return url.toString();
}
