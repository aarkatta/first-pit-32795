# First Pit

First Pit is a private team-management application for the FIRST LEGO League
community. The web MVP and pilot-hardening foundation are implemented, with
Release 1.1 adding team-scoped Kanban project management. Trusted identity,
transactional membership administration, explicit safety policies, reporting,
moderation, and audit history remain the authorization foundation.

[`docs/architecture.md`](docs/architecture.md) is the single reference for the
data model, authorization contract, per-domain behavior, open product blockers,
and the release runbook.

## What is included

- Vite + React + TypeScript application shell
- Browser routing that works for web and Capacitor packaging
- Firebase Authentication with sign-in, sign-up, sign-out, recovery, and protected routes
- Firebase client bootstrap with emulator support, invoked from `src/main.tsx`
- Team context and switcher backed by active Firestore memberships
- Server-side team creation with baseline policies, settings, and audit logging
- Team administration for invitations, join approvals, role assignment, membership lifecycle, and leadership transfer
- Deny-first safety policies for messaging, file sharing, parent visibility, and private discoverability
- Privacy defaults with mandatory safety notifications for least-exposing profiles
- Server-created reports, moderation queue records, and immutable administrative audit events
- Firebase emulator configuration for Auth, Firestore, Storage, and Functions
- Node.js Cloud Functions scaffold
- Team-scoped Firestore and Storage rules with deny-by-default feature writes
- Multi-project Kanban boards with configurable workflows, accessible card movement, conflict detection, and role-scoped controls
- CI workflow for lint, type-check, test, and build

## Local development prerequisites

- Node.js 24, matching the Functions runtime declared by the repository
- npm 11.4.2, matching the `packageManager` field
- Firebase CLI available as `firebase`

The browser shell requires a local environment file because Firebase client
configuration is validated during application startup. Do not commit `.env.local`.

Only `*.example` env templates are tracked; `.gitignore` ignores every real
`.env*` file plus service-account keys, `*.pem`/`*.p8`/`*.p12`, keystores,
`google-services.json`, and `GoogleService-Info.plist`. Use `.env.example` for
local work and `.env.production.example` as the key list to set in Vercel —
production values belong in the Vercel project settings, never in the repo.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Fill in Firebase config values or keep emulator placeholders for local-only work. Keep `VITE_USE_FIREBASE_EMULATORS=true` when using the local emulators.
3. Install dependencies with `npm install`.
4. Start the emulators in a second terminal with `npm run emulators`.
5. Run the app with `npm run dev`.

`src/main.tsx` calls `bootstrapFirebaseClient()` before rendering. The bootstrap
validates the client configuration, initializes Firebase, and connects the
configured local emulators. `AuthProvider` then owns the session listener and
`TeamProvider` loads only active memberships.

## Verification

- `npm run lint`
- `npm run typecheck`
- `npm test`
- `npm run build`
- `npm run functions:build`
- `npm run test:release`
- `npm run test:rules`
- `npx firebase emulators:exec --project demo-first-pit-ci --config firebase.json --only auth,functions,firestore,storage "node tests/emulator-verification.mjs"`

## Route strategy

- The app uses `BrowserRouter`.
- Vercel rewrites all client routes to `index.html`.
- The same shell remains compatible with a future Capacitor iOS build.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — data model, authorization
  contract, per-domain behavior, roadmap, open blockers, and the release runbook.
- [`AGENTS.md`](AGENTS.md) — product boundaries and explicitly deferred scope.
- [`CLAUDE.md`](CLAUDE.md) — conventions, idempotency/versioning rules, and the
  testing layout.
