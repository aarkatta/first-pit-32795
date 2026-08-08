const emulatorPorts = [
  ['Auth', '9099'],
  ['Firestore', '8080'],
  ['Functions', '5001'],
  ['Storage', '9199'],
  ['Emulator UI', '4000']
];

export function EmulatorPage() {
  return (
    <div className="page-stack">
      <section className="hero hero--compact">
        <div className="hero-copy">
          <p className="eyebrow">Firebase emulators</p>
          <h1>Local services are wired before feature work starts.</h1>
          <p className="lead">
            Phase 0 keeps emulator support in the repo so future authentication, rules, and
            privileged workflow work can be verified locally.
          </p>
        </div>
      </section>

      <section className="content-grid">
        <article className="card">
          <p className="eyebrow">Ports</p>
          <ul className="list">
            {emulatorPorts.map(([service, port]) => (
              <li key={service}>
                <strong>{service}</strong> on {port}
              </li>
            ))}
          </ul>
        </article>

        <article className="card">
          <p className="eyebrow">Environment</p>
          <ul className="list">
            <li>Copy `.env.example` to `.env.local`.</li>
            <li>Set the Firebase config values for your project or local emulator target.</li>
            <li>Keep secrets out of source control.</li>
          </ul>
        </article>
      </section>

      <section className="card">
        <p className="eyebrow">Commands</p>
        <pre className="code-block">
          <code>{['npm install', 'npm run dev', 'npm run emulators'].join('\n')}</code>
        </pre>
      </section>
    </div>
  );
}
