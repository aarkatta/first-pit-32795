import { useCallback, useEffect, useRef, useState } from 'react';
import { getFirebaseServices } from './firebase';
import { getProjects } from './kanban-service';
import { getRequestState, type RequestState } from './request-state';
import type { KanbanProject } from './domain';

/**
 * The team's board, for the screens that configure or feed it rather than draw
 * it. A team has one active board, so this returns the first one and leaves the
 * board component itself to own the live card subscriptions.
 */
export function useTeamBoard(teamId: string | null, online: boolean) {
  const firestore = getFirebaseServices().firestore;
  const [project, setProject] = useState<KanbanProject | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const generation = useRef(0);

  const refresh = useCallback(async () => {
    const attempt = ++generation.current;
    if (!teamId) return;
    setStatus('loading');
    setRequestState(null);
    try {
      const projects = await getProjects(firestore, teamId);
      if (attempt !== generation.current) return;
      setProject(projects[0] ?? null);
      setStatus('ready');
    } catch (error) {
      if (attempt !== generation.current) return;
      setRequestState(getRequestState(error, online));
      setStatus('error');
    }
  }, [firestore, online, teamId]);

  useEffect(() => { void refresh(); }, [refresh]);

  return { project, status, requestState, setRequestState, refresh };
}
