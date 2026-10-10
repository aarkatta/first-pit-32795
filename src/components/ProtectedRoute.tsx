import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { StatePanel } from './StatePanel';
import { PasswordSetupGate } from './PasswordSetupGate';
import { useAuth } from '@/lib/auth-context';
import { hasPasswordProvider } from '@/lib/auth';
import { useProvisionedAccount } from '@/lib/account-type';
import { useOnlineStatus } from '@/lib/use-online-status';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, error, user, auth } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();
  const provisioning = useProvisionedAccount(user?.uid);

  if (status === 'loading') {
    return <StatePanel variant="loading" title="Checking your session" message="Your secure First Pit session is being restored." />;
  }

  if (status === 'error') {
    return (
      <StatePanel
        variant="error"
        title="We could not verify your session"
        message={error?.message ?? 'Try reloading the page and signing in again.'}
        actionLabel="Reload"
        onAction={() => window.location.reload()}
      />
    );
  }

  if (status !== 'authenticated') {
    const next = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate to={`/auth?next=${encodeURIComponent(next)}`} replace />;
  }

  // Waits for the profile once per tab; `useProvisionedAccount` caches what it
  // resolved, so navigating between pages does not flash this panel. A profile
  // that cannot be read deliberately does NOT block the app: `setInitialPassword`
  // re-checks the flag server-side, so failing open costs a prompt, and failing
  // closed would lock a member out over a transient read error.
  if (provisioning.status === 'loading') {
    return <StatePanel variant="loading" title="Checking your account" message="First Pit is loading your profile." />;
  }

  // A coach-provisioned member still using the password their coach passed on.
  // The only gate left in front of the app: an unverified email address does
  // NOT hold anyone out, because nothing a signed-in member can reach depends
  // on a proven mailbox. The one thing that does — accepting an email
  // invitation — asks for verification on `JoinTeamPage`, at the moment it
  // matters, instead of blocking the whole app up front.
  if (provisioning.mustSetPassword && hasPasswordProvider(user)) {
    return <PasswordSetupGate user={user!} auth={auth} online={online} />;
  }

  return children;
}
