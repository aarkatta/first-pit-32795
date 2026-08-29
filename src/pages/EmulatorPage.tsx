import { useEffect, useState } from 'react';
import type { ClientEnv } from '@/lib/env';

type EmulatorPageProps = {
  clientEnv: ClientEnv;
};

export function EmulatorPage({ clientEnv }: EmulatorPageProps) {
  // `firebase.json` is repository tooling, not product data. Importing it at the
  // top level bundles the emulator configuration into a client chunk, so the one
  // value that is not part of the validated client env is fetched on demand.
  const [emulatorUiPort, setEmulatorUiPort] = useState<number | null>(null);

  useEffect(() => {
    let current = true;
    void import('../../firebase.json').then((module) => {
      if (current) setEmulatorUiPort(module.default.emulators.ui.port);
    }).catch(() => undefined);
    return () => { current = false; };
  }, []);

  const emulatorPorts: [string, number | string][] = [
    ['Auth', clientEnv.emulatorHosts.auth.port],
    ['Firestore', clientEnv.emulatorHosts.firestore.port],
    ['Functions', clientEnv.emulatorHosts.functions.port],
    ['Storage', clientEnv.emulatorHosts.storage.port],
    ['Emulator UI', emulatorUiPort ?? 'reading firebase.json…']
  ];

  return (
    <div className="page-stack">
      <section className="team-hero">
        <div><span className="eyebrow light">FIREBASE EMULATORS</span><h3>Local services are wired before feature work starts.</h3><p>Verify authentication, team boundaries, Storage, server-side creation, and audit logging locally.</p></div>
      </section>

      <section className="split-panels">
        <article className="feature-panel">
          <span className="eyebrow">PORTS</span><h3>Local endpoints</h3>
          <ul className="list">
            {emulatorPorts.map(([service, port]) => (
              <li key={service}>
                <strong>{service}</strong> on {port}
              </li>
            ))}
          </ul>
        </article>

        <article className="feature-panel">
          <span className="eyebrow">ENVIRONMENT</span><h3>Configuration</h3>
          <ul className="list">
            <li>Copy <code>.env.example</code> to <code>.env.local</code>.</li>
            <li>Set the Firebase config values for your project or local emulator target.</li>
            <li>Keep secrets out of source control.</li>
          </ul>
        </article>
      </section>

      <section className="feature-panel">
        <span className="eyebrow">COMMANDS</span><h3>Run locally</h3>
        <pre className="code-block">
          <code>{['npm install', 'npm run dev', 'npm run emulators'].join('\n')}</code>
        </pre>
      </section>
    </div>
  );
}
