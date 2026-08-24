# Seek — build specification

A self-hosted PWA front-ending [Floppy](https://github.com/dannyvfilms/Floppy) for
fast episode marking, upcoming releases, and discovery. Replaces Hobi, which is
Trakt-only.

**The problem it solves:** Floppy's web UI takes ~5 taps to mark an episode
watched. Hobi took 1. Everything below is subordinate to that.

---

## 0. Read this first

Floppy is a fork of Yamtrack with a **different API surface**. Training data
about Yamtrack does not apply. Before writing code:

- `GET {FLOPPY_URL}/api/openapi.yaml` — the committed, supported 41-operation
  subset. Authoritative.
- `GET {FLOPPY_URL}/api/v1/info/` — no auth, confirms the build.

Auth header is `X-API-Key`. Bearer is also accepted.

The endpoint facts in §3 were read from Floppy source at spec time. Verify
against the live `openapi.yaml` before relying on any of them — the project
ships daily.

---

## 1. Scope

**Tracks:** TV, movies, and anime.

**Four tabs:** Watchlist · Upcoming · Discover · Profile.

**Non-goals:**
- No changes to Floppy itself. Seek is strictly an API client.
- No local database of watch state. Floppy is the single source of truth.
- No notification delivery — Floppy already does this (§7).
- No stats computation — read them from Floppy (§6.4).

---

## 2. Architecture

Single container, server-rendered or SPA-with-thin-backend. **All third-party
credentials live server-side**, injected via compose env. The browser never
sees the Floppy token or the TMDB key.

```yaml
services:
  seek:
    image: seek:latest
    container_name: seek
    restart: unless-stopped
    environment:
      - "TZ=America/New_York"
      - "FLOPPY_URL=http://floppy:8000"
      - "FLOPPY_TOKEN=<Floppy → Settings → Integrations → API Token>"
      - "FLOPPY_CALENDAR_TOKEN=<see §5.1>"
      - "TMDB_API_KEY=<themoviedb.org key>"
      - "SEEK_SESSION_SECRET=<openssl rand -hex 32>"
    volumes:
      - /mnt/NAS/Data/seek:/data      # preferences only, see §8
    ports:
      - "8100:8100"
    networks:
      - floppy-net
```

Join `floppy-net` so Seek reaches Floppy by container name rather than
traversing the LAN.

**Backend responsibilities:** proxy and reshape Floppy responses, hold
credentials, fetch and parse the iCal feed, call TMDB for discovery, cache
poster/metadata lookups. **Frontend responsibilities:** rendering and gestures
only.

**Auth:** single household user. A simple session cookie gated by one shared
passphrase is sufficient — this is LAN-only. Do not expose Seek through the
reverse proxy without revisiting this.

---

## 3. Floppy API — verified surface

### Reading the library

```
GET /api/v1/media/{media_type}/          # media_type: tv | movie | anime
```

Useful query params (from the contract): `status[]`, `progress`
(`all|caught_up|not_caught_up`), `search`, `sort`, `direction`, `limit`,
`offset`, `genre`, `platform[]`, `collection`, `release`, `rating`, `tag[]`,
`tag_mode`, `year`.

Each result is a `TrackedMediaResponse` carrying:

```
id, item, item_id, tracked, status, progress, progress_scope, progress_unit,
progressed_at, start_date, end_date, score, notes, lists, next_episode
```

**`next_episode` is the key field.** Schema `NextEpisode`, described as "the
next released, unwatched TV-like episode":

```json
{ "season_number": 3, "episode_number": 7, "air_date": "2026-08-20T00:00:00Z" }
```

Nullable. The server resolves next-up — Seek must not compute it.

### Marking watched

```
POST   /api/v1/media/tv/{source}/{media_id}/{season}/episodes/{episode}/watch/
DELETE (same path)
```

- `source` is `tmdb` for everything in this library.
- `media_id` is the **show's** TMDB id, not the episode's.
- Body: `{"end_date": "2026-08-20 21:30:00+00:00"}`. Omit `end_date` and the
  server stamps now. Omitting is correct for normal use.
- **POST appends a play row; it does not upsert.** Two POSTs = two plays.
- **DELETE removes the most recent play.** This is Seek's undo (§4.3).
- The season is auto-created if missing (`resolve_or_create_season`).

Other write paths:

```
POST  /api/v1/media/{media_type}/                          # start tracking
PATCH /api/v1/media/{media_type}/{source}/{media_id}/       # status, score, notes
POST  /api/v1/media/{media_type}/{source}/{media_id}/progress/
POST  /api/v1/media/tv/{source}/{media_id}/{season}/progress/
```

### Show and season detail

```
GET /api/v1/media/{media_type}/{source}/{media_id}/
GET /api/v1/media/{media_type}/{source}/{media_id}/{season_number}/
GET /api/v1/media/{media_type}/{source}/{media_id}/{season}/{episode}/
```

Returns `CompleteMediaResponse`: `title, synopsis, image, backdrop, genres,
score, cast, crew, details, related, max_progress, consumptions,
consumptions_number, lists`.

`details` and `related` are typed as free-form objects — **inspect them at
runtime** rather than assuming a shape. `max_progress` is the episode count for
a season. Episode air dates live inside `details`; walk the structure looking
for objects with an episode number beside a date-like field.

### Search and add

```
GET /api/v1/search/{media_type}/?search=<q>&source=<provider>&limit=&offset=
```

`media_type` accepts `tv`, `movie`, `anime` (among others). This searches the
**provider**, not the local library — it's what backs the add flow.

### Other

```
GET  /api/v1/discover/                    # cached rows, see §5.3
POST /api/v1/discover/refresh/
GET  /api/v1/statistics/overview/         # see §6.4
GET  /api/v1/history/                     # diary
GET  /api/v1/user/preferences/
GET|POST /api/v1/tags/                    # see §9
```

---

## 4. Watchlist tab

The primary screen. Optimise ruthlessly for one-handed marking.

### 4.1 The list

```
GET /api/v1/media/tv/?status=in_progress&progress=not_caught_up
```

Repeat for `movie` and `anime`, or use the segmented control to switch. Segments:
**TV Shows · Movies · Anime**.

Each row:

```
┌──────────┬─────────────────────────────────────────┐
│          │  Show Title                             │
│  poster  │  S05E01 · The Crossing                  │
│          │  ▓▓▓▓▓▓▓▓░░░░  40/50      10 left       │
└──────────┴─────────────────────────────────────────┘
```

Season/episode/title come from `next_episode` plus a title lookup. Progress bar
from `progress` / `max_progress`.

The row needs **two distinct destinations**, and both must be reachable from the
watchlist without a detour:

- **Show page** — seasons list, progress per season, cast, next-airs (§6.1)
- **Episode sheet** — synopsis, still, air date, runtime for the *next* episode
  specifically (§4.4)

Hobi solves this with a chunky "Episode Info" button that eats a third of the
row. Keep both destinations, drop the button: **make the episode line itself the
episode affordance.**

```
┌──────────┬─────────────────────────────────────────┐
│          │  Show Title                    ← show   │
│  poster  │ ╭─────────────────────────────╮         │
│   ← show │ │ S05E01 · The Crossing    ⓘ │ ← sheet │
│          │ ╰─────────────────────────────╯         │
│          │  ▓▓▓▓▓▓▓▓░░░░  40/50      10 left       │
└──────────┴─────────────────────────────────────────┘
```

- **Tap the episode pill** (the `SxxEyy · Title` line, rendered on
  `--surface-raised` with a trailing info glyph) → episode detail sheet
- **Tap anywhere else in the row** — poster, title, progress bar → show page
- **Swipe** → mark watched (§4.2)

The pill must be a full 44px touch target and visually distinct from the plain
title above it, or the two destinations become a coin flip. The subtle
background is doing real work here; don't flatten it.

This is the same information architecture as Hobi with the affordance moved onto
the content it describes, reclaiming the row width the button was using.

### 4.2 Swipe to mark

The core interaction. One gesture, no confirmation.

- Default direction **right-to-left** (Hobi does left-to-right; the user wants
  the opposite).
- Setting: `swipe.markDirection` = `rtl` | `ltr`. Structure the gesture handler
  so the opposite direction can be bound to a second action later — leave it
  unbound for now, don't invent one.
- Reveal shows an eye icon and "Mark as Watched" against the signal gradient.
- On release past threshold: fire the POST, advance the row optimistically to
  the next episode, and refetch that row in the background.
- Haptic feedback on commit.

### 4.3 Undo

Mis-swipes will happen. After a successful mark, show a toast for ~6s with
**Undo**, which issues `DELETE` on the same path (removes the most recent play).
Revert the row optimistically on undo.

### 4.4 Episode detail sheet

Bottom sheet, not a page. Reached by tapping a row, or an episode inside a
season list. Contains: still image, **Mark as Watched** button, air date,
runtime, `SxxEyy`, episode title, synopsis.

Do not navigate away to show this — the point is to stay in the list.

### 4.5 Sort

Sort control top-right opens a sheet: Recently watched · Newest episode ·
Oldest episode · Alphabetical · Total episodes · Episodes left to watch. Map to
the `sort` and `direction` params. Persist the choice per media type.

### 4.6 Filter

Hobi's filter icon sits beside the sort control. Minimum: filter by status and
by platform, using `status[]` and `platform[]`.

---

## 5. Upcoming tab

### 5.1 Data source — important

**Floppy's calendar is not on `/api/v1/`.** The 41-operation subset has no
calendar endpoint. The feed lives at:

```
GET {FLOPPY_URL}/calendar/download/{token}      # iCalendar
```

The token is per-user, obtained from Floppy's calendar page. Seek's **backend**
fetches and parses this `.ics` on a schedule (every 30–60 min is plenty), caches
the parsed events, and serves them to the frontend as JSON.

Underlying `Event` rows carry `item`, `content_number`, and `datetime` — so the
feed has episode numbers and **air times**, not just dates.

If a calendar endpoint appears in `openapi.yaml` by build time, prefer it.

### 5.2 The timeline

Vertical gradient rail on the left with relative-time markers (9 Hours, 2 Days,
4 Days), poster and details on the right: title, `SxxEyy`, and the **absolute
air date and time**.

Show the air time everywhere, including the show page — Hobi omits it and the
user specifically wants it.

### 5.3 What moves out

Hobi puts Trending / Premiering / Returning / Most Wanted shelves at the bottom
of Upcoming. **Move these to Discover.** Upcoming is only the timeline for
things already tracked.

---

## 6. Discover tab

The tab Hobi does worst and the one the user's wife will actually use. Design
for *"I want a heist show"* and *"something like the thing we watched last
week"*, not just a trending grid.

### 6.1 Rows

1. **Trending now** — mixed TV/movie/anime.
2. **Because you watched _X_** — similarity seeded from recent history. Floppy's
   own Discover already computes personalised rows; prefer them over rolling
   your own.
3. **Top on your services** — trending filtered by streaming provider. Requires
   watch-provider data, which comes from TMDB (§6.3), not Floppy.
4. **Premiering this month** / **Returning this month** — from the shelves moved
   out of Upcoming.

Floppy source: `GET /api/v1/discover/?media_type=<tv|movie|anime>&show_more=`,
returning `{media_type, show_more, rows[]}`. Rows are cached server-side;
`POST /api/v1/discover/refresh/` queues a rebuild. Inspect a live response for
row shape.

### 6.2 Mood and theme search

The distinguishing feature. A search that understands "heist", "slow burn
mystery", "workplace comedy".

Implement with **TMDB keyword search**:

```
GET /search/keyword?query=heist                  → keyword ids
GET /discover/tv?with_keywords=<id>&sort_by=popularity.desc
GET /discover/movie?with_keywords=<id>&…
```

Offer a row of preset chips (Heist · Time travel · Courtroom · Slow burn ·
Workplace comedy · Whodunnit) alongside free text, so it's usable without
knowing what to type. Chips map to known keyword ids; free text goes through
`/search/keyword` first.

Combine with `with_genres`, `vote_average.gte`, `with_watch_providers`, and
`watch_region=US` to support "highly rated heist shows on Netflix".

### 6.3 Streaming availability

TMDB `/watch/providers` per title, `watch_region=US`. Cache aggressively —
provider data changes slowly and the calls add up. Show the provider badge on
detail pages the way Hobi does ("Netflix", "Apple TV+").

Let the household filter Discover to services they actually subscribe to; store
the subscribed set in Seek preferences (§8).

### 6.4 Adding from Discover

Every Discover and search result carries an inline **Add Show** / **Add Movie**
button, and the detail page carries the same. Both call
`POST /api/v1/media/{media_type}/` with the TMDB id.

Search is **live with a 1s debounce** after typing stops. Filter chips: Best
Match · TV Shows · Movies · Anime.

---

## 7. Profile tab

### 7.1 Stats — read, don't compute

```
GET /api/v1/statistics/overview/
```

Supports range selection (this month / this year / last year / all time).
Everything Hobi shows — total minutes, episodes watched, movies watched, shows
watched, most-watched titles, favourite genres, top network — should come from
this endpoint. **Seek computes nothing.**

If Floppy's overview lacks something Hobi had (binge rhythm, streaks, finish
rate), leave it out of v1 rather than deriving it client-side. Revisit later by
asking upstream to expose it.

### 7.2 Collection

Rows for My TV Shows / My Movies / My Anime / Archive, each with **View All**,
mirroring Hobi's Collection section. Backed by
`GET /api/v1/media/{media_type}/` with appropriate status filters.

### 7.3 Diary

`GET /api/v1/history/` — day-by-day watch history grouped by date, newest first,
with poster, title, `SxxEyy`, and timestamp.

---

## 8. Settings

Seek stores **only its own preferences** in `/data` (a small JSON file or SQLite
is fine). Anything about watch state belongs to Floppy.

| Setting | Default |
|---|---|
| Swipe direction to mark watched | right-to-left |
| Theme | Midnight (§10) |
| Default tab on launch | Watchlist |
| Default watchlist sort | Recently watched |
| Subscribed streaming services | empty |
| Show anime as separate segment | on |

Also surface, read-only, a link out to Floppy's own settings for notifications
and integrations, so there's one obvious place to go.

---

## 9. Notifications — do not build

**Floppy already integrates Apprise.** The user model has a `notification_urls`
field and Floppy sends release notifications through it, with per-item
exclusions via `notification_excluded_items`.

So: configure Pushover in **Floppy's** notification settings
(`pover://user@token`), not in Seek. Apprise supports the full backend stack, so
other targets work by adding URLs.

Seek's only job here is a settings row linking to Floppy's notification page.

---

## 10. Design

Dark, near-black, with an electric blue-to-violet gradient as the single accent
— the house style, and it also matches Hobi closely enough that the switch won't
feel like a downgrade.

```
--bg              #08080C    /* near-black, not pure */
--surface         #14141C    /* cards, sheets */
--surface-raised  #1E1E28    /* controls, chips */
--text            #F4F5FA
--text-dim        #8A8DA0
--signal-from     #5B6CFF    /* electric blue */
--signal-to       #B36BFF    /* violet */
--signal-solid    #6B7BFF    /* single-colour fallback */
```

Gradient (`--signal-from` → `--signal-to`) is reserved for: progress bars, the
swipe-to-mark reveal, the FAB, active tab icon, and primary buttons. Nothing
else. If everything is gradient, nothing reads as actionable.

Theme setting should be structured as swappable token sets from day one, even if
Midnight is the only one shipped.

**Type:** system stack (`-apple-system, SF Pro`) — this is an iOS home-screen
app and the native face is right. Tabular numerals for progress counts and
timestamps so they don't jitter.

**Touch targets:** 44px minimum. The FAB sits bottom-right above the tab bar on
every tab.

**PWA:** `display: standalone`, apple-touch-icon at 180px, manifest icons at
192/512, theme-color `#08080C`. Must work one-handed on an iPhone.

---

## 11. Household / joint watching

The user tracks everything he watches, including things watched together; his
wife doesn't track separately. A "solo vs joint" marker is desirable but **must
not require modifying Floppy**.

**Joint watching is show-level, not episode-level** in this household: a show is
either one they watch together or one he watches alone, consistently. That makes
Floppy's tag system an exact fit rather than a workaround.

Floppy has tags at item level (`GET|POST /api/v1/tags/`, `PUT|GET
/api/v1/media/{media_type}/{source}/{media_id}/tags/`), and the media list
endpoint filters on them (`tag[]`, `tag_mode`, `tag_exclude`). A `joint` tag on
the show is all that's needed — no per-play attribution, no Floppy changes.

That buys:

- A **Solo / Joint / All** filter on the watchlist, so "what can we watch
  tonight" is one tap. This is the actual payoff — the tag alone is just
  bookkeeping.
- A toggle on the show page to set it.
- Optionally a badge on watchlist rows.

**Recommendation:** still v2, but only because the core loop should be proven
first — not because it's awkward. It's a small piece of work landing on existing
API surface, and worth doing early in v2 rather than late.

---

## 12. Known traps

Learned the hard way during the Trakt migration:

1. **Anime buckets.** Floppy files grouped anime under a different
   `library_media_type`. If the user's Anime Library setting is `TV Library`,
   everything shares one bucket and TMDB ids work uniformly. If it's ever set
   back to `Anime Library`, watch calls 404 with `UNIQUE constraint failed:
   app_tv.user_id, app_tv.item_id`. On that specific error, retry with
   `{"library_media_type": "anime"}` in the body.

2. **Episode media_id is the show's TMDB id.** Not the episode's. Trakt-style
   ids will silently produce wrong results.

3. **POST appends, it does not upsert.** Never retry a watch POST blindly on
   timeout — you'll double the play. Retry only on connection errors where you
   can confirm nothing was written, or accept the duplicate and expose undo.

4. **Season/episode numbering can disagree with TMDB.** Some shows (Re:ZERO in
   this library) use absolute numbering upstream. Trust Floppy's `next_episode`
   over anything computed.

5. **`status` appears twice in Floppy's CSV export** (media status and user
   status). Irrelevant to the API but will bite if Seek ever touches exports.

6. **`details` and `related` are free-form.** Probe at runtime; don't hardcode
   paths into them.

---

## 13. Build order

1. Backend skeleton + Floppy proxy + `/api/v1/info/` health check.
2. Watchlist list view, read-only.
3. Swipe to mark + undo. **Stop and use it for a day.** This is the whole point;
   if it isn't faster than Hobi, nothing else matters.
4. Episode sheet, show page, season list.
5. Search and add.
6. Upcoming (iCal fetch and parse).
7. Discover — Floppy rows first, TMDB keyword search second.
8. Profile and settings.

---

## 14. Open questions

- Does Floppy's `/api/v1/statistics/overview/` cover enough that Profile is
  worth building, or should it link out to Floppy's stats page in v1?
- Does the iCal feed include air *times* reliably across providers, or only
  dates for some shows?
- Is Floppy's Discover personalisation good enough to power "because you
  watched", or does that need TMDB `/similar` and `/recommendations`?

Answer these by inspecting live responses before committing to the design.
