import { Link, NavLink, useLocation } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatePanel } from './StatePanel';
import { useAuth } from '@/lib/auth-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { isCoachOrLeader } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';

type AppShellProps = {
  children: ReactNode;
  online: boolean;
  appName: string;
  appTagline: string;
};

const navItems = [
  { to: '/', label: 'Home', icon: '⌂', mobile: true },
  { to: '/hub', label: 'Team hub', icon: '▤', mobile: true },
  { to: '/coordination', label: 'Tracker', icon: '▦', mobile: true },
  { to: '/chat', label: 'Chat', icon: '◌', mobile: true },
  { to: '/knowledge', label: 'Knowledge', icon: '?', mobile: true },
  { to: '/scorer', label: 'Scorer', icon: '◫' },
  { to: '/search', label: 'Search', icon: '⌕' },
  { to: '/admin', label: 'Team admin', icon: '◇' },
  { to: '/states', label: 'State lab', icon: '□' },
  { to: '/emulators', label: 'Emulators', icon: '⚙' }
];

function getBrandMark(appName: string) {
  return appName.trim().split(/\s+/).map((word) => word[0]).join('').slice(0, 2).toUpperCase();
}

function pageLabel(pathname: string) {
  return navItems.find((item) => item.to !== '/' && pathname.startsWith(item.to))?.label ?? 'Home';
}

export function AppShell({ children, online, appName, appTagline }: AppShellProps) {
  const { status: authStatus, user, signOut } = useAuth();
  const { teams, activeTeamId, setActiveTeamId } = useTeamContext();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutState, setSignOutState] = useState<RequestState | null>(null);
  const [profile, setProfile] = useState<{ displayName: string; photoURL: string | null } | null>(null);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const isAdmin = isCoachOrLeader(teams.find((team) => team.teamId === activeTeamId));
  const visibleItems = navItems.filter((item) => {
    if (authStatus === 'authenticated' && (item.to === '/states' || item.to === '/emulators')) return false;
    if (item.to === '/admin' && !isAdmin) return false;
    return true;
  });
  const mobileItems = visibleItems.filter((item) => item.mobile);
  const secondaryItems = visibleItems.filter((item) => !item.mobile);
  const currentPageLabel = pageLabel(location.pathname);

  useEffect(() => {
    document.title = `${currentPageLabel} | ${appName}`;
  }, [appName, currentPageLabel]);

  useEffect(() => {
    if (authStatus !== 'authenticated' || !user) {
      setProfile(null);
      return undefined;
    }
    return onSnapshot(doc(getFirebaseServices().firestore, 'users', user.uid), (snapshot) => {
      const data = snapshot.data();
      setProfile(data ? {
        displayName: typeof data.displayName === 'string' && data.displayName.trim() ? data.displayName.trim() : user.displayName || user.email || 'Signed in',
        photoURL: typeof data.photoURL === 'string' && data.photoURL.trim() ? data.photoURL : null
      } : null);
    }, () => setProfile(null));
  }, [authStatus, user]);

  async function handleSignOut() {
    setSigningOut(true);
    setSignOutState(null);
    try {
      await signOut();
    } catch (error) {
      setSignOutState(getRequestState(error, online));
    } finally {
      setSigningOut(false);
    }
  }

  if (authStatus !== 'authenticated' && (location.pathname === '/' || location.pathname === '/auth')) {
    return <><span className="visually-hidden">{appName}</span>{children}</>;
  }

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to main content</a>
      <aside className="sidebar" aria-label="First Pit workspace navigation">
        <Link className="brand brand-dark" to="/">
          <span className="brand-mark" aria-hidden="true">{getBrandMark(appName)}</span>
          <span>{appName}</span>
        </Link>

        {authStatus === 'authenticated' && teams.length > 0 ? (
          <label className="team-switcher team-switcher--sidebar">
            <span className="team-badge" aria-hidden="true">{(teams.find((team) => team.teamId === activeTeamId)?.team?.name ?? 'FP').slice(0, 2).toUpperCase()}</span>
            <span className="team-switcher__copy">
              <strong>{teams.find((team) => team.teamId === activeTeamId)?.team?.name ?? 'Active team'}</strong>
              <small>{isAdmin ? 'Coach workspace' : 'Team workspace'}</small>
            </span>
            <select aria-label="Switch active team" value={activeTeamId ?? ''} onChange={(event) => setActiveTeamId(event.target.value)}>
              {teams.map(({ teamId, team }) => <option key={teamId} value={teamId}>{team?.name ?? 'Unnamed team'}</option>)}
            </select>
          </label>
        ) : null}

        <nav className="sidebar-nav" aria-label="Primary">
          {visibleItems.map((item) => (
            <NavLink key={item.to} className="sidebar-nav__link" to={item.to} end={item.to === '/'}>
              <span aria-hidden="true">{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>

        {authStatus === 'authenticated' ? (
          <div className="sidebar-footer">
            <Link className="profile-button" to="/profile">
              <span className="profile-avatar" aria-hidden="true">{profile?.photoURL ? <img src={profile.photoURL} alt="" /> : (profile?.displayName || user?.displayName || user?.email || 'FP').slice(0, 2).toUpperCase()}</span>
              <span><strong>{profile?.displayName || user?.displayName || user?.email || 'Signed in'}</strong><small>Profile & settings</small></span>
            </Link>
            <button className="text-button" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          </div>
        ) : (
          <div className="sidebar-footer"><Link className="button" to="/auth">Sign in</Link></div>
        )}
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">{getBrandMark(appName)}</span>
            <strong>FIRST PIT</strong>
          </div>
          <div className="topbar-title">
            <span className="eyebrow">{authStatus === 'authenticated' ? 'TEAM WORKSPACE' : appTagline.toUpperCase()}</span>
            <h1>{currentPageLabel}</h1>
          </div>
          <div className="top-actions">
            <span className={`connection-status connection-status--${online ? 'online' : 'offline'}`}><i aria-hidden="true" />{online ? 'Online' : 'Offline'}</span>
            {authStatus === 'authenticated' ? <Link className="top-action" to="/search" aria-label="Search team workspace">⌕</Link> : null}
            {authStatus === 'authenticated' ? <details className="mobile-secondary-nav" ref={mobileMenuRef}>
              <summary className="top-action" aria-label="Open workspace menu"><span aria-hidden="true">☰</span></summary>
              <div className="mobile-secondary-nav__panel">
                {teams.length > 0 ? <label className="mobile-team-switcher">Active team<select aria-label="Switch active team from mobile menu" value={activeTeamId ?? ''} onChange={(event) => setActiveTeamId(event.target.value)}>{teams.map(({ teamId, team }) => <option key={teamId} value={teamId}>{team?.name ?? 'Unnamed team'}</option>)}</select></label> : null}
                <nav className="mobile-secondary-nav__links" aria-label="Mobile secondary navigation">
                  {secondaryItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => mobileMenuRef.current?.removeAttribute('open')}><span aria-hidden="true">{item.icon}</span>{item.label}</NavLink>)}
                  <NavLink to="/profile" onClick={() => mobileMenuRef.current?.removeAttribute('open')}><span aria-hidden="true">◉</span>Profile &amp; settings</NavLink>
                </nav>
                <button className="text-button" type="button" aria-label="Sign out from mobile menu" disabled={signingOut} onClick={() => void handleSignOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
              </div>
            </details> : null}
            {authStatus !== 'authenticated' ? <Link className="button button--small" to="/auth">Sign in</Link> : null}
          </div>
        </header>

        <main className="app-main" id="main-content" tabIndex={-1}>
          {signOutState ? <StatePanel {...signOutState} actionLabel="Try again" onAction={() => void handleSignOut()} autoFocus /> : null}
          {children}
        </main>

        <nav className="bottom-nav" aria-label="Mobile navigation">
          {mobileItems.map((item) => <NavLink key={item.to} className="bottom-nav__link" to={item.to} end={item.to === '/'}><span aria-hidden="true">{item.icon}</span><small>{item.label}</small></NavLink>)}
        </nav>

        <footer className="footer"><span>Private team workspace</span><span>Web + Capacitor shell</span></footer>
      </section>
    </div>
  );
}
