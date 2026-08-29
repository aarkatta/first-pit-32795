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

const AuthPage = lazy(() => import('@/pages/AuthPage').then((module) => ({ default: module.AuthPage })));
const ChatPage = lazy(() => import('@/pages/ChatPage').then((module) => ({ default: module.ChatPage })));
const CoordinationPage = lazy(() => import('@/pages/CoordinationPage').then((module) => ({ default: module.CoordinationPage })));
const CreateTeamPage = lazy(() => import('@/pages/CreateTeamPage').then((module) => ({ default: module.CreateTeamPage })));
const EmulatorPage = lazy(() => import('@/pages/EmulatorPage').then((module) => ({ default: module.EmulatorPage })));
const JoinTeamPage = lazy(() => import('@/pages/JoinTeamPage').then((module) => ({ default: module.JoinTeamPage })));
const HomePage = lazy(() => import('@/pages/HomePage').then((module) => ({ default: module.HomePage })));
const KnowledgePage = lazy(() => import('@/pages/KnowledgePage').then((module) => ({ default: module.KnowledgePage })));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage').then((module) => ({ default: module.NotFoundPage })));
const ProfilePage = lazy(() => import('@/pages/ProfilePage').then((module) => ({ default: module.ProfilePage })));
const ScorerPage = lazy(() => import('@/pages/ScorerPage').then((module) => ({ default: module.ScorerPage })));
const SearchPage = lazy(() => import('@/pages/SearchPage').then((module) => ({ default: module.SearchPage })));
const StatusLabPage = lazy(() => import('@/pages/StatusLabPage').then((module) => ({ default: module.StatusLabPage })));
const TeamAdminPage = lazy(() => import('@/pages/TeamAdminPage').then((module) => ({ default: module.TeamAdminPage })));
const TeamHubPage = lazy(() => import('@/pages/TeamHubPage').then((module) => ({ default: module.TeamHubPage })));

type AppRoutesProps = {
  clientEnv?: ClientEnv;
};

/**
 * `/states` is a QA catalogue of every UI state and `/emulators` documents the
 * local Firebase setup. Neither is product surface, so they only exist in a
 * development build — a production visitor gets the normal not-found page.
 */
const devToolsEnabled = import.meta.env.DEV;

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
            <Route path="/hub" element={<ProtectedRoute><TeamHubPage /></ProtectedRoute>} />
            <Route path="/admin" element={<ProtectedRoute><TeamAdminPage /></ProtectedRoute>} />
            <Route path="/coordination" element={<ProtectedRoute><CoordinationPage /></ProtectedRoute>} />
            <Route path="/chat" element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
            <Route path="/knowledge" element={<ProtectedRoute><KnowledgePage /></ProtectedRoute>} />
            <Route path="/scorer" element={<ProtectedRoute><ScorerPage /></ProtectedRoute>} />
            <Route path="/search" element={<ProtectedRoute><SearchPage /></ProtectedRoute>} />
            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
            <Route path="/settings" element={<Navigate to="/profile" replace />} />
            <Route path="/tracker" element={<CoordinationAlias />} />
            <Route path="/calendar" element={<CoordinationAlias />} />
            <Route path="/teams/new" element={<ProtectedRoute><CreateTeamPage /></ProtectedRoute>} />
            {/* Invitation acceptance, reached from an emailed `/join?invite=<id>` link.
                ProtectedRoute round-trips the full deep link through `/auth?next=…`,
                so a signed-out invitee keeps the invitation id across sign-in. */}
            <Route path="/join" element={<ProtectedRoute><JoinTeamPage /></ProtectedRoute>} />
            {devToolsEnabled ? <Route path="/states" element={<StatusLabPage />} /> : null}
            {devToolsEnabled ? <Route path="/emulators" element={<EmulatorPage clientEnv={runtimeEnv} />} /> : null}
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
