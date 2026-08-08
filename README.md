# First Pit

First Pit is a Phase 0 scaffold for the FIRST LEGO League team-management app.
This repository currently focuses on the web shell, Firebase emulator setup,
Capacitor compatibility, and the product decisions needed before feature work.

## What is included

- Vite + React + TypeScript application shell
- Browser routing that works for web and Capacitor packaging
- Firebase client bootstrap with emulator support
- Firebase emulator configuration for Auth, Firestore, Storage, and Functions
- Node.js Cloud Functions scaffold
- Security-first default-deny Firestore and Storage rules
- CI workflow for lint, type-check, test, and build

## Local development

1. Copy `.env.example` to `.env.local`.
2. Fill in Firebase config values or keep emulator placeholders for local-only work.
3. Install dependencies with `npm install`.
4. Run the app with `npm run dev`.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run emulators`

## Route strategy

- The app uses `BrowserRouter`.
- Vercel rewrites all client routes to `index.html`.
- The same shell remains compatible with a future Capacitor iOS build.

## Phase 0 decisions

See `docs/phase-0-decisions.md` for the current confirmed decisions and the
open blockers that still need product and safety input.
