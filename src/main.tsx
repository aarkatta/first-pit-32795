import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getFirebaseServices } from './lib/firebase';
import { installNativeLinkHandler } from './lib/native-links';
import { hideNativeSplash } from './lib/native-shell';
import { registerGlobalErrorHandlers } from './lib/report-error';
import './styles/global.css';
import './styles/reference-ui.css';
import './styles/monday.css';
import './styles/polish.css';
import './styles/tailwind.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element #root was not found.');
}

/**
 * Phase 1 startup boundary. This initializes Firebase and optional emulators;
 * AuthProvider owns the session listener after the app renders.
 */
export function bootstrapFirebaseClient() {
  return getFirebaseServices();
}

// Registered before bootstrap so a failure inside Firebase initialization is
// reported rather than lost. AppErrorBoundary covers render-time crashes; this
// covers rejected promises and uncaught errors outside the React tree.
registerGlobalErrorHandlers();

bootstrapFirebaseClient();

// iOS shell only: new-tab links open in the in-app Safari view and downloads
// go to the share sheet (see native-links.ts). A no-op on the web.
installNativeLinkHandler();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

// In the iOS shell, drop the launch splash once the first frame has painted.
requestAnimationFrame(() => { void hideNativeSplash(); });
