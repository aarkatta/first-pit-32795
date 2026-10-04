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

The MVP and Release 1.1 are implemented. Release 1.1 now covers the
work-breakdown tracker — milestones, categories, tasks, subtasks, planned dates
— and spreadsheet import from a standard template. Read `docs/architecture.md`
before starting work. The table below records the order the modules were built in and
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
the product**, as were the Search page and the development-only State lab and
Emulators pages (2026-09-17); their collections, rules, indexes and callables are gone, and the
catch-all deny now covers any documents left behind. The Tracker's Calendar tab
is not that feature: it is a read-only view of existing tasks and milestones by
date and stores nothing.

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
- Only coach and mentor accounts may create a team. The account type is
  self-declared once at sign-up and written only by the server; anyone who is a
  student or parent on any team is refused regardless (decision of 2026-09-17).
- Tracker tasks may be added and edited by coaches, team leaders and students;
  mentors and parents are read-only there. Board setup, import, templates and
  all team administration stay with coaches and team leaders.
- Invitations are shared as links by the coach; the product sends no invitation
  email. Adding email delivery is a product decision, not a default.

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
