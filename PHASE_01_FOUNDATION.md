# Phase 1 — Platform Foundation, Authentication, and Data Model

## Goal

Build the identity, team-context, Firestore model, shared authorization primitives, and audit foundation required by every module.

## Scope and source requirements

- Account/Profile foundation: PROFILE-01, PROFILE-05, PROFILE-06.
- Team context and navigation behavior from Section 4.
- Core entities from Section 8: Account/Profile, Team, Membership, Task/Goal, File/Folder, Event/Notification, Question/Answer, Video/Category, Poll/Vote, Score Session/Attempt.
- Server-side authorization, encryption, audit logs, privacy, observability, and scalability requirements from Sections 6–7.

## Implementation tasks

- Firebase Authentication with protected routes and session handling.
- Firestore collections and indexes for users, teams, memberships, and audit events.
- Team context provider and team switcher foundation.
- Shared authorization functions: authenticated user, team member, role, coach/leader, platform admin.
- Firestore and Storage rules with emulator tests.
- Audit event helper for invitations, role changes, membership changes, administrative actions, and sensitive updates.
- Common UI states, error boundary, retry handling, responsive shell, and accessible primitives.
- Observability hooks that avoid logging private message/file content.

## Minimum collections

`users`, `teams`, `memberships`, `teamPolicies`, `auditEvents`, `notificationPreferences`, `privacySettings`.

## Exit criteria

- A user can sign up/sign in/sign out and recover an account.
- A signed-in user can see only teams for which an authorized membership exists.
- Firestore and Storage emulator tests prove unauthorized reads/writes fail.
- Team-scoped queries cannot cross team boundaries.
- Audit events are generated for sensitive administrative operations.

## Codex prompt

> Implement Phase 1 from `FIRST_PIT_PHASE_PLAN.md`. First inspect existing code and preserve unrelated changes. Build Firebase Authentication, the Firestore foundation collections, team context, shared role/permission utilities, Firestore/Storage security rules, emulator tests, audit logging, common UI states, and responsive application shell. Do not implement Tracker, Chat, Questions, Videos, Polls, Scorer, or full Dashboard yet. Keep authorization server-side and rule-enforced. Run tests, type-check, lint, and build.

