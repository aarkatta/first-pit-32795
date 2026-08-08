# Phase 5 — Questions, How-to Videos, and Polls

## Goal

Help teams learn, reuse knowledge, and make decisions without exposing private content by default.

## Scope and source requirements

- Questions: QST-01 through QST-07.
- Videos: VID-01 through VID-06.
- Polls: POLL-01 through POLL-06.

## Implementation tasks

- Questions with categories, tags, answers, comments, votes, accepted answers, saved questions, attachments, reporting, and visibility.
- Search/filter by keyword, category, tags, solved state, and recency.
- Video catalog with the required categories: Drivetrain, Programming, CAD, Electronics, Autonomous, Pit Tips.
- Video metadata, external source attribution, captions/transcripts, favorites, recently watched, related videos, reporting, and admin publication controls.
- Poll creation, audience targeting, choices, anonymous/non-anonymous mode, single/multiple choice behavior, expiration, close-now, results visibility, history, and audit history.
- Notification deep links for polls without duplicates.

## Exit criteria

- A student searches and saves a programming question, signs in later, and sees it in Saved Questions.
- A student watches and favorites a CAD video and sees Favorites/Recently Watched.
- A coach creates an anonymous poll; eligible users vote according to rules and only authorized users see results.
- Private team questions are not returned to unauthorized searchers.
- Admin can publish/unpublish/moderate video records.

## Codex prompt

> Implement Phase 5. Build Questions, How-to Videos, and Polls with team/community visibility as an explicit per-item policy. Include search, saved/favorite/recently-watched records, moderation/reporting, captions/transcripts metadata, poll vote constraints, results visibility, expiration, audit history, and notification links. Do not expose private team content through global search. Add acceptance and authorization tests.

