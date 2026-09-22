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
- [Coordination: tracker, goals, notifications, files](#coordination-tracker-goals-notifications-files)
- [Kanban project management (Release 1.1)](#kanban-project-management-release-11)
- [Chat and announcements (removed)](#chat-and-announcements-removed)
- [Knowledge and polls](#knowledge-and-polls)
- [Scorer](#scorer)
- [Dashboard, global search, and profile integration](#dashboard-global-search-and-profile-integration)
- [App shell and navigation](#app-shell-and-navigation)
- [Manage team](#manage-team)
- [Administration](#administration)
- [Landing page](#landing-page)
- [Authentication hardening](#authentication-hardening)
- [Calendar and Google Calendar integration (removed)](#calendar-and-google-calendar-integration-removed)
- [v1 launch hardening (2026-08-29)](#v1-launch-hardening-2026-08-29)
- [Hardening and pilot release runbook](#hardening-and-pilot-release-runbook)

---

## Scope and roadmap

**Source:** MVP requirements baseline, 08 August 2026 (`FLL_Community_Platform_Requirements.docx`).
**Stack:** React, Node.js, Firebase Authentication, Cloud Firestore, Firebase Storage, Cloud Functions, Capacitor, Vercel.

### MVP includes

Dashboard, Questions, Polls, Resources, Scorer (a link to FIRST's official scoresheet), Roles, Tracker, Storage Area, Notifications, Profile Customization, and core safety/admin controls. Chat, the calendar, How-to Videos and the team-defined scorer were built and later removed from the product; see their sections below.

### Explicitly deferred

Public team discovery, public community feed, collaboration marketplace, full innovation-project workflow, advanced robot version/parts/maintenance logs, learning courses, calendar and external calendar synchronization, team chat, offline-first mode, large-scale reputation/social features, and features requiring unproven moderation capacity.

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

A coach can create a team, invite members, assign work, share a file, run a poll, and open the official FIRST scoresheet from the Scorer page. Each action respects role permissions and produces the correct notifications and audit records.

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
- `teams/{teamId}` — the team identity and creator, plus an optional FIRST LEGO League `teamNumber` (1–8 digits, or null). It is set at creation (`createTeam`) or later by a coach or team leader together with the team name (`updateTeamDetails`, audited as `team.details.updated`), and shown after the name on Home and Manage team.
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

### Account types and who may create a team

A team role belongs to a membership; an **account type** belongs to the person
and decides one thing: who may create a team (decision of 2026-09-17).

- Sign-up asks "I am a: Coach / Mentor / Student / Parent". The value is stored
  as `users/{uid}.accountType` by the `setAccountType` callable only — the
  `users` rules pin the keys a client may write, so the browser cannot set or
  change it. It is set **once**; a later change is a Platform Admin action.
  Accounts created before sign-up asked have no type and are asked on the
  Create team page. It is self-declared, not verified.
- `createTeam` refuses, inside its transaction (`teamCreationRefusal` in
  `functions/src/phase2.ts`): an account with no type (`failed-precondition`),
  a student or parent account (`permission-denied`), and anyone who holds an
  active or pending **student or parent membership on any team**, whatever
  their account type — so an invited student cannot relabel themselves a coach.
  Platform Admins bypass it. The creator becomes the new team's `coach`.
- The client mirrors this (`canCreateTeams` / `mayOfferTeamCreation` in
  `src/lib/domain.ts`, `useAccountType` in `src/lib/account-type.ts`): "Create
  a team" and "Create another team" are never shown to students or parents, and
  `/teams/new` explains the refusal instead of showing the form.

### Team name and number

`teams/{teamId}` carries `name` (2–80 characters, whitespace collapsed;
`requireTeamName`) and an optional FIRST LEGO League `teamNumber` (1–8 digits or
null; `optionalTeamNumber`, both in `functions/src/phase2.ts`). Create team
offers the number as an optional field — teams are often numbered after they
register. Afterwards a coach or team leader edits both together from the Manage
team banner through `updateTeamDetails`, which re-checks the role inside its
transaction and writes a `team.details.updated` audit record; an empty number
clears it. Clients show "Name · Team #12345" (`teamNumberSuffix` in
`src/lib/domain.ts`) on Home and Manage team. Team documents reach the client
once per membership change, not live, so a successful save is applied locally
through `patchTeam` on the team context rather than waiting for a re-read.

### Team settings panel

Administration shows two team settings, each as an On/Off switch with its
current state (2026-09-19): **Team files** (`fileSharing`: `teamOnly` / `disabled`
— attachments on task cards are refused while off) and **Join requests**
(`membershipApproval`: `coachApproval` / `inviteOnly`). The panel used to be
"Private by design" with toggles for `directMessaging` and
`messageRetentionDays`; those fields outlived team chat, drive no feature, and
are no longer shown, though `updateTeamPolicy` still accepts them and stored
values are untouched. Discoverability is always private and has no setting.
Below the two switches, **Team messaging**, **Message history limit** and **Team
discovery** appear greyed out as "Coming soon" placeholders (`PLANNED_SETTINGS`
in `TeamAdminPage.tsx`): always Off, disabled, and wired to nothing. Making any
of them real is a product and youth-safety decision (public discovery is an MVP
non-goal in `AGENTS.md`).

### Administrative record

The **Audit history** panel (coaches and team leaders; the `auditEvents` read
rule already limits it to team admins) lists changes in plain language, newest
first — "Dana Ruiz changed Amir Khan's role from student to mentor" — with a
time on each line (2026-09-19). `describeAuditEvent` in `src/lib/audit-log.ts`
turns each record into one line, naming people from the roster ("Former member"
once they have gone) and invitees from the loaded invitations ("someone" for
older ones). Task, milestone and card edits (`kanban.task.*`, `task.*`,
`goal.*`) are audited too but left out as everyday board work; board setup,
settings, membership and moderation changes are listed. A safety report's
reporter is never named. The page reads 100 events, shows 10 at a time, and
"Show more" reads the next 100 with a `startAfter` cursor on the existing
`teamId` + `createdAt desc` index. Earlier the panel printed only a count.

### Safety reports

Every team question in the Knowledge base has **Report**. It opens a short form
(`ReportQuestionForm` in `KnowledgePage.tsx`): one required reason — Unkind or
bullying, Not appropriate for kids, Shares personal information, Something
else (`REPORT_REASONS` in `src/lib/safety-reports.ts`, stored as `reasonCode`) —
and an optional note of up to 500 characters (`description`). The reporter
sees "Thanks. Your coaches will take a look." Reports filed before
2026-09-19 carry `knowledge-content` and read as "No reason given".

Coaches work the queue in Manage team → **Safety reports**: the reported
question's title (read with `getDoc`, linked to `/knowledge?question=<id>`),
the reason, the note, and the date. The reporter is never named. **Keep and
resolve** sends `updateModerationCase` with `action: 'none'`; **Remove
question** asks once more, then sends `action: 'remove-content'`, which the
existing server path already turns into `moderationStatus: 'removed'` — the
rules then hide the question from every member. No new callable, rule or index
was needed.

### Task card attachments

A task card's **Attachments** section (2026-09-19) lets a coach or team leader
**Upload a file** straight onto the card: `uploadTeamFile` with
`linkedTaskIds: [taskId]`, so the existing `createFileMetadata` callable adds
the file to the team's files and to the card's `attachmentFileIds` in one
step, then `completeFileUpload` checks its bytes. The card shows progress and
a plain error for a wrong type or a file over 10 MB (`attachmentProblem` in
`src/lib/task-attachments.ts`, mirroring `ALLOWED_FILE_TYPES`). **Attach a team
file** still links an existing one. With **Team files** off the card says so
and points to Manage team → Team settings. A card holds at most 10 files
(`MAX_TASK_ATTACHMENTS`). Uploading stays coach/team-leader only because
`createFileMetadata` requires a team admin; students see the files but get no
upload control. No callable, rule or index changed.

### Invitations are links, not emails

First Pit sends no email for invitations — there is no mail provider.
`createInvitation` stores a pending invitation (normalized email, role, team
name, 7-day expiry, audit record) and returns its id; the coach sends the
invite link (`/join?invite=<id>`) themselves. Since 2026-09-21 invitations are
created only from **Manage team → ＋ Add a member**, when the address already
has an account; the dialog copies the link on creation, and Administration's
Invitations tab keeps **Copy link** on every pending invitation. The invitee must sign in as, and verify, the invited
address before `acceptInvitation` succeeds.

**Email invite (2026-09-18).** To save the coach retyping the message, the
Administration section offers **✉ Email invite with Gmail** under the
confirmation of a new invitation, and **Email invite** on every pending one.
Each opens Gmail's compose screen (`https://mail.google.com/mail/?view=cm&…`) in
a new tab, in whichever Gmail account the browser is signed in to, with the
recipient, subject ("Join <team> · Team #<n> on First Pit"), and body already
written: role, join link, the three sign-in steps, the 7-day expiry, and the
coach's display name. `src/lib/invite-email.ts` builds it (tested); the coach
presses Send, so the message comes from someone the family knows. The server
still sends nothing, stores nothing new, and needs no mail provider.
`inviteMailtoHref` (a `mailto:` link for non-Gmail users) exists but is not
shown — a second option confused coaches.

Sending real invitation emails from First Pit (for example Firebase's Trigger
Email extension, or Resend/Postmark with SPF/DKIM on first-pit.com) remains an
open product decision, not a bug: it needs a provider, DNS work, and a youth
safety decision, because many invitees are minors.

**Accepting.** `/join?invite=<id>` reads the invitation directly; the rule
admits the invited, verified address only. Two failure modes are handled:

- *Stale token.* Rules read `email_verified` from the ID token, and
  `user.reload()` does not refresh it, so a newly verified invitee kept a
  `false` claim for up to an hour and was told "This invitation is not for your
  account". `refreshVerificationStatus` now forces `getIdToken(true)` once the
  address is verified, and `JoinTeamPage` refreshes the token once and retries
  before reporting a permission error.
- *Wrong account.* If the read is still refused, the message names the address
  the invitee is signed in as, so a mismatch is obvious.

### Coach-provisioned member accounts (2026-09-21)

The second way onto a team, beside invitations. A coach opens **Manage team →
＋ Add a member**, gives a name, an email address (typed twice) and a role;
`provisionTeamMember` creates the Firebase Auth account with a generated
single-use password and returns it once. The coach passes the credentials on
from their own mailbox, and `PasswordSetupGate` makes the member replace the
password before they reach any team data.

Why it exists: the invitation flow asks the invitee to create an account,
verify their address and accept — three handoffs, and the middle one routinely
fails because Firebase's `noreply@<authDomain>` sender lands in spam (see
`authEmailSender`). A student stuck at the verification gate could not be
helped by anyone, because by design no coach held any lever over their account.

**What the design holds onto.**

- *The password is returned once and stored nowhere* — not in the
  `phase2Operations` receipt, not in the profile, not in a log line. A replay of
  the same `operationId` returns `temporaryPassword: null` and says to use
  **Reset password**. `CredentialsCard` copies to the clipboard and deliberately
  builds no URL: `invite-email.ts` can hand Gmail a pre-written compose screen
  because an invitation link is safe in a query string, and a live password is
  not — it would land in the coach's browser history.
- *An address that already has an account is refused* (`already-exists`, with a
  message pointing at invitations). Attaching someone's existing personal
  account to a team without them acting is what the invitation flow prevents,
  and that stays true.
- *A coach's reset reaches only accounts their own team created.*
  `resetTeamMemberPassword` requires `users/{uid}.provisionedByTeamId === teamId`
  and an active membership, so a coach can never take over the personal account
  of a mentor or parent who signed up themselves. Every reset writes an
  `administrative.action` audit event; the Firestore transaction commits before
  the Auth password changes, so a failure leaves an audited attempt rather than
  an untraceable password change.
- *`emailVerified` stays false.* Nobody proved the mailbox, and saying otherwise
  would be a claim First Pit cannot support. Only invitation reads require the
  claim (`firestore.rules`), so a provisioned member works everywhere else and
  still has to verify before accepting an invitation to a *second* team.
  `ProtectedRoute` exempts them from `EmailVerificationGate` on
  `provisionedByTeamId`, and puts `PasswordSetupGate` ahead of it.
- *The forced change is enforced server-side.* `setInitialPassword` refuses
  unless `mustSetPassword` is still set, and sets the password itself, so the
  flag cannot clear without the password really changing. The browser cannot
  write the flag (the `users` rules pin which keys an owner may touch).
- *`accountType` follows the coach's chosen role*, keeping a provisioned student
  a student for `teamCreationRefusal`.

**Known risks, accepted.** A mistyped address now produces a working account
whose credentials the coach is about to email, where under the invitation flow
the same typo was inert — the invitation simply became unreadable and expired.
The compensating controls are the confirm-address field and the **Has not
signed in yet** badge on the roster. And the password travels through two
mailboxes in plain text; the forced change limits, but does not remove, how
long it is useful.

**Open product decision.** Provisioning moves consent from the family to the
coach: no invitee acts, and the audit trail names the coach as the only actor.
COPPA's verifiable parental consent is not satisfied by either path today (the
invitation flow proves control of a mailbox, which may be the child's own), but
provisioning makes First Pit the party creating identities for minors on a third
party's say-so. Recording the coach's confirmation that the family agreed — a
checkbox written into the audit event, or making the parent's address the
provisioning field for students — is the cheap mitigation and is not built.

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

## Coordination: tracker, goals, notifications, files

Phase 3 adds team-scoped Tracker, Goals, Notifications, and Storage
capabilities on top of the Phase 1 authentication and Phase 2 membership/safety
authorization model.

### Canonical data model

Privileged callable functions write the root collections below. The client can
read only bounded team-scoped pages through Firestore rules and indexed queries.

| Collection | Purpose |
| --- | --- |
| `tasks` | Tracker task state, assignment, checklist, labels, due date, and attachment IDs |
| `goals` | Team goals and progress counters |
| `notifications` | Recipient-isolated notifications with deterministic dedupe IDs |
| `taskHistory` / `taskComments` | Append-only server-created task history and comments |
| `fileMetadata` | Approved file name/type/size, Storage path, scan state, and task links |
| `folders` | Reserved team-only file folder metadata |

Release 1.1 extends this model with team-scoped `projects` and
`projectTemplates` records and adds `projectId`, `columnId`, `orderKey`,
`version`, and `completedAt` to tasks. See
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
  goal or file records.
- Coaches and Team Leaders manage tasks, goals, and uploads.
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

### Work breakdown: milestones → categories → tasks → subtasks

Since 2026-09-17 the tracker is a single tree rather than two parallel grouping
dimensions:

```
1  Innovation project ready for the expert demo   milestone (a `goals` record)
   1.1  Problem research                          category (work package on the board)
        1.1.1  Define the problem                 task
               1.1.1.1  Interview a user          subtask
```

A category carries an optional `goalId`, validated against this team's goals
inside the same transaction that writes the category list. A card created in a
category inherits that milestone, and moving a card to another category moves it
to that category's milestone — unless the same edit names one explicitly, which
is the deliberate per-card override. The milestone counters stay per task, so
the existing transactional counting continues to work unchanged.

Templates never carry a milestone: a milestone is this team's and this season's,
and a stale one would point a seeded board at nothing. A category the importer
invents starts with none until a coach places it.

The table's default grouping is `milestone`, which renders each milestone as a
band over its categories with outline numbers (1, 1.1, 1.1.1) and progress
summed from every card beneath it. The UI calls these milestones throughout; the
Firestore collection stays `goals`, because renaming it would mean migrating
live data for no user-visible gain.

### Goals (the `goals` collection)

A goal is a team milestone with a title, description, target date, status
(`active` / `completed` / `archived`) and two counters, `taskCount` and
`completedTaskCount`. The counters are server-maintained: linking a card to a
goal, completing it, relinking it to another goal, or unlinking it adjusts them
inside the same transaction as the task write, so progress never needs its own
bookkeeping.

Until 2026-09-17 the client could only create a goal and list it. Nothing could
link a task to one and nothing called `updateGoal`, so every goal sat at `0/0`
and `active` forever, and the dashboard's "goals achieved" could never leave 0 —
the same working-callable-with-no-way-in shape v1 hardening found for
invitations and Q&A answers. The client now has all three: a Goal picker on the
task card (`listActiveTeamGoals`, bounded and read only while a card is open), a
Mark achieved / Reopen control that sends the goal's own version, and
description and target date on the create form, with progress shown as a bar.

### Bounded queries and retry states

Tasks, goals, and notifications use 50-record limits and Firestore
indexes. Task pagination uses a cursor (`startAfter`) rather than loading an
entire season. The UI includes loading, empty, permission, offline, error, and
retry states. Mutations send operation IDs where supported; notification IDs are
derived from recipient, team, and event key so repeated retries do not duplicate
notifications.

### Explicit deferrals

Full file version history is deferred.
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
- A team may have up to 10 active projects, each with 2–8 columns and up to 20
  categories.
- Projects remain private to one team and archived rather than deleted.
- A team may save up to 12 board templates, each carrying at most 40 cards.
- Dependencies, estimates, workload views, automations, recurring task
  templates, WIP limits, public projects, and dedicated innovation stages
  remain deferred. Board templates seed a new board once; they do not stay
  linked to the boards created from them.

### Implemented behavior

- Multiple project boards with coach/team-leader creation and archival.
- Configurable column names, ordering, colors, and a protected completion
  designation, edited from the toolbar's Board setup panel (hidden until asked
  for) rather than from a section always on the page. The completion column may change only while a board is empty.
- **Categories** — the board's own grouping of the work, in the monday.com
  sense, independent of the workflow columns. A category carries a name, a
  colour, and optionally one of the four judging areas. `updateProjectCategories`
  replaces the whole list in one coach-only call — add, rename, recolour, retag,
  reorder and remove — under the same `expectedVersion` check column edits use,
  and refuses to remove a category that still holds cards. A task carries
  `categoryId`, validated against its own board, so a category id from another
  board is a `not-found`. The judging area stays a task label, because that is
  what the dashboard counts; a category's `areaId` is the default for cards
  created in it, not a second source of truth. Boards written before categories
  existed read as having none, so no migration was needed.
- Ordered Kanban cards with pointer, touch, keyboard, and explicit select-menu
  movement controls.
- **Task editors** — coaches, team leaders and active students — add cards
  and edit any card's title, description, priority, assignment, category,
  milestone, labels, dates and subtasks, and move any card. Mentors and parents
  are read-only, except that a member assigned to a card may still progress its
  status, checklist and their own subtasks. Import, board setup, templates and
  attaching team files stay with coaches and team leaders. The role set is
  `TASK_EDITOR_ROLES` in `functions/src/phase2.ts` (`requireTaskEditor`,
  `assertTaskEditorInTransaction`, used by `createKanbanTask`, `moveTaskCard`
  and `updateTask`), mirrored client-side by `canEditTasks` in
  `src/lib/domain.ts` and `canMoveKanbanTask` in `KanbanBoard.tsx`. Students
  were limited to their own cards until 2026-09-17.
- **Subtasks** — up to 30 sub-items per card, stored in a `subtasks` array on
  the task itself rather than as a second collection of cards. That keeps a
  subtask edit atomic with its parent's `version`, keeps sub-items out of the
  per-column card budget, and needs no new collection, rules block or index;
  the trade-off is that a sub-item is not a board card and has no history of
  its own. Each carries a title, `todo`/`inProgress`/`done` status, an optional
  assignee and an optional due date. A coach edits the list (sent whole, with
  `expectedVersion`); a student sends only `subtaskStatus`, which is accepted
  when the card is assigned to them **or** the sub-item is, and which may not be
  combined with any other field. In the table a card's row expands to show its
  sub-items and carries a done/total badge.
- Grouping by category is the monday-style default in the table view; empty
  categories stay visible, and a "No category" group appears only when
  something is in it. Category is also a table column and a filter.
- One board screen: the Main Table (`src/features/kanban/BoardTable.tsx`) with
  category, status, person, priority, timeline, label, and file columns plus
  per-group summary rows. The separate Kanban column view and its Main
  Table/Kanban tabs were removed — one screen carries the project-management
  features, and grouping by status group gives the same column read with every
  field still visible. Cards still change column through the Status cell and by
  dragging rows between status groups.
- `src/features/kanban/BoardToolbar.tsx` owns the New item, Import from Excel
  and Board setup actions, grouping (by
  column, person, priority, due window, or label), sorting, column hiding, and
  bulk selection with bulk move. The grouping, sorting, and timeline maths live
  in `src/lib/board-view.ts`, which is pure and unit-tested.
- Text, priority, assignee, label, and due-date filters.
- Live bounded column subscriptions, optimistic movement, conflict rollback,
  task history, audit records, goal completion counters, and deduplicated
  watcher/assignee notifications.
- Board templates (`functions/src/kanban-templates.ts`) — **server-side only as
  of 2026-09-17.** The `ProjectTemplates` panel, the New project form and the
  archive control were removed from the Tracker page to keep it to one focused
  screen; `listProjectTemplates`, `createProjectFromTemplate`,
  `saveProjectAsTemplate`, `deleteProjectTemplate`, `createProject` and
  `archiveProject` remain deployed and tested, so restoring the UI is a client
  change. What the callables do: a coach starts a project from a
  built-in preset or a template the team saved from an existing board, and can
  save the current board — workflow, and optionally its cards — back as a team
  template. Built-in presets cover robot game, innovation project, season plan,
  and tournament prep as *process*; no template ships season content — the
  season's missions are FIRST's to publish. Preset cards carry a
  judging-area label (see the Dashboard section) so a seeded board feeds the
  per-area progress bars immediately.
- Spreadsheet task import (`functions/src/task-import.ts`, `TaskImportPanel`,
  `spreadsheet-reader.ts` and `template-workbook.ts` in `src/features/kanban/`,
  parsing rules in `src/lib/task-import.ts`): a coach uploads a `.xlsx` or
  `.csv` with a header row. Recognised columns are Type, Title (required),
  Description, Category, Area, Status, Priority, Assignee, Due date and Labels.
  The file is parsed in the browser — `read-excel-file` and `papaparse`, both
  loaded on demand — and previewed row by row. Only validated rows are sent to
  `importProjectTasks`; the file itself never leaves the device.
  - **Type** `Subtask` attaches a row to the task above it as a sub-item; a
    subtask row with no task above it is refused rather than guessed at.
  - **Category** is matched against the board's categories case-insensitively
    and created inside the import transaction when it is new, so one file can
    describe a season's structure as well as its work.
  - **Status** names a board column, matched by name or id; an unmatched value
    warns and falls back to the import's default column. Capacity is then
    checked per target column rather than once against the default.
  - **Assignee** is a display name or the address the member signs in with.
    Matching happens in the `resolveImportAssignees` callable (coach-only)
    because the address lives in Firebase Auth and `users/{uid}` is readable
    only by its owner; only the resolved id and display name come back, and an
    unknown or ambiguous value imports unassigned with the reason shown rather
    than blocking the row.
  - The **standard template** is a fixed file, `public/first-pit-task-template.xlsx`,
    authored by `npm run template:build` from `functions/src/data/fll-standard-task-list.json`
    — the team's own 12-week, 48-task plan across Project Mgmt & Core Values,
    Innovation Project, Robot Design and Robot Game. It is served statically, so
    every team starts from the same sheet and ExcelJS stays a devDependency
    rather than a ~937 KB browser download. `src/lib/task-template.test.ts`
    parses the shipped file through the importer — including the sheet choice —
    so a change to either side that breaks the round trip fails the build. A CSV starter file remains for
    anyone who cannot open `.xlsx`.
  - **Sheet choice**: a workbook rarely holds one sheet, and reading whichever
    came first made the template's own instructions tab look like a file with no
    Title column. `pickTaskSheet` takes the first sheet whose header row maps a
    Title, falling back to the first sheet so a genuinely wrong file still gets
    a useful error. The template also puts its plan sheet before the guide.
  - The template's own column names are understood as they are: **Task
    Description** is the title, **Notes** the description, **Task ID** is
    recognised and skipped, **Week** becomes a `week-01` label (zero-padded so
    it sorts), and plan statuses (Not Started, In Progress, Review, Done) map to
    board columns. A sheet that names its categories after the judging areas —
    as this one does — needs no Area column: `areaFromCategory` fills it in, so
    dashboard area progress works straight after an import.
  - One import is capped at 200 tasks: the bound is the 500-write transaction
    budget rather than a single column page.

### Free text may contain "/"

`requireString` refuses "/" because it guards identifiers that become document
path segments. That rule was applied to prose as well, which blocked ordinary
task titles — three of the standard template's own 48 tasks, including "Start
passive/active attachments". `requireText` (in `phase2.ts`) is the validator for
free text: same trimming and length bounds, no "/" rule, and control characters
still rejected. Titles, descriptions, comments, category, project, goal and
template names use it; every identifier still uses `requireString`.

### Planned dates

A task carries `startAt`, `endAt` and `dueAt`: the planned window and the
deadline, all optional. The table has a column for each (only the due date is
toned by urgency — a plan is not a deadline), the card dialog edits all three,
and the import reads Start date / End date / Due date columns. `timelineSpan`
prefers the window and falls back to opened-to-due, which is what every card
did before these fields existed, so boards written earlier render unchanged.

### Status changes resolve against the board's workflow

`updateTask` used to set a card's `columnId` to the status id outright. On a
board with custom columns ("Building", "Testing") no such column exists, so a
status change moved the card into a column nothing renders and it disappeared
from the board. The status is now resolved against the card's own project:
`completed` means that board's completion column, a status that names a real
column moves the card there, and anything else records the status while the card
stays put. The move also honours the per-column capacity check, which the old
path skipped.

### Data and authorization model

`projects` records contain `teamId`, project metadata, an ordered bounded column
array, an ordered bounded `categories` array, `completedColumnId`, and archival
state. Tasks add `projectId`, `columnId`, `categoryId`, numeric `orderKey`,
integer `version`, and `completedAt`. Removing a category checks for remaining
cards through the `tasks (teamId, projectId, categoryId)` composite index.

All mutations use callable Functions. Firestore rules allow active team members
to read projects and tasks but deny direct writes. Card moves re-check current
membership, project/team ownership, expected card version, adjacent card IDs,
and target-column capacity inside a transaction. Movement notifications use
operation-derived IDs so retries cannot create duplicates.

`projectTemplates` records are team-scoped and hold the same validated column
array a project holds, plus a bounded snapshot of cards (title, description,
priority, labels, and column only — never assignments, due dates, or
attachments, which would be stale or misdirected in a later season). Built-in
presets have no documents: they live in server code, and `listProjectTemplates`
is a read-only callable that serves both catalogues so the client never carries
a second, drifting copy of the definitions. `createProjectFromTemplate` and
`saveProjectAsTemplate` are coach/team-leader-only, carry idempotency receipts,
and revalidate a template against the live project and card limits, so a
template saved before a limit changed can never seed a board the workflow
editor would then refuse to edit. Templates carry categories as well as
columns, and a card whose category the template no longer defines seeds without
one rather than failing the whole template. `deleteProjectTemplate` removes a team
template; a built-in preset cannot be deleted. All three write audit records.

`importProjectTasks` is coach/team-leader-only and treats uploaded rows as
untrusted input. It re-validates every row with the same text validator task
creation uses (which refuses `/`; the browser preview flags those rows up front),
accepts only the four judging-area ids, and bounds one import to 50 rows — one
column page — so the whole import is a single transaction and every imported
card is visible without paging. Cards land in the requested column or the first
column that is not the completion column, and the column's remaining capacity is
checked inside the transaction. The idempotency receipt stores the created task
ids, so a retried import replays its result instead of adding the rows twice.
Each import writes task history for every card and one audit record. Spreadsheet
size (1 MB), rows read (500), columns (20), and cell length are capped in the
browser before anything is previewed.

`ensureDefaultProject` is idempotent. It creates a deterministic Team Board.
When the team has no tasks at all, that board is seeded in the same transaction
with the **standard season plan** — the four categories (each tied to its
judging area) and 48 tasks of `functions/src/data/fll-standard-task-list.json`,
the same list the downloadable Excel template is built from — all in the first
column, labelled with their area and week, and marked as needing no migration
(`buildStandardPlan` in `functions/src/standard-plan.ts`). A team that already
has tasks gets an empty board instead, and the call then maps legacy `todo`, `inProgress`, `review`, and `completed` tasks into compatible
columns with stable initial ordering and versions. Its server-owned cursor and
per-column counts make multi-page migration resumable without duplicate order
keys or client-selected gaps.

Project and card limits are enforced transactionally rather than only in the
client. The same 150-card boundary used by live column subscriptions is checked
for legacy creation, Kanban creation, cross-column moves, and same-column
reordering so a successful write cannot create a hidden 51st card.

### Verification and exit criteria

- Unit coverage passes for legacy mapping, ordering, bounded constants, query
  scoping, parsing, and callable routing.
- Rules/emulator coverage proves project and template read isolation and
  direct-write denial, and that only a coach or team leader can create from,
  save, or delete a template.
- `test:phase3-emulator` proves a coach import lands its rows with area label,
  priority, and due date, that a retry replays rather than duplicates, and that
  students, unknown areas, and unknown columns are refused.
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

### Verification record — 17 September 2026 (second round)

`npm run verify:static` passes (485 tests with coverage, functions and web
builds, release check), and the foundation, Phase 2, 3, 5, 6 and 7 emulator
suites pass. This round shipped: the notification bell; ISO dates from
`getDashboard`; a new team's board pre-filled with the standard season plan;
students as task editors; the full-width tracker; Manage team; invite-link
wording; account types gating team creation; and removal of Search, State lab
and Emulators. Deploy with `firebase deploy --only functions` for the new
`setAccountType` callable and the changed `createTeam`, `ensureDefaultProject`,
`createKanbanTask`, `moveTaskCard`, `updateTask` and `getDashboard`; no rules or
index changes.

### Verification record — 17 September 2026

Static checks and the Phase 3 / Release 1.1 emulator suite pass locally:

- `npm run verify:static` — lint, typecheck, 438 tests across 55 files with
  coverage, functions build, web build, release check
- `npm run test:phase3-emulator` — board categories and their milestones,
  subtask permissions, status-to-column resolution, the three planned dates,
  slashes in free text, spreadsheet import with per-row columns, created
  categories, resolved assignees and nested subtasks, and milestone counters
  following a card between packages

What shipped in this round, in order: board categories; subtasks; the
spreadsheet import and its standard template; the work-breakdown tree
(milestones → categories → tasks → subtasks) with outline numbering; start/end
dates beside the deadline; and the split of the coordination page into tracker
tabs plus separate Team files and Notifications screens. Deployment still
requires `firebase deploy --only functions,firestore:indexes` — the new
`updateProjectCategories` and `resolveImportAssignees` callables and the
`tasks (teamId, projectId, categoryId)` index are not live yet.

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

The emulator role matrix covers coach and student movement and editing,
standard-plan seeding of a new team's board, stale-version
`ABORTED` responses, mentor and parent `PERMISSION_DENIED` responses, direct
write denial, legacy migration, and linked-goal counters. Deployment remains
blocked until the manual Phase 8 product/safety approvals and pilot gates are
accepted; this verification record does not substitute for those approvals.

---

## Chat and announcements (removed)

Team chat shipped as Phase 4 and was **removed from the product**. The
`channels`, `messages`, `announcements`, `announcementAcknowledgements`,
`channelReads`, and `channelMutes` collections have no rules block any more, so
the catch-all `match /{document=**} { allow read, write: if false; }` denies
every client read of anything still stored in them. `functions/src/phase4.ts`,
all fourteen chat callables, the nightly `enforceMessageRetention` schedule, the
`/chat` page, and the chat branch of global search are gone.

Two deliberate leftovers:

- **Existing documents are not deleted.** Removing a feature is a code change;
  purging a team's message history is a data decision with its own retention and
  safeguarding consequences. The rules make the data unreachable, which is the
  security-relevant half. Deleting it is a separate, explicit migration.
- **`/chat` redirects to `/team`.** Notifications already delivered to mailboxes
  carry `/chat?channel=…` deep links, and `safeInternalRoute` no longer allows
  that path, so both the router and the deep-link allowlist land the user on a
  real page instead of a 404.

## Knowledge and polls

Phase 5 stores Questions, How-to Videos, and Polls in top-level Firestore collections. Every content record carries an explicit `visibility` of `team` or `community`. Team records carry a `teamId`; community records carry `teamId: null` and can only be created by an approved community publisher.

### Authorization boundary

- While the community-content audience policy remains unresolved, community
  content is available only to signed-in users. This deny-first boundary does
  not approve public or anonymous access.
- Global question/video search is callable-only and adds `visibility == community` and `teamId == null` constraints. Team search requires an active membership and adds the team visibility constraints.
- Firestore rules independently enforce those visibility conditions for direct reads and list queries. Rules are not filters, so a list query must itself pin the fields a rule reads: answer and comment threads filter on the parent question's `teamId` and `visibility` as well as `questionId` (`threadConstraints` in `src/lib/phase5-service.ts`). Until 2026-09-18 they filtered on `questionId` alone and every member got "permission denied".
- Knowledge management — publishing/unpublishing team videos (and reading drafts), closing team polls, and accepting an answer on someone else's question — is open to coaches, team leaders, mentors and students (`KNOWLEDGE_EDITOR_ROLES`, and `isKnowledgeEditor` in `firestore.rules`). Parents ask, answer, comment, vote and create polls. Seeing poll results before a poll's `resultsVisibility` allows stays coach/team-leader, so anonymous results are not exposed early to students.
- Poll votes, saved questions, favorites, and watch history are written only through callable functions. Personal records are readable only by their owner; anonymous vote records are never directly readable.

### Records and safety

- Questions support categories, tags, bounded token search, answers, comments, votes, accepted answers, saved records, attachments by approved file IDs, reporting, and moderation status. Attachments are checked transactionally against ready, non-blocked team file metadata and cannot cross a team/community boundary.
- Videos use the required six categories, one validated external/storage source, source attribution, caption/transcript track metadata, related IDs, publication controls, favorites, watch history, and reporting.
- Polls use transaction-guarded one-vote-per-user documents, single/multiple choice validation, role audiences, anonymous mode, expiration, close-now, results visibility, aggregate counts, `pollHistory`, audit events, and deterministic notification IDs/deep links. Result aggregates are returned only through server-controlled output that enforces each poll's `resultsVisibility`; direct reads and list output must not bypass that setting.
- `remove-content` moderation actions update the referenced Phase 5 item, and the read rules hide removed questions/videos from subsequent access.

### The Knowledge base page (as of 2026-09-18)

`/knowledge` is titled **Knowledge base** and has three tabs:

- **Questions** — the team's recent questions (bounded, "Load more" cursor),
  an "Ask your team" form, and per question: Answers, Mark helpful, Save and
  Report. Opening **Answers** widens the card and lists one answer per row, the
  accepted answer first and highlighted, followed by a **Your answer** form.
  The question author or a knowledge editor can accept an answer.
- **Polls** — create, vote, close, and authorized results.
- **Resources** — curated external FLL links (FIRST season materials, FIN
  Playbook, FLL Tutorials, Prime Lessons, the Excel in FLL guide, the BIOGLOW
  missions video, and the official score calculator), each opening in a new
  tab. The list is static and identical for every team:
  `src/lib/knowledge-resources.ts`. Deep link: `/knowledge?tab=resources`.

Removed from the UI, with their callables, rules and data left server-side:
the How-to Videos tab (old `?tab=videos` / `?video=` links open Questions),
question comments (neither listed nor postable; comments are no longer
fetched), and the "Knowledge & Decisions" banner with its question search and
Team/Shared-library scope (`searchQuestions` is no longer called).

Acceptance and rules coverage lives in `tests/phase5-emulator-integration.mjs` and `tests/firestore-rules-phase5.integration.mjs`.

---

## Scorer

As of 2026-09-18 First Pit no longer stores scores. The Scorer page
(`/scorer`, `src/pages/ScorerPage.tsx`) links to FIRST's official robot game
scoresheet at `https://eventhub.firstinspires.org/scoresheet`, which always
matches the current season's missions and rules. It is a link rather than an
iframe because that site sends `X-Frame-Options: SAMEORIGIN`, which browsers
and the iOS web view enforce. Below it, an information-only **Manage scoring —
coming soon** card announces in-app practice tracking; it has no controls.

The team-defined scorer this replaced (Phase 6: `scoreDefinitions`,
`scoreSessions`, `scoreSessionHistory`, `phase6Operations`, and the
`createScoreDefinition`/`listScoreDefinitions`/`createScoreSession`/
`listScoreSessions`/`correctScoreSession`/`exportScoreReport` callables) was
removed with its rules, indexes and tests. Documents left in those collections
are closed by the catch-all deny and read by nothing; delete them with the
Admin SDK if the data is no longer wanted.

---

## Dashboard, global search, and profile integration

As of 2026-09-17 the coordination screen is split into separate routes rather
than one stacked page. Four of them are the tracker, presented as tabs of one
screen by `TrackerTabs` and absent from the sidebar, which carries only
"Tracker": `/coordination` (the board), `/milestones` (the work-breakdown top
level), `/import` (the spreadsheet import) and `/board-setup` (columns and
categories). Import and board setup are coach-only, and read the team's single
board through `useTeamBoard` rather than owning card subscriptions. They stay
separate routes so each keeps its deep links — `?goal=`, `?task=` — and loads
only its own records. `/files` is its own sidebar destination, since it is not
project management. Notifications are reached from the top-bar bell
(`NotificationBell`), which keeps a live unread count for the active team
(capped at 99+, reading at most 100 documents) and, only while open, the eight
most recent; its "See all" link opens the full `/notifications` page. Each loads only its own records, so a team whose policy
or rules deny one still gets the others, and the phone's four-slot bar carries
Home, Tracker, Knowledge base and Manage team; everything else is in the ☰ menu.
Search results for a milestone and a file now deep-link to `/milestones?goal=`
and `/files?file=`; links stored before the split still resolve to the tracker.

Phase 7 keeps the browser app as the team-scoped hub for the completed MVP
modules. The Dashboard reads a bounded, server-authorized summary for the
selected active team. Global search is a callable operation: it first resolves
the caller's active memberships and then searches only team Questions, Videos,
Files, Tasks, Goals, and the team's own record.
Community/public discovery is intentionally excluded. **No screen calls it any
more:** the Search page was removed on 2026-09-17 (see *App shell and
navigation*); the callable remains server-side until it is deliberately retired.

### Dashboard analytics

The Dashboard (`src/pages/HomePage.tsx`) is laid out as a season analytics
view. Every figure comes from the one `getDashboard` callable, and every read
behind it is bounded — count aggregations or small `limit`ed queries — so the
cost does not grow with a team's season.

Dates leave the callable as **ISO strings** (`pickPublicFields` in
`functions/src/phase7.ts`). A callable encodes a Firestore `Timestamp` as a bare
`{_seconds, _nanoseconds}` object that `toDate()` cannot read; until 2026-09-17
that showed every Upcoming task as "Due · …" with no date, every task as "No due
date". Any callable that returns a
stored date must convert it the same way.


- **Overall season progress** — task completion percentage, tasks complete,
  goals achieved (`status == completed` count), and open tasks.
- **Progress by area** — the four FIRST LEGO League judging areas
  (`innovation-project`, `robot-design`, `robot-game`, `core-values`,
  `DASHBOARD_AREAS` in `functions/src/phase7.ts`). A task belongs to an area when
  it carries the area id as a label; two count aggregations per area give total
  and completed. Labels rather than a new task field keep every existing task,
  rule, and editor unchanged; built-in templates and the spreadsheet importer
  apply them, and a coach can add one to any card.
- **Top achievements** — derived, never stored: up to three most recently
  completed goals. A team with none sees an empty state, not placeholder awards.
- **Upcoming tasks** — up to five open tasks with a due date, soonest first, so
  overdue work leads. Tasks with no due date are excluded by the query.

The percentages and highlight copy live in
`src/lib/dashboard-view.ts`, which is pure and unit-tested. The new queries need
the `tasks (teamId, labels)`, `tasks (teamId, labels, status)`, and
`goals (teamId, status, updatedAt desc)` composite indexes.

### Representative acceptance coverage

The `test:phase7-emulator` workflow covers these representative paths:

1. A coach creates a team and invites a student.
2. The student receives a role-aware dashboard with team-scoped task data,
   per-area progress from labelled tasks, and upcoming due work.
3. Assignment notifications appear in the selected team summary.
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

## App shell and navigation

As of 2026-09-18 (`src/components/AppShell.tsx`):

- **Sidebar:** Home, Tracker, Scorer, Knowledge base, Manage team, View
  profile, Sign out, in that order; the footer shows who is signed in. Team
  files (`/files`) has no entry and is reached from task cards. The phone's
  bottom bar carries Home, Tracker, Knowledge base and Manage team; Scorer,
  View profile and Sign out sit in the ☰ menu.
- **Top bar:** the **active team** (badge and name), then online status and
  the notification **bell**. The team sits on every page so a coach with
  several teams always sees which one they are working in; with more than one
  team it is the team switcher (a dropdown), otherwise just the name. It
  replaced the switcher that sat at the top of the sidebar and the one in the
  phone's ☰ menu (2026-09-19). The notification **bell**
  (`NotificationBell`) — a live unread count for the active team (99+ cap, at
  most 100 documents read), a dropdown of the eight most recent that is read
  only while open, and "See all" to `/notifications`. Notifications are no
  longer a sidebar entry.
- **Manage team** (`/team`, `src/pages/ManageTeamPage.tsx`) replaced Team hub
  and Team admin: one page with the team overview for every member, followed
  for coaches and team leaders by the administration sections (invite links,
  safety defaults, roster and roles, invitations, join approvals, moderation,
  audit history). Hiding them is presentation only — `TeamAdminPage` refuses
  non-coaches itself and every administrative callable re-checks the role.
  Coaches do not get the overview's short roster preview; the full roster is
  below it. `/hub`, `/admin` and `/team/admin` redirect to `/team`, so stored
  links, emailed `next=` paths and notifications keep working. Sign-in and team
  creation land on `/team`. See *Manage team* below.
- **Removed pages:** Search (`/search` redirects to Home; the ⌕ top-bar icon is
  gone), and the development-only State lab (`/states`) and Emulators
  (`/emulators`) pages, which now fall through to not-found.
- **Layout width:** pages sit in a centred 1440px column, except the four
  Tracker routes, which use the full width beside the sidebar (`wideRoutes` →
  `.app-main--wide`) because the board is a wide table.

## Manage team

`/team` (`ManageTeamPage`), as of 2026-09-21, is the roster and nothing else.
The administration that used to sit below it moved to `/admin`.

- **Banner** — "Team name · Team #number" (the number in accent colour, omitted
  until set), the viewer's role, the active member count, and the created date.
  Coaches and team leaders get **Edit team name & number**, which opens an
  inline form (name 2–80 characters, number up to 8 digits, empty clears it)
  saved through `updateTeamDetails`, and a link to **Administration**. Others see
  the name and number only. The banner's ghost buttons keep a dark hover state;
  the global `.button--ghost:hover` would otherwise whiten them and hide their
  white label.
- **Team members** — one table for everyone (`RosterTable`), **active members
  only**: Manage team stays clean by rule (2026-09-21), so suspended, removed and
  pending people are never listed here. A coach or team leader also gets the
  role select, **Suspend**, **Make leader**, and **Reset password** on rows the
  team provisioned; a member sees names, roles and statuses only. A **Has not
  signed in yet** badge marks anyone still owing a password change. Suspending
  someone takes their row away and shows a notice with **Undo** and a link to
  Administration → Suspended, where they are restored.
- **＋ Add a member** (coaches and team leaders) — **the only way to add
  anyone**, decided 2026-09-21. `AddMemberDialog` calls `provisionTeamMember`:
  a new address gets an account and `CredentialsCard` shows the starter
  password; an address that already has an account is refused
  (`already-exists`, `isExistingAccountError`), and the same dialog offers
  **Invite <email> as a <role>**, which calls `createInvitation`, copies the
  link and offers **Email invite with Gmail**. The coach never has to know in
  advance which mechanism an address needs. See *Coach-provisioned member
  accounts*.

Leaving a team and joining or starting another are about the person, not the
team, so since 2026-09-21 they live on the profile rather than here: Profile →
**Your teams** (`MembershipsPanel`) lists every membership with its role and its
own **Leave…** (with confirmation, and a leadership reminder for coaches — the
server's last-coach refusal is shown verbatim), plus **Accept an invitation** and
**Create another team** (offered per `mayOfferTeamCreation`). Manage team keeps
only its empty state for someone with no team at all.

`TeamHubPage` no longer exists — its banner is part of `ManageTeamPage`.

## Administration

`/admin` (`AdministrationPage`), coach and team leader only, re-checked by every
callable behind it. One `loadAdminData` read feeds six tabs, and `?tab=<id>`
opens a given one (Manage team's suspend notice links to `?tab=suspended`):

- **Invitations** — a status list only, with no create form: invitations are
  created from **＋ Add a member**. Pending invitations offer **Email invite**,
  **Copy link** and **Revoke** (see *Invitations are links, not emails*).
- **Join requests** — approve or reject, with the team ID to share.
- **Suspended** — members who keep their account but have lost access to the
  team, each with **Restore** (back to active with the role they had). Removed
  members are not listed; they come back through **＋ Add a member**, which
  invites an existing account.
- **Team settings** — Team files and Join requests, plus the greyed-out planned
  settings.
- **Safety** — the moderation queue, with optimistic-concurrency conflicts
  explained rather than reported generically.
- **Audit** — the administrative record, paginated.

The sidebar shows the **Administration** entry only to coaches and team leaders;
hiding it is presentation only. `/team/admin` redirects here, `/hub` redirects to
`/team`, and `/admin` is no longer a redirect.

`listTeamMembers` adds two admin-only fields, `provisionedByThisTeam` and
`mustSetPassword`, omitted entirely for other members — a teammate has no
business knowing who has not finished signing in. **Reset password** appears only
where the first is true, because the server refuses the rest.

## Landing page

`src/features/landing/landing-page.tsx` is the signed-out home. Under the hero's
"Get started" call to action it shows two **coming soon** store badges — "Coming
soon to the App Store" (Apple mark) and "Coming soon to Google Play" (Play mark)
— drawn as inline SVG from simple-icons (CC0) paths, so no dependency was added.
They are not links, because there are no store listings yet. The Apple and
Google marks are their owners' trademarks and "coming soon" is not one of their
official badge forms: when the apps ship, replace these with the official
"Download on the App Store" / "Get it on Google Play" artwork, linked to the
listings. The feature grid and audience copy describe Resources and the
official scoresheet rather than videos and stored scores.

## Authentication hardening

### Sign-in transports

`signInWithPopup` cannot work in the Capacitor iOS shell: at a `capacitor://`
origin a popup has no opener to post back to, and a redirect cannot return to
the app. `signInWithGoogle` picks its transport:

| Environment | Transport |
| --- | --- |
| Desktop / mobile web | `signInWithPopup` |
| Web where the popup is blocked or storage is unusable | falls back to `signInWithRedirect` |
| Capacitor shell (`isNativeShell()`) | native Google SDK via `@capacitor-firebase/authentication`, then `signInWithCredential` |

On the web, a redirect resolves to `null` because the page is navigating away;
`completeGoogleRedirect` (`getRedirectResult`) collects it on the next load from
an effect in `AuthPage`. `AuthProvider` still creates the private profile from
its own session listener, so the redirect path only has to route the user and
surface failures. A genuine popup failure is rethrown rather than silently
converted to a redirect.

In the shell, the plugin runs with `skipNativeAuth: true`: the native Google
SDK only obtains Google's ID token, and the Firebase JS SDK signs in with
`GoogleAuthProvider.credential(idToken)` and owns the session exactly as on
the web. The plugin is loaded with a dynamic `import()` so the web bundle does
not carry it. `completeGoogleRedirect` returns `null` in the shell (its Auth has
no redirect resolver), a dismissed Google sheet counts as a dismissal rather
than an error, and `signOutCurrentUser` also ends the native Google session so
the next sign-in shows the account picker. Sign in with Apple is deliberately
out of scope; see `docs/ios-app-plan.md` for the App Store review risk.

### Session persistence

`configureAuthPersistence` sets `indexedDBLocalPersistence` and falls back to
`browserLocalPersistence`. `browserLocalPersistence` alone loses the session in
a WKWebView whose local storage the OS evicts, and throws outright in Safari
private mode — where the fallback is what keeps sign-in working at all. The
listener is still registered only after persistence resolves, so a sign-in
observed in between cannot be stored under the wrong persistence.

### Email verification is enforced, not suggested

`requiresEmailVerification` is true only for an account carrying a `password`
provider with `emailVerified === false`. Google has already proved the address,
so a federated-only account is never gated.

`ProtectedRoute` renders `EmailVerificationGate` in front of every protected
route for such a user. This is a gate rather than a banner because an unverified
address is exactly how an emailed invitation could be accepted by someone who
does not control it — and here that invitation grants access to a team of
minors. The only exits are verifying or signing out, and sign-out stays enabled
offline so nobody is stranded.

`user.reload()` mutates the existing `User` and fires no auth-state change, so
`refreshVerificationStatus` returns the new value and callers act on it; the
gate navigates with a full page load once verification succeeds rather than
pretending React would re-render. `reload()` also leaves the ID token alone,
and Firestore rules and callables read `email_verified` from the token, so
`refreshVerificationStatus` forces `getIdToken(true)` as soon as the address is
verified (2026-09-18) — otherwise the first invitation read after verifying is
refused.

**This changes behavior for existing accounts:** anyone already signed in with
an unverified password account meets the gate on their next protected
navigation.

### Closing the loop: `/auth/action`

`AuthActionPage` (route `/auth/action`, deliberately outside `ProtectedRoute`)
handles the `?mode=…&oobCode=…` links Firebase Auth mails out. It applies the
code, then refreshes the signed-in session so the persisted
`emailVerified: false` does not re-raise the gate on the very next route.

Verification emails are sent with `actionCodeSettings` pointing at this route,
carrying the destination path in `?next=`. That matters for an invitation: an
invitee who verifies mid-flow returns to `/join?invite=…` rather than losing
the deep link. When the origin is not an authorized domain — a per-branch
preview — `sendVerification` retries without the continue URL, because losing
the return trip beats losing verification.

The handler covers `resetPassword`, `recoverEmail`, and `verifyAndChangeEmail`
as well as `verifyEmail`. The console's action URL is one project-wide setting,
so a handler that only knew `verifyEmail` would break password recovery the
moment the console was pointed at it.

The gate itself re-asks the server every few seconds while the tab is visible
and on every focus, so a user who opens the link on their phone finds the
desktop tab already through.

The Auth emulator records out-of-band codes but never delivers mail. In
emulator builds only, `latestVerificationLink` reads them from
`/emulator/v1/projects/{projectId}/oobCodes` and the gate renders the link
directly; without it local verification is a dead end.

### Provider configuration this depends on

Email/Password and Google must both be enabled in the project's Authentication
providers, and every origin serving the app — the Vercel production domain, any
preview domain, and `localhost` — must be listed under Authorized domains.

For the fully in-app path, set Authentication → Templates → "customize action
URL" to `https://<production domain>/auth/action`. Without it the links still
work — Firebase's hosted handler applies the code and then forwards to
`/auth/action` as the continue URL, which picks the session up from there.
`AuthPage` already maps `auth/operation-not-allowed`,
`auth/configuration-not-found` and `auth/unauthorized-domain` to plain-language
messages, so a missing provider surfaces as guidance rather than a stack trace.
This is console configuration; it cannot be asserted from the repository.

**Production state (checked 2026-09-18).** The site is served at
`www.first-pit.com`; Authorized domains include `www.first-pit.com`,
`first-pit.com`, `first-pit-32795.firebaseapp.com`, `first-pit-32795.web.app`,
the Vercel domain and `localhost`. A new custom domain must be added there
first, or Google sign-in fails with "Sign-in is not enabled for this site
address". Keep `VITE_FIREBASE_AUTH_DOMAIN` at `first-pit-32795.firebaseapp.com`.
Auth email uses Firebase's default sender, `noreply@first-pit-32795.firebaseapp.com`
— no custom SMTP and no custom email domain are configured.

**"I never got the verification email."** Firebase only mails an account that
exists. Before suspecting delivery, confirm the account was created (Firebase
console → Authentication → Users, or the Identity Toolkit `accounts:lookup`
API) with exactly the address expected, and that it signed up with a password —
Google sign-ins are already verified and never receive one. Then check spam for
the sender above.

---

## Calendar and Google Calendar integration (removed)

The in-app calendar and the Google Calendar sync were **removed from the
product** together. Gone: the `events` and `eventOccurrences` collections and
their rules and indexes; `createEvent` / `updateEvent` / `deleteEvent`;
recurrence validation and occurrence materialization in `phase3.ts`; the whole
of `functions/src/google-calendar.ts` (OAuth consent, token exchange, encrypted
refresh-token storage, two-way sync, the `syncGoogleCalendars` schedule, and the
`/google/oauth/callback` route on the `api` function); `src/features/google/`;
and the calendar section of the Tracker page.

This also removed the only two Secret Manager dependencies in the codebase,
`GOOGLE_OAUTH_CLIENT_SECRET` and `GOOGLE_TOKEN_ENCRYPTION_KEY`. Neither secret
had ever been created in the production project, and because `defineSecret`
bindings are resolved at deploy time, their absence aborted the whole
`firebase deploy --only functions` run — which is why 18 functions, including
the unrelated `listTeamMembers`, were missing from production while the rest
appeared to deploy fine. With the bindings gone, a functions deploy no longer
depends on any secret.

`googleIntegrations`, `googleOAuthStates`, and `googleCalendarSync` lost their
explicit `allow read, write: if false` blocks; the catch-all deny covers them,
and `tests/firestore-rules-phase3.integration.mjs` asserts that for every role
including a platform admin.

The `/calendar` route still redirects to `/coordination` for old links.

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

- **Parent visibility was enforced for chat.** `parentVisibility` had been
  defined, validated, and stored but read by no authorization check, so parents
  could read the entire team chat while the product promised the coach
  controlled it. That fix shipped, and the chat removal later retired the whole
  code path along with the policy's only consumer. `parentVisibility` remains on
  `teamPolicies` and is inert; the next feature that shows role-scoped content
  should read it rather than reinventing the check.
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
- **Scoring is FIRST's official scoresheet.** First Pit does not reproduce
  the season's missions; the Scorer page links out to FIRST's scoresheet (see
  *Scorer*).

### Known follow-ups

- **A category's judging area is not applied to cards created by hand.** The
  dashboard counts a task toward an area when the task carries the area id as a
  label. The importer and the built-in templates apply those labels; manual card
  creation does not, so a category tied to an area does not move that area's bar
  on its own. The Board setup copy promises it does. Either make creation and
  category moves inherit the label the way they inherit the milestone, or change
  the copy.
- **The dashboard has no per-category progress.** "Progress by area" is the four
  fixed judging areas; a team's own categories ("Experts Feedback") appear only
  on the board. Adding them needs a count aggregation per `categoryId` and a
  `tasks (teamId, categoryId, status)` index.
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
access or innovation-project workflows.

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

### Deploying

- **Web:** merging to `main` deploys to Vercel automatically (project
  `first-pit-32795-prod`); pull requests get preview deployments.
- **Firebase is separate.** Any change to `firestore.rules`,
  `firestore.indexes.json`, `storage.rules` or `functions/` must also be deployed
  with the CLI, or the live site calls functions and queries that production
  does not have yet:

  ```bash
  firebase deploy --only firestore:rules,firestore:indexes,functions --project production
  ```

  The CLI asks before deleting functions that no longer exist in the code
  (e.g. `updateTeamNumber`, replaced by `updateTeamDetails`) — answer yes once
  the replacement is deployed in the same run. New composite indexes build for
  a few minutes after deploy; queries that need them fail until they show as
  Enabled under Firestore → Indexes.
- Deploy Firebase before, or together with, a web release that depends on it.

### Responsive and accessibility matrix

Smoke-test the Dashboard, Auth, Manage team (as a coach and as a student),
Coordination, Knowledge, Scorer and Profile routes at:

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

The phased plan for shipping the app, and its status, is in
`docs/ios-app-plan.md`.

The web bundle remains the source of truth; `ios/` is a Capacitor 8 shell using
Swift Package Manager (no CocoaPods), iOS 15+, bundle id `com.firstpit.app`.
Building it needs Xcode 26 or later.

```bash
cp .env.ios.example .env.ios.local   # once; production web config, see below
npx firebase apps:sdkconfig IOS --project production \
  --out ios/App/App/GoogleService-Info.plist   # once; native Google sign-in
npm run ios:build                    # typecheck, vite build --mode ios, bundle check, cap sync ios
npm run ios:open                     # opens ios/App in Xcode
```

- **Production bundle only.** `ios:build` builds in Vite mode `ios`, which layers
  `.env.ios.local` over `.env.local`. `scripts/ios-bundle-check.mjs` inspects the
  built JS before `cap sync` and refuses a bundle that is not mode `ios`, has
  emulators on, or points at a `demo-*` project. The values are the production
  Firebase *web* app config (`npx firebase apps:sdkconfig WEB --project
  production`), which is public by design.
- **Auth initialization.** In the shell, `getFirebaseApp` creates Auth with
  `initializeAuth(app, { persistence: indexedDBLocalPersistence })` before
  anything calls `getAuth`. The browser `getAuth` loads the popup/redirect
  resolver iframe from `authDomain`, which never answers at a `capacitor://`
  origin, so the first auth-state event never arrived and the app sat on
  "Loading your dashboard".
- **Safe areas.** `contentInset: 'never'`: the page is full-bleed
  (`viewport-fit=cover`) and pads itself with `env(safe-area-inset-*)`. An
  `automatic` inset padded twice and showed the bare web view behind the home
  indicator. `release-check` asserts the setting.
- **Native chrome** lives in `src/lib/native-shell.ts` (`isNativeShell`,
  `syncNativeStatusBar`, `hideNativeSplash`); each is a no-op on the web. The
  status bar follows the resolved theme from `PreferencesProvider`; the splash
  hides after the first paint, capped at 10 s in `capacitor.config.ts`.
- **Native Google sign-in** needs `ios/App/App/GoogleService-Info.plist` (the
  iOS app `com.firstpit.app`, registered in the production project). It is
  gitignored like other platform config and referenced by the Xcode target, so
  a checkout builds only once it is downloaded. Its reversed client ID is the
  `google-sign-in` URL scheme in `Info.plist`. `capacitor.config.ts` limits the
  plugin's Swift package to the Google trait, so the Facebook SDK is not linked.
- **Links in the shell** (`src/lib/native-links.ts`, installed from `main.tsx`):
  one bubble-phase click handler on `document` routes an `<a download>` to the
  cache and the share sheet, and an `http(s)` link to another origin to the
  in-app Safari view (`@capacitor/browser`). In-app routes, `mailto:` and
  clicks a component already handled are left alone. Pages keep plain anchors.
- **Public web origin.** Invite links and the continue URL in verification
  emails use `publicWebOrigin()` (`src/lib/public-origin.ts`): the page origin
  on the web, `VITE_PUBLIC_WEB_ORIGIN` in the shell, where the page origin is
  `capacitor://localhost`. The bundle check requires it to be `https://`.
- **Invites** in the shell use the share sheet (**Send invite**) instead of
  Gmail's web compose screen; the landing page's "coming soon" store badges are
  hidden there.
- **iPhone is portrait-only**; the iPad orientations are the template's until
  the iPad decision is made. `Info.plist` declares `arm64` and
  `ITSAppUsesNonExemptEncryption = false` (HTTPS only).
- **Icon and splash** are drawn from the `public/favicon.svg` mark by
  `scripts/render-ios-brand.swift`: opaque, full bleed, brand colours.

The shell requests no camera, location, contacts, photo library, or push
permissions. File selection uses the WebView picker; do not add native
permission prompts without an approved feature and privacy review.

**Universal Links.** A `https://www.first-pit.com/...` link tapped on an
iPhone with the app installed opens the app at the same route.

- `public/.well-known/apple-app-site-association` names
  `B4C87L2787.com.firstpit.app` and claims every route except static files
  (`/assets/*`, `/.well-known/*`, anything with a file extension). `vercel.json`
  excludes `/.well-known/` from the SPA rewrite and serves the file as
  `application/json`; without that, iOS received `index.html` and ignored it.
  `release-check` asserts all three.
- `ios/App/App/App.entitlements` holds `applinks:www.first-pit.com`. Only
  `www` is listed: the apex `first-pit.com` 308-redirects to it, and iOS does
  not follow redirects for the association file.
- `NativeDeepLinks` (inside the router) uses `listenForDeepLinks`
  (`src/lib/native-deep-links.ts`): the launch URL on a cold start and
  `appUrlOpen` afterwards. Only URLs on `publicWebOrigin()` are routed.
  Protected routes still go through `ProtectedRoute`, so a signed-out invitee
  signs in and keeps `/join?invite=…`.
- The team is `B4C87L2787`, the developer's individual account, used for
  TestFlight. Moving the app to the coach's account means an App Store Connect
  app transfer and a new Team ID. Add the new `<TEAMID>.com.firstpit.app` to
  `appIDs` and deploy it **before** the transfer, then update
  `DEVELOPMENT_TEAM`.
- iOS fetches the file through Apple's CDN when the app is installed, so links
  work only after the file is deployed to production.

Still open for the store build: the device checks listed under Phases B and C
in `docs/ios-app-plan.md`.

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
4. Coach creates a task, goal, event, team-only file, announcement, and poll
   from the Dashboard workflow, and opens the official scoresheet from Scorer.
5. Parent and mentor confirm their role-specific visibility and cannot access
   coach-only administration or private conversations.
6. Suspend the student, retry reads and writes, and confirm access is denied.
7. Report a test content item, resolve it as the coach, and verify the audit
   record without exposing private message contents in logs.
8. Export a test message report, verify the authorized recipient, then
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
