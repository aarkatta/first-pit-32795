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
npm run template:build   # regenerates public/first-pit-task-template.xlsx
npm run ios:build        # production bundle -> checked -> cap sync ios (needs .env.ios.local + ios/App/App/GoogleService-Info.plist)
npm run ios:open         # open the iOS shell in Xcode
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
e.g. `npm run test:rules:phase3`, `npm run test:phase3-emulator`,
`npm run test:storage:rules`, `npm run test:foundation-emulator`,
`npm run test:provisioning-emulator` (coach-created accounts, forced password change).

Node 24 and npm 11.4.2 are pinned (`engines`, `.nvmrc`, `packageManager`); the
Functions runtime is `nodejs24`. `functions/` is an npm workspace, so a root
`npm install` covers it.

## Architecture

Three layers, and the boundary between them is the security model:

1. **React client** (`src/`) — reads Firestore directly, never writes feature data.
2. **Callable Cloud Functions** (`functions/src/`) — every privileged mutation.
3. **Rules** (`firestore.rules`, `storage.rules`) — deny-by-default enforcement.

### Deny-first data model

Firestore collections are **flat and top-level** (`tasks`, `goals`, `polls`,
`notifications`, …), not subcollections; each document carries a validated `teamId`
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

### Work-breakdown model

The tracker is one tree, and the levels are not interchangeable:

- **Milestone** — a `goals` record. The deliverable. Progress counters are
  maintained per linked task, transactionally.
- **Category** — an entry in a project's `categories` array: the work package.
  Carries an optional `goalId` (its milestone) and `areaId` (a judging area).
- **Task** — a `tasks` document with `categoryId`, `goalId`, `columnId`,
  `orderKey`, `version`, and `startAt`/`endAt`/`dueAt`.
- **Subtask** — an entry in the task's `subtasks` array (max 30), with its own
  status, assignee and due date. Not a board card: no column, order or history.

A card inherits its category's milestone on create and on category change,
unless the same call names a milestone explicitly. Judging areas are still task
*labels*, which is what the dashboard counts; a category's `areaId` is applied by
the importer and the built-in templates, **not** by manual card creation — see
the follow-ups in `docs/architecture.md`.

A team's first board is **pre-filled** when `ensureDefaultProject` creates it for
a team with no tasks: the four categories and 48 tasks of
`functions/src/data/fll-standard-task-list.json` (`buildStandardPlan` in
`functions/src/standard-plan.ts`). That JSON is also the source of the Excel
template (`npm run template:build`), so edit it there, once.

### Who may do what

- **Account type** (`users/{uid}.accountType`: coach / mentor / student /
  parent) is chosen at sign-up, set once via the `setAccountType` callable (the
  browser cannot write it), and decides only **team creation**: `createTeam`
  allows coach and mentor accounts and refuses anyone who is a student or parent
  on any team (`teamCreationRefusal`, `phase2.ts`).
- **Team role** (a membership's `role`) decides everything inside a team.
  Administration — invitations, roles, policy, moderation, audit, board setup,
  import, templates, file attachments, and the team name and number
  (`updateTeamDetails`) — is coach/team-leader (`requireTeamAdmin`).
- **Tracker task editors** are coaches, team leaders **and students**
  (`TASK_EDITOR_ROLES` / `requireTaskEditor`): they add, edit and move any task.
  Mentors view the board and may progress work assigned to them. **Parents are
  strictly read-only and can never be assigned a task or subtask**
  (`TASK_ASSIGNABLE_ROLES` / `assertAssignableMemberInTransaction` — use it on
  any new path that sets an assignee).
- **Team leader** is a legacy title with no powers of its own: every
  permission check treats `coach` and `teamLeader` alike. The UI no longer
  offers a way to assign it (`transferTeamLeadership` stays deployed, unused,
  for older bundles). Existing leaders keep the label. Don't add features that
  hinge on it without first deciding what a lead coach may do that a coach
  can't.
- **Knowledge editors** are coaches, team leaders, **mentors and students**
  (`KNOWLEDGE_EDITOR_ROLES` / `requireKnowledgeEditor`, `phase2.ts`): they
  publish and unpublish team videos (and see drafts), close team polls, and
  accept an answer on any team question. Parents still ask, answer, comment,
  vote and create polls. Early sight of poll results stays coach/team-leader.
- Client mirrors for UI only: `isCoachOrLeader`, `canEditTasks`, `canEditKnowledge`,
  `canCreateTeams`, `mayOfferTeamCreation` in `src/lib/domain.ts`. The server
  re-checks every one; hiding a control is never the authorization.

### Server command modules

`functions/src/index.ts` defines Phase 0–2 callables inline and re-exports the
rest from per-phase command modules — `phase2.ts` (roles,
membership, safety, plus the shared validators `requireTeamId`, `requireTeamAdmin`,
`auditRecord`, …), `phase3.ts` (tracker/goals/notifications/files),
`kanban.ts`, `kanban-templates.ts` (board presets and team-saved templates),
`phase5.ts` (Q&A/videos/polls), `phase7.ts`
(dashboard/search/profile), `team-members.ts` (coach-provisioned accounts),
`standard-plan.ts` (the seeded season plan). There is no `phase4.ts` — chat was removed from the
product — and no `phase6.ts`: the scorer now links out to FIRST's official
scoresheet and stores nothing. `phase2.ts` is the shared validation/authorization toolkit — reuse its
helpers instead of re-deriving auth checks. There is also one
`onRequest` HTTP function, `api`, serving `/healthz`.

Mutations follow two conventions worth preserving:

- **Idempotency** — callers pass an `operationId`; the handler records a receipt in
  a `phase{N}Operations/{teamId}_{operationId}` doc inside the transaction and
  replays the stored result on retry.
- **Optimistic concurrency** — records carry a `version`; edits pass
  `expectedVersion` and a mismatch is a conflict error, not a silent overwrite.

Sensitive administrative changes (invitations, role changes, membership lifecycle,
moderation) must also write an immutable `auditEvents` record. Audit `metadata`
accepts only the keys in `AUDIT_METADATA_KEYS` (`phase2.ts`); encode anything
else in `action`.

A callable must return stored dates as **ISO strings** — a raw Firestore
`Timestamp` reaches the browser as `{_seconds, _nanoseconds}`, which `toDate()`
cannot read. Use `timestampToIso` (`phase2.ts`), as `pickPublicFields` in
`phase7.ts` does.

Free text is validated with `requireText`, which refuses an empty string. A
field an edit form may send back blank (a task description) must use
`optionalText` instead, which stores `''` — otherwise a record created without it
can never be saved again (the 2026-10-01 task-save bug).

Client display helpers are shared in `src/lib/domain.ts`: `roleLabel` ("Team
leader", "Coach") and `nameInitials`; per-person/team badge colours use
`avatarTone` from `src/lib/board-view.ts`. Don't add page-local copies.

There are **two ways onto a team, and one entry point**: a coach always adds
someone with **Manage team → Add a member**, and First Pit picks the
mechanism. Do not add a second place to create members or invitations.

*Invitations* are for an address that already has an account —
`provisionTeamMember` refuses it with `already-exists` and the dialog offers an
invitation instead. They are **not emailed** by First Pit: `createInvitation`
stores the invitation and the coach shares the `/join?invite=<id>` link
themselves. **Email invite** opens Gmail's compose screen in a new tab with
the message written (`src/lib/invite-email.ts`) — no server email, no provider,
nothing stored. `inviteMailtoHref` is kept, unused, for a later non-Gmail option.

*Provisioning* (`functions/src/team-members.ts`) is for someone with no First Pit
account: `provisionTeamMember` creates the Auth account and returns a generated
password **once**, the coach passes it on from their own mailbox, and
`PasswordSetupGate` forces the member to replace it before they reach any team
data. Rules that module exists to hold: the password is never stored, logged or
put in a URL (`CredentialsCard` copies, it does not build a Gmail link); an
address that already has an account is refused so consent stays with the
invitation flow; `resetTeamMemberPassword` only reaches accounts where
`users/{uid}.provisionedByTeamId` is this team; and `emailVerified` stays false
because nobody proved the mailbox. See *Coach-provisioned member accounts* in
`docs/architecture.md`.

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
- Navigation (`AppShell.tsx`): sidebar Home, Tracker, Scorer, Knowledge base,
  Manage team, Administration (coaches/team leaders only) (Team files has no
  entry; it is reached from task cards). **View profile** and **Sign out** live
  in the account menu — the sidebar's footer profile card is a `<details>`
  disclosure — and in the phone's top-bar Menu. The logo is the "FP" mark with
  FIRST PIT and a "by Tech Titans NC" line; `appName` stays "First Pit". Top bar:
  active-team switcher + online status + notification bell. **Manage team**
  (`/team`, `ManageTeamPage`) is a two-part screen: a **team picker** of cards —
  every team the viewer belongs to, each with its live member/not-signed-in
  counts, plus a dashed "Create a new team" card (`mayOfferTeamCreation`,
  coach/mentor accounts, → `/teams/new`) — above a **selected-team panel**.
  Choosing a card calls `setActiveTeamId`, so the top-bar switcher and the rest
  of the app follow. The panel is the dark team header (Edit team details, Add a
  member), four stat tiles (members, coaches & leaders, students, not signed in),
  a search box + role-filter chips, and the member table (`RosterTable`): role
  select, Status (Active / Not signed in), Last active, and a per-row kebab menu
  for Reset password / Suspend. Each team's roster is fetched once and cached so
  the card counts and the panel share one read. Keep it clean: **active members
  only** — suspended, removed and pending people belong in Administration — and
  leaving a team or accepting an invitation stay on the profile
  (`MembershipsPanel`, Profile → Your teams).
  **Administration** (`/admin`, `AdministrationPage`) is coach-only and tabs over
  the invitations list, join requests, suspended members, team settings, safety
  and audit (`?tab=<id>` opens one); `/team/admin` redirects there and `/hub`
  redirects to `/team`. Search, State lab and Emulators pages were
  removed (`/search` → Home). Tracker routes render full-width
  (`wideRoutes` → `.app-main--wide`); other pages use a centred 1440px column.
- The tracker is four routes presented as tabs by
  `src/features/kanban/TrackerTabs.tsx` and absent from the sidebar:
  `/coordination` (board), `/milestones`, `/import`, `/board-setup`. The last two
  are coach-only and read the team's single board through `src/lib/use-team-board.ts`.
  `/files` is its own sidebar destination; `/notifications` is reached from the
  top-bar bell (`src/components/NotificationBell.tsx`, live unread badge + recent
  list). Their shared reads and listeners live in `src/lib/coordination-data.ts`.
- `src/features/kanban/` holds the board: `KanbanBoard.tsx` (subscriptions,
  movement, card dialog), `BoardTable.tsx` (the one board view), `BoardToolbar.tsx`,
  `BoardSetup.tsx` (columns + categories), `TaskImportPanel.tsx` and
  `spreadsheet-reader.ts`. Grouping, numbering, filtering and timeline maths are
  pure functions in `src/lib/board-view.ts`. In the iOS shell (`isNativeShell()`)
  the board is **compact**: task name and assignee per row, no column picker.
- iOS-only styling: `markNativeShell()` (`src/lib/native-shell.ts`, called in
  `main.tsx`) adds `native-shell` to `<html>` in the Capacitor app; scope phone
  app CSS under `.native-shell` so the web is untouched.
- Path alias `@/` → `src/` (configured in both `vite.config.ts` and `tsconfig.app.json`).

### Required UI states

Every screen and data operation must handle loading, empty, error/retry,
permission-denied, and offline. `src/lib/request-state.ts` maps an unknown error +
online flag to one of those variants, and `src/components/StatePanel.tsx` renders
them; `src/lib/use-online-status.ts` supplies the online flag. Use these rather than
inventing per-page error UI.

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
  directly and throw on failure; there is no test framework in them. They use the
  default emulator ports, so stop a running `npm run emulators` first (or run them
  against a copy of `firebase.json` with other ports). Only
  `tests/provisioning-emulator-integration.mjs` reads its ports from the
  environment (`FIRST_PIT_AUTH_PORT`, `FIRST_PIT_FUNCTIONS_PORT`,
  `FIRST_PIT_FIRESTORE_PORT`); the other suites hard-code the defaults. Remember
  `npm run functions:build` first when calling `firebase emulators:exec`
  directly — the npm scripts do it for you, and a stale `functions/lib` runs
  the old code. Any suite that creates a
  team must first call `setAccountType` with `coach` or `mentor`.
- `scripts/release-check.mjs` is a static release gate (Capacitor metadata,
  Vercel SPA rewrite, safe-area viewport, production emulator guard, secret scan).

## Documentation map

`docs/architecture.md` is the single architecture and release reference — data
model, authorization contract, per-domain behavior, roadmap, and the release
runbook. `AGENTS.md` holds product boundaries and non-goals. This file holds
day-to-day conventions.

The MVP was built through a numbered-phase agent pipeline. That pipeline and its
generated reports have been removed; the phase numbers survive only in the
`phase{N}-service.ts` / `functions/src/phase{N}.ts` filenames and in the `phase3Operations` Firestore
collection name. Renaming the files is a safe mechanical change; renaming the
collection needs a data migration.

## Deploying

Merging to `main` deploys the web client to Vercel. Firebase is a separate,
manual step — `firebase deploy --only firestore:rules,firestore:indexes,functions
--project production` — and a web change that needs a new callable, rule or
index is broken in production until it runs. Production is served at
`www.first-pit.com`; see *Deploying* in `docs/architecture.md`.

## Local setup

Copy `.env.example` to `.env.local` (never commit it) and keep
`VITE_USE_FIREBASE_EMULATORS=true` for local work. Emulator ports: auth 9099,
firestore 8080, functions 5001, storage 9199, UI 4000.

Emulator data is thrown away on every `npm run emulators` restart — use
`npm run emulators:export` to persist it to `.firebase/emulator-data`. Emulated
verification emails are never delivered; read the links from
`http://127.0.0.1:9099/emulator/v1/projects/demo-first-pit-dev/oobCodes`.

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
| 3 | Tracker, robot-practice coordination, Notifications, and Storage Area |
| 5 | Questions, How-to Videos, and Polls |
| 6 | Scorer and practice/match history |
| 7 | Dashboard, search, profile customization, and cross-module integration |
| 8 | Hardening, responsive QA, Capacitor iOS packaging, pilot readiness, and deployment |

Explicitly deferred from MVP: public team discovery, public community feed,
collaboration marketplace, full innovation-project workflow, advanced robot
version/parts/maintenance logs, learning courses, offline-first mode,
large-scale reputation features, and capabilities requiring unproven moderation
capacity. Team chat (channels, messages, announcements) and the calendar
(events, recurrence, Google Calendar sync) were built and then **removed from
the product**; their collections, rules, indexes and callables are gone, and the
catch-all deny now covers any documents left behind.

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
