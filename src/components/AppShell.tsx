import { Link, NavLink } from 'react-router-dom';
import type { ReactNode } from 'react';

type AppShellProps = {
  children: ReactNode;
  online: boolean;
};

const navItems = [
  { to: '/', label: 'Overview' },
  { to: '/states', label: 'State lab' },
  { to: '/emulators', label: 'Emulators' }
];

export function AppShell({ children, online }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link className="brand" to="/">
          <span className="brand-mark">FP</span>
          <span>
            <strong>First Pit</strong>
            <small>Phase 0 foundation</small>
          </span>
        </Link>

        <nav className="nav" aria-label="Primary">
          {navItems.map((item) => (
            <NavLink key={item.to} className="nav-link" to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="status-pill" aria-label="Connection status">
          <span className={`status-dot ${online ? 'status-dot--online' : 'status-dot--offline'}`} />
          <span>{online ? 'Online' : 'Offline'}</span>
        </div>
      </header>

      <main className="app-main">{children}</main>

      <footer className="footer">
        <span>BrowserRouter + Vercel rewrite route strategy</span>
        <span>Capacitor-compatible build output in `dist`</span>
      </footer>
    </div>
  );
}
