# Phase 4 — Team Chat and Announcements

## Goal

Provide safe, team-scoped communication with channels, announcements, search, reporting, and notification integration.

## Scope and source requirements

- CHAT-01 through CHAT-07.
- Related notification requirements NOTIF-01 through NOTIF-05.
- Related safety/moderation requirements from Section 6.

## Implementation tasks

- Coach-created and archived channels.
- Text messages, mentions, reactions, threaded replies, timestamps, read state, and permitted file links.
- Announcements with acknowledgement support.
- Direct messages only according to the stored team/account safety policy.
- Authorized message search with pagination.
- Mute, report, retention, deletion, attachment limits, moderation access, and export behavior.
- Notification generation for mentions, direct messages, announcements, and replies.

## Exit criteria

- A member can post in an authorized channel and another member can find it through authorized search.
- A parent cannot see restricted student conversations.
- A reported message enters moderation workflow.
- Announcements are visually distinct and acknowledgement state persists.
- Mention and unread counts do not create duplicate notification storms.

## Codex prompt

> Implement Phase 4. Build team channels, messages, threads, reactions, mentions, read state, announcements, authorized message search, report/mute actions, retention controls, and notification integration. Enforce team policy for direct messages and attachments. Do not create public chat or broad community discovery. Add rules and integration tests proving private content isolation. Run all checks.

