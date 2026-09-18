import { StatePanel } from '@/components/StatePanel';
import { useOnlineStatus } from '@/lib/use-online-status';

/**
 * FIRST publishes the official robot game scoresheet. It sends
 * `X-Frame-Options: SAMEORIGIN`, so browsers and the iOS web view refuse to
 * render it in an iframe; the page links out to it instead.
 */
export const OFFICIAL_SCORESHEET_URL = 'https://eventhub.firstinspires.org/scoresheet';

export function ScorerPage() {
  const online = useOnlineStatus();
  return <div className="page-stack">
    {!online ? <StatePanel variant="offline" title="You are offline" message="The official scoresheet is hosted by FIRST. Reconnect to open it." /> : null}
    <section className="card">
      <div className="card-heading"><div><p className="eyebrow">Robot game</p><h2>Official FIRST scoresheet</h2></div></div>
      <p>Score robot game runs with the official FIRST LEGO League scoresheet for this season. It is published by FIRST and always matches the current missions and rules.</p>
      <p><a className="button" href={OFFICIAL_SCORESHEET_URL} target="_blank" rel="noopener noreferrer">Open the official scoresheet ↗</a></p>
    </section>
    <section className="card" aria-labelledby="manage-scoring-title">
      <div className="card-heading"><div><p className="eyebrow">Coming soon</p><h2 id="manage-scoring-title">Manage scoring</h2></div></div>
      <p className="muted">Record your team's practice runs, track scores across the season, and see which missions are improving — all inside First Pit. This feature is coming soon.</p>
    </section>
  </div>;
}
