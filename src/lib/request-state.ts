import type { StateVariant } from '@/components/StatePanel';

export type RequestState = {
  variant: Extract<StateVariant, 'error' | 'permission' | 'offline'>;
  title: string;
  message: string;
};

function errorCode(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code.toLowerCase() : '';
  }
  return '';
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message.trim() ? error.message : 'That request could not be completed. Try again.';
}

/**
 * Firebase Auth codes that mean the *project* is misconfigured, not that the
 * signed-in person lacks access. `auth/unauthorized-domain` (the origin is not
 * in the Auth authorized-domain list) and `auth/operation-not-allowed` (the
 * provider was never switched on) both contain substrings the permission match
 * below looks for, and answering them with "ask a coach" sends the user chasing
 * a team-membership problem that does not exist. They stay on the generic error
 * path so the caller's own message survives.
 */
const AUTH_CONFIGURATION_CODES = [
  'auth/unauthorized-domain',
  'auth/operation-not-allowed',
  'auth/configuration-not-found',
  'auth/app-not-authorized',
  'auth/invalid-api-key',
  'auth/api-key-not-valid'
];

function isAuthConfigurationFailure(code: string): boolean {
  return AUTH_CONFIGURATION_CODES.some((part) => code.includes(part));
}

export function getRequestState(error: unknown, online: boolean): RequestState {
  const code = errorCode(error);
  const message = errorMessage(error).toLowerCase();

  if (!online || ['unavailable', 'network-request-failed', 'deadline-exceeded'].some((part) => code.includes(part)) || message.includes('network')) {
    return {
      variant: 'offline',
      title: 'Connection interrupted',
      message: 'Reconnect to the internet, then try again.'
    };
  }

  if (!isAuthConfigurationFailure(code)
    && (['permission-denied', 'unauthorized', 'operation-not-allowed'].some((part) => code.includes(part))
      || message.includes('permission denied'))) {
    return {
      variant: 'permission',
      title: 'You do not have permission',
      message: 'Your account is not authorized for this action. Check your team access or ask a coach.'
    };
  }

  return {
    variant: 'error',
    title: 'Request failed',
    message: errorMessage(error)
  };
}
