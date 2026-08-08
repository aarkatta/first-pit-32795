import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import { EmulatorPage } from '@/pages/EmulatorPage';
import { HomePage } from '@/pages/HomePage';
import { NotFoundPage } from '@/pages/NotFoundPage';
import { StatusLabPage } from '@/pages/StatusLabPage';
import { useOnlineStatus } from '@/lib/use-online-status';

export function AppRoutes() {
  const online = useOnlineStatus();

  return (
    <AppShell online={online}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/states" element={<StatusLabPage />} />
        <Route path="/emulators" element={<EmulatorPage />} />
        <Route path="/home" element={<Navigate to="/" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AppShell>
  );
}

export default function App() {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AppRoutes />
    </BrowserRouter>
  );
}
