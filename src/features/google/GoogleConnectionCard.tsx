import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { disconnectGoogle, getGoogleConnection, startGoogleOAuth, type GoogleConnection } from '@/lib/google-service';

type GoogleConnectionCardProps = { online: boolean };

/**
 * Messages for the `?google=` parameter the OAuth callback redirects back with.
 * The callback cannot render into the app, so this is where the outcome of the
 * round trip is finally explained to the person who started it.
 */
const RETURN_MESSAGES: Record<string, { variant: 'success' | 'error'; text: string }> = {
  connected: { variant: 'success', text: 'Google account connected.' },
  denied: { variant: 'error', text: 'You declined the Google permission request. Nothing was connected.' },
  invalid: { variant: 'error', text: 'That Google sign-in link was incomplete. Start the connection again.' },
  failed: { variant: 'error', text: 'Google could not complete the connection. Try again.' }
};

export function GoogleConnectionCard({ online }: GoogleConnectionCardProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const [connection, setConnection] = useState<GoogleConnection | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<RequestState | null>(null);
  const [busy, setBusy] = useState(false);

  const returnCode = searchParams.get('google');
  const returnMessage = returnCode ? RETURN_MESSAGES[returnCode] : undefined;

  const load = useCallback(() => {
    setStatus('loading');
    setError(null);
    getGoogleConnection()
      .then((result) => {
        setConnection(result);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        setError(getRequestState(cause, online));
        setStatus('error');
      });
  }, [online]);

  useEffect(() => {
    load();
  }, [load]);

  const dismissReturn = useCallback(() => {
    const next = new URLSearchParams(searchParams);
    next.delete('google');
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const connect = useCallback(() => {
    setBusy(true);
    setError(null);
    startGoogleOAuth()
      .then(({ authUrl }) => {
        // A full navigation, not a popup: a popup is blocked by default on iOS
        // Safari, which the Capacitor shell also uses.
        window.location.assign(authUrl);
      })
      .catch((cause: unknown) => {
        setError(getRequestState(cause, online));
        setBusy(false);
      });
  }, [online]);

  const disconnect = useCallback(() => {
    setBusy(true);
    setError(null);
    disconnectGoogle()
      .then((result) => {
        setConnection({ connected: false, email: null, scopes: [] });
        if (result.disabledTeams > 0) dismissReturn();
      })
      .catch((cause: unknown) => setError(getRequestState(cause, online)))
      .finally(() => setBusy(false));
  }, [dismissReturn, online]);

  return (
    <article className="feature-panel">
      <span className="eyebrow">GOOGLE ACCOUNT</span>
      <h3>Google Calendar connection</h3>
      <p>
        Connecting lets First Pit show your Google Calendar here and, if a coach turns it on, keep a team calendar in
        step with Google. First Pit never reads your Gmail or your Google Chat messages.
      </p>

      {returnMessage ? (
        <StatePanel
          variant={returnMessage.variant === 'success' ? 'success' : 'error'}
          title={returnMessage.variant === 'success' ? 'Connected' : 'Not connected'}
          message={returnMessage.text}
          actionLabel="Dismiss"
          onAction={dismissReturn}
        />
      ) : null}

      {status === 'loading' ? (
        <StatePanel variant="loading" title="Checking Google" message="Looking up your Google connection." />
      ) : null}

      {status === 'error' && error ? (
        <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} />
      ) : null}

      {status === 'ready' && connection ? (
        connection.connected ? (
          <div className="stack">
            <p>
              Connected as <strong>{connection.email ?? 'your Google account'}</strong>.
            </p>
            <button className="button secondary" type="button" onClick={disconnect} disabled={busy || !online}>
              {busy ? 'Disconnecting…' : 'Disconnect Google'}
            </button>
            {!online ? <p className="muted">Reconnect to the internet to change this.</p> : null}
          </div>
        ) : (
          <div className="stack">
            <p className="muted">No Google account is connected yet.</p>
            <button className="button" type="button" onClick={connect} disabled={busy || !online}>
              {busy ? 'Opening Google…' : 'Connect Google Calendar'}
            </button>
            {!online ? <p className="muted">Reconnect to the internet to connect an account.</p> : null}
          </div>
        )
      ) : null}

      {status === 'ready' && error ? (
        <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} />
      ) : null}
    </article>
  );
}
