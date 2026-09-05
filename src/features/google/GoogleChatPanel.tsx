import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { StatePanel } from '@/components/StatePanel';
import { getFirebaseServices } from '@/lib/firebase';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { isGoogleChatUrl, setTeamChatLink } from '@/lib/google-service';

type GoogleChatPanelProps = {
  teamId: string | null;
  canManage: boolean;
  online: boolean;
};

/**
 * Google Chat hand-off.
 *
 * Google Chat cannot be embedded — `chat.google.com` serves
 * `X-Frame-Options: SAMEORIGIN` — and its API needs a Business or Enterprise
 * Workspace account, which the FLL families this app is built for generally do
 * not have. So a team links out to its space rather than mirroring it, and
 * First Pit's own chat stays the surface that works for everyone.
 */
export function GoogleChatPanel({ teamId, canManage, online }: GoogleChatPanelProps) {
  const [chatUrl, setChatUrl] = useState<string | null>(null);
  const [label, setLabel] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [draftLabel, setDraftLabel] = useState('');
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<RequestState | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    if (!teamId) {
      setStatus('ready');
      return;
    }
    setStatus('loading');
    setError(null);
    const { firestore } = getFirebaseServices();
    getDoc(doc(firestore, 'teamPolicies', teamId))
      .then((snapshot) => {
        const data = snapshot.data() ?? {};
        const url = typeof data.googleChatUrl === 'string' ? data.googleChatUrl : null;
        setChatUrl(url);
        setLabel(typeof data.googleChatLabel === 'string' ? data.googleChatLabel : null);
        setDraft(url ?? '');
        setDraftLabel(typeof data.googleChatLabel === 'string' ? data.googleChatLabel : 'Google Chat');
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        setError(getRequestState(cause, online));
        setStatus('error');
      });
  }, [online, teamId]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(
    (event: FormEvent) => {
      event.preventDefault();
      if (!teamId) return;
      if (!isGoogleChatUrl(draft)) {
        setInvalid(true);
        return;
      }
      setInvalid(false);
      setBusy(true);
      setError(null);
      setTeamChatLink({ teamId, chatUrl: draft.trim(), label: draftLabel.trim() || 'Google Chat' })
        .then(() => load())
        .catch((cause: unknown) => setError(getRequestState(cause, online)))
        .finally(() => setBusy(false));
    },
    [draft, draftLabel, load, online, teamId]
  );

  const clear = useCallback(() => {
    if (!teamId) return;
    setBusy(true);
    setError(null);
    setTeamChatLink({ teamId, clear: true })
      .then(() => load())
      .catch((cause: unknown) => setError(getRequestState(cause, online)))
      .finally(() => setBusy(false));
  }, [load, online, teamId]);

  if (!teamId) return null;

  return (
    <article className="feature-panel">
      <span className="eyebrow">GOOGLE CHAT</span>
      <h3>Google Chat space</h3>

      {status === 'loading' ? <StatePanel variant="loading" title="Loading link" message="Checking this team's Google Chat link." /> : null}
      {status === 'error' && error ? (
        <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} />
      ) : null}

      {status === 'ready' ? (
        <>
          {error ? <StatePanel variant={error.variant} title={error.title} message={error.message} actionLabel="Try again" onAction={load} /> : null}

          {chatUrl ? (
            <p>
              <a className="button secondary" href={chatUrl} target="_blank" rel="noopener noreferrer">
                Open {label ?? 'Google Chat'}
              </a>
              <span className="muted"> Opens Google Chat in a new tab.</span>
            </p>
          ) : (
            <StatePanel
              variant="empty"
              title="No Google Chat space linked"
              message={
                canManage
                  ? 'Paste your team’s Google Chat space link below to add a shortcut for the team.'
                  : 'A coach has not linked a Google Chat space for this team.'
              }
            />
          )}

          <p className="muted">
            Google Chat opens in its own tab: it cannot be shown inside First Pit, and its API is limited to Google
            Workspace Business and Enterprise accounts. Team messages posted in First Pit stay here, where coach
            moderation, retention and parent-visibility settings apply.
          </p>

          {canManage ? (
            <form className="form-stack" onSubmit={save}>
              <label>
                Google Chat space link
                <input
                  type="url"
                  value={draft}
                  onChange={(event) => {
                    setDraft(event.target.value);
                    setInvalid(false);
                  }}
                  placeholder="https://chat.google.com/room/…"
                  disabled={busy || !online}
                />
              </label>
              <label>
                Button label
                <input value={draftLabel} onChange={(event) => setDraftLabel(event.target.value)} maxLength={60} disabled={busy || !online} />
              </label>
              {invalid ? (
                <p role="alert" className="muted">
                  Enter an https://chat.google.com or https://mail.google.com link.
                </p>
              ) : null}
              <div className="stack">
                <button className="button" type="submit" disabled={busy || !online || !draft.trim()}>
                  {busy ? 'Saving…' : 'Save link'}
                </button>
                {chatUrl ? (
                  <button className="button secondary" type="button" onClick={clear} disabled={busy || !online}>
                    Remove link
                  </button>
                ) : null}
              </div>
              {!online ? <p className="muted">Reconnect to the internet to change this.</p> : null}
            </form>
          ) : null}
        </>
      ) : null}
    </article>
  );
}
