import { onAuthStateChanged, type Auth, type User } from 'firebase/auth';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { configureAuthPersistence, signOutCurrentUser } from './auth';
import { getFirebaseServices } from './firebase';
import { bootstrapUserProfile } from './profile';

export type AuthStatus = 'loading' | 'authenticated' | 'unauthenticated' | 'error';

type AuthContextValue = {
  auth: Auth | null;
  user: User | null;
  status: AuthStatus;
  error: Error | null;
  retry: () => void;
  signOut: () => Promise<void>;
};

const unauthenticatedValue: AuthContextValue = {
  auth: null,
  user: null,
  status: 'unauthenticated',
  error: null,
  retry: () => undefined,
  signOut: async () => undefined
};

const AuthContext = createContext<AuthContextValue>(unauthenticatedValue);

type AuthProviderProps = {
  children: ReactNode;
  auth?: Auth;
};

export function AuthProvider({ children, auth: suppliedAuth }: AuthProviderProps) {
  const auth = suppliedAuth ?? getFirebaseServices().auth;
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [status, setStatus] = useState<AuthStatus>(auth.currentUser ? 'authenticated' : 'loading');
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    let active = true;
    let authEventGeneration = 0;

    setStatus(auth.currentUser ? 'authenticated' : 'loading');
    setError(null);

    // The session listener is registered only after persistence is configured.
    // Registering first meant a sign-in observed in between was stored under
    // the default persistence for that tab.
    let unsubscribe: (() => void) | null = null;

    const handleUser = (nextUser: User | null) => {
        if (!active) return;
        const generation = ++authEventGeneration;
        setUser(nextUser);
        setStatus(nextUser ? 'authenticated' : 'unauthenticated');
        setError(null);
        if (nextUser) {
          void bootstrapUserProfile(nextUser).catch((profileError: unknown) => {
            if (!active || generation !== authEventGeneration || auth.currentUser?.uid !== nextUser.uid) return;
            setStatus('error');
            setError(profileError instanceof Error ? profileError : new Error('Could not create your private profile.'));
          });
        }
    };

    const handleError = (authError: Error) => {
        if (!active) return;
        setStatus('error');
        setError(authError);
    };

    configureAuthPersistence(auth)
      .then(() => {
        if (!active) return;
        unsubscribe = onAuthStateChanged(auth, handleUser, handleError);
      })
      .catch((persistenceError: unknown) => {
        if (!active) return;
        setStatus('error');
        setError(persistenceError instanceof Error ? persistenceError : new Error('Could not configure session persistence.'));
      });

    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [auth, retryToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      auth,
      user,
      status,
      error,
      retry: () => setRetryToken((token) => token + 1),
      signOut: () => signOutCurrentUser(auth)
    }),
    [auth, error, status, user]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  return useContext(AuthContext);
}
