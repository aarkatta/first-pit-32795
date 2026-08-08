# Phase 7 — Dashboard, Search, Profile, and Cross-Module Integration

## Goal

Make Dashboard/Home the useful central hub and complete the shared experience across all MVP modules.

## Scope and source requirements

- Dashboard: DASH-01 through DASH-06.
- Profile: PROFILE-01 through PROFILE-06.
- Global search and navigation behavior from Section 4.
- All cross-module acceptance criteria in Section 10.

## Implementation tasks

- Dashboard activity summary, quick links, upcoming events, task/goal progress, scoring activity, unread messages, announcements, and role-specific cards.
- New-team empty states: invite members, create task, schedule event, start score.
- Team switcher and selected-team shell integration.
- Authorized global search across Questions, Videos, Messages, Files, and team records with clear type labels.
- Profile display name, picture, memberships, theme, accessibility preferences, privacy, notifications, password/session controls, deletion workflow, and child-data minimization.
- Deep links from notifications and dashboard cards.
- End-to-end pilot workflow.

## Exit criteria

- The MVP completion test passes from Dashboard.
- All ten representative acceptance criteria pass end-to-end.
- Dashboard cards respect role and team context.
- Global search returns only authorized records.
- Profile and notification settings persist across sessions and cannot suppress mandatory safety alerts.
- Empty, loading, error, denied, and interrupted-network states exist for every MVP module.

## Codex prompt

> Implement Phase 7. Integrate all completed modules into Dashboard/Home, team shell, global authorized search, Profile Customization, notification deep links, and role-specific empty states. Execute all representative acceptance criteria end-to-end. Audit every query and dashboard card for team scoping and authorization. Do not add deferred public community or innovation-project features.

