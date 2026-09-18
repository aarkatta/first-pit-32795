import { lazy, Suspense } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { parseClientEnv, type ClientEnv } from '@/lib/env';
import { useOnlineStatus } from '@/lib/use-online-status';
import { AuthProvider } from '@/lib/auth-context';
import { TeamProvider } from '@/lib/team-context';
import { PreferencesProvider } from '@/lib/preferences-context';
import { ProtectedRoute } from '@/components/ProtectedRoute';
import { AppErrorBoundary } from '@/components/AppErrorBoundary';

const AuthActionPage = lazy(() => import('@/pages/AuthActionPage').then((module) => ({ default: module.AuthActionPage })));
const AuthPage = lazy(() => import('@/pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const CoordinationPage = lazy(() => import('@/pages/CoordinationPage').then((module) => ({ default: module.CoordinationPage })));
const CreateTeamPage = lazy(() => import('@/pages/CreateTeamPage').then((module) => ({ default: module.CreateTeamPage })));
const JoinTeamPage = lazy(() => import('@/pages/JoinTeamPage').then((module) => ({ default: module.JoinTeamPage })));
const HomePage = lazy(() => import('@/pages/HomePage').then((module) => ({ default: module.HomePage })));
const BoardSetupPage = lazy(() => import('@/pages/BoardSetupPage').then((module) => ({ default: module.BoardSetupPage })));
const ImportTasksPage = lazy(() => import('@/pages/ImportTasksPage').then((module) => ({ default: module.ImportTasksPage })));
const MilestonesPage = lazy(() => import('@/pages/MilestonesPage').then((module) => ({ default: module.MilestonesPage })));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage').then((module) => ({ default: module.NotificationsPage })));
const TeamFilesPage = lazy(() => import('@/pages/TeamFilesPage').then((module) => ({ default: module.TeamFilesPage })));
const KnowledgePage = lazy(() => import('@/pages/KnowledgePage').then((module) => ({ default: module.KnowledgePage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ScorerPage = lazy(() => import('@/pages/ScorerPage').then((module) => ({ default: module.ScorerPage })));
const ManageTeamPage = lazy(() => import('@/pages/ManageTeamPage').then((module) => ({ default: module.ManageTeamPage })));

type AppRoutesProps = {
  clientEnv?: ClientEnv;
};

function CoordinationAlias() {
  const location = useLocation();
  return <Navigate to={`/coordination${location.search}${location.hash}`} replace />;
}

function RouteLoadingFallback() {
  return (
    <section className="state-panel feature-panel state-panel--loading" role="status" aria-live="polite" aria-atomic="true" aria-busy="true">
      <div className="state-panel__header">
        <span className="eyebrow">LOADING</span>
        <h3>Loading page</h3>
      </div>
      <p>First Pit is preparing this page.</p>
    </section>
  );
}

export function AppRoutes({ clientEnv }: AppRoutesProps = {}) {
  const runtimeEnv = clientEnv ?? parseClientEnv(import.meta.env as Record<string, string | undefined>);
  const online = useOnlineStatus();

  return (
    <AppErrorBoundary>
      <AppShell appName={runtimeEnv.appName} appTagline={runtimeEnv.appTagline} online={online}>
        <Suspense fallback={<RouteLoadingFallback />}>
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/auth" element={<AuthPage />} />
            {/* Handler for the `?mode=…&oobCode=…` links Firebase Auth emails out.
                Unprotected on purpose: the link opens in whatever browser the
                recipient reads mail in, usually with no session. */}
            <Route path="/auth/action" element={<AuthActionPage />} />
            <Route path="/team" element={<ProtectedRoute><ManageTeamPage /></ProtectedRoute>} />
            {/* The team hub and team admin merged into Manage team; bookmarks,
                emails and stored notifications still carry the old paths. */}
            <Route path="/team/admin" element={<Navigate to="/team" replace />} />
            <Route path="/hub" element={<Navigate to="/team" replace />} />
            <Route path="/admin" element={<Navigate to="/team" replace />} />
            <Route path="/coordination" element={<ProtectedRoute><CoordinationPage /></ProtectedRoute>} />
            <Route path="/board-setup" element={<ProtectedRoute><BoardSetupPage /></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><ImportTasksPage /></ProtectedRoute>} />
            <Route path="/milestones" element={<ProtectedRoute><MilestonesPage /></ProtectedRoute>} />
            <Route path="/files" element={<ProtectedRoute><TeamFilesPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
            <Route path="/knowledge" element={<ProtectedRoute><KnowledgePage /></ProtectedRoute>} />
            <Route path="/scorer" element={<ProtectedRoute><ScorerPage /></ProtectedRoute>} />
            {/* Search was removed from the product; old links land on Home. */}
            <Route path="/search" element={<Navigate to="/" replace />} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/settings" element={<Navigate to="/profile" replace />} />
            <Route path="/tracker" element={<CoordinationAlias />} />
            {/* Chat and the calendar were removed from the product, but
                notifications already delivered to a mailbox still carry their
                deep links. Landing on Manage team beats a not-found page. */}
            <Route path="/calendar" element={<CoordinationAlias />} />
            <Route path="/chat" element={<Navigate to="/team" replace />} />
            <Route path="/teams/new" element={<ProtectedRoute><CreateTeamPage /></ProtectedRoute>} />
            {/* Invitation acceptance, reached from an emailed `/join?invite=<id>` link.
                ProtectedRoute round-trips the full deep link through `/auth?next=…`,
                so a signed-out invitee keeps the invitation id across sign-in. */}
            <Route path="/join" element={<ProtectedRoute><JoinTeamPage /></ProtectedRoute>} />
            <Route path="/home" element={<Navigate to="/" replace />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </Suspense>
      </AppShell>
    </AppErrorBoundary>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <PreferencesProvider>
        <TeamProvider>
          <BrowserRouter>
            <AppRoutes />
          </BrowserRouter>
        </TeamProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
