# Phase 0 Decisions and Blockers

## Confirmed decisions

- Use Cloud Firestore as the MVP database for collection-oriented team data.
- Build the web app first and keep the React shell compatible with Capacitor
  packaging for iOS later.
- Use a browser-based routing strategy with Vercel rewrites so the web app and
  future native shell can share one route model.
- Keep Firebase emulator support in the repo so local development can run
  Auth, Firestore, Storage, and Functions without production dependencies.

## Open blockers

These decisions are still required before later feature phases can safely lock
their behavior. They remain blocked, not assumed:

- pilot age
- parent-consent policy
- coach-approval policy
- retention and deletion policy
- recovery policy
- reporting policy
- student direct-message policy
- Questions and Videos audience policy
- file type, file-size, media, retention, and export limits
- scoring model and season-content maintenance
- moderation staffing and response-time target

## Phase 0 implementation notes

- Firestore and Storage rules are deny-by-default until Phase 1 adds the real
  authorization model.
- The app shell intentionally stops short of feature modules so later phases can
  add authentication, team context, and authorization without rewiring the root
  layout.

## Exit gate

Phase 0 is ready to hand off when a new developer can install dependencies,
start the app, and run the Firebase emulators locally, with the open blockers
clearly documented instead of silently guessed.
