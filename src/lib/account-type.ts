import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useState } from 'react';
import { call } from './callable';
import { isAccountType, type AccountType } from './domain';
import { getFirebaseServices } from './firebase';

/** Server-only write: the `users` rules do not let the browser set this field. */
export function setAccountType(accountType: AccountType) {
  return call<{ accountType: AccountType }, { accountType: AccountType; changed: boolean }>('setAccountType', { accountType });
}

export type AccountTypeState = {
  status: 'loading' | 'ready' | 'error';
  /** Null until the person has chosen one; accounts from before sign-up asked have none. */
  accountType: AccountType | null;
};

type ProfileStatus = 'loading' | 'ready' | 'error';
type ProfileState = { status: ProfileStatus; data: Record<string, unknown> | null };

/**
 * The last profile each account resolved to, for the lifetime of the tab.
 *
 * `ProtectedRoute` gates on this document, and React Router unmounts one
 * ProtectedRoute and mounts another on every navigation. Without a cache every
 * page change would re-enter `loading` and flash a panel over the whole app.
 * The listener keeps the entry current, so a stale read is only ever as old as
 * the last snapshot.
 */
const resolvedProfiles = new Map<string, Record<string, unknown> | null>();

/**
 * The signed-in person's own `users/{uid}` document.
 *
 * Shared by the hooks below rather than subscribed twice: the Firestore SDK
 * multiplexes identical document listeners, but the loading and error handling
 * is the part worth having in one place.
 */
function useUserDocument(userId: string | null | undefined) {
  const [state, setState] = useState<ProfileState>(() => initialProfileState(userId));
  useEffect(() => {
    if (!userId) {
      setState({ status: 'ready', data: null });
      return undefined;
    }
    setState(initialProfileState(userId));
    return onSnapshot(
      doc(getFirebaseServices().firestore, 'users', userId),
      (snapshot) => {
        const data = (snapshot.data() as Record<string, unknown> | undefined) ?? null;
        resolvedProfiles.set(userId, data);
        setState({ status: 'ready', data });
      },
      () => setState({ status: 'error', data: null })
    );
  }, [userId]);
  return state;
}

function initialProfileState(userId: string | null | undefined): ProfileState {
  if (!userId) return { status: 'ready', data: null };
  return resolvedProfiles.has(userId)
    ? { status: 'ready', data: resolvedProfiles.get(userId) ?? null }
    : { status: 'loading', data: null };
}

/** Test seam: drops the cached profiles so each case starts cold. */
export function clearResolvedProfiles() {
  resolvedProfiles.clear();
}

/** The signed-in person's account type, live from their private profile. */
export function useAccountType(userId: string | null | undefined): AccountTypeState {
  const { status, data } = useUserDocument(userId);
  const value = data?.accountType;
  return { status, accountType: isAccountType(value) ? value : null };
}

export type ProvisionedAccountState = {
  status: ProfileStatus;
  /**
   * True while the member is still using the password their coach handed them.
   * Set by `provisionTeamMember` and `resetTeamMemberPassword`, cleared only by
   * `setInitialPassword` — the browser cannot write it (the `users` rules pin
   * which keys an owner may touch).
   */
  mustSetPassword: boolean;
  /** The team that created this account, or null for someone who signed up themselves. */
  provisionedByTeamId: string | null;
};

/**
 * Whether this account was created by a coach, and whether it still owes a
 * password change.
 *
 * `ProtectedRoute` reads both: a provisioned member is sent to
 * `PasswordSetupGate` first, and is exempt from the email-verification gate
 * because nobody ever sent them a verification mail to open. They keep
 * `emailVerified: false`, which is the truth, and which still makes them verify
 * before accepting an invitation to a second team.
 */
export function useProvisionedAccount(userId: string | null | undefined): ProvisionedAccountState {
  const { status, data } = useUserDocument(userId);
  const provisionedByTeamId = data?.provisionedByTeamId;
  return {
    status,
    mustSetPassword: data?.mustSetPassword === true,
    provisionedByTeamId: typeof provisionedByTeamId === 'string' ? provisionedByTeamId : null
  };
}
