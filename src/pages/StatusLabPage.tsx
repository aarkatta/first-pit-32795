import { useState } from 'react';
import { StatePanel } from '@/components/StatePanel';

export function StatusLabPage() {
  const [lastAction, setLastAction] = useState('No state action selected yet.');

  function handleAction(actionLabel: string, stateLabel: string) {
    setLastAction(`${actionLabel} selected for the ${stateLabel} state example.`);
  }

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div><span className="eyebrow light">REQUIRED UI STATES</span><h3>Loading, empty, error, permission, and offline are all represented.</h3><p>Every outcome uses the same accessible visual language and gives the user a clear next step.</p></div>
      </section>

      <section className="split-panels">
        <StatePanel
          variant="loading"
          title="Waiting for team data"
          message="The app is fetching the first page of content from Firebase."
          actionLabel="Retry"
          onAction={() => handleAction('Retry', 'loading')}
        />
        <StatePanel
          variant="empty"
          title="No teams yet"
          message="This account does not have a team membership, so the page is intentionally blank."
          actionLabel="Create team"
          onAction={() => handleAction('Create team', 'empty')}
        />
        <StatePanel
          variant="error"
          title="Could not load scores"
          message="A transient network or service issue stopped the request before it completed."
          actionLabel="Try again"
          onAction={() => handleAction('Try again', 'error')}
        />
        <StatePanel
          variant="permission"
          title="You do not have access"
          message="The current role does not allow this action. The UI explains the reason in plain language."
          actionLabel="Request access"
          onAction={() => handleAction('Request access', 'permission')}
        />
        <StatePanel
          variant="offline"
          title="You are offline"
          message="The device lost network access. Cached UI can still render while the action is retried."
          actionLabel="Reload"
          onAction={() => handleAction('Reload', 'offline')}
        />
      </section>

      <p className="lead" role="status" aria-live="polite">
        {lastAction}
      </p>
    </div>
  );
}
