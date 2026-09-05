import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { StatePanel } from '@/components/StatePanel';
import { getRequestState, type RequestState } from '@/lib/request-state';
import {
  getTeamCalendarSync,
  listGoogleCalendars,
  listMyGoogleEvents,
  setTeamCalendarSync,
  syncTeamCalendar,
  type GoogleAgendaEvent,
  type GoogleCalendarSummary,
  type SyncResult,
  type TeamCalendarSync
} from '@/lib/google-service';

type TeamCalendarPanelProps = {
  teamId: string | null;
  canManage: boolean;
  online: boolean;
};

function formatWhen(startsAt: string, endsAt: string): string {
  const start = new Date(startsAt);
  const end = new Date(endsAt);
  if (Number.isNaN(start.getTime())) return 'Date unavailable';
  const date = start.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  const from = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (Number.isNaN(end.getTime())) return `${date}, ${from}`;
  return `${date}, ${from}–${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

/**
 * The Google Calendar surface inside Coordination.
 *
 * Two distinct things share this panel because they answer the same question
 * for different people: a coach configures which Google calendar mirrors the
 * team's events, and every member sees their own upcoming Google agenda beside
 * the team's First Pit events.
 */
export function TeamCalendarPanel({ teamId, canManage, online }: TeamCalendarPanelProps) {
  const [sync, setSync] = useState<TeamCalendarSync | null>(null);
  const [calendars, setCalendars] = useState<GoogleCalendarSummary[]>([]);
  const [agenda, setAgenda] = useState<GoogleAgendaEvent[]>([]);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<RequestState | null>(null);
  const [notConnected, setNotConnected] = useState(false);
  const [selected, setSelected] = useState('');
  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState<SyncResult | null>(null);

  const load = useCallback(() => {
    if (!teamId) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    setError(null);
    setNotConnected(false);
    getTeamCalendarSync(teamId)
      .then(async (current) => {
        setSync(current);
        setSelected(current.calendarId ?? '');
        // The agenda and the calendar picker both need a connected Google
        // account. A missing connection is an expected state, not an error, so
        // it is caught here and rendered as guidance instead of a failure.
        const [agendaResult, calendarResult] = await Promise.allSettled([
          listMyGoogleEvents({ days: 14 }),
          canManage ? listGoogleCalendars() : Promise.resolve({ calendars: [] })
        ]);
        if (agendaResult.status === 'fulfilled') setAgenda(agendaResult.value.events);
        else if (String((agendaResult.reason as { message?: string })?.message ?? '').includes('Connect a Google account')) setNotConnected(true);
        if (calendarResult.status === 'fulfilled') setCalendars(calendarResult.value.calendars);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        setError(getRequestState(cause, online));
        setStatus('error');
      });
  }, [canManage, online, teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const saveSync = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!teamId || !selected) return;
      setBusy(true);
      setError(null);
      setTeamCalendarSync({ teamId, calendarId: selected, enabled: true })
        .then(() => load())
        .catch((cause: unknown) => setError(getRequestState(cause, online)))
        .finally(() => setBusy(false));
    },
    [load, online, selected, teamId]
  );

  const disableSync = useCallback(() => {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    setTeamCalendarSync({ teamId, enabled: false })
      .then(() => load())
      .catch((cause: unknown) => setError(getRequestState(cause, online)))
      .finally(() => setBusy(false));
  }, [load, online, teamId]);

  const syncNow = useCallback(() => {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    setLastResult(null);
    syncTeamCalendar(teamId)
      .then((result) => {
        setLastResult(result);
        return load();
      })
      .catch((cause: unknown) => setError(getRequestState(cause, online)))
      .finally(() => setBusy(false));
  }, [load, online, teamId]);

  if (!teamId) {
    return (
      <article className="feature-panel">
        <span className="eyebrow">GOOGLE CALENDAR</span>
        <StatePanel variant="empty" title="No active team" message="Choose a team to see its Google Calendar connection." />
      </article>
    );
  }

  return (
    <article className="feature-panel">
      <span className="eyebrow">GOOGLE CALENDAR</span>
      <h3>Google Calendar</h3>

      {status === 'loading' ? <StatePanel variant="loading" title="Loading calendar" message="Checking the team's Google Calendar connection." /> : null}
      {status === 'error' && error ? (
        <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} />
      ) : null}

      {status === 'ready' ? (
        <>
          {!online ? <StatePanel variant="offline" title="Offline" message="Google Calendar needs a connection. Showing the last loaded view." /> : null}
          {error ? <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} /> : null}

          <p>
            {sync?.enabled
              ? `Team events sync two ways with Google Calendar${sync.calendarId ? ` (${sync.calendarId})` : ''}.`
              : 'Team events are not synced with Google Calendar yet.'}
            {sync?.lastSyncedAt ? ` Last synced ${new Date(sync.lastSyncedAt).toLocaleString()}.` : ''}
          </p>

          {sync?.enabled ? (
            <div className="stack">
              <button className="button secondary" type="button" onClick={syncNow} disabled={busy || !online}>
                {busy ? 'Syncing…' : 'Sync now'}
              </button>
              {lastResult ? (
                <p className="muted" role="status" aria-live="polite">
                  Pushed {lastResult.pushed}, added {lastResult.created}, updated {lastResult.updated}, removed {lastResult.removed}.
                </p>
              ) : null}
            </div>
          ) : null}

          {canManage ? (
            notConnected ? (
              <StatePanel
                variant="empty"
                title="Connect Google first"
                message="Connect your Google account on the Profile page, then choose which calendar mirrors this team's events."
              />
            ) : (
              <form className="form-stack" onSubmit={saveSync}>
                <label>
                  Team calendar
                  <select value={selected} onChange={(event) => setSelected(event.target.value)} disabled={busy || !online}>
                    <option value="">Choose a calendar…</option>
                    {calendars.map((calendar) => (
                      <option key={calendar.id} value={calendar.id}>
                        {calendar.summary}
                        {calendar.primary ? ' (primary)' : ''}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="muted">
                  Events created in First Pit appear in this Google calendar, and events added there appear here. Only a
                  calendar you can write to can be used.
                </p>
                <div className="stack">
                  <button className="button" type="submit" disabled={busy || !online || !selected}>
                    {busy ? 'Saving…' : sync?.enabled ? 'Update calendar' : 'Turn on sync'}
                  </button>
                  {sync?.enabled ? (
                    <button className="button secondary" type="button" onClick={disableSync} disabled={busy || !online}>
                      Turn off sync
                    </button>
                  ) : null}
                </div>
                {calendars.length === 0 ? <p className="muted">No writable Google calendars were found on your account.</p> : null}
              </form>
            )
          ) : null}

          <h4>Your next two weeks</h4>
          {notConnected ? (
            <StatePanel
              variant="empty"
              title="Google not connected"
              message="Connect your Google account on the Profile page to see your own calendar here."
            />
          ) : agenda.length === 0 ? (
            <StatePanel variant="empty" title="Nothing scheduled" message="Your Google Calendar has no events in the next two weeks." />
          ) : (
            <ul className="stack">
              {agenda.map((event) => (
                <li key={event.googleEventId}>
                  <strong>{event.title}</strong>
                  <span className="muted">
                    {' '}
                    · {formatWhen(event.startsAt, event.endsAt)}
                    {event.location ? ` · ${event.location}` : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </>
      ) : null}
    </article>
  );
}
