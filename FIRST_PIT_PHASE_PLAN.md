# First Pit — Codex Implementation Phase Plan

**Source:** `FLL_Community_Platform_Requirements.docx`  
**Baseline:** MVP requirements, 08 August 2026  
**Product:** First Pit Team Hub for FLL students, coaches, mentors, and parents  
**Stack:** React, Node.js, Firebase Authentication, Cloud Firestore, Firebase Storage, Cloud Functions, Capacitor, Vercel

## How Codex should use this plan

Implement one phase at a time. Do not begin a later phase until the current phase's exit criteria pass. For every phase:

1. Inspect the existing code before changing it.
2. Preserve unrelated user changes.
3. Update the data model, security rules, server-side authorization, UI, tests, and documentation together.
4. Run the relevant tests and build checks.
5. Report completed work, remaining issues, and the exact next phase.

## Product boundaries

### MVP includes

Dashboard, Questions, How-to Videos, Polls, Scorer, Chat, Roles, Tracker, Storage Area, Calendar, Notifications, Profile Customization, and core safety/admin controls.

### Explicitly deferred

Public team discovery, public community feed, collaboration marketplace, full innovation-project workflow, advanced robot version/parts/maintenance logs, learning courses, external calendar synchronization, offline-first mode, large-scale reputation/social features, and features requiring unproven moderation capacity.

### Release 1.1

Richer statistics, file version history, parent dashboard, competition checklist, recurring task templates, curated official scoring content, and improved exports.

### Release 2

Public showcases, team profiles, expanded Q&A community, learning paths, event directory, innovation-project documentation, and advanced robot-practice analytics.

## Phase dependency map

| Phase | Name | Depends on |
|---|---|---|
| 0 | Product decisions and project setup | None |
| 1 | Platform foundation and data model | 0 |
| 2 | Team membership, roles, and safety | 1 |
| 3 | Tracker, Calendar, Notifications, and Storage | 2 |
| 4 | Team Chat and announcements | 2, 3 |
| 5 | Questions, How-to Videos, and Polls | 2, 3 |
| 6 | Scorer and practice history | 2, 3 |
| 7 | Dashboard, search, profile, and cross-module integration | 3, 4, 5, 6 |
| 8 | Hardening, responsive QA, Capacitor iOS, and pilot | 7 |

## Global engineering rules

- Use Firebase Auth for identity and session management.
- Use Cloud Firestore for application records and Firebase Storage for files/media.
- Use Node.js Cloud Functions or a server API for privileged operations, moderation, exports, notifications, and sensitive workflows.
- Enforce authorization in Firestore/Storage rules and server-side code. UI hiding is not authorization.
- Every feature needs loading, empty, error, permission-denied, retry/interrupted-network, and accessible states.
- Use team context on every team-owned record. Never trust a client-supplied team ID without validating membership.
- Avoid storing unnecessary child personal information, precise location, or private content in logs.
- Use cursor pagination and bounded queries. Do not load an entire season history into the client.
- Keep IDs and requirement IDs from the source document in implementation notes and tests.

## MVP completion test

A coach can create a team, invite members, assign work, schedule an event, share a file, communicate safely, run a poll, and record/review a practice or match score from the Dashboard. Each action respects role permissions and produces the correct notifications and audit records.

