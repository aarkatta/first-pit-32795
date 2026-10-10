import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { StatePanel } from '@/components/StatePanel';
import { setAccountType, useAccountType } from '@/lib/account-type';
import { useAuth } from '@/lib/auth-context';
import { ACCOUNT_TYPE_OPTIONS, mayOfferTeamCreation, type AccountType } from '@/lib/domain';
import { useTeamContext } from '@/lib/team-context';
import { createTeam } from '@/lib/team-service';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useOnlineStatus } from '@/lib/use-online-status';

export function CreateTeamPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const online = useOnlineStatus();
  const [name, setName] = useState('');
  const [teamNumber, setTeamNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [requestState, setRequestState] = useState<RequestState | null>(null);
  const account = useAccountType(user?.uid);
  const { teams } = useTeamContext();
  const [chosenType, setChosenType] = useState<AccountType | ''>('');

  async function saveAccountType(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!chosenType) return;
    if (!online) {
      setRequestState(getRequestState(new Error('Network unavailable.'), false));
      return;
    }
    setBusy(true);
    setRequestState(null);
    try {
      // The profile listener picks the saved type up and re-renders this page.
      await setAccountType(chosenType);
    } catch (requestError) {
      setRequestState(getRequestState(requestError, online));
    } finally {
      setBusy(false);
    }
  }

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
      await createTeam(name, teamNumber);
      navigate('/team', { replace: true });
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

  if (account.status === 'loading') return <StatePanel variant="loading" title="Checking your account" message="Only coach and mentor accounts can create a team." />;

  if (account.status === 'ready' && !mayOfferTeamCreation(account.accountType, teams)) {
    return (
      <div className="page-stack">
        <StatePanel variant="permission" title="Coaches and mentors create teams" message="Students and parents join a team by invitation instead of creating one. Ask your coach to send you an invite link. If your account type is wrong, ask an administrator to change it." />
        <div className="form-actions"><Link className="button" to="/join">Accept an invitation</Link></div>
      </div>
    );
  }

  if (account.status === 'ready' && !account.accountType) {
    return (
      <div className="page-stack">
        <section className="team-hero"><div><span className="eyebrow light">NEW TEAM</span><h3>First, who are you on the team?</h3><p>Only coaches and mentors create teams; students and parents join by invitation.</p></div></section>
        {requestState ? <StatePanel {...requestState} actionLabel="Dismiss" onAction={() => setRequestState(null)} autoFocus /> : null}
        <section className="split-panels">
          <article className="feature-panel">
            <span className="eyebrow">YOUR ACCOUNT</span>
            <h3>Choose your account type</h3>
            <p>You choose this once. Only an administrator can change it later.</p>
            <form className="form-stack" onSubmit={saveAccountType}>
              <label>I am a
                <select value={chosenType} onChange={(event) => setChosenType(event.target.value as AccountType | '')} required>
                  <option value="">Choose…</option>
                  {ACCOUNT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                </select>
              </label>
              <button className="button" type="submit" disabled={busy || !chosenType}>{busy ? 'Saving…' : 'Continue'}</button>
            </form>
          </article>
        </section>
      </div>
    );
  }

  // A profile that could not be read falls through to the form: the server
  // makes the same decision and explains a refusal itself.
  return (
    <div className="page-stack">
      <section className="team-hero"><div><span className="eyebrow light">NEW TEAM</span><h3>Create your private workspace.</h3><p>Start with safe team policies, a coach membership, and an auditable foundation.</p></div></section>
      {!online && !requestState ? <StatePanel variant="offline" title="You are offline" message="Reconnect before creating a team." actionLabel="Try again" onAction={() => void submitRequest()} /> : null}
      {requestState ? <StatePanel {...requestState} actionLabel="Try again" onAction={() => void submitRequest()} autoFocus /> : null}
      <section className="split-panels">
        <article className="feature-panel"><span className="eyebrow">TEAM DETAILS</span><h3>Name your team</h3><p>The server creates the team, coach membership, baseline policies, private settings, and audit event together.</p><form className="form-stack" onSubmit={handleSubmit}><label>Team name<input value={name} onChange={(event) => setName(event.target.value)} maxLength={80} required /></label><label>Team number<input value={teamNumber} onChange={(event) => setTeamNumber(event.target.value)} inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} placeholder="e.g. 12345" title="Your FIRST LEGO League team number: up to 8 digits." required /></label><button className="button" type="submit" disabled={busy}>{busy ? 'Creating…' : 'Create team'}</button></form></article>
        <article className="feature-panel"><span className="eyebrow">SAFE BY DEFAULT</span><h3>What gets configured</h3><p>Your new workspace is private and role-scoped from the first request.</p><div><span>Private discoverability</span><span>Coach membership</span><span>Invite-only access</span><span>Team-scoped files</span><span>Server audit event</span></div></article>
      </section>
    </div>
  );
}
