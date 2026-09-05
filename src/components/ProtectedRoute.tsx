import { Navigate, useLocation } from 'react-router-dom';
import type { ReactNode } from 'react';
import { StatePanel } from './StatePanel';
import { EmailVerificationGate } from './EmailVerificationGate';
import { useAuth } from '@/lib/auth-context';
import { requiresEmailVerification } from '@/lib/auth';
import { useOnlineStatus } from '@/lib/use-online-status';

export function ProtectedRoute({ children }: { children: ReactNode }) {
  const { status, error, user, auth } = useAuth();
  const location = useLocation();
  const online = useOnlineStatus();

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

  // Authenticated but unproven: a password account that never opened its
  // verification link gets the gate instead of the app.
  if (requiresEmailVerification(user)) {
    return <EmailVerificationGate user={user!} auth={auth} online={online} />;
  }

  return children;
}
