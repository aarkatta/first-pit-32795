# Phase 0 — Product Decisions and Project Setup

## Goal

Resolve launch decisions and establish a maintainable React/Node/Firebase/Capacitor/Vercel foundation.

## Decisions required before implementation

- Use Cloud Firestore as the Firebase database for MVP collection-oriented data.
- Responsive web is the first runtime; keep the React app Capacitor-compatible for iOS packaging in Phase 8.
- Define pilot age, parent-consent, coach-approval, retention, deletion, recovery, and reporting policies.
- Decide whether student direct messages are disabled, coach-supervised, or enabled under a documented policy.
- Decide whether Questions and Videos are team-private, signed-in community content, or mixed by item.
- Define file type, file-size, media, retention, and export limits.
- Define the configurable scoring model and how season-specific scoring content is maintained.
- Define moderation staffing and the one-business-day response target.

## Deliverables

- Repository structure and environment configuration.
- React application shell and route strategy.
- Node.js functions/API structure.
- Firebase project configuration for development and test environments.
- CI checks for lint, type-check, unit tests, and production build.
- Written decisions for every item above.

## Exit criteria

- A new developer can run the web app and Firebase emulators locally.
- Development secrets are not committed.
- CI passes on a clean checkout.
- The unresolved decisions are either closed or explicitly marked as pilot blockers.

## Codex prompt

> Read `FIRST_PIT_PHASE_PLAN.md` and this phase file. Inspect the repository. Set up the React, Node.js, Firebase, and Capacitor-compatible project structure without implementing feature modules. Configure local Firebase emulators, environment handling, linting, type-checking, tests, and Vercel build compatibility. Create a decision record for the open product and youth-safety decisions. Do not invent policy answers; mark unresolved decisions as blockers. Run all checks and report the result.

