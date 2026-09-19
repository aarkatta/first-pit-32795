import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { listenForDeepLinks } from '@/lib/native-deep-links';

/**
 * Routes Universal Links into the app (iOS shell only). Renders nothing; it
 * sits inside the router so a link can navigate. Protected destinations go
 * through `ProtectedRoute` as usual, so a signed-out user tapping an invite
 * signs in first and keeps the invitation.
 */
export function NativeDeepLinks() {
  const navigate = useNavigate();
  useEffect(() => listenForDeepLinks((path) => navigate(path)), [navigate]);
  return null;
}
