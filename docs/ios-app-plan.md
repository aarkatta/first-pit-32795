# iOS app plan

How First Pit becomes an App Store app. The web bundle stays the source of
truth; `ios/` is a Capacitor shell around it. Implementation details of what is
already built live in *Capacitor iOS* in `docs/architecture.md`; this file is
the phase plan and its status.

| Phase | Scope | Status |
| --- | --- | --- |
| A | Modernize the native shell | Done; runs on a device via TestFlight (2026-09-18) |
| B | Web-view compatibility fixes | Built (2026-09-18); on-device feature checks pending |
| C | Universal Links | Built (2026-09-18); needs web deploy + device check |
| D | Native value (push notifications) | Needs a policy decision |
| E | App Store readiness | In progress: first TestFlight build installed (2026-09-18) |
| F | Documentation | Ongoing, per phase |

Rough effort: 2–3 weeks of engineering without push, plus Apple review; push
adds about a week.

## Next steps

In order; each links to the phase that owns it.

1. **Commit Phases A–C** on `launch/v1-hardening` (nothing is committed yet).
   The TestFlight build was archived from this uncommitted tree.
2. **Run the on-device checks** on the TestFlight build (Phase B list):
   Google and email sign-in, the verification email link, relaunch keeps the
   session, files and links in the in-app browser, template and CSV to the
   share sheet, **Send invite**, keyboard, and the offline banner. Note any
   failures; they become fixes before the next build.
3. **Deploy the web app** (merge to `main`) so Vercel serves the association
   file, then test Universal Links on the phone (Phase C).
4. **Check the Firebase Auth authorized domains** include `www.first-pit.com`,
   so verification emails sent from the app are accepted.
5. **Decide Phase D** (push notifications) and the other open decisions below;
   they shape what the first review build contains.
6. **Finish Phase E**: privacy manifest and labels, privacy policy URL, age
   rating and category, confirm in-app account deletion, reviewer demo
   account, then external TestFlight (pilot team) and App Review.
7. **Before release, move the app to the coach's account** (see Phase C,
   *Apple team*), including the association-file update.

## Phase A — Modernize the native shell (done)

- Capacitor 6 → 8.5 (`@capacitor/core`, `ios`, `cli`), plus
  `@capacitor/status-bar` and `@capacitor/splash-screen`.
- `ios/` regenerated with Swift Package Manager (no CocoaPods), iOS 15 minimum,
  Xcode 26 or later.
- `Info.plist`: `arm64` (was `armv7`), iPhone portrait-only,
  `ITSAppUsesNonExemptEncryption = false`. The unused `firstpit://` scheme was
  dropped.
- Brand app icon and splash from the `favicon.svg` mark
  (`scripts/render-ios-brand.swift`), opaque as the App Store requires.
- `npm run ios:build` builds in Vite mode `ios` from `.env.ios.local` (template:
  `.env.ios.example`), then `scripts/ios-bundle-check.mjs` refuses to sync a
  bundle with emulators on or a `demo-*` project. `npm run ios:open` opens Xcode.
- `src/lib/native-shell.ts`: status bar follows the theme; splash hides after
  first paint (10 s cap).
- Fixed: Auth never resolved in the shell. `getAuth()` waits on a resolver
  iframe that cannot load at `capacitor://`; native now uses `initializeAuth`
  with IndexedDB persistence.
- Fixed: `contentInset: 'automatic'` double-padded the safe areas and left a
  white strip; now `'never'`, since the CSS pads itself. `release-check`
  asserts it.

**Exit criteria:** app runs against production Firebase in the simulator and on
a device; email sign-in, tracker and file upload work.
**Status:** done. The simulator launch was verified (landing page renders,
auth resolves), and on 2026-09-18 the app was signed with team `B4C87L2787`,
uploaded to TestFlight and installed on the developer's iPhone. The signed-in
walkthrough (sign-in, tracker, file upload) is part of the Phase B on-device
checks.

## Phase B — Web-view compatibility fixes (built)

1. **Google sign-in on native.** Done. `@capacitor-firebase/authentication`
   with `skipNativeAuth`: the native Google SDK gets the ID token, the JS SDK
   signs in with `signInWithCredential`. The web keeps popup/redirect. The iOS
   app is registered in the production Firebase project
   (`GoogleService-Info.plist`, gitignored) and its reversed client ID is the
   URL scheme. A dismissed sheet is not an error; sign-out also ends the native
   Google session.
2. **External links and downloads.** Done, as one click handler in the shell
   (`src/lib/native-links.ts`) instead of per-page changes: other sites open in
   the in-app Safari view (`@capacitor/browser`), and `download` links are
   written to the cache and offered through the share sheet
   (`@capacitor/filesystem` and `@capacitor/share`). This covers team files, the
   scoresheet, Knowledge resources, the Excel template and the CSV starter.
3. **Invites.** Done. **Send invite** opens the share sheet with the written
   invitation instead of Gmail's web compose screen.
4. **Landing page.** Done. The "coming soon" store badges are hidden in the
   shell.
5. **Public web origin.** Found and fixed while building: invite links and the
   continue URL in verification emails used `window.location.origin`, which is
   `capacitor://localhost` in the shell. That sent families dead links and
   would have made Firebase reject verification emails. They now use
   `publicWebOrigin()` with `VITE_PUBLIC_WEB_ORIGIN`, which the bundle check
   requires.
6. **Session and offline.** Session persistence was fixed in Phase A
   (`initializeAuth` with IndexedDB). `@capacitor/network` was **not** added:
   WKWebView supports `navigator.onLine` and its events, which
   `use-online-status` already uses. Add the plugin only if the device check
   shows stale status.
7. **Safe areas and keyboard.** Safe areas were fixed in Phase A.
   `@capacitor/keyboard` was **not** added up front; the WKWebView default
   (scroll the focused field into view) is left in place until the device check
   shows a problem.
8. **Tests.** Done: `native-links`, `public-origin`, and native paths in the
   `auth` tests. `verify:static` is green (505 tests).

**Sign in with Apple is out of scope** (decided 2026-09-18). Google is the only
third-party sign-in; email and password stay as they are. Review risk: App
Store guideline 4.8 expects an app offering a third-party login such as Google
to also offer a privacy-focused login option, and Sign in with Apple is the
usual way to meet it. If review rejects the build on 4.8, the fallback is to
add Sign in with Apple then, or to hide Google sign-in in the shell and keep
email and password only.

**Exit criteria:** email and Google sign-in, every external link and every
download work in the shell on a device; no web regressions.
**Status:** built; the simulator build launches cleanly with the plugins
linked, and the TestFlight build installs on a device. Still to check by hand on
the TestFlight build:

- Google sign-in end to end (sheet opens, account chosen, lands signed in),
  and sign-out then sign-in shows the account picker again.
- Email sign-up sends a verification email whose link opens
  `https://www.first-pit.com/auth/action` (needs `www.first-pit.com` in the
  Firebase Auth authorized domains).
- Session survives killing and relaunching the app.
- A team file, the scoresheet and a Knowledge resource open in the in-app
  browser; the Excel template and the CSV starter reach the share sheet.
- **Send invite** opens the share sheet with a `https://www.first-pit.com/join`
  link.
- Keyboard on the board, the card dialog and forms; offline banner in
  airplane mode.

## Phase C — Universal Links (built)

1. **Association file.** Done. `public/.well-known/apple-app-site-association`
   lists `B4C87L2787.com.firstpit.app` and claims every app route, excluding
   static files. `vercel.json` excludes `/.well-known/` from the SPA rewrite (it
   was serving `index.html` there) and sets `Content-Type: application/json`.
   `release-check` asserts the file, the app ID, the rewrite exclusion and the
   header.
2. **Entitlement.** Done. `ios/App/App/App.entitlements` has
   `applinks:www.first-pit.com`, and the app target uses team `B4C87L2787`.
   The apex domain is not listed because it redirects to `www`.
3. **In-app routing.** Done. `NativeDeepLinks` / `listenForDeepLinks` route the
   launch URL and `appUrlOpen` events for `www.first-pit.com` to the same path,
   query and hash. Tests cover mapping, foreign hosts, cold start and
   unsubscribe.
4. **Stale `/chat?channel=` example.** Already removed in Phase A's rewrite of
   *Capacitor iOS*.

**Apple team.** Team `B4C87L2787` (the developer's individual account) is used
for development and TestFlight. The seller will later move to the coach's
account through an App Store Connect app transfer. That changes the Team ID:
add the coach's `<TEAMID>.com.firstpit.app` to `appIDs` and deploy it before
the transfer, then switch `DEVELOPMENT_TEAM`.

**Exit criteria:** tapping an invite link on a device with the app installed
opens the join flow in the app; without the app, it opens the website.
**Status:** built; the simulator build carries the entitlement and launches
cleanly. Still needed:

- Deploy: merge to `main` so Vercel serves the association file, then check
  `curl -sI https://www.first-pit.com/.well-known/apple-app-site-association`
  shows `200` and `application/json`.
- ~~A signed device build~~ Done: automatic signing registered the App ID
  with the Associated Domains capability, and the TestFlight build installs.
- Tap an invite link in Mail or Messages on the device. It should open the
  app's join flow, and after sign-in it should keep the invitation.

## Phase D — Native value: push notifications (about 1 week, gated)

App Store guideline 4.2 can reject apps that only wrap a website; push
notifications are the strongest answer. Design sketch: FCM over APNs, device
tokens in a server-only collection (deny-all rules, Admin SDK writes), a
callable to register or unregister a token, and a Functions trigger on
`notifications` that sends the push.

**Gate:** `docs/architecture.md` forbids push permissions without an approved
feature and privacy review. Get that sign-off before building.

Lower-cost extras: haptics on card moves, pull-to-refresh, and the native share
sheet from Phase B.

## Phase E — App Store readiness (in progress)

Done (2026-09-18):

- Paid Apple Developer Program membership (team `B4C87L2787`, individual). The
  updated Program License Agreement was accepted after it blocked the first
  archive ("PLA Update available").
- App Store Connect record created for bundle ID `com.firstpit.app`. The store
  name is **First Pit Team Hub** because "First Pit" was already taken on the
  App Store. The name under the icon stays **First Pit** (`CFBundleDisplayName`).
  The store name can change until release.
- App ID registered with the Associated Domains capability through automatic
  signing.
- Build 1.0 (1) archived, uploaded to TestFlight and installed on the
  developer's iPhone through a TestFlight invite. Export compliance was
  answered by `ITSAppUsesNonExemptEncryption = false`.

Still to do:

- Increase the build number (target → General → Identity) for every upload
  after 1.0 (1).
- `PrivacyInfo.xcprivacy` privacy manifest; privacy labels (email, name, user
  content, no tracking); privacy policy URL.
- Age rating and category. The Kids category restricts third-party SDKs and
  links; the alternative is Productivity or Education with an age rating. Ties
  into the *Pilot policy gate* because the users include minors.
- Account deletion that starts in the app (guideline 5.1.1(v)): confirm that
  `ProfilePage`'s "Request account deletion" really deletes the account.
- A reviewer demo account on a synthetic team with sample data.
- TestFlight: internal testers (in use), then an external group for the pilot
  team (needs Beta App Review), then App Review submission.
- Naming risk: keep "FLL" and "FIRST LEGO League" out of the store name
  (guideline 5.2, others' trademarks); mention them only in the description.
  "FIRST" is itself a FIRST trademark, so confirm the team is comfortable with
  the brand before a public release.
- CI: Xcode Cloud or a macOS GitHub Actions job (`ios:build` → archive →
  TestFlight upload).
- Before release: transfer the app to the coach's developer account (Phase C,
  *Apple team*).
- After approval, replace the landing-page badge with the official "Download
  on the App Store" artwork linked to the listing.

**Exit criteria:** build approved and live, or approved for phased release.

## Phase F — Documentation

With each phase, update *Capacitor iOS* and *Authentication hardening* in
`docs/architecture.md`, the commands in `CLAUDE.md` and `README.md`, and this
file's status table.

## Open decisions

1. Push notifications in v1 (Phase D), or ship without them and risk a 4.2
   rejection?
2. Kids category, or a standard age rating?
3. iPhone only for v1, or iPad too? (The iPad orientations are the template's
   defaults until this is decided.)
4. Seller: the developer's individual account (`B4C87L2787`) is used for
   TestFlight now; the app moves to the coach's account before or at release
   (App Store Connect app transfer). Decide when the coach enrolls.
