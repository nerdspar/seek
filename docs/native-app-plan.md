# Seek goes native — plan

**Goal:** replace the web app with a native Seek for iPhone, iPad, Mac and Apple Watch, with
iCloud as the database. Every modern Apple platform feature that fits a TV/movie/book tracker is
in scope. The NAS server shrinks to a small **bridge** that only does what a phone can't: receive
Jellyfin's webhook, talk to Sonarr/Radarr on the LAN, and feed MagicMirror.

**Status:** planned 2026-10-11. Nothing built.

**Decided (Scott, 2026-10-11):**
- No web app once iPhone, iPad and Mac are covered.
- Jellyfin is not exposed to the internet and stays that way. Seek's server is exposed
  (`seek.nerdspar.com` through the Cloudflare tunnel) and keeps receiving Jellyfin's webhook.
- "I want it all": every modern iOS feature that earns its place, not a minimal port.

## Why

| Today (web app) | Native |
|---|---|
| Fights Safari over safe areas, the tab bar, status-bar blur (`pwa-chrome.md` exists because of this) | Real system chrome, Liquid Glass, no workarounds |
| Every screen waits on the NAS; offline is a service-worker cache plus a write queue | The database is on the device; offline is the normal case |
| Web Push digest, iOS-PWA only, needs the server's scheduler | Local notifications, Live Activities, interactive widgets |
| Accounts, passwords, Resend email, sessions | Your Apple ID; no login screen |
| Household mirroring is server code | iCloud sharing: one shared zone both of you write to |
| One place to use it: the phone's home screen | iPhone, iPad, Mac, Watch, widgets, Siri, Spotlight, Control Center, Lock Screen |

What we give up: Seek in a browser or on Android (accepted), and a single server-side view of
everyone's data (each person's data now lives in their own iCloud).

## Architecture

```
 ┌───────────── iCloud (CloudKit) ─────────────┐
 │  Scott's private DB      Jenny's private DB  │
 │  ┌──────────────┐        ┌──────────────┐    │
 │  │ tracked, solo│        │ tracked, solo│    │
 │  │ plays, prefs │        │ plays, prefs │    │
 │  └──────────────┘        └──────────────┘    │
 │        Household zone (owned by Scott,       │
 │        shared to Jenny with a CKShare)       │
 │  ┌─────────────────────────────────────────┐ │
 │  │ shared titles + their plays, new-show   │ │
 │  │ choices, anime overrides                │ │
 │  └─────────────────────────────────────────┘ │
 └──────────────▲───────────────────▲───────────┘
                │ CKSyncEngine      │
   iPhone · iPad · Mac · Watch  (GRDB/SQLite on each device + local TMDB catalog cache)
                │                   │
                │ HTTPS, device token / APNs
                ▼
   Seek Bridge (today's server, slimmed) on the NAS, exposed via the tunnel
     • /webhook/jellyfin/{token}  → per-person play inbox → silent push to that person's devices
     • Jellyfin PlaybackStart/Stop → push-to-start / update / end a "Now watching" Live Activity
     • Sonarr / Radarr proxy (keys stay on the NAS)
     • MagicMirror feed: the app uploads an Upcoming snapshot; MMM-seek reads it as today
```

### On the device

- **Store:** SQLite through **GRDB**, one database per device in an App Group container so the
  app, widgets, intents and extensions all read it.
- **Sync:** **CKSyncEngine** (iOS 17+), one engine for the private database and one for the
  shared database. Chosen over SwiftData because SwiftData's CloudKit sync covers only the private
  database; the household zone is a *shared* database and it is Seek's core feature. Re-check
  this at build time; if iOS 26 SwiftData supports shared databases cleanly, reconsider.
- **Catalog** (titles, seasons, episodes, art, air dates): pulled from TMDB + TVmaze straight
  from the app, cached locally, **never synced**. It can always be rebuilt, and keeping it out of
  iCloud keeps sync small. Same airing-aware refresh rules as `catalog/refresh.ts`, run on launch,
  in `BGAppRefreshTask`, and when a widget timeline reloads.
- **Domain logic** ported from TypeScript to a Swift package with the same rules: next-up
  (`tracking/nextUp.ts`), stats (`tracking/stats.ts`), the anime rule (`tracking/anime.ts`), the
  Jellyfin payload mapping (`tracking/jellyfinPayload.ts`, used by the bridge *and* for local
  fixtures), split-show handling (Bake Off), merged two-parters.

### Records in iCloud

| Record | Zone | Fields | Notes |
|---|---|---|---|
| `Tracked` | private | mediaType, tmdbId, status, score, notes, addedAt | One per title per person. Last-write-wins |
| `Play` | private | mediaType, tmdbId, season, episode, watchedAt, source | Solo titles. Add-only, so no conflicts |
| `Prefs` | private | everything in `Prefs` today that is per person | One record |
| `Wishlist`, `BookWish` | private | | |
| `SharedTitle` | household | mediaType, tmdbId, title, addedBy, createdAt | Replaces `shared_shows` |
| `SharedPlay` | household | as `Play` | One record per viewing; counts for every member. Replaces "write a play for each person" |
| `ShowChoice` | household | together / solo / ask per new show | Replaces `show_choices` |
| `AnimeOverride` | household | | Replaces `anime_overrides` |

- **Record names are deterministic** where a play can arrive twice: Jellyfin plays are named from
  a hash of (person, TMDB id, season, episode, Jellyfin's play date). Two devices draining the same
  inbox write the *same* record, so no duplicates.
- **Shared plays keep today's ±12 h rule:** a play within 12 h of an existing play of the same
  episode is the same viewing. A small de-dup pass runs after each sync.
- **Sharing a title** moves both people's plays for it into the household zone (merged with the
  ±12 h rule). **Unsharing** copies them back into each person's private zone.
- **Per-person stats** = your private plays + household plays.

### The bridge (today's server, slimmed)

Kept from the current server: the users table (now people ↔ Apple identity ↔ Jellyfin token),
the Jellyfin webhook and payload mapping, `webhook_unmatched`, the *arr routes, the feed token.

Added:
- **Play inbox:** an incoming webhook play is stored for that person, then a **silent push** wakes
  their devices. The app also drains the inbox on launch, on foreground, in background refresh and
  on widget reload, so a throttled push only delays it. The app acknowledges each play after it is
  in iCloud, and the bridge deletes it.
- **Live Activities:** Jellyfin's PlaybackStart webhook push-starts a "Now watching" activity
  (iOS 17.2+ push-to-start); progress events update it; PlaybackStop ends it and the play lands
  through the inbox.
- **Sign in with Apple:** each device signs in once; the bridge checks Apple's identity token and
  issues a device token kept in Keychain. The owner approves new people.
- **MMM feed:** the app uploads `upcoming.json` after each refresh; `/feed/{token}/upcoming.json`
  serves the latest one.

Removed once cutover is done: tracking tables, catalog refresh, household mirroring, books proxy
(the app calls Hardcover and BookOrbit directly), Web Push, Resend, email logins, the whole
SvelteKit UI.

**App Store note:** the bridge is optional. Without it, the app works fully except Jellyfin
auto-logging, Live Activities from playback, and *arr. That's what makes a public release
possible later.

## Features ("all of it")

### App and design
- **iOS 26 Liquid Glass** throughout: glass tab bar that minimises on scroll, glass toolbars, sheets.
- **One multiplatform SwiftUI target** for iPhone, iPad and Mac (native macOS, not Catalyst).
- iPad/Mac: `NavigationSplitView` sidebar, multiple windows, Stage Manager, keyboard shortcuts,
  menu bar commands, pointer hover effects, drag and drop (drag a poster into a list, drop an
  EPUB to upload a book).
- Mac: a **menu bar extra** with Up Next and one-click mark watched; a Settings window.
- **Zoom navigation transitions** from poster to detail page, matched-geometry hero art, scroll
  transitions, **mesh gradients** for the accent (today's gradient, done natively), SF Symbols
  animations, sensory feedback (haptics) on mark/unmark.
- Dynamic Type, VoiceOver labels, Reduce Motion, high contrast; light/dark/system + accent picker
  as today.
- **TipKit** for discoverability (long-press to rewatch, swipe to mark).

### Widgets and system surfaces
- **Home Screen widgets** (small to extra large): Up Next, Airing tonight, Upcoming this week,
  Currently reading with progress, Reading goal.
- **Interactive widgets:** a Mark watched button on Up Next (App Intent; runs without opening the app).
- **Configurable widgets:** pick a show, or "together" vs "mine".
- **Lock Screen** accessory widgets, **StandBy**, Mac desktop widgets, the **Watch Smart Stack**.
- **Control Center controls** (iOS 18+): "Mark next episode", "Open Up Next". Also usable from the
  **Action button**.
- **Live Activities + Dynamic Island:** "Now watching" from Jellyfin playback; "Starts in 30 min"
  countdown for an episode you've chosen to watch live.

### Siri, Shortcuts, Spotlight, Apple Intelligence
- **App Intents** for everything a person might say: mark next episode of X, mark movie watched,
  what's on tonight, what's next for us, add to watchlist, start reading, update page.
- **App Shortcuts** with zero-setup Siri phrases; all intents available in Shortcuts and automations.
- **App Entities** for show, movie, episode and book, marked `IndexedEntity` so they appear in
  **Spotlight** and Siri can reason about them.
- **Apple Intelligence / Foundation Models** (on-device, iOS 26): the mood search becomes a
  `@Generable` structured request ("cozy British mystery, under 45 min, something we haven't
  started") that maps to TMDB discover filters plus your own library. Also "why you might like
  this" blurbs and a spoiler-free "previously on" from episode overviews. Falls back to the
  current keyword parsing on devices without Apple Intelligence.
- **Visual Intelligence** (iOS 26): point the camera at a poster or screenshot, Seek offers the
  matching title. *Verify the API surface at build time.*
- **Focus filters:** e.g. a "Family" Focus hides solo shows.
- Handoff between iPhone, iPad and Mac (`NSUserActivity` on every detail page).

### Notifications
- **Local, scheduled on the device** from the catalog: "Airing tonight" digest at your chosen
  hour, at-air-time alerts, new-season alerts, new shows the household should answer together/solo.
- **Actionable:** Mark watched, Snooze, "Together / Just me" right from the notification.
- **Rich:** poster attached; a notification content extension shows the episode card.
- Time-sensitive level for at-air-time alerts; grouped per show.

### Sharing and household
- Household set up with the system iCloud sharing sheet (`ShareLink` with a `CKShare`): Scott
  invites Jenny once.
- The together/solo picker, new-show inbox and household page carry over.
- **Share extension:** share from IMDb, Letterboxd, TMDB, Safari or Jellyfin's web page into
  Seek → add or mark watched. **Universal links** for show/movie pages.
- **SharePlay** (stretch): pick tonight's show together from two devices; "together" marks credit
  both people.

### Apple Watch
- Up Next and Airing tonight lists, mark watched, rewatch.
- Complications and Smart Stack widgets; **double tap** to mark the top Up Next item.
- Syncs straight from iCloud (no phone needed).

### Books
- Your books (Hardcover shelf), reading goal, status/rating/page updates, discovery and facet
  filter, "In my library" (BookOrbit), requests, send to device.
- Uploads through the Files picker, drag and drop on iPad/Mac, the share sheet ("Share EPUB to
  Seek"), using BookOrbit's resumable upload sessions directly.
- Hardcover token and BookOrbit login in **iCloud Keychain**, so every device of the same person
  has them.

### Sonarr / Radarr
- Everything from the *arr management plan (edit, search, grab, file ops, activity) through the
  bridge. Shown only when the bridge is connected and the person is allowed.

### Stretch platforms
- **Apple TV:** Up Next in the **Top Shelf**, a simple tvOS app that opens the episode in Jellyfin
  (Swiftfin) and marks it watched.
- **Vision Pro:** the iPad app runs as-is; a native window later if wanted.

## Repository and tooling

- New repo **`seek-apple`**. Pushing to `main` here deploys the server container; Swift changes
  must not trigger that.
- **XcodeGen** (`project.yml`) generates the Xcode project, so targets and settings are text that
  can be reviewed and edited from the command line, not hand-edited `.pbxproj`.
- Swift packages:
  - `SeekCore`: models, GRDB store, CKSyncEngine sync, next-up, stats, anime rule, de-dup.
  - `SeekCatalog`: TMDB and TVmaze clients, refresh scheduling.
  - `SeekBooks`: Hardcover (GraphQL) and BookOrbit clients.
  - `SeekBridge`: bridge client, inbox drain, Sign in with Apple pairing.
  - `SeekUI`: design tokens and shared components (port of `design-system.md`).
- Targets: app (iOS/iPadOS/macOS), widget extension (widgets, controls, Live Activities), Watch
  app, share extension, notification content extension, Top Shelf extension (stretch).
- Minimum OS: **iOS / iPadOS / macOS 26, watchOS 26**. Two-person household on current devices,
  and it unlocks Liquid Glass, Foundation Models and the newest App Intents without fallbacks
  everywhere. (Foundation Models still needs an Apple Intelligence device; fallback above.)
- Bundle ID `com.nerdspar.seek`, iCloud container `iCloud.com.nerdspar.seek`, App Group
  `group.com.nerdspar.seek`.
- **Tests:** Swift Testing for every package. Domain logic is ported **with its test cases**:
  the TS tests' inputs/expected outputs move to shared JSON fixtures that both the TS and Swift
  suites run, so parity is proven rather than assumed. UI: snapshot tests for key screens, a few
  XCUITest smoke flows. CloudKit sync tested against an in-memory fake plus a manual two-account
  checklist.
- **CI:** GitHub Actions on macOS runs build + tests on every push. **Xcode Cloud** (25 free
  hours/month with the developer program) builds and uploads to **TestFlight** from `main`.
- The bridge stays in this repo (`seek`) and keeps its Vitest suite.

## Migration from today's Seek

1. Add `GET /api/export` to the current server: per person, every tracked title, play, pref,
   wishlist item, plus the household's shared titles, show choices and anime overrides.
2. The app's first launch (signed in to the bridge) pulls the export and writes it to iCloud.
   Runs as a `BGContinuedProcessingTask` (iOS 26) with system progress so it survives
   backgrounding.
3. **Check by exact totals**, as with the Floppy move: plays per person (13,995 Scott today),
   tracked counts, shared titles; next-up for every tracked show compared title by title against
   the server's answer. Any difference is listed, not silently fixed.
4. **Cutover day:** the web app goes read-only, the bridge switches the webhook from "write to the
   DB" to "inbox + push", the app becomes the only writer. The web app stays read-only for a few
   weeks as a fallback, then the UI is deleted.

## Phases

Each phase ends with tests green and a TestFlight build both of you install.

| # | Phase | Delivers | Done when |
|---|---|---|---|
| 0 | Accounts and skeleton | Developer account setup (App ID, iCloud container, App Group, APNs key, Sign in with Apple), `seek-apple` repo, XcodeGen project, CI, first empty TestFlight build | A blank Seek installs on both phones from TestFlight |
| 1 | Core data | GRDB store, CKSyncEngine (private), TMDB/TVmaze catalog, ported next-up/stats/anime with shared fixtures, export endpoint + import | Imported totals match the server exactly; next-up matches for every show |
| 2 | The core loop | Watchlist, show/season/movie pages, mark/unmark, rewatch menu, Upcoming, search (list/grid), Discover shelves, Profile + stats | Scott uses the native app instead of the web app for a week |
| 3 | Household | Household zone + `CKShare`, together/solo picker, new-show inbox, sharing moves plays, de-dup pass | Jenny on her own Apple ID; a mark on a shared show shows on the other phone |
| 4 | Bridge + Jellyfin | Sign in with Apple pairing, play inbox + silent push, Jellyfin plays arrive in iCloud, MMM feed upload | Cutover: web app read-only, Jellyfin plays land in the app for both people |
| 5 | Notifications + Live Activities | Local digest/at-air/new-season, actionable + rich notifications, Now watching Live Activity, Dynamic Island, countdown activity | Both of you get tonight's digest and a Live Activity while watching |
| 6 | Widgets + controls | All widget families, interactive mark watched, configurable widgets, Lock Screen, StandBy, Control Center, Action button | Mark next episode without opening the app, from widget and Control Center |
| 7 | Siri, Spotlight, intelligence | App Intents + Entities, App Shortcuts, Spotlight, Focus filters, Handoff, Foundation Models mood search and blurbs, Visual Intelligence | "Hey Siri, mark the next Severance watched" works; mood search runs on device |
| 8 | iPad + Mac polish | Sidebar layouts, multi-window, keyboard shortcuts, menu bar commands, Mac menu bar extra, drag and drop | Daily use on the Mac feels native, not stretched |
| 9 | Books | Hardcover + BookOrbit clients, all book screens, uploads via Files/drag/share, book widgets and intents | Jenny tracks reading only in the native app |
| 10 | Sonarr / Radarr | *arr screens through the bridge | Parity with the web *arr pages |
| 11 | Watch + extras | Watch app + complications + double tap, share extension, universal links, TipKit, notification content extension | Mark from the wrist; share from IMDb into Seek |
| 12 | Retire the web app | Delete the SvelteKit UI and the tables the app now owns; the bridge is all that runs on the NAS | The NAS container is the bridge only |
| — | Stretch | Apple TV Top Shelf app, SharePlay picking, Vision Pro window, public App Store release | As wanted |

Phases 5–8 can run in any order after 4; books (9) can move earlier if Jenny wants it sooner.

## Risks and open questions

- **CloudKit sharing is the hardest part.** Shared databases, share acceptance, zone ownership
  and what happens if the owner leaves all need care. Mitigation: build it in phase 3 against a
  fake first, then a two-account manual checklist. If Scott's iCloud ever goes away, Jenny keeps a
  copy (unshare copies plays back to each private zone).
- **Silent pushes are throttled.** Jellyfin plays may arrive a few minutes late on the phone.
  Mitigation: drain the inbox on every launch, foreground, background refresh and widget reload.
- **iCloud must be signed in** with iCloud Drive on for Seek; the app explains this instead of
  failing quietly.
- **TMDB key ships in the app.** Fine under TMDB's terms for apps; requests come from each device
  so rate limits are per person. Needs TMDB attribution in Settings (also required for App Store).
- **Foundation Models / Visual Intelligence** need Apple Intelligence hardware and their exact
  APIs should be checked against the iOS 26 SDK before phase 7.
- **One more codebase to maintain** until phase 12; the web app gets bug fixes only from phase 2.
- **Name:** the home-screen name is **Seek** (decided). App Store listing names must be unique and
  "Seek" is likely taken (Seek by iNaturalist), so a public listing would need something like
  "Seek: TV & Book Tracker" while the icon still says Seek.
- **App Store:** a possible later release, not a requirement now (decided 2026-10-11). Keep the
  bridge optional and the TMDB attribution in, but don't polish the no-bridge path yet.
- **Paid developer account timing:** a free Apple ID can build to Scott's own devices (7-day
  signing, no TestFlight) but cannot use iCloud/CloudKit, push notifications or Sign in with Apple.
  So phase 0 and the UI/catalog/domain-logic parts of phases 1–2 can start free against a
  local-only store; enroll before turning on CloudKit sync.

## What Scott needs to do

1. Enroll in the Apple Developer Program (if not already) and tell me the Team ID.
2. In the developer portal (or let Xcode do it): App ID `com.nerdspar.seek` with iCloud,
   Push Notifications, App Groups, Sign in with Apple; an APNs auth key (`.p8`) for the bridge.
3. Create the `seek-apple` GitHub repo.
4. In App Store Connect: the app record, and Jenny as a TestFlight tester.
5. Make sure Jenny's devices are on iOS 26 with iCloud signed in.
