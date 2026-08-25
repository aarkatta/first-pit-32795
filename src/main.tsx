import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getFirebaseServices } from './lib/firebase';
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

bootstrapFirebaseClient();

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
