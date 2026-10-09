# Seek tracks watches itself — plan

**Goal:** retire Floppy. Seek stores what each person has watched in its own database, gets show
and movie information straight from TMDB, and receives Jellyfin's "watched" webhook itself. Same
shape as books: one home per fact, Seek is the only app you use.

**Status:** proposed 2026-10-09, for review. Nothing is built yet.

## Why

Seek only uses Floppy for TV and movie tracking, never its own UI, and a lot of Seek's code exists
to work around how Floppy stores things:

| Recent problem | Cause | Goes away? |
|---|---|---|
| Next-up stuck on S01E01, or missing (Avatar: Seven Havens) | Floppy's `next_episode` is "lowest unwatched", and its show summary is cached up to 24h | Yes: Seek computes next-up from your plays and the episode list |
| Re:Zero E83 marked in Floppy but never shown | Floppy's anime library buckets: the play landed in a bucket Seek doesn't read | Yes: no buckets; anime is a flag |
| Films "Completed" with no play, or a play with "Planning" | Floppy's status and plays drift apart on films | Yes: watched means "has a play" |
| Several seconds before a marked row moves | Each mark is 3–6 calls to Floppy, including a title search of the whole list | Yes: a local write plus a local next-up, a few milliseconds |
| Household mirroring job, retries, late-scrobble lookback | Two separate Floppy accounts kept in step on a timer | Mostly: one database, "watched together" writes both plays at once |

What we give up: Floppy's own UI, its other media types (unused), its import tools (the Trakt
import is already done), and Floppy's daily fixes. Seek owns the bugs from here on.

## One home per fact

| Fact | Lives in | Notes |
|---|---|---|
| Show, season, episode, movie info: titles, art, air dates, runtimes, genres, networks | TMDB, cached in Seek | Your existing free key. Refresh schedule below |
| What you track, status, rating, added date | Seek | Per person |
| Plays (each episode or film watched, with when) | Seek | Per person; rewatches are extra plays |
| Watched together (shared shows) | Seek | Already Seek's (`shared_shows`); marking writes a play for each person |
| Anime or not | Seek | TMDB genre + origin, with the household overrides that exist today |
| Air **times** (not just dates) | TVmaze (free, no key) | See "Open questions" |
| Files, downloads | Sonarr / Radarr | Unchanged |
| Books | Hardcover / BookOrbit | Unchanged |

No TVDB key and no AniBridge: shows are stored in TMDB's own seasons (Re:Zero is four seasons, not
one long one), so Jellyfin's `S04E17` maps across directly. A library that sends TVDB ids instead is
resolved through TMDB's `/find`, which accepts TVDB episode ids.

## What Seek stores

New tables (the SQLite file Seek already uses):

- **`titles`** — one row per TMDB show or movie Seek knows about: type, title, poster, status
  (returning/ended), genres, networks, runtime, anime flag, `refreshed_at`, `refresh_after`.
- **`episodes`** — per show: season, number, title, air date (+ air time when known), runtime,
  still image. Specials (season 0) stored but ignored for next-up and progress.
- **`tracked`** — per person per title: status (Planning, Watching, Paused, Dropped, Completed),
  rating, added date, last activity.
- **`plays`** — per person: title, season, episode (null for films), `watched_at`, `source`
  (seek / jellyfin / import), idempotency key. Undo removes the newest play.

Everything Seek shows today derives from these:

- **Next-up:** after the last episode you played in the season you're watching, among episodes that
  have aired; roll into the next season you haven't started; "caught up" when nothing aired is left.
  The current corrections (`nextUpFor`, `firstAiredFor`) are deleted.
- **Progress bars, season counts:** counts of distinct played episodes vs aired episodes, from the
  same tables. No day-old TMDB count to disagree with (the Below Deck Med bug can't recur).
- **Watchlist / Library / sorting / filters:** one query. No 200-row paging, no closed sort list.

## Keeping TMDB info fresh

- **Airing shows** (an episode aired in the last 7 days or airs in the next 14): refresh hourly, and
  again just after an episode's air time. A premiere shows up within the hour, not the next day.
- **Returning but between seasons:** daily. **Ended:** weekly. **Movies:** weekly.
- TMDB's daily change list (`/tv/changes`, `/movie/changes`) triggers an early refresh of anything
  that changed. The load is tiny: ~475 titles for you, ~30 of them airing.
- Attribution: add the required TMDB (and JustWatch, for streaming services) credit to Settings.

## Screens that change

| Screen | Today | After |
|---|---|---|
| Watchlist | Floppy list + per-row enrichment | Local query; marking is instant |
| Show / Season / Movie pages | Floppy detail + season fetches | Local tables |
| Library (Profile → Collection) | Floppy list, paged | Local query |
| Upcoming | Floppy's calendar feed | Local episodes table (+ TVmaze times) |
| Profile → Watching stats | Floppy's statistics endpoint | Computed from plays × runtimes: minutes, weekday rhythm, streaks, top genres/networks, most watched |
| Search, Add | Floppy search + library | TMDB search (already used for Discover) |
| Discover | TMDB rows + Floppy's "Top Picks" / "Coming Soon" | All TMDB: recommendations from your top-rated shows; upcoming premieres |
| Household (watched together, new-shows inbox) | Mirroring job between two Floppy accounts | Direct: a shared mark writes both plays in one transaction |
| Jellyfin auto-marking | Floppy's webhook | Seek's webhook (below) |

Unchanged: Sonarr/Radarr management, Activity, Books, the offline write queue (it still queues
writes, they just land in Seek).

## Jellyfin webhook

- One URL per person (`/webhook/jellyfin/{token}`), same as Floppy, so the Jellyfin plugin keeps its
  existing template and you only swap the URL.
- **Marks a play** on `MarkPlayed`, or on playback stop past ~90% of the runtime. **Removes** the
  newest play on `MarkUnplayed`. Duplicate events within a few minutes are ignored.
- **Matching:** TMDB id from the payload (`ProviderIds` or the TMDB link in `ExternalUrls`, which
  Re:Zero's payload had); otherwise TVDB/IMDb through TMDB `/find`. Episodes by TMDB season and
  number; if the library's numbering doesn't line up (absolute order), by the episode's own TVDB id
  through `/find`.
- **Never drops silently:** anything it can't match goes to a small "Couldn't match" list in Settings
  with the raw title, so a missed episode is visible instead of vanishing.
- A shared show marked by one person marks both, as Seek does today.

## Copying your history out of Floppy (one time)

Read-only against Floppy, for each person with their own token. Re-runnable: it skips what's
already copied, so it can run as often as needed until the numbers match.

1. **Tracked titles:** 408 shows and 67 movies for you (your wife's counted on the first run),
   with status, rating, added date, and the `joint` tag (→ shared).
2. **Plays with dates:** every play, including rewatches. Floppy's history holds 13,908 episode
   plays for you and 11,258 for your wife; those exact totals are the check.
3. **Episode numbering:** most shows use the same seasons in Floppy and TMDB and copy across
   directly. Where Floppy's season layout differs from TMDB's (Re:Zero: one 85-episode season vs
   TMDB's four), convert absolute → TMDB season by counting through TMDB's season lengths, and
   **only when the totals match exactly**. Anything that doesn't add up goes to a review list
   (show, Floppy numbering, proposed mapping) rather than being guessed; AniBridge's mapping file
   is the fallback for those if any turn up.
4. **Re:Zero's stray anime-bucket play** (E83) is read via `library_media_type=anime` and merged
   in, so nothing stranded in Floppy is lost.

**Done when**, per person: same titles, same statuses and ratings, same play count per show and in
total, and the watchlist next-up matches Floppy's corrected next-up for every in-progress show.

## Order (Floppy keeps running throughout)

1. **TMDB info layer:** `titles` + `episodes` tables and the refresh schedule, filled for everything
   you track. Nothing user-facing changes. *Done when* every tracked title has fresh info.
2. **The copy + comparison:** run it, fix mismatches until the "done when" above holds for both of
   you. Re-run it right before switching.
3. **Read from Seek:** Watchlist, Show/Season/Movie pages, Library, Upcoming, Profile stats, one at a
   time behind a setting, each checked against Floppy. Writes still go to Floppy *and* Seek, so both
   stay current and switching back is always possible.
4. **Write to Seek, webhook to Seek:** marking, statuses, ratings, shared marks; point Jellyfin's
   webhook at Seek. Floppy goes read-only (kept running, untouched) for a few weeks as a safety net.
5. **Remove Floppy:** delete the Floppy client, the mirroring job, the next-up corrections, the
   anime-bucket handling, the Floppy settings; drop Floppy from compose once you're happy.

Each step is its own release with tests; you can stop after any of them and lose nothing.

## Open questions for you

1. **Air times.** TMDB gives air *dates*. TVmaze (free, no key) has real air times for most US/UK
   shows; it's also what tells "8 PM tonight" apart from "aired at midnight" for next-up. Add it,
   or accept dates only (an episode counts as aired from the start of its air date)?
2. **Rewatches.** Keep every play (Floppy does), so rewatches count in stats and the diary? (Assumed
   yes.)
3. **Your wife's Floppy account:** copy it in the same pass (assumed yes; needs her Floppy token,
   which Seek already holds).

## Rough size

Bigger than the books move, comparable to the household work: about five releases. The copy and
comparison (step 2) and the webhook matching are where the care goes; the screens mostly swap their
data source.
