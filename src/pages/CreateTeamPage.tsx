import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { useAuth } from '@/lib/auth-context';
import { createTeam } from '@/lib/team-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

export function CreateTeamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);

  async function submitRequest() {
    if (!user) {
      setRequestState({ variant: 'permission', title: 'Sign-in required', message: 'Sign in with an authorized account before creating a team.' });
      return;
    }
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    try {
      await createTeam(name);
      navigate('/hub', { replace: true });
    } catch (requestError) {
      setRequestState(getRequestState(requestError, online));
    } finally {
      setBusy(false);
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submitRequest();
  }

  return (
    <div className="page-stack">
      <section className="team-hero"><div><span className="eyebrow light">NEW TEAM</span><h3>Create your private workspace.</h3><p>Start with safe team policies, a coach membership, and an auditable foundation.</p></div></section>
      {!online && !requestState ? <StatePanel variant="offline" title="You are offline" message="Reconnect before creating a team." actionLabel="Try again" onAction={() => void submitRequest()} /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Try again" onAction={() => void submitRequest()} autoFocus /> : null}
      <section className="split-panels">
        <article className="feature-panel"><span className="eyebrow">TEAM DETAILS</span><h3>Name your team</h3><p>The server creates the team, coach membership, baseline policies, private settings, and audit event together.</p><form className="form-stack" onSubmit={handleSubmit}><label>Team name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><button className="button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button></form></article>
        <article className="feature-panel"><span className="eyebrow">SAFE BY DEFAULT</span><h3>What gets configured</h3><p>Your new workspace is private and role-scoped from the first request.</p><div><span>Private discoverability</span><span>Coach membership</span><span>Invite-only access</span><span>Team-scoped files</span><span>Server audit event</span></div></article>
      </section>
    </div>
  );
}
