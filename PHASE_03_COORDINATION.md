# Phase 3 — Tracker, Calendar, Notifications, and Storage

## Goal

Deliver the daily coordination workflow: assign work, schedule time, share team materials, and notify the right people.

## Scope and source requirements

- Tracker: TRACK-01 through TRACK-07.
- Storage: STORE-01 through STORE-07, with version history treated as Release 1.1 unless feasible.
- Calendar: CAL-01 through CAL-06.
- Notifications: NOTIF-01 through NOTIF-06.

## Implementation tasks

- Tasks with owner, status, priority, due date, labels, checklist, comments, attachments, and completion history.
- Progress board with To Do, In Progress, Review, and Completed states.
- Team goals linked to tasks.
- Events for meetings, practices, competitions, deadlines, recurring events, reminders, and dashboard links.
- Notification records, preferences, deep links, unread counts, batching, deduplication, and mandatory alerts.
- Storage folders for CAD, code, images, documents, resources, and uploads.
- Upload validation, size/type limits, Storage rules, malware-scan integration boundary, previews, and linked-file references.
- Pagination, query indexes, and retry/sync states.

## Exit criteria

- Coach assigns a task and student can update permitted fields only.
- Task changes notify only relevant owners/watchers.
- Recurring practice appears in Calendar and Dashboard-ready queries.
- Permitted file uploads work; unauthorized users cannot download them.
- A task, event, or upload cannot be silently lost during a transient failure.
- Notification counts and deep links are consistent.

## Codex prompt

> Implement Phase 3. Build Tracker, Goals, Calendar, Notifications, and Storage using the Phase 1–2 team and authorization model. Include Firestore schema/indexes, Storage rules, bounded queries, retry states, notification deduplication, recurring events, task history, file metadata, and links between files and tasks. Treat external calendar sync and full file version history as deferred. Add tests for role access and the acceptance criteria. Run all checks.

