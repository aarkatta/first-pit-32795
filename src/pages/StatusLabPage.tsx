import { StatePanel } from '@/components/StatePanel';

export function StatusLabPage() {
  return (
    <div className="page-stack">
      <section className="hero hero--compact">
        <div className="hero-copy">
          <p className="eyebrow">Required UI states</p>
          <h1>Loading, empty, error, permission, and offline are all represented.</h1>
          <p className="lead">
            The shell exposes the states every later feature module needs so we do not end up
            retrofitting them under pressure.
          </p>
        </div>
      </section>

      <section className="grid grid--two">
        <StatePanel
          variant="loading"
          title="Waiting for team data"
          message="The app is fetching the first page of content from Firebase."
          actionLabel="Retry"
        />
        <StatePanel
          variant="empty"
          title="No teams yet"
          message="This account does not have a team membership, so the page is intentionally blank."
          actionLabel="Create team"
        />
        <StatePanel
          variant="error"
          title="Could not load scores"
          message="A transient network or service issue stopped the request before it completed."
          actionLabel="Try again"
        />
        <StatePanel
          variant="permission"
          title="You do not have access"
          message="The current role does not allow this action. The UI explains the reason in plain language."
          actionLabel="Request access"
        />
        <StatePanel
          variant="offline"
          title="You are offline"
          message="The device lost network access. Cached UI can still render while the action is retried."
          actionLabel="Reload"
        />
      </section>
    </div>
  );
}
