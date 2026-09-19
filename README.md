# First Pit

First Pit is a private team-management application for the FIRST LEGO League
community. The web MVP and pilot-hardening foundation are implemented, with
Release 1.1 adding team-scoped project management: a work-breakdown tracker of
milestones, categories, tasks and subtasks, fed by a standard spreadsheet
template. Trusted identity, transactional membership administration, explicit
safety policies, reporting, moderation, and audit history remain the
authorization foundation.

[`docs/architecture.md`](docs/architecture.md) is the single reference for the
data model, authorization contract, per-domain behavior, open product blockers,
and the release runbook.

## What is included

- Vite + React + TypeScript application shell
- Browser routing that works for web and Capacitor packaging
- Firebase Authentication with sign-in, sign-up, sign-out, recovery, and protected routes
- Firebase client bootstrap with emulator support, invoked from `src/main.tsx`
- Team context and switcher backed by active Firestore memberships
- Server-side team creation with baseline policies, settings, and audit logging — limited to coach and mentor accounts (account type chosen once at sign-up), with an optional FLL team number
- Manage team: one page with the team overview for everyone ("Team name · Team #number") and, for coaches and team leaders, administration — editing the team name and number, invite links, join approvals, role assignment, membership lifecycle, and leadership transfer
- Email invite: a one-click button opens Gmail compose in a new tab with the invitation already written; First Pit itself sends no email
- Sidebar in the order Home, Tracker, Scorer, Knowledge base, Manage team, View profile, Sign out
- Knowledge base: team questions with answers (accepted answer first), polls, and a Resources tab of curated FLL links
- Scorer: a link to FIRST's official robot game scoresheet (it cannot be embedded), with in-app scoring marked coming soon
- A landing page with "coming soon" App Store and Google Play badges
- A notification bell in the top bar with a live unread count and the latest notifications
- Deny-first safety policies for messaging, file sharing, parent visibility, and private discoverability
- Privacy defaults with mandatory safety notifications for least-exposing profiles
- Server-created reports, moderation queue records, and immutable administrative audit events
- Firebase emulator configuration for Auth, Firestore, Storage, and Functions
- Node.js Cloud Functions scaffold
- Team-scoped Firestore and Storage rules with deny-by-default feature writes
- A work-breakdown tracker: milestones → categories → tasks → subtasks, numbered (1, 1.1, 1.1.1), with progress rolling up at every level
- One board screen — a grouped, sortable, filterable table with status, person, category, priority, start/end/due dates, timeline, labels and files — plus accessible card movement, conflict detection, and role-scoped controls
- Tracker tabs for Board, Milestones, Import tasks and Board setup, so project management lives in one place
- A new team's board starts pre-filled with the standard season plan's categories and tasks; coaches, team leaders and students add and edit tasks, mentors and parents view
- A standard 12-week, 48-task FLL template (`public/first-pit-task-template.xlsx`, rebuilt by `npm run template:build`) that teams edit and upload back
- Spreadsheet import with a row-by-row preview: categories created on the fly, statuses matched to board columns, assignees resolved server-side by name or email, subtasks nested under their task
- Team milestones with server-maintained progress counters, achieved/reopen state, and dashboard highlights
- CI workflow: `verify:static` on every push and pull request, plus the full emulator and rules suites on `main`

## Local development prerequisites

- Node.js 24, matching the Functions runtime declared by the repository
- npm 11.4.2, matching the `packageManager` field
- Firebase CLI available as `firebase`
- A Java runtime (JDK 11 or newer) on `PATH`. The Firestore and Storage emulators
  are Java processes, so `npm run emulators` and every `test:*-emulator` /
  `test:rules*` script fail without it. On macOS: `brew install --cask temurin`,
  then confirm with `java -version`.

The browser shell requires a local environment file because Firebase client
configuration is validated during application startup. Do not commit `.env.local`.

Only `*.example` env templates are tracked; `.gitignore` ignores every real
`.env*` file plus service-account keys, `*.pem`/`*.p8`/`*.p12`, keystores,
`google-services.json`, and `GoogleService-Info.plist`. Use `.env.example` for
local work and `.env.production.example` as the key list to set in Vercel —
production values belong in the Vercel project settings, never in the repo.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Keep the emulator placeholders — a `demo-*` project id and
   `VITE_USE_FIREBASE_EMULATORS=true`. Pointing `VITE_FIREBASE_PROJECT_ID` at the
   production project (`first-pit-32795`, see `.firebaserc`) with emulators off makes
   `npm run dev` and any Vite-loaded test read and write live Firestore, Auth, and
   Storage. Production values belong in Vercel, not in `.env.local`.
3. Install dependencies with `npm install`.
4. Start the emulators in a second terminal with `npm run emulators`.
5. Run the app with `npm run dev`.

`src/main.tsx` calls `bootstrapFirebaseClient()` before rendering. The bootstrap
validates the client configuration, initializes Firebase, and connects the
configured local emulators. `AuthProvider` then owns the session listener and
`TeamProvider` loads only active memberships.

## Verification

Two aggregate gates cover everything; prefer them over running the pieces by hand.

- `npm run verify:static` — lint, type-check, coverage, functions build, web build,
  and the release check. No emulators, so this is the fast loop, and it is what CI
  runs on every push and pull request.
- `npm run verify` — the complete gate: `verify:static` plus `npm run test:firebase`
  (every rules and emulator suite). CI runs this on `main` and on demand, because
  it starts the emulators thirteen times. Needs the Firebase CLI and a Java
  runtime; takes several minutes. Run it before a release.

The individual scripts behind them, for iterating on one thing:

- `npm run lint` — ESLint, `--max-warnings 0`
- `npm run typecheck` — the app, node, and functions tsconfigs
- `npm test` / `npm run test:coverage` — Vitest (coverage thresholds are in `vite.config.ts`)
- `npm run build` — type-checks, then builds to `dist/`
- `npm run functions:build` — compiles `functions/` to `functions/lib/`
- `npm run test:release` — static release gate (Capacitor metadata, Vercel routing,
  brand and social metadata, the production emulator guard, secret scan)
- `npm run test:firebase` — every rules and emulator suite; individual suites such as
  `npm run test:rules:phase3` or `npm run test:phase3-emulator` run on their own

## Route strategy

- The app uses `BrowserRouter`.
- `vercel.json` rewrites client routes to `index.html`, excluding `/assets/*` and the
  files served from `public/`, so a stale asset URL returns a 404 instead of HTML.
- The same shell is packaged for iOS with Capacitor: `npm run ios:build`, then
  `npm run ios:open` (see *Capacitor iOS* in `docs/architecture.md`).

## Brand and social assets

`public/` holds the assets referenced from `index.html`: `favicon.svg` (the master FP
mark), `favicon.ico` (16/32/48), `apple-touch-icon.png` (180×180), and `og-image.png`
(1200×630) for link previews. `npm run test:release` asserts the tags and the files
stay in place and that the PNGs keep their required dimensions.

Open Graph wants absolute URLs. `index.html` carries a `%SITE_URL%` token that
`vite.config.ts` replaces at build time from `VITE_SITE_URL`, falling back to Vercel's
`VERCEL_PROJECT_PRODUCTION_URL` / `VERCEL_URL`. Set `VITE_SITE_URL` once the production
domain is final; with none set the tags stay root-relative.

## Deploy to Vercel

The project builds with the settings already in `vercel.json` (framework `vite`,
`npm run build`, output `dist`), so the only setup is environment variables. Set the
keys listed in `.env.production.example` for the Production and Preview environments
(Vercel → Settings → Environment Variables, or `vercel env add <NAME> production`):

- `VITE_APP_NAME`, `VITE_APP_TAGLINE`
- `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
  `VITE_FIREBASE_STORAGE_BUCKET`, `VITE_FIREBASE_MESSAGING_SENDER_ID`,
  `VITE_FIREBASE_APP_ID`, and optionally `VITE_FIREBASE_MEASUREMENT_ID`
- `VITE_USE_FIREBASE_EMULATORS=false` — `src/lib/env.ts` hard-fails a production build
  when this is `true`
- `VITE_SITE_URL` (optional) — the canonical origin, e.g. `https://firstpit.example`,
  used for the absolute Open Graph and Twitter card URLs

Every `VITE_*` value is inlined into the browser bundle and is therefore public. Server
secrets and service-account credentials belong in Cloud Functions configuration, never
in a `VITE_*` variable. Deploy Firestore rules, Storage rules, indexes, and Functions
with the Firebase CLI separately — Vercel only hosts the web client:

```bash
firebase deploy --only firestore:rules,firestore:indexes,functions --project production
```

Merging to `main` deploys the web client; the Firebase deploy is a separate,
manual step, and a web change that relies on a new callable, rule or index does
not work in production until it has run. A custom domain (production is
`www.first-pit.com`) must also be added to Firebase Authentication → Settings →
Authorized domains, or Google sign-in is refused there. See the *Deploying*
section of `docs/architecture.md`.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — data model, authorization
  contract, per-domain behavior, roadmap, open blockers, and the release runbook.
- [`AGENTS.md`](AGENTS.md) — product boundaries and explicitly deferred scope.
- [`CLAUDE.md`](CLAUDE.md) — conventions, idempotency/versioning rules, and the
  testing layout.
