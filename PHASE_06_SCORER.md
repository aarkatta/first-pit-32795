# Phase 6 — Scorer and Practice History

## Goal

Allow teams to record practice and match performance, calculate totals, review history/statistics, and export authorized records.

## Scope and source requirements

- SCORE-01 through SCORE-08.
- Related file-linking, notification, audit, and role requirements.

## Implementation tasks

- Configurable team-defined scoring content with season/source metadata.
- Match and practice scoring sessions.
- Missions, points, penalties/deductions, completion state, notes, participants, run time, robot/program context, and total calculation.
- Corrected score activity history.
- History filters by date, event, score type, and team.
- Totals, averages, best score, completion rate, mission trends, and session-type trends.
- CSV or readable report export for authorized users.

## Exit criteria

- A team records a practice score and the total is calculated deterministically.
- Score history and statistics show the session correctly.
- A correction retains who changed what and when.
- Unauthorized users cannot view or export team scores.
- Export contains no data outside the requesting user's authorized team scope.

## Codex prompt

> Implement Phase 6. Build configurable team-defined scoring, match/practice sessions, mission points, deductions, notes, participants, history, statistics, correction audit records, and authorized CSV/report export. Clearly label team-defined scoring content unless an official curated source exists. Add deterministic calculation tests and permission tests. Do not implement advanced robot maintenance/version logs.

