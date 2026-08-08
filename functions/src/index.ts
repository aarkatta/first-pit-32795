import { getApps, initializeApp } from 'firebase-admin/app';
import { onRequest } from 'firebase-functions/v2/https';

if (getApps().length === 0) {
  initializeApp();
}

export const api = onRequest({ cors: true }, (req, res) => {
  if (req.method === 'GET' && req.path === '/healthz') {
    res.status(200).json({
      ok: true,
      service: 'first-pit-functions',
      phase: 0
    });
    return;
  }

  res.status(200).json({
    ok: true,
    service: 'first-pit-functions',
    message: 'Phase 0 foundation is ready.'
  });
});
