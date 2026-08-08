import { DecisionCard } from '@/components/DecisionCard';
import { confirmedDecisions, exitCriteria, localCommands, openBlockers, routeStrategy } from '@/content/phaseZero';

export function HomePage() {
  return (
    <div className="page-stack">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Phase 0 scaffold</p>
          <h1>First Pit is ready for the first real implementation pass.</h1>
          <p className="lead">
            The repository now has a React shell, Firebase emulator wiring, Vercel compatibility, and
            a documented set of blocked product decisions that later phases must not guess.
          </p>
        </div>

        <div className="hero-panel">
          <p className="eyebrow">Local setup</p>
          <ol className="command-list">
            {localCommands.map((command) => (
              <li key={command}>
                <code>{command}</code>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="grid grid--three">
        {confirmedDecisions.map((decision) => (
          <DecisionCard key={decision.title} title={decision.title} body={decision.body} />
        ))}
      </section>

      <section className="content-grid">
        <article className="card">
          <p className="eyebrow">Route strategy</p>
          <h2>One route model for web and Capacitor</h2>
          <ul className="list">
            {routeStrategy.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>

        <article className="card">
          <p className="eyebrow">Open blockers</p>
          <h2>Do not invent the youth-safety policy</h2>
          <div className="stack">
            {openBlockers.map((blocker) => (
              <div key={blocker.title} className="inline-blocker">
                <h3>{blocker.title}</h3>
                <p>{blocker.details.join(', ')}</p>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section className="card">
        <p className="eyebrow">Exit criteria</p>
        <h2>What Phase 0 must prove</h2>
        <ul className="list">
          {exitCriteria.map((criterion) => (
            <li key={criterion}>{criterion}</li>
          ))}
        </ul>
      </section>
    </div>
  );
}
