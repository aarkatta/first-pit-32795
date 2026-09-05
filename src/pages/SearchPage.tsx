import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { globalSearch, type GlobalSearchResult } from '@/lib/phase7-service';
import { safeInternalRoute } from '@/lib/notification-route';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';
import { useTeamContext } from '@/lib/team-context';

export function SearchPage() {
  const { user } = useAuth();
  const { teams, activeTeam, setActiveTeamId } = useTeamContext();
  const online = useOnlineStatus();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [scope, setScope] = useState<'all' | 'team'>('all');
  const [results, setResults] = useState<GlobalSearchResult[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [error, setError] = useState<Error | null>(null);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const searchRequest = useRef(0);
  const activeTeamRef = useRef(activeTeam?.teamId ?? null);
  activeTeamRef.current = activeTeam?.teamId ?? null;

  const runSearch = useCallback(async (rawQuery: string) => {
    const trimmed = rawQuery.trim();
    if (!trimmed || !online) return;
    const requestId = ++searchRequest.current;
    const startedTeamId = activeTeamRef.current;
    setStatus('loading');
    setError(null);
    setRequestState(null);
    try {
      const response = await globalSearch({ query: trimmed, ...(scope === 'team' && activeTeam ? { teamId: activeTeam.teamId } : {}) });
      if (requestId !== searchRequest.current || startedTeamId !== activeTeamRef.current) return;
      setResults(response.results);
      setStatus('ready');
    } catch (nextError) {
      if (requestId !== searchRequest.current || startedTeamId !== activeTeamRef.current) return;
      setError(nextError instanceof Error ? nextError : new Error('Search could not run.'));
      setStatus('error');
      setRequestState(getRequestState(nextError, online));
    }
  }, [activeTeam, online, scope]);

  // A shared `/search?q=…` link seeded the box but never ran the query, so the
  // recipient saw a filled field above an empty results region.
  const seededQuery = params.get('q')?.trim() ?? '';
  const seedRan = useRef(false);
  useEffect(() => {
    if (seedRan.current || !seededQuery || !user || !teams.length) return;
    seedRan.current = true;
    void runSearch(seededQuery);
  }, [runSearch, seededQuery, teams.length, user]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void runSearch(query);
  }

  function openResult(result: GlobalSearchResult) {
    if (teams.some((team) => team.teamId === result.teamId)) setActiveTeamId(result.teamId);
    navigate(safeInternalRoute(result.deepLink));
  }

  if (!user) return <StatePanel variant="permission" title="Sign in to search" message="Global search only runs for authenticated team members." />;
  if (!teams.length) return <StatePanel variant="empty" title="Join a team to search" message="Search is private and only includes records from teams where your active membership is verified." actionLabel="Open team hub" onAction={() => navigate('/hub')} />;

  return (
    <div className="page-stack">
      <section className="search-hero">
        <div><span className="eyebrow light">AUTHORIZED SEARCH</span><h3>Find team work quickly.</h3><p>Search questions, videos, messages, files, tasks, events, goals, and scores only within teams you can access.</p></div>
        <form onSubmit={submit}><label htmlFor="global-search">Search team workspace<input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Robot, practice, filename…" /></label><label>Scope<select value={scope} onChange={(event) => setScope(event.target.value as 'all' | 'team')}><option value="all">All my teams</option><option value="team">Active team only</option></select></label><button type="submit" disabled={status === 'loading' || !online || !query.trim()}>{status === 'loading' ? 'Searching…' : 'Search'}</button></form>
      </section>
      {!online ? <StatePanel variant="offline" title="Search is unavailable offline" message="Reconnect to search the current authorized team index." /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} /> : null}
      {status === 'error' ? <StatePanel variant="error" title="Search could not complete" message={error?.message ?? 'Try again.'} actionLabel="Retry" onAction={() => void runSearch(query)} autoFocus /> : null}
      {/* The live region stays mounted so a screen reader hears the search start
          and finish; mounting it with the results announced nothing at all. */}
      <section aria-live="polite" aria-busy={status === 'loading'}>
        {status === 'loading' ? <StatePanel variant="loading" title="Searching" message="Checking the records you are authorized to see." /> : null}
        {status === 'ready' ? <><div className="section-heading"><div><span className="eyebrow">RESULTS</span><h3>{results.length} authorized result{results.length === 1 ? '' : 's'}</h3></div></div>{results.length ? <div className="feed-list">{results.map((result) => <article key={`${result.type}:${result.teamId}:${result.recordId}`}><span className="eyebrow">{result.type}</span><strong>{result.title}</strong><p>{result.snippet} · {teams.find((team) => team.teamId === result.teamId)?.team?.name ?? 'Team workspace'}</p><div><button type="button" onClick={() => openResult(result)}>Open result →</button></div></article>)}</div> : <StatePanel variant="empty" title="No authorized matches" message="Try a shorter keyword, switch team scope, or ask a coach to add the missing team record." />}</> : null}
      </section>
      <p className="muted"><Link to="/profile">Manage profile and privacy preferences</Link>. Public community discovery is intentionally not part of this search.</p>
    </div>
  );
}
