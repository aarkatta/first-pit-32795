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

/** The signed-in person's account type, live from their private profile. */
export function useAccountType(userId: string | null | undefined): AccountTypeState {
  const [state, setState] = useState<AccountTypeState>({ status: 'loading', accountType: null });
  useEffect(() => {
    if (!userId) {
      setState({ status: 'ready', accountType: null });
      return undefined;
    }
    setState({ status: 'loading', accountType: null });
    return onSnapshot(
      doc(getFirebaseServices().firestore, 'users', userId),
      (snapshot) => {
        const value = snapshot.data()?.accountType;
        setState({ status: 'ready', accountType: isAccountType(value) ? value : null });
      },
      () => setState({ status: 'error', accountType: null })
    );
  }, [userId]);
  return state;
}
