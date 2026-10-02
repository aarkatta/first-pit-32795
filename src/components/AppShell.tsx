import { Link, NavLink, useLocation } from 'react-router-dom';
import { doc, onSnapshot } from 'firebase/firestore';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StatePanel } from './StatePanel';
import { NotificationBell } from './NotificationBell';
import { useAuth } from '@/lib/auth-context';
import { getRequestState, type RequestState } from '@/lib/request-state';
import { useTeamContext } from '@/lib/team-context';
import { isCoachOrLeader, nameInitials } from '@/lib/domain';
import { getFirebaseServices } from '@/lib/firebase';

type AppShellProps = {
  children: ReactNode;
  online: boolean;
  appName: string;
  appTagline: string;
};

// Sidebar order. View profile and Sign out follow these in the sidebar; the
// four `mobile` entries fill the phone's bottom bar and the rest go in its Menu
// menu. Team files (`/files`) has no entry: it is reached from task cards.
const navItems = [
  { to: '/', label: 'Home', mobile: true },
  { to: '/coordination', label: 'Tracker', mobile: true },
  { to: '/scorer', label: 'Scorer' },
  { to: '/knowledge', label: 'Knowledge base', mobile: true },
  { to: '/team', label: 'Manage team', mobile: true }
];

/**
 * Administration sits next to Manage team, and only for a coach or team leader.
 * Hiding it is presentation only — `AdministrationPage` refuses anyone else on
 * its own and every callable behind it re-checks the role.
 */
const adminNavItem = { to: '/admin', label: 'Administration', mobile: false };

/**
 * Routes that carry a page title but no navigation entry. Without them every
 * unmatched path fell back to "Home", so the Profile screen announced itself —
 * in its `<h1>` and in `document.title` — as Home.
 */
const routeLabels: { to: string; label: string }[] = [
  // Tabs of the tracker rather than destinations of their own, so they carry a
  // page title without a navigation entry.
  { to: '/milestones', label: 'Milestones' },
  { to: '/import', label: 'Import tasks' },
  { to: '/board-setup', label: 'Board setup' },
  // Reached from the top-bar bell rather than the navigation.
  { to: '/notifications', label: 'Notifications' },
  { to: '/files', label: 'Team files' },
  { to: '/admin', label: 'Administration' },
  { to: '/profile', label: 'Profile & settings' },
  { to: '/settings', label: 'Profile & settings' },
  { to: '/teams/new', label: 'Create a team' },
  { to: '/join', label: 'Join a team' },
  { to: '/auth', label: 'Sign in' },
  { to: '/tracker', label: 'Tracker' },
];

/**
 * The tracker's board is a wide table, so its screens use the full width beside
 * the sidebar instead of the centred reading column the other pages use. All
 * four tabs share it so the tab bar does not jump when switching between them.
 */
const wideRoutes = ['/coordination', '/milestones', '/import', '/board-setup', '/tracker'];

function isWideRoute(pathname: string) {
  return wideRoutes.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}

function pageLabel(pathname: string) {
  if (pathname === '/' || pathname === '/home') return 'Home';
  const match = [...navItems, ...routeLabels].find((item) => item.to !== '/' && (pathname === item.to || pathname.startsWith(`${item.to}/`)));
  return match?.label ?? 'Not found';
}

export function AppShell({ children, online, appName, appTagline }: AppShellProps) {
  const { status: authStatus, user, signOut } = useAuth();
  const { teams, activeTeamId, setActiveTeamId } = useTeamContext();
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutState, setSignOutState] = useState<RequestState | null>(null);
  const [profile, setProfile] = useState<{ displayName: string; photoURL: string | null } | null>(null);
  const mobileMenuRef = useRef<HTMLDetailsElement>(null);
  const profileMenuRef = useRef<HTMLDetailsElement>(null);
  const activeTeam = teams.find((team) => team.teamId === activeTeamId);
  const activeTeamName = activeTeam?.team?.name ?? 'Unnamed team';
  const isAdmin = isCoachOrLeader(activeTeam);
  const visibleNavItems = isAdmin
    ? navItems.flatMap((item) => (item.to === '/team' ? [item, adminNavItem] : [item]))
    : navItems;
  const mobileItems = visibleNavItems.filter((item) => item.mobile);
  const secondaryItems = visibleNavItems.filter((item) => !item.mobile);
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

  // Close the account menu on an outside click or Escape, like a real popover.
  useEffect(() => {
    function onPointer(event: MouseEvent) {
      const menu = profileMenuRef.current;
      if (menu?.open && !menu.contains(event.target as Node)) menu.removeAttribute('open');
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') profileMenuRef.current?.removeAttribute('open');
    }
    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => { document.removeEventListener('mousedown', onPointer); document.removeEventListener('keydown', onKey); };
  }, []);

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
          <span className="brand-mark" aria-hidden="true">{nameInitials(appName)}</span>
          <span className="brand-text">
            <strong>{appName}</strong>
            <small>by <span className="brand-accent">Tech Titans NC</span></small>
          </span>
        </Link>

        <nav className="sidebar-nav" aria-label="Primary">
          {visibleNavItems.map((item) => (
            <NavLink key={item.to} className="sidebar-nav__link" to={item.to} end={item.to === '/'}>
              {item.label}
            </NavLink>
          ))}
        </nav>

        {authStatus === 'authenticated' ? (
          <div className="sidebar-footer">
            <details className="profile-menu" ref={profileMenuRef}>
              <summary className="profile-button" aria-label="Account menu">
                <span className="profile-avatar" aria-hidden="true">{profile?.photoURL ? <img src={profile.photoURL} alt="" /> : (profile?.displayName || user?.displayName || user?.email || 'FP').slice(0, 2).toUpperCase()}</span>
                <span><strong>{profile?.displayName || user?.displayName || user?.email || 'Signed in'}</strong><small>{user?.email ?? 'Signed in'}</small></span>
              </summary>
              <div className="profile-menu__panel">
                <Link className="profile-menu__item" to="/profile" onClick={() => profileMenuRef.current?.removeAttribute('open')}>View profile</Link>
                <button className="profile-menu__item profile-menu__button" type="button" disabled={signingOut} onClick={() => void handleSignOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
              </div>
            </details>
          </div>
        ) : (
          <div className="sidebar-footer"><Link className="button" to="/auth">Sign in</Link></div>
        )}
      </aside>

      <section className="main-panel">
        <header className="topbar">
          <div className="mobile-brand">
            <span className="brand-mark" aria-hidden="true">{nameInitials(appName)}</span>
            <span className="brand-text">
              <strong>{appName}</strong>
              <small>by <span className="brand-accent">Tech Titans NC</span></small>
            </span>
          </div>
          <div className="topbar-title">
            <span className="eyebrow">{authStatus === 'authenticated' ? 'TEAM WORKSPACE' : appTagline.toUpperCase()}</span>
            <h1>{currentPageLabel}</h1>
          </div>
          <div className="top-actions">
            {authStatus === 'authenticated' && activeTeam ? (
              <div className="topbar-team" title={isAdmin ? 'Coach workspace' : 'Team workspace'}>
                <span className="team-badge" aria-hidden="true">{activeTeamName.slice(0, 2).toUpperCase()}</span>
                {teams.length > 1 ? (
                  <select aria-label="Switch active team" value={activeTeamId ?? ''} onChange={(event) => setActiveTeamId(event.target.value)}>
                    {teams.map(({ teamId, team }) => <option key={teamId} value={teamId}>{team?.name ?? 'Unnamed team'}</option>)}
                  </select>
                ) : <strong className="topbar-team__name">{activeTeamName}</strong>}
              </div>
            ) : null}
            <span className={`connection-status connection-status--${online ? 'online' : 'offline'}`}><i aria-hidden="true" />{online ? 'Online' : 'Offline'}</span>
            {authStatus === 'authenticated' && user && activeTeamId ? <NotificationBell teamId={activeTeamId} userId={user.uid} online={online} /> : null}
            {authStatus === 'authenticated' ? <details className="mobile-secondary-nav" ref={mobileMenuRef}>
              <summary className="top-action" aria-label="Open workspace menu">Menu</summary>
              <div className="mobile-secondary-nav__panel">
                <nav className="mobile-secondary-nav__links" aria-label="Mobile secondary navigation">
                  {secondaryItems.map((item) => <NavLink key={item.to} to={item.to} onClick={() => mobileMenuRef.current?.removeAttribute('open')}>{item.label}</NavLink>)}
                  <NavLink to="/profile" onClick={() => mobileMenuRef.current?.removeAttribute('open')}>View profile</NavLink>
                </nav>
                <button className="text-button" type="button" aria-label="Sign out from mobile menu" disabled={signingOut} onClick={() => void handleSignOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>
              </div>
            </details> : null}
            {authStatus !== 'authenticated' ? <Link className="button button--small" to="/auth">Sign in</Link> : null}
          </div>
        </header>

        <main className={`app-main${isWideRoute(location.pathname) ? ' app-main--wide' : ''}`} id="main-content" tabIndex={-1}>
          {signOutState ? <StatePanel {...signOutState} actionLabel="Try again" onAction={() => void handleSignOut()} autoFocus /> : null}
          {children}
        </main>

        <nav className="bottom-nav" aria-label="Mobile navigation">
          {mobileItems.map((item) => <NavLink key={item.to} className="bottom-nav__link" to={item.to} end={item.to === '/'}><small>{item.label}</small></NavLink>)}
        </nav>

        <footer className="footer"><span>Private team workspace</span><span>Web + Capacitor shell</span></footer>
      </section>
    </div>
  );
}
