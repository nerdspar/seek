# Seek: Books subsystem — plan

Status: **backend live; Seek foundation committed (branch `books`).** Supersedes the
earlier "Goodreads mirror" idea — his wife is replacing Goodreads with this stack
entirely.

## Decisions (2026-10-03) — these override anything below that disagrees

- **Shelfmark dropped.** BookOrbit's indexer-manager is Prowlarr-native (sync all
  indexers in one click) with SABnzbd as the download client.
- **Role split:** Hardcover = *outward discovery only* (search/trending/new over the
  whole catalog — BookOrbit has no global discovery feed). **BookOrbit = everything
  else:** reading list, status, progress, goals, stats, achievements, and per-book
  "more like this" recs (local pgvector over your own library).
- **Multi-user:** one BookOrbit instance, **one shared library**, a BookOrbit account
  per person (status/progress/goals/stats are natively per-user). One Prowlarr+SAB
  serves both. Hardcover sync in BookOrbit is per-user — she links her own token.
  Seek's discovery uses one Hardcover token (public catalog, same for everyone).
- **Separate libraries stay possible:** each Seek user carries a `bookorbitLibraryId`
  (the destination for their uploads/requests). Shared = same id for both; separate
  = different ids + BookOrbit library access. No Seek rework to switch.
- **Per-user OPDS:** each person creates their own OPDS user in BookOrbit; every
  feed is scoped to them. Personal lists = private collections and smart scopes
  with per-user `readStatus`/`readProgress` rules ("Want to read", "Currently
  reading"), exposed as OPDS feeds and optionally synced to Kobo. Seek status
  changes flow straight into those feeds.
- **Identity:** real per-user Seek logins via the household plan
  (`docs/household-multiuser-plan.md`) — built *before* per-user books. The BookOrbit
  client calls BookOrbit **as the signed-in user** (per-user session + cache), never
  a shared service account; the `claude` account is for dev/testing only.
- **UI:** Books is a segment in both Watchlist and Discover, gated by a Settings
  toggle.

**Build order:** household A (auth core) → B (Resend email) → C (per-user Floppy
token **+ BookOrbit login + library id**, encrypted at rest) → Books 1 (segments,
read-only, per-user) → household D–F (shared-show mirroring) → Books 2+ (status
writes, requests, uploads, goals/stats/achievements).

## Decision & stack (all verified live / from source)

| Tool | Role | Hosting |
| --- | --- | --- |
| **Hardcover** | Discovery + social tracking brain: lists, status, ratings, **reading goals**, stats. Free GraphQL API, writable, per-user bearer token (expires yearly). 60 req/min, query depth 3. | Cloud |
| **BookOrbit** | Self-hosted library + files. Owns: uploads, acquisition (indexers+download clients), kosync/OPDS/KOReader+Kobo sync, progress, collections ("shelves"), stats, and a built-in **Hardcover sync** module. | Self-hosted (Docker + Postgres) |
| **Prowlarr** | Indexer source for BookOrbit (Torznab/Newznab). | Self-hosted |
| **Seek** | The unified household phone UI over the above. **Absorbs the `bookshelf` upload role** so that app can be retired. | Self-hosted |

**Shelfmark is likely redundant.** BookOrbit has Torznab/Newznab indexer adapters
(what Prowlarr serves) + qBittorrent/Deluge/Transmission/SABnzbd/NZBGet download-client
adapters + request automation + import. Recommend **dropping Shelfmark** and driving
acquisition through BookOrbit's `book-request` API. (Keep it only if you prefer its
search UX.)

**Two-brain split, kept in sync:**
- *Discovery + lists + status + ratings + goals + social stats* → **Hardcover** (its API is the best at this; nothing self-hosted matches it).
- *Library + files + uploads + acquisition + progress + KOReader/Kobo/Kindle sync* → **BookOrbit** (self-hosted; the bulky part stays on your box).
- BookOrbit's own **Hardcover module** bridges them (pushes reading progress/finishes → Hardcover), so "currently reading / read" updates without manual entry.

## Verified integration surfaces

### BookOrbit (NestJS REST, shared `packages/types` contract)
- **Auth:** `POST /auth/login` → session cookie + `POST /auth/refresh`; `GET /auth/me`. OIDC + magic-link also exist. **No static API key** → Seek holds a per-user service login and maintains the session server-side (like it does FLOPPY_TOKEN).
- **Library/catalog:** `library`, `catalog`, `book`, `cover`, `collection` controllers → browse, metadata, covers, shelves/collections.
- **Reading state/progress:** `reading-state`, `reading-session`, `book-reading-session`, `reading-attempt` → status + progress + sessions. kosync + OPDS also exposed (`koreader/*`, `opds/*`, `kobo/*`).
- **Uploads (replaces bookshelf):** chunked **upload sessions** — `CreateUploadSessionRequest { filename, sizeBytes, idempotencyKey, target, sha256? }`; `target` = `{kind:"library",libraryId,folderId?}` | `{kind:"existing_book",bookId}` | `{kind:"book_dock"}`. Formats: epub/kepub/pdf/mobi/azw3/cbz/cbr/audio. Lifecycle receiving→processing→completed with offset+checksum.
- **Acquisition:** `book-request` (+ `-admin`, `-automation`, `-self-fulfil`), `indexers` (Torznab/Newznab adapters + plugin model + indexer-manager), `download-clients` (qbittorrent/deluge/transmission/sabnzbd/nzbget).
- **Stats/goals:** `statistics`, `user-statistics`, `dashboard`, `achievement`.
- **Hardcover bridge:** `hardcover` controller/module.

### Hardcover (GraphQL)
- `https://api.hardcover.app/v1/graphql`, `Authorization: Bearer <token>` (from hardcover.app/settings, yearly expiry). Free. 60 req/min, 30s timeout, max depth 3.
- Writable: change status (want/reading/read/DNF/paused), add to lists, rate. Goal *mutation* not yet confirmed — **Phase 0 to verify**.
- Scope: your data + public data + followed users (good for household).

### Catalog/discovery fallback
- **Open Library** (subjects/popular) + **Google Books** (real publish dates for new/upcoming). Free, no account. Used by Seek directly for Discover rails that Hardcover doesn't cover, and as a metadata backstop. (Floppy's book discover is junk — not used.)

## Her 7 asks → where each lands

| Ask | Source | Seek UI home |
| --- | --- | --- |
| Discover books | Hardcover (trending/genres/lists) + Open Library/Google Books | Discover tab, **Books mode** (rails like TV/movies) |
| Add to lists (want / read) + auto-complete when finished | Write status → Hardcover; BookOrbit progress 100% → mark read (its Hardcover module may already do this) | Book detail sheet + reading list |
| Download (indexers/Prowlarr) + manual uploads | BookOrbit `book-request` (Prowlarr) for grabs; BookOrbit upload-session for uploads | Grab = detail sheet (mirrors the *arr pattern); **upload + shelf management = Discover-books header buttons** |
| Progress across readers | BookOrbit (kosync) | Progress bars on reading list + detail |
| Kindle/Kobo autosync + OPDS | BookOrbit (Send-to-Kindle, Kobo sync, OPDS) — device-side; Seek just reflects | — |
| Reading goals (yearly + monthly) | Hardcover goals (or Seek-stored if goal mutation unavailable) | A ring at top of Books tab / in Profile |
| Reading stats (books, genres, authors) | BookOrbit stats (time/streaks/heatmap) + Hardcover (genres/authors/counts) | Profile → Books section |

## Seek UI additions
- **Books tab** on the bottom bar? Or a mode-switch inside the existing Watchlist (like the TV/Movie/Anime segment)? → decision below. Leaning: a Books *segment* alongside TV/Movie keeps the tab bar at 4.
- **Discover-books**: new Discover mode; rails from Hardcover + Open Library/Google Books. Header carries the **Upload** button and a **Shelf management** button next to it (his original spec).
- **Book detail sheet**: status control (want/reading/read), rating, progress, grab (interactive + auto), file actions — reuses the ArrEpisodeControl / interactive-search / file-actions patterns already built.
- **Profile → Books**: goals ring, streaks, genres/authors, books-read count.
- **Settings toggle** (`booksManage`, per-user later) like `arrManage`, so the wife sees books and you both control visibility — ties into the household split.

## Household / per-user
- Each person: own Hardcover token + own BookOrbit account. Seek stores both per user → first real driver of the parked household-multiuser work. See `docs/household-multiuser-plan.md`.

## Phased build order
- **Phase 0 — verify & stand up.** Confirm BookOrbit reachable on LAN + a Seek service login; confirm Hardcover goal mutation; stand up BookOrbit + Prowlarr; enable BookOrbit↔Hardcover sync. Wrap BookOrbit behind one Seek server module (`books-bookorbit.ts`) and Hardcover behind `books-hardcover.ts` to isolate churn.
- **Phase 1 — read-only Books.** Reading list from BookOrbit (status + progress + covers); Profile books stats/goals read. Proves the data path end to end.
- **Phase 2 — Discover + lists.** Discover-books rails (Hardcover + Open Library/Google Books); add-to-list / status writes (→ Hardcover, mirrored by BookOrbit).
- **Phase 3 — acquisition.** Search → request/grab via BookOrbit `book-request` (Prowlarr); queue/status surfaced like `/activity`.
- **Phase 4 — uploads (retire bookshelf).** Chunked upload-session from Seek + shelf (collection) management in the Discover header.
- **Phase 5 — polish.** Goals (yearly+monthly), achievements, auto-complete-on-finish, genres/authors stats.

## Open decisions / needed from you
1. **Drop Shelfmark?** (recommend yes — BookOrbit + Prowlarr covers it.)
2. **Books tab vs Books segment** in the existing Watchlist? (lean: segment, to keep 4 tabs.)
3. **BookOrbit base URL** + a service login for Seek (no static API key, so username/password or a dedicated account).
4. **Hardcover tokens** for you and your wife.
5. **Prowlarr** already configured in BookOrbit, or set that up in Phase 0?
6. **Goals storage**: Hardcover-native if its goal mutation works, else Seek-stored — confirm in Phase 0.

## Risks / notes
- **BookOrbit is young-ish** (created May 2026, ~5k★, very active) and its REST API is *internal* (not a documented public API), so it can change between versions. Mitigation: pin the BookOrbit image version, wrap all of it behind `books-bookorbit.ts`.
- **Session auth** (no PAT) means Seek manages BookOrbit login + refresh and stores creds like `FLOPPY_TOKEN` (never in the client bundle; see `auth-session.md` / `src/lib/server/env.ts`).
- **Two trackers in sync**: Hardcover owns discovery/lists/goals; BookOrbit owns files/progress; BookOrbit's Hardcover module is the bridge. Seek reads each for what it's authoritative on rather than trying to reconcile.
- **Hardcover limits** (60/min, depth 3): cache aggressively (Seek already has TTLCache) and split deep queries.
