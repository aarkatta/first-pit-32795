# First Pit — Architecture and Release Reference

This is the single reference for how First Pit is built and what gates a release.
It consolidates what were previously ten separate per-phase documents; the phase
numbering was an artifact of how the project was built, not a part of the design.

Product boundaries and non-goals live in `AGENTS.md`. Day-to-day conventions
(idempotency keys, versioning, testing layout) live in `CLAUDE.md`.

## Contents

- [Scope and roadmap](#scope-and-roadmap)
- [Foundational decisions](#foundational-decisions)
- [Identity, teams, and the authorization foundation](#identity-teams-and-the-authorization-foundation)
- [Roles, safety, and the authorization contract](#roles-safety-and-the-authorization-contract)
- [Coordination: tracker, goals, calendar, notifications, files](#coordination-tracker-goals-calendar-notifications-files)
- [Kanban project management (Release 1.1)](#kanban-project-management-release-11)
- [Chat and announcements](#chat-and-announcements)
- [Knowledge and polls](#knowledge-and-polls)
- [Scorer and practice history](#scorer-and-practice-history)
- [Dashboard, global search, and profile integration](#dashboard-global-search-and-profile-integration)
- [v1 launch hardening (2026-08-29)](#v1-launch-hardening-2026-08-29)
- [Hardening and pilot release runbook](#hardening-and-pilot-release-runbook)

---

## Scope and roadmap

**Source:** MVP requirements baseline, 08 August 2026 (`FLL_Community_Platform_Requirements.docx`).
**Stack:** React, Node.js, Firebase Authentication, Cloud Firestore, Firebase Storage, Cloud Functions, Capacitor, Vercel.

### MVP includes

Dashboard, Questions, How-to Videos, Polls, Scorer, Chat, Roles, Tracker, Storage Area, Calendar, Notifications, Profile Customization, and core safety/admin controls.

### Explicitly deferred

Public team discovery, public community feed, collaboration marketplace, full innovation-project workflow, advanced robot version/parts/maintenance logs, learning courses, external calendar synchronization, offline-first mode, large-scale reputation/social features, and features requiring unproven moderation capacity.

### Release 1.1

Kanban project management, richer statistics, file version history, parent dashboard, competition checklist, recurring task templates, curated official scoring content, and improved exports.

### Release 2

Public showcases, team profiles, expanded Q&A community, learning paths, event directory, innovation-project documentation, and advanced robot-practice analytics.

### Global engineering rules

- Use Firebase Auth for identity and session management.
- Use Cloud Firestore for application records and Firebase Storage for files/media.
- Use Node.js Cloud Functions or a server API for privileged operations, moderation, exports, notifications, and sensitive workflows.
- Enforce authorization in Firestore/Storage rules and server-side code. UI hiding is not authorization.
- Every feature needs loading, empty, error, permission-denied, retry/interrupted-network, and accessible states.
- Use team context on every team-owned record. Never trust a client-supplied team ID without validating membership.
- Avoid storing unnecessary child personal information, precise location, or private content in logs.
- Use cursor pagination and bounded queries. Do not load an entire season history into the client.
- Keep IDs and requirement IDs from the source document in implementation notes and tests.

### MVP completion test

A coach can create a team, invite members, assign work, schedule an event, share a file, communicate safely, run a poll, and record/review a practice or match score from the Dashboard. Each action respects role permissions and produces the correct notifications and audit records.

---

## Foundational decisions

Reviewed 2026-08-08. These were previously duplicated in a `src/content/phaseZero.ts`
module that no page consumed; this document is now the single record. When a
decision changes, update it here.

### Confirmed decisions

- **Firestore for the MVP database** — Cloud Firestore for collection-oriented
  team data and scoped records.
- **Web first, native-ready shell** — build the responsive web app first and keep
  the shell Capacitor-compatible.
- **Firebase emulator support** — keep Auth, Firestore, Storage, and Functions
  emulators in the repo for local development.

### Route strategy

- Use `BrowserRouter` for one shared route model across web and Capacitor.
- Let Vercel rewrite client-side routes to `index.html`.
- Keep native packaging focused on the same build output in `dist`.

### Open blockers

These remain blocked, not assumed, until product and safety owners make an
explicit decision. When one is resolved, record the decision and date here.

| Blocker | Still undecided |
| --- | --- |
| Youth safety policy | pilot age, parent consent, coach approval, retention, deletion, recovery, reporting |
| Direct messaging policy | disabled, coach-supervised, or a documented policy before implementation |
| Content audience policy | team-private, signed-in community content, or mixed by item |
| File and media limits | type, size, retention, export limits |
| Scoring and moderation | season scoring model, content maintenance, moderation staffing, one-business-day response target |

### Startup boundaries

- Firestore and Storage rules are deny-by-default; the real authorization model
  layers on top of that baseline.
- Firebase client initialization is an explicit startup boundary in
  `src/main.tsx`. It validates configuration and connects optional emulators;
  it does not add authentication flows or feature data access.
- Emulator ports remain owned by `firebase.json`; `.env.example` provides the
  client-side values that must match that runtime configuration.

### Setup exit criteria

- A new developer can run the web app and Firebase emulators locally.
- Development secrets stay out of source control.
- CI passes on a clean checkout.
- Open decisions are documented as blockers instead of silently assumed.

---

## Identity, teams, and the authorization foundation

This layer implements PROFILE-01, PROFILE-05, PROFILE-06, the shared team
context, and the authorization/audit foundation.

### Records and ownership

The minimum Firestore collections are:

- `users/{uid}` — the authenticated account profile.
- `teams/{teamId}` — the team identity and creator.
- `memberships/{teamId}_{uid}` — the validated team boundary, role, and status.
- `teamPolicies/{teamId}` — explicit foundation policy defaults.
- `auditEvents/{eventId}` — server-generated sensitive-operation records.
- `notificationPreferences/{uid}` and `privacySettings/{uid}` — user-owned settings.

The client bootstraps a newly authenticated user's private profile, and the
server-side `createTeam` callable repairs or merges that profile while writing
the initial team, coach membership, policy, settings, and `team.created` audit
event in one Firestore transaction. Clients cannot create, update, or delete
audit events.

### Authorization boundary

The client uses the current Firebase Auth session only to select the user and
request team data. Firestore rules require an `active` membership document whose
`teamId`, `userId`, and path all agree. Storage reads use the same membership
check. Future feature records are deny-by-default until their phase adds
validated writes and role-specific authorization. Foundation policy documents
are server-controlled until the Phase 2 safety and membership decisions are
audited. Membership documents are private to the member and platform admins;
roster visibility is deferred. The phase-1 team context enforces a documented
maximum of 50 active team memberships and fails explicitly above that bound
instead of hiding authorized teams.

The shared TypeScript utilities in `src/lib/domain.ts` are UI and service
guards; they never replace Firestore rules or server-side authorization.

### Explicitly deferred policy

The foundation records `deferred` policy values only; no feature interprets
parent visibility, membership approval, content audience, or direct messaging
until the open Phase 0 and Phase 2 decisions are closed. File writes remain
disabled until Phase 3 finalizes file type, size, audience, retention, and
moderation policy. No public team discovery or social feed is enabled.

### Verification

`tests/emulator-verification.mjs` creates two Auth emulator users, calls the
server-side team bootstrap, verifies profile and policy boundaries, checks
authorized and cross-team Firestore reads, verifies the bounded active-membership
query excludes inactive records, checks the generated audit event, and verifies
team-scoped Storage access. Run it through:

```bash
npx firebase emulators:exec --project demo-first-pit-ci --config firebase.json \
  --only auth,functions,firestore,storage "node tests/emulator-verification.mjs"
```

---

## Roles, safety, and the authorization contract

Phase 2 keeps authorization on the server and in Firestore rules. The client
only presents controls for the active team and never writes membership,
policy, report, moderation, or audit documents directly.

### Role matrix

| Role | Team read | Request membership | Invite/approve/manage | Assign roles/policy | Moderate/audit |
| --- | --- | --- | --- | --- | --- |
| Student | own active team | yes, when policy allows | no | no | report only |
| Parent | own active team | no default | no | no | report only |
| Mentor | own active team | no default | no | no | report only |
| Coach | team roster | no default | yes | yes | yes |
| Team Leader | team roster | no default | yes | yes | yes |
| Platform Admin | all authorized records | administrative override | yes | yes | yes |

Platform Admin is a Firebase Auth `platformAdmin == true` custom claim. Claim
issuance and revocation remain an operational responsibility; clients do not
edit claims.

### Safe policy defaults

New teams are created with:

- `directMessaging: disabled`
- `discoverability: private`
- `contentAudience: teamOnly`
- `fileSharing: disabled`
- `parentVisibility: none`
- `membershipApproval: inviteOnly`

The only direct-message setting currently supported is explicit coach-only
messaging. Public discovery, public team profiles, and unsupervised minor
messaging are not enabled.

### Lifecycle invariants

- Membership IDs are deterministic: `{teamId}_{userId}`.
- Invitations are deterministic per team and normalized email; duplicate
  pending invitations fail atomically.
- Email-address invitations may be accepted only when the authenticated user's
  normalized email matches the invitation and Firebase Authentication reports
  that email as verified. A matching but unverified email cannot grant
  membership.
- Join requests are deterministic per team and user; approval atomically
  consumes the request and creates an active Student membership.
- Every sensitive mutation rechecks the actor and target inside its Firestore
  transaction and writes its audit record in the same transaction.
- A team must retain at least one active Coach or Team Leader. Leaving,
  removing, suspending, or demoting the final active coach is rejected.
- Audit, report, and moderation documents are immutable to clients.

### Privacy and safety

Profiles default to `teamOnly`, are not searchable, and cannot enable parent
visibility or private conversations through the Phase 2 client settings path.
Safety notifications are mandatory; email and push preferences cannot disable
the safety channel. Reports create a moderator-visible case with severity,
status, assignment, evidence reference, action, escalation, and audit history.

---

## Coordination: tracker, goals, calendar, notifications, files

Phase 3 adds team-scoped Tracker, Goals, Calendar, Notifications, and Storage
capabilities on top of the Phase 1 authentication and Phase 2 membership/safety
authorization model.

### Canonical data model

Privileged callable functions write the root collections below. The client can
read only bounded team-scoped pages through Firestore rules and indexed queries.

| Collection | Purpose |
| --- | --- |
| `tasks` | Tracker task state, assignment, checklist, labels, due date, and attachment IDs |
| `goals` | Team goals and progress counters |
| `events` | Recurring event master records |
| `eventOccurrences` | Materialized, deterministic event occurrences for bounded calendar reads |
| `notifications` | Recipient-isolated notifications with deterministic dedupe IDs |
| `taskHistory` / `taskComments` | Append-only server-created task history and comments |
| `fileMetadata` | Approved file name/type/size, Storage path, scan state, and task links |
| `folders` | Reserved team-only file folder metadata |

Release 1.1 extends this model with team-scoped `projects` records and adds
`projectId`, `columnId`, `orderKey`, `version`, and `completedAt` to tasks. See
the Kanban section below for the migration and card-movement
authorization contract.

Every Phase 3 record includes `teamId`. Mutations use callable Functions, re-
check current membership inside transactions, and reject client writes in
Firestore rules. `operationId` receipts and deterministic notification IDs make
retries safe for task commands and assignment notifications.

### Authorization and safety

- Students may read active-team coordination records and mutate only tasks
  assigned to them, including status, checklist, comment, and Kanban movement.
  They cannot mutate or move unassigned tasks or tasks assigned to another
  member.
- Parents and Mentors have team read access but cannot create or mutate tracker,
  goal, calendar, or file records.
- Coaches and Team Leaders manage tasks, goals, events, and uploads.
- Legacy project creation and task migration are controlled by Coaches and Team
  Leaders; other members cannot initiate or execute the migration.
- Platform Admin claims receive operational read access; notification records
  remain recipient-only to avoid private information disclosure.
- Team file uploads and reads require `teamPolicies/{teamId}.fileSharing ==
  "teamOnly"`; files are capped at 10 MB and restricted to an allowlist of MIME
  types. Storage paths are bound to the server-created metadata record. Creating
  the pending Storage object is restricted to the initiating uploader recorded
  in that metadata, and another active member cannot claim the pending upload.
  Pending files cannot be read.
- Direct messaging and public discovery are not enabled by Phase 3. The stored
  Phase 2 policy remains the source of truth.

### Bounded queries and retry states

Tasks, event occurrences, and notifications use 50-record limits and Firestore
indexes. Task pagination uses a cursor (`startAfter`) rather than loading an
entire season. The UI includes loading, empty, permission, offline, error, and
retry states. Mutations send operation IDs where supported; notification IDs are
derived from recipient, team, and event key so repeated retries do not duplicate
notifications.

### Explicit deferrals

External calendar synchronization and full file version history are deferred.
Current uploads are single-version metadata records with lifecycle states
`pending`, `ready`, and `deleted`; a future phase can add version records and
external provider adapters without changing the team authorization boundary.

---

## Kanban project management (Release 1.1)

### Goal

Upgrade the Phase 3 Tracker into private, team-scoped Kanban project management
without enabling public collaboration or the deferred innovation-project
workflow.

### Dependencies and boundaries

- Phase 8 pilot gates remain the prerequisite for Release 1.1 deployment.
- A team may have up to 10 active projects, each with 2–8 columns.
- Projects remain private to one team and archived rather than deleted.
- Dependencies, estimates, workload views, automations, recurring templates,
  WIP limits, public projects, and dedicated innovation stages remain deferred.

### Implemented behavior

- Multiple project boards with coach/team-leader creation and archival.
- Configurable column names, ordering, colors, and a protected completion
  designation. The completion column may change only while a board is empty.
- Ordered Kanban cards with pointer, touch, keyboard, and explicit select-menu
  movement controls.
- Active students may move only cards assigned to them; coaches and team
  leaders may move any card. Parents and mentors are read-only. This is
  enforced server-side in `functions/src/kanban.ts` (`moveTaskCard`) and
  mirrored client-side by `canMoveKanbanTask` in `KanbanBoard.tsx`.
- Coach-managed task title, description, priority, assignment, labels, and due
  date details.
- Two board views over the same data, toggled from the board toolbar: the
  column Kanban view (`KanbanBoard.tsx`) and a Main Table view
  (`src/features/kanban/BoardTable.tsx`) with status, person, priority,
  timeline, label, and file columns plus per-group summary rows.
- `src/features/kanban/BoardToolbar.tsx` owns view switching, grouping (by
  column, person, priority, due window, or label), sorting, column hiding, and
  bulk selection with bulk move. The grouping, sorting, and timeline maths live
  in `src/lib/board-view.ts`, which is pure and unit-tested.
- Text, priority, assignee, label, and due-date filters.
- Live bounded column subscriptions, optimistic movement, conflict rollback,
  task history, audit records, goal completion counters, and deduplicated
  watcher/assignee notifications.

### Data and authorization model

`projects` records contain `teamId`, project metadata, an ordered bounded column
array, `completedColumnId`, and archival state. Tasks add `projectId`,
`columnId`, numeric `orderKey`, integer `version`, and `completedAt`.

All mutations use callable Functions. Firestore rules allow active team members
to read projects and tasks but deny direct writes. Card moves re-check current
membership, project/team ownership, expected card version, adjacent card IDs,
and target-column capacity inside a transaction. Movement notifications use
operation-derived IDs so retries cannot create duplicates.

`ensureDefaultProject` is idempotent. It creates a deterministic Team Board and
maps legacy `todo`, `inProgress`, `review`, and `completed` tasks into compatible
columns with stable initial ordering and versions. Its server-owned cursor and
per-column counts make multi-page migration resumable without duplicate order
keys or client-selected gaps.

Project and card limits are enforced transactionally rather than only in the
client. The same 50-card boundary used by live column subscriptions is checked
for legacy creation, Kanban creation, cross-column moves, and same-column
reordering so a successful write cannot create a hidden 51st card.

### Verification and exit criteria

- Unit coverage passes for legacy mapping, ordering, bounded constants, query
  scoping, parsing, and callable routing.
- Rules/emulator coverage proves project read isolation and direct-write denial.
- Coach, student, mentor, and parent role behavior matches the authorization
  model above.
- Concurrent stale moves fail with an explicit conflict and the client restores
  the confirmed card position.
- Dashboard completion counts, goal counters, search links, task history,
  notifications, and legacy Tracker data remain compatible.
- `npm run lint`, `npm run typecheck`, `npm test`, `npm run functions:build`,
  relevant emulator suites, and `npm run build` pass.

After these criteria pass, the next roadmap decision is whether Release 1.1
should add recurring task templates or keep further planning features deferred.

### Verification record — 24 August 2026

Static checks pass locally; the emulator suites below require the Firebase
emulator binaries and were last confirmed on 09 August 2026.

- `npm run lint`
- `npm run typecheck`
- `npm test` — 42 files and 215 tests passed
- `npm run functions:build`
- `npm run build`
- `npm run test:release`
- `npm run test:rules:phase3`
- `npm run test:phase3-emulator`
- the combined Auth, Functions, Firestore, and Storage emulator verification
  command documented in `README.md`

The emulator role matrix covers coach and student movement, stale-version
`ABORTED` responses, mentor and parent `PERMISSION_DENIED` responses, direct
write denial, legacy migration, and linked-goal counters. Deployment remains
blocked until the manual Phase 8 product/safety approvals and pilot gates are
accepted; this verification record does not substitute for those approvals.

---

## Chat and announcements

Phase 4 keeps communication inside active team memberships. `channels`, `messages`, and `announcements` are team-owned records. Team channels are readable by active members, coach channels by coaches/team leaders, and direct channels are only available when the stored policy is `coachesOnly` and all participants are coaches. There is no public chat or discovery path.

All writes go through callable Functions. Functions validate membership, channel visibility, policy, mentions, approved file metadata, participant roles, and bounded input sizes before writing. Message mutations are transactional and idempotent when callers provide stable IDs/operation IDs. Reactions are bounded per emoji, messages are soft-deleted, and `purgeExpiredMessages` applies the stored 30/90/365-day retention control.

Notifications are server-created with deterministic recipient/team/event keys. Mentions, replies, direct messages, and announcements therefore do not create duplicate notification storms. Read state and mute state are user-owned records. Reports use the Phase 2 moderation workflow and keep message content out of logs.

Verification covers callable integration for channels, threads, reactions, mentions, notifications, announcements, acknowledgements, authorized search, reporting, read/mute state, direct-message policy, and attachment denial. Rules integration proves team, coach-only, direct, announcement, read-state, and forged-write isolation.

---

## Knowledge and polls

Phase 5 stores Questions, How-to Videos, and Polls in top-level Firestore collections. Every content record carries an explicit `visibility` of `team` or `community`. Team records carry a `teamId`; community records carry `teamId: null` and can only be created by an approved community publisher.

### Authorization boundary

- While the community-content audience policy remains unresolved, community
  content is available only to signed-in users. This deny-first boundary does
  not approve public or anonymous access.
- Global question/video search is callable-only and adds `visibility == community` and `teamId == null` constraints. Team search requires an active membership and adds the team visibility constraints.
- Firestore rules independently enforce those visibility conditions for direct reads and list queries.
- Poll votes, saved questions, favorites, and watch history are written only through callable functions. Personal records are readable only by their owner; anonymous vote records are never directly readable.

### Records and safety

- Questions support categories, tags, bounded token search, answers, comments, votes, accepted answers, saved records, attachments by approved file IDs, reporting, and moderation status. Attachments are checked transactionally against ready, non-blocked team file metadata and cannot cross a team/community boundary.
- Videos use the required six categories, one validated external/storage source, source attribution, caption/transcript track metadata, related IDs, publication controls, favorites, watch history, and reporting.
- Polls use transaction-guarded one-vote-per-user documents, single/multiple choice validation, role audiences, anonymous mode, expiration, close-now, results visibility, aggregate counts, `pollHistory`, audit events, and deterministic notification IDs/deep links. Result aggregates are returned only through server-controlled output that enforces each poll's `resultsVisibility`; direct reads and list output must not bypass that setting.
- `remove-content` moderation actions update the referenced Phase 5 item, and the read rules hide removed questions/videos from subsequent access.

Acceptance and rules coverage lives in `tests/phase5-emulator-integration.mjs` and `tests/firestore-rules-phase5.integration.mjs`.

---

## Scorer and practice history

Phase 6 stores team scoring in the existing root-collection convention with a
`teamId` on every record:

- `scoreDefinitions`: immutable, team-owned mission and deduction definitions.
  New records are `sourceType: team-defined` and are labeled that way in the UI.
  `official-curated` is reserved for a platform administrator and is not
  presented unless an approved curated source exists.
- `scoreSessions`: practice or match records. Each record stores the server-
  calculated total and snapshots the scoring source metadata so later definition
  changes cannot rewrite history.
- `scoreSessionHistory`: append-only creation and correction records with actor,
  changed fields, and bounded before/after score snapshots.

The calculation is deterministic: `max(0, sum(earned mission points) - sum(applied
deduction points))`. Mission and deduction IDs and all point bounds are validated
against the selected definition on the server; clients cannot supply a trusted
total. Participants and linked events must be active members or events of the
same team.

Active team members can view history and record sessions. Coaches and team
leaders can manage definitions, correct sessions, and export CSV. Corrections
use an expected version compare-and-swap in a transaction; stale corrections are
rejected. Score history and audit records are not client-writable.

History/statistics and exports use the same team-scoped, bounded server query.
CSV columns are stable and formula-leading values are prefixed to prevent
spreadsheet formula injection. Advanced robot maintenance, parts, and version
logs are intentionally out of scope.

---

## Dashboard, global search, and profile integration

Phase 7 keeps the browser app as the team-scoped hub for the completed MVP
modules. The Dashboard reads a bounded, server-authorized summary for the
selected active team. Global search is a callable operation: it first resolves
the caller's active memberships and then searches only team Questions, Videos,
Messages, Files, Tasks, Goals, Events, Scores, and the team's own record.
Community/public discovery is intentionally excluded.

### Representative acceptance coverage

The `test:phase7-emulator` workflow covers these representative paths:

1. A coach creates a team and invites a student.
2. The student receives a role-aware dashboard with team-scoped task data.
3. Assignment notifications appear in the selected team summary.
4. A student can search authorized team messages.
5. Team Questions are searchable only inside the active membership boundary.
6. Published team How-to Videos appear in authorized search.
7. Team records are returned with type labels and internal deep links.
8. A second team's private record is excluded from the student's search.
9. Profile/account-sensitive workflows remain authenticated and team-independent.
10. Account deletion requests persist as a server-created, auditable workflow.

Dashboard notification links are normalized to known internal routes and map
legacy `/tracker` and `/calendar` links to the current coordination route.
Profile settings persist display name, picture URL, theme, accessibility
preferences, notification preferences, and the privacy-safe minor flag. Safety
notifications are always written as enabled.

---

## v1 launch hardening (2026-08-29)

A full-codebase audit before the v1 launch found defects across every layer.
What changed, and what it means for the contracts above.

### Contract changes callers must honour

These callables now reject requests that omit the new field. They are breaking
input changes, made deliberately: an idempotency key that is optional is not an
idempotency key, and an optimistic-concurrency check that is optional is not one
either.

| Callable | New required field |
| --- | --- |
| `createInvitation`, `assignTeamRole`, `updateMembershipStatus`, `transferTeamLeadership`, `createReport` | `operationId` (receipt in `phase2Operations`) |
| `createQuestion`, `createAnswer`, `createQuestionComment`, `createVideo`, `createPoll`, `votePoll`, `voteQuestion`, `acceptAnswer` | `operationId` (receipt in `phase5Operations`) |
| `sendMessage`, `createChannel`, `createAnnouncement` | `operationId` |
| `updateModerationCase` | `expectedVersion` (`moderationCases` now carry `version`) |
| `updateGoal` | `expectedVersion` (goals now carry `version`) |
| `updateProjectColumn`, `reorderProjectColumns`, `removeProjectColumn` | `expectedVersion` (projects now carry `version`) |

A missing stored `version` is read as 1, so existing documents keep working.

### Safety contract corrections

- **Parent visibility is now enforced.** `parentVisibility` was defined,
  validated, and stored, but read by no authorization check: `canAccessChannel`
  returned `true` unconditionally for team channels, so parents read the entire
  team chat while the product promised the coach controlled that. Team-channel
  access for role `parent` is now gated on the policy, deny-by-default, and
  parents are neither notified about nor mentionable in a channel they cannot
  read. The duplicated copy of that logic in `phase7.ts` was deleted in favour of
  importing the phase-4 implementation so the two cannot drift again.
- **The file scan gate is now real.** `createFileMetadata` wrote
  `scanStatus: 'notConfigured'` once and nothing ever changed it, so the
  `blocked`/`clean` states were unreachable and `storage.rules` gated nothing.
  The lifecycle is now `pending` on create and `clean` on
  `completeFileUpload`, and `storage.rules` accepts only `clean` for reads.
- **`photoURL` is validated.** It was type-checked but unbounded and
  scheme-free, so a `javascript:` or `data:` URL could be stored and rendered.
  It is now https-only and length-capped.
- Moderation deletions, privacy-settings changes, and minor-status changes now
  write the `auditEvents` records the charter requires.

### Client changes worth knowing

- `listTeamMembers` (new callable, `src/lib/directory.ts`) resolves team member
  display names server-side. `users/{uid}` is readable only by its owner, which
  is correct for a product used by minors, but it meant every screen rendered
  raw Firebase UIDs — including a task assignee field that required pasting a
  28-character UID. Names now come from this one place.
- Invitations became a real flow. `acceptInvitation`, `revokeInvitation`,
  `requestToJoinTeam`, and `leaveTeam` had live callables and no UI at all, so a
  team could never gain a second member. `/join` is the acceptance route.
- The Storage Area exists. Uploads previously succeeded and then became
  invisible, because nothing ever queried `fileMetadata`.
- Q&A answers exist. `createAnswer`, `createQuestionComment`, `voteQuestion`,
  and `acceptAnswer` were all reachable on the server and unreachable in the UI.
- `searchQuestions` and `searchVideos` applied `where()` after `startAfter()`,
  which the Firestore SDK rejects — page 2 of either search was a hard 500.

### Retention, upload inspection, and scoring content

- **Retention is enforced on a schedule.** `enforceMessageRetention`
  (`onSchedule('every 24 hours')`) walks every team policy and purges one page
  per team per run, so `messageRetentionDays` no longer depends on a coach
  opening team settings. One team's failure is logged and does not stop the
  others, and no message body is ever logged. The coach-invoked
  `purgeExpiredMessages` callable remains for clearing a backlog immediately;
  both share `purgeExpiredMessagesForTeam`.
- **Uploads are inspected byte-for-byte.** `contentType` is chosen by the
  browser, and `storage.rules` compares an upload's content type against that
  same client-supplied value — so that check only ever proved
  self-consistency. `completeFileUpload` now reads the leading bytes and
  confirms they match the declared type (`detectContentMismatch`); a mismatch
  marks the record `blocked` and rejects the completion, so the object stays
  unreadable even though it is already in the bucket. This is a format check,
  not an antivirus scan — `scanStatus` remains the hook a real scanner would
  set, and `blocked` is now reachable.
- **Scoring content is team-defined by design.** The season's official mission
  list is FIRST's material and First Pit does not reproduce it; every
  definition is labelled `team-defined`. The Scorer ships a starter
  robot-game rubric a coach loads and renames, which is what makes the feature
  usable without a blank pipe-delimited textarea. The landing page describes
  the scorer as something you set up with the season's missions rather than
  claiming an official rubric.

### Known follow-ups

- No antivirus/malware scanning runs behind `scanStatus`. The gate and the
  `blocked` state are real; wiring a scanner is a matter of setting
  `scanStatus` from a scanning service instead of from `completeFileUpload`.
- Documents written before this change keep `scanStatus: 'notConfigured'` and
  are no longer downloadable. There is no production data yet, so no migration
  was written.

---

## Hardening and pilot release runbook

This runbook is the release gate for the First Pit MVP. It keeps the pilot
private, team-scoped, and reversible. It does not enable public team discovery,
public community feeds, unsupervised student direct messaging, broad file
access, external calendar sync, or innovation-project workflows.

### Release checks

Run from a clean checkout with Node 24 and npm 11.4.2:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --coverage
npm run functions:build
npm run build
npm run test:release
```

Then run the rules and emulator suites listed in `README.md`. The web build must
use production Firebase configuration with `VITE_USE_FIREBASE_EMULATORS=false`.
The parser rejects emulator mode whenever Vite builds with `MODE=production`.

### Responsive and accessibility matrix

Smoke-test the Dashboard, Auth, Team hub, Coordination, Chat, Knowledge,
Scorer, Search, Profile, and Team admin routes at:

| Profile | Viewport | Required checks |
| --- | --- | --- |
| Desktop | 1280×800 | navigation, two-column cards, tables, keyboard focus |
| Tablet | 768×1024 | stacked shell, readable cards, no horizontal page overflow |
| Mobile | 375×812 | single-column cards, 44px controls, safe-area padding, touch navigation |

For each route, verify loading, empty, error/retry, permission denied, and
offline/interrupted-network states. Use the skip link, keyboard-only navigation,
visible focus rings, labelled form controls, and screen-reader announcements for
state panels. A user must never lose unsaved profile text just because the
network changes state.

### Capacitor iOS

The web bundle remains the source of truth. Native packaging is only a shell:

```bash
npm run build
npm install
npx cap add ios
npx cap sync ios
npx cap open ios
```

`capacitor.config.ts` uses `dist` and automatic iOS content insets. The web
viewport includes `viewport-fit=cover`, and CSS consumes the safe-area inset
variables. The current MVP requests no camera, location, contacts, photo
library, or push permissions. File selection uses the browser/WebView picker;
do not add native permission prompts without an approved feature and privacy
review.

Deep links remain internal paths such as `/coordination?task=...` and
`/chat?channel=...`. Universal Links/App Links require a real production domain,
associated-domain entitlements, and an Apple developer signing profile, so they
are a pilot deployment task rather than a local emulator assumption.

### Pilot policy gate

Every unresolved Phase 0 or Phase 8 safety and pilot policy is a release
blocker. Until each decision has explicit, dated approval from its product and
safety owner and is reflected in the relevant rules, server behavior, and
tests, real-youth pilot use is prohibited and rehearsal remains synthetic-only.
Documentation of a proposed behavior is not policy approval.

Before inviting a real team, the product and safety owners must sign off on:

- parent visibility and parent-consent handling;
- coach approval and membership removal;
- youth reporting, moderation escalation, and retention duration;
- direct-message policy, which remains coach-only or disabled;
- team-only file/media audience and deletion/recovery behavior;
- scoring corrections, exports, and audit access;
- support ownership and emergency escalation.

If any item is not approved, the pilot is blocked. Do not work around an open
policy decision in the client.

### Rehearsal accounts and workflow

Use synthetic accounts only:

1. Coach creates a private team and confirms baseline deny-first policies.
2. Coach invites one student, one parent, and one mentor.
3. Student confirms only assigned work, permitted team content, and safe empty
   states are visible.
4. Coach creates a task, goal, event, team-only file, announcement, poll, and
   practice score from the Dashboard workflow.
5. Parent and mentor confirm their role-specific visibility and cannot access
   coach-only administration or private conversations.
6. Suspend the student, retry reads and writes, and confirm access is denied.
7. Report a test content item, resolve it as the coach, and verify the audit
   record without exposing private message contents in logs.
8. Export a test score or message report, verify the authorized recipient, then
   delete the rehearsal data according to the retention policy.

Record route, role, expected result, actual result, timestamp, and screenshot in
the pilot evidence log. Never use real child names, emails, locations, or
production files in rehearsal data.

### Monitoring and incident response

Monitor Functions error rate, callable permission-denied spikes, Auth failures,
Firestore/Storage latency, emulator-disabled production builds, and client
uncaught errors. Assign one support owner and one safety escalation owner before
pilot start.

For an incident:

1. Stop new invitations and disable the affected pilot cohort.
2. Preserve timestamps, request IDs, audit IDs, and safe error summaries. Do not
   copy private content or child data into tickets.
3. Reproduce against an emulator fixture, not production records.
4. If authorization or privacy is involved, revoke sessions and suspend the
   affected team before investigating access.
5. Roll back to the last verified Vercel deployment, then document the decision.
6. Notify the safety owner, affected coach, and support owner using the approved
   escalation channel.

### Rollback and retention

Rollback means selecting the last verified Vercel deployment and, if needed,
reverting the Functions deployment to the last verified revision. Do not delete
Firestore data as a rollback action. Deletion requests are server-created and
audited; fulfilment requires the approved retention and recovery policy.

Pilot cohort size, success metrics, and retention duration remain explicit
product-owner decisions. Until accepted, the pilot is not ready for real youth
data.
