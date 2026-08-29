import { type Firestore } from 'firebase/firestore';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useAuth } from './auth-context';
import { getFirebaseServices } from './firebase';
import type { TeamMembership } from './teams';
import { subscribeToUserTeams } from './teams';

type TeamContextValue = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  teams: TeamMembership[];
  activeTeam: TeamMembership | null;
  activeTeamId: string | null;
  error: Error | null;
  setActiveTeamId: (teamId: string) => void;
  retry: () => void;
};

const defaultTeamContext: TeamContextValue = {
  status: 'idle',
  teams: [],
  activeTeam: null,
  activeTeamId: null,
  error: null,
  setActiveTeamId: () => undefined,
  retry: () => undefined
};

const TeamContext = createContext<TeamContextValue>(defaultTeamContext);

type TeamProviderProps = {
  children: ReactNode;
  firestore?: Firestore;
};

export function TeamProvider({ children, firestore: suppliedFirestore }: TeamProviderProps) {
  const { user, status: authStatus } = useAuth();
  const firestore = suppliedFirestore ?? getFirebaseServices().firestore;
  const [status, setStatus] = useState<TeamContextValue['status']>('idle');
  const [teams, setTeams] = useState<TeamMembership[]>([]);
  const [activeTeamId, setActiveTeamIdState] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem('first-pit.active-team-id');
  });
  const [error, setError] = useState<Error | null>(null);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user) {
      // Clear the previous session completely. Leaving the error and the active
      // team id behind carried one user's state into the next sign-in on a
      // shared browser.
      setStatus(authStatus === 'loading' ? 'loading' : 'idle');
      setTeams([]);
      setError(null);
      if (authStatus !== 'loading') {
        setActiveTeamIdState(null);
        if (typeof window !== 'undefined') window.localStorage.removeItem('first-pit.active-team-id');
      }
      return undefined;
    }

    setStatus('loading');
    setError(null);
    return subscribeToUserTeams(
      firestore,
      user.uid,
      (nextTeams) => {
        setTeams(nextTeams);
        setStatus('ready');
        setActiveTeamIdState((currentId) => {
          const preferred = currentId && nextTeams.some((team) => team.teamId === currentId) ? currentId : nextTeams[0]?.teamId ?? null;
          if (typeof window !== 'undefined') {
            if (preferred) window.localStorage.setItem('first-pit.active-team-id', preferred);
            else window.localStorage.removeItem('first-pit.active-team-id');
          }
          return preferred;
        });
      },
      (nextError) => {
        setStatus('error');
        setError(nextError);
      }
    );
  }, [authStatus, firestore, retryToken, user]);

  const value = useMemo<TeamContextValue>(() => {
    const activeTeam = teams.find((team) => team.teamId === activeTeamId) ?? teams[0] ?? null;
    return {
      status,
      teams,
      activeTeam,
      activeTeamId: activeTeam?.teamId ?? null,
      error,
      setActiveTeamId: (teamId: string) => {
        if (!teams.some((team) => team.teamId === teamId)) return;
        setActiveTeamIdState(teamId);
        if (typeof window !== 'undefined') window.localStorage.setItem('first-pit.active-team-id', teamId);
      },
      retry: () => setRetryToken((token) => token + 1)
    };
  }, [activeTeamId, error, status, teams]);

  return <TeamContext.Provider value={value}>{children}</TeamContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTeamContext() {
  return useContext(TeamContext);
}
