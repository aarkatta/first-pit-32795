# Phase 2 — Team Membership, Roles, Privacy, and Safety

## Goal

Allow a coach to create and safely administer a team while protecting minors and private team content.

## Scope and source requirements

- Role requirements: ROLE-01 through ROLE-06.
- User roles: Student, Coach, Mentor, Parent, Platform Admin.
- Youth-safety and moderation requirements from Section 6.
- Profile privacy and notification defaults: PROFILE-03, PROFILE-04, PROFILE-06.

## Implementation tasks

- Team creation and team settings.
- Invitation, join request, approval, rejection, removal, and leave-team flows.
- Role assignment with plain-language permission explanation.
- Sole-coach transfer protection.
- Team policy controls for direct messages, file sharing, profile visibility, discoverability, parent visibility, and membership approval.
- Report actions for users and future content types.
- Admin moderation queue with severity, assignment, status, evidence reference, action, escalation, and audit history.
- Safe defaults for minor accounts and mandatory safety/security notifications.

## Exit criteria

- Coach can create a team, invite a student, approve membership, and assign a role.
- Every role has tested allow/deny behavior.
- Parent cannot access private student conversations by default.
- A minor profile uses least-exposing defaults.
- A report becomes a moderation record and is visible to authorized admins.
- A sole coach cannot leave without transferring leadership.

## Codex prompt

> Implement Phase 2. Add team administration, invitations, join approvals, membership lifecycle, role assignment, team safety policies, privacy defaults, reporting, moderation queue, and audit history. Use the authorization foundation from Phase 1. Add unit, integration, and Firestore rules tests for Student, Coach, Mentor, Parent, and Platform Admin. Do not enable unsafe direct messaging or public discovery by assumption; use stored team policy. Run all checks.

