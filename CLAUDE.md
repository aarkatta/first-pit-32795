# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` is the authoritative project charter (product boundaries, safety rules,
phase protocol). Read it before non-trivial work; this file covers the mechanics.

## Product

First Pit is a private team-management app for FIRST LEGO League teams (students,
coaches, mentors, parents). Web MVP first; the React shell must stay
Capacitor-compatible for the iOS package. Stack is fixed by decision: React + Vite,
Firebase Auth / Cloud Firestore / Storage / Cloud Functions, Vercel for web hosting.
Do not swap the database or auth provider.

## Commands

```bash
npm run dev              # Vite dev server on 127.0.0.1:5173
npm run emulators        # builds functions, then starts the Firebase emulator suite
npm run lint             # eslint, --max-warnings 0
npm run typecheck        # three tsconfigs: app, node, functions
npm test                 # vitest run (src/**/*.test.ts(x) AND functions/test/*.test.ts)
npm run test:watch
npm run build            # vite build -> dist/
npm run functions:build  # tsc for the functions workspace -> functions/lib/
```

Run a single test file or case:

```bash
npx vitest run src/lib/phase3-service.test.ts
npx vitest run -t "creates a task"
```

Two aggregate gates — `npm run verify` is what CI runs:

- `npm run verify:static` — lint, typecheck, coverage, automation contract test,
  functions build, web build, Phase 8 release check. No emulators needed.
- `npm run verify` — `verify:static` plus `npm run test:firebase` (every rules and
  emulator suite; slow). Requires the `firebase` CLI.

Emulator/rules suites run individually, each against its own throwaway project id,
e.g. `npm run test:rules:phase4`, `npm run test:phase4-emulator`,
`npm run test:storage:rules`, `npm run test:foundation-emulator`.

Node 24 and npm 11.4.2 are pinned (`engines`, `.nvmrc`, `packageManager`); the
Functions runtime is `nodejs24`. `functions/` is an npm workspace, so a root
`npm install` covers it.

## Architecture

Three layers, and the boundary between them is the security model:

1. **React client** (`src/`) — reads Firestore directly, never writes feature data.
2. **Callable Cloud Functions** (`functions/src/`) — every privileged mutation.
3. **Rules** (`firestore.rules`, `storage.rules`) — deny-by-default enforcement.

### Deny-first data model

Firestore collections are **flat and top-level** (`tasks`, `messages`, `polls`,
`scoreSessions`, …), not subcollections; each document carries a validated `teamId`
and access is derived from a `memberships/{teamId}_{userId}` lookup. Nearly every
feature collection is `allow create, update, delete: if false` — clients read, the
Admin SDK writes. The catch-all `match /{document=**} { allow read, write: if false; }`
closes everything else.

Consequences when adding a feature:

- A new write path means a new callable in `functions/src/`, re-exported from
  `functions/src/index.ts`, plus a thin wrapper in the matching `src/lib/*-service.ts`.
- A new collection needs a read rule in `firestore.rules`, probably an entry in
  `firestore.indexes.json`, and coverage in the phase's `tests/firestore-rules-*.mjs`.
- Never widen a rule to make a test pass.

### Server command modules

`functions/src/index.ts` is a thin export surface: it defines Phase 0–2 callables
inline and re-exports the rest from per-phase command modules — `phase2.ts` (roles,
membership, safety, plus the shared validators `requireTeamId`, `requireTeamAdmin`,
`auditRecord`, …), `phase3.ts` (tracker/calendar/files), `kanban.ts`, `phase4.ts`
(chat), `phase5.ts` (Q&A/videos/polls), `phase6.ts` (scorer), `phase7.ts`
(dashboard/search/profile). `phase2.ts` is the shared validation/authorization
toolkit — reuse its helpers instead of re-deriving auth checks. There is also one
`onRequest` HTTP function, `api`, serving `/healthz`.

Mutations follow two conventions worth preserving:

- **Idempotency** — callers pass an `operationId`; the handler records a receipt in
  a `phase{N}Operations/{teamId}_{operationId}` doc inside the transaction and
  replays the stored result on retry.
- **Optimistic concurrency** — records carry a `version`; edits pass
  `expectedVersion` and a mismatch is a conflict error, not a silent overwrite.

Sensitive administrative changes (invitations, role changes, membership lifecycle,
moderation) must also write an immutable `auditEvents` record.

### Client structure

- `src/main.tsx` calls `bootstrapFirebaseClient()` **before** render;
  `src/lib/firebase.ts` validates env, initializes Firebase once, and connects
  emulators when `VITE_USE_FIREBASE_EMULATORS=true`.
- `src/lib/env.ts` (Zod) is the single env gate and hard-fails if emulators are
  enabled in a production build — `scripts/release-check.mjs` asserts that
  guard string still exists.
- Providers wrap the router: `AuthProvider` owns the session listener,
  `TeamProvider` subscribes to *active* memberships and persists the active team id
  in `localStorage`. `ProtectedRoute` guards authenticated routes; all pages are
  `lazy()`-loaded in `src/App.tsx`, inside `AppErrorBoundary` and `AppShell`.
- `src/lib/*-service.ts` mirror the server phase modules. Each has a local
  `call(name, input)` helper over `httpsCallable` plus typed input shapes, and holds
  the paginated Firestore queries (bounded `limit` + `startAfter` cursors — never
  load a whole season).
- `src/lib/domain.ts` holds shared domain types/role unions. Note `TeamRole` on the
  client includes `teamLeader`; `functions/src/phase2.ts` `TEAM_ROLES` is the
  *assignable* set and excludes it.
- Path alias `@/` → `src/` (configured in both `vite.config.ts` and `tsconfig.app.json`).

### Required UI states

Every screen and data operation must handle loading, empty, error/retry,
permission-denied, and offline. `src/lib/request-state.ts` maps an unknown error +
online flag to one of those variants, and `src/components/StatePanel.tsx` renders
them; `src/lib/use-online-status.ts` supplies the online flag. Use these rather than
inventing per-page error UI. `/states` (`StatusLabPage`) is the visual catalogue.

## Testing layout

- **Vitest / jsdom** — colocated `*.test.ts(x)` next to sources, plus pure-logic
  tests for server command modules in `functions/test/` (they import from
  `../src/*.js` and exercise validators, not Firestore). Setup: `src/test/setup.ts`.
- **Coverage gates** in `vite.config.ts`: 80% statements/lines, 70% branches, 75%
  functions, scoped to `src/lib/**` and `src/components/**`. Note that this leaves
  route pages, `src/features/**`, `src/lib/*.tsx` (both React contexts), and all of
  `functions/src/**` unmeasured — see the test-gap notes before trusting the number.
- **Emulator + rules integration** — plain Node scripts in `tests/*.mjs` driven by
  `firebase emulators:exec`. They talk to the emulator REST APIs / rules-unit-testing
  directly and throw on failure; there is no test framework in them.
- `scripts/release-check.mjs` is a static release gate (Capacitor metadata,
  Vercel SPA rewrite, safe-area viewport, production emulator guard, secret scan).

## Documentation map

`docs/architecture.md` is the single architecture and release reference — data
model, authorization contract, per-domain behavior, roadmap, and the release
runbook. `AGENTS.md` holds product boundaries and non-goals. This file holds
day-to-day conventions.

The MVP was built through a numbered-phase agent pipeline. That pipeline and its
generated reports have been removed; the phase numbers survive only in the
`phase{N}-service.ts` / `functions/src/phase{N}.ts` filenames and in two Firestore
collection names (`phase3Operations`, `phase6Operations`). Renaming the files is
a safe mechanical change; renaming the collections needs a data migration.

## Local setup

Copy `.env.example` to `.env.local` (never commit it) and keep
`VITE_USE_FIREBASE_EMULATORS=true` for local work. Emulator ports: auth 9099,
firestore 8080, functions 5001, storage 9199, UI 4000.

## Conventions

2-space indent; `camelCase` values, `PascalCase` components/types, `kebab-case`
filenames. `import type` is lint-enforced (`consistent-type-imports`). Prefer shared
domain types over inline object shapes. Commit messages are short and imperative
("Add Firestore team foundation").

## Known drift

`functions/src/phase2.ts` is not a feature module — it is the shared
validation/authorization/audit toolkit that every other server module imports.
`functions/src/index.ts` is not a thin export surface; it defines the whole
team/membership/moderation feature set inline.

<!-- imported-from: codex:project:instructions -->
# First-Pit — Codex Repository Guidelines

## Product Context

First-Pit is a cross-platform team-management tool for FIRST LEGO League (FLL)
students, coaches, mentors, and parents. It helps teams organize robot practice
sessions, innovation-project work, tasks, files, events, communication, polls,
questions, videos, and scoring history.

The first deliverable is a responsive web application. The React application
must remain compatible with Capacitor so it can be packaged for iOS after the
web MVP is stable.

## Technology Decisions

- React for the client application.
- Node.js for server-side functions/API code.
- Firebase Authentication for identity and sessions.
- Cloud Firestore for application data and team-scoped records.
- Firebase Storage for uploaded files and media.
- Firebase Cloud Functions or a Node.js server API for privileged operations,
  notifications, moderation, exports, and other sensitive workflows.
- Capacitor for the iOS application shell.
- Vercel for web deployment and compatible server/API deployment where
  applicable.

Do not substitute another database or authentication provider without an
explicit project decision. “Firebase DB” means Cloud Firestore for this project;
Firebase Realtime Database is not the default MVP datastore.

## Implementation Order

The MVP and Release 1.1 are implemented. Read `docs/architecture.md` before
starting work. The table below records the order the modules were built in and
their dependencies; it is history, not a queue.

| Phase | Scope |
|---|---|
| 0 | Product decisions, repository setup, Firebase emulators, CI, and app shell |
| 1 | Authentication, profiles, teams, memberships, Firestore model, authorization, rules, audit foundation |
| 2 | Roles, invitations, membership lifecycle, privacy, youth safety, reporting, and moderation |
| 3 | Tracker, robot-practice coordination, Calendar, Notifications, and Storage Area |
| 4 | Team Chat and announcements |
| 5 | Questions, How-to Videos, and Polls |
| 6 | Scorer and practice/match history |
| 7 | Dashboard, search, profile customization, and cross-module integration |
| 8 | Hardening, responsive QA, Capacitor iOS packaging, pilot readiness, and deployment |

Explicitly deferred from MVP: public team discovery, public community feed,
collaboration marketplace, full innovation-project workflow, advanced robot
version/parts/maintenance logs, learning courses, external calendar sync,
offline-first mode, large-scale reputation features, and capabilities requiring
unproven moderation capacity.

## Repository Structure

Use a simple structure that can evolve without mixing client and privileged
code:

- `src/` — React application code, routes, shared components, hooks, and feature
  modules.
- `src/features/<feature>/` — feature-specific UI, state, validation, and data
  access.
- `src/lib/` — Firebase client initialization, shared utilities, authorization
  helpers, error handling, and common types.
- `functions/` or `server/` — Node.js Cloud Functions/API code that requires
  trusted execution.
- `firestore.rules` — Firestore security rules.
- `storage.rules` — Firebase Storage security rules.
- `firestore.indexes.json` — required Firestore indexes.
- `tests/` or feature-local test files — unit, integration, emulator, and rules
  tests.
- `docs/` — decision records, data-model notes, safety policy decisions, and
  operational documentation.
- `public/` or `assets/` — static assets only.

Follow the repository’s actual framework conventions if the scaffold uses a
different equivalent layout. Do not create duplicate app structures.

## Data and Authorization Rules

- Every team-owned document must contain or be addressable by a validated
  `teamId`.
- Never trust a client-supplied team ID, role, user ID, or permission claim.
- Enforce access in Firestore/Storage rules and server-side authorization;
  hiding a button is not authorization.
- Use least-privilege defaults for students and minors.
- Do not expose private student information, private conversations, or file
  contents in logs.
- Avoid collecting unnecessary child personal information and precise location.
- Record audit events for invitations, role changes, membership changes,
  moderation actions, and other sensitive administrative updates.
- Use bounded queries, cursor pagination, and indexes. Do not load an entire
  season’s history into the client.
- Treat file uploads as untrusted: validate type, size, access scope, and
  metadata before making them available.
- Parent visibility, direct messaging, discoverability, file sharing, and
  membership approval must be controlled by explicit team policy. Do not invent
  unsafe defaults.

## Coding Conventions

- Use TypeScript when the project scaffold supports it; otherwise use modern
  JavaScript consistently.
- Use 2-space indentation for JavaScript, TypeScript, JSON, and configuration.
- Use `camelCase` for variables and functions.
- Use `PascalCase` for React components, classes, and types.
- Use `kebab-case` for filenames unless a framework convention requires another
  form.
- Keep feature modules small and colocate feature-specific tests.
- Prefer explicit domain types and shared validation over duplicated inline
  object shapes.
- Keep web and Capacitor-compatible code separate from native-only adapters.
- Follow the project formatter, linter, and import conventions once configured.

## Required UI Behavior

Every screen and data operation must account for:

- loading state;
- empty state;
- error and retry state;
- permission-denied state;
- interrupted or offline-network state;
- accessible keyboard, focus, labels, and contrast behavior;
- responsive layouts for desktop and mobile widths.

Use plain-language permission explanations for role and safety decisions. Avoid
adding public-facing social mechanics to private team workflows.

## Development and Verification

Use the scripts defined by `package.json`; do not invent commands that are not
present. The expected checks, once configured, are:

```bash
npm install
npm run dev
npm run lint
npm run typecheck
npm test
npm run build
```

Use Firebase Emulator Suite for local Authentication, Firestore, Storage, and
Functions/rules tests where applicable. Run the narrowest relevant tests while
iterating, then run the complete lint, type-check, test, and production-build
checks before declaring a phase complete. Confirm Vercel compatibility before
deployment and keep secrets out of source control.

## Phase Completion Protocol

Before changing code:

1. Inspect the existing repository and current phase status.
2. Read the master phase plan and the requested phase file.
3. Identify existing user changes and preserve unrelated work.
4. Confirm the current phase’s scope and exit criteria.

During implementation:

1. Update UI, data access, authorization, security rules, tests, and relevant
   documentation together.
2. Keep team boundaries and role checks covered by tests.
3. Do not mark a requirement complete merely because the UI exists.

At phase completion, report:

- files and behavior changed;
- tests, emulator tests, lint, type-check, and build results;
- known limitations or unresolved product/safety decisions;
- whether the phase exit criteria passed;
- the exact next phase to run.

## Commits and Pull Requests

Use short, imperative commit messages such as `Add Firestore team foundation`.
Pull requests should include a concise summary, requirements or phase
reference, tests run, security/rules impact, known limitations, and screenshots
or recordings for UI changes.

## Agent Safety Notes

- Do not overwrite an existing `AGENTS.md` or unrelated user changes.
- Do not add credentials, service-account keys, or production data.
- Do not weaken Firestore/Storage rules to make a test pass.
- Do not enable public discovery, unsupervised minor messaging, or broad file
  access without an explicit policy decision and tests.
- Keep edits focused on the requested phase and update documentation when a
  project decision changes.
