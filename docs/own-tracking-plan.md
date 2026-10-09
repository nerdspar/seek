# Seek tracks watches itself — plan

**Goal:** retire Floppy. Seek stores what each person has watched in its own database, gets show
and movie information straight from TMDB, and receives Jellyfin's "watched" webhook itself. Same
shape as books: one home per fact, Seek is the only app you use.

**Status:** agreed 2026-10-09 (decisions below). Steps 1–2 done; step 3 in progress.

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

No TVDB key and no AniBridge: shows are stored in TMDB's standard numbering. *Correction after
checking live:* TMDB's standard order has Re:Zero as one 85-episode season, exactly as Floppy stores
it. Jellyfin numbers it in seasons (`S04E17`) because its library uses one of TMDB's alternate
episode orders. So the history copy needs no conversion for it, and the **webhook** does the
translation: it looks the episode up by its own IMDb/TVDB id through TMDB's `/find` (Re:Zero's
payload carries the episode's IMDb id), which answers in TMDB's standard numbering (`S01E83`).

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
- **Matching:** the show by TMDB id from the payload (`ProviderIds` or the TMDB link in
  `ExternalUrls`), otherwise by TVDB/IMDb through TMDB `/find`. The episode by its **own** IMDb/TVDB
  id through `/find` first, which gives TMDB's standard numbering whatever order the Jellyfin library
  displays (Re:Zero: Jellyfin's `S04E17` → `S01E83`); by season and number only when the episode has
  no id, and only if that episode exists.
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
3. **Episode numbering:** Floppy stores plays in TMDB's standard numbering (Re:Zero included: one
   85-episode season in both), so plays copy across as they are. As a check, every copied play must
   land on an episode that exists in Seek's TMDB copy; any that don't (a show whose seasons TMDB
   has since renumbered) go to a review list — show, Floppy's numbering, the proposed match —
   rather than being guessed. AniBridge's mapping file stays the fallback if such cases turn up.
4. **Re:Zero's stray anime-bucket play** (E83) is read via `library_media_type=anime` and merged
   in, so nothing stranded in Floppy is lost.

**Done when**, per person: same titles, same statuses and ratings, same play count per show and in
total, and the watchlist next-up matches Floppy's corrected next-up for every in-progress show.

## Order (Floppy keeps running throughout)

*Revised while building:* writes move to Seek **before** reads do. If screens read Seek while
Jellyfin's marks still only reached Floppy, a watched episode would be missing from Seek until the
nightly copy. So Seek becomes the place every change lands first, and screens switch once Seek is
always the freshest copy.

1. **TMDB info layer** *(done, deployed)*: `titles` + `episodes`, refreshed on a schedule.
2. **The copy + comparison** *(done)*: everything tracked and every play copied out of Floppy for
   both of you, re-run nightly, totals checked. First live run: 13,939/13,939 episode plays,
   62/62 film plays, nothing to review.
3. **Writes recorded in Seek** *(in progress)*: every change made in Seek (marks, undo, season
   fill/clear, add/remove, status, rating) is recorded in Seek's tables as well as Floppy, for
   everyone it counts for (shared shows). The nightly copy links these to Floppy's copies of the
   same viewings and corrects any drift, so Floppy stays the record until the switch.
4. **Jellyfin to Seek:** Seek's own webhook records the play and passes it on to Floppy, so Floppy
   stays complete for going back. You swap the webhook URL in Jellyfin.
5. **Read from Seek:** watchlist, show/season/movie pages, library, Upcoming, Profile stats, one at
   a time, each checked against Floppy first. The long-press rewatch menu lands here.
6. **Remove Floppy:** stop passing changes on, delete the Floppy client, the mirroring job, the
   next-up corrections and anime-bucket handling; take Floppy out of the server setup.

Each step is its own release with tests; you can stop after any of them and lose nothing.

## Decisions (2026-10-09)

1. **Air times: yes, TVmaze.** Real air times for scheduled broadcast shows (Saturday Night Live:
   11:29 PM, NBC). Streaming drops have no time on TVmaze — it fills in a noon-UTC placeholder, which
   Seek ignores — so they count as aired from 00:00 UTC on their date: the evening before in US
   time, which is when US streaming drops land and how Floppy behaved (Avatar: Seven Havens).
2. **Rewatches: yes, every play is kept.** Rewatching gets UI without cluttering what's there: a
   **long-press** on an episode row or a season row opens a small menu — *Watched again* (a play
   now), *Watched on…* (pick a date), *Remove last play*, and the play history with dates. A tap
   still does exactly what it does today. Ships with step 4, when plays are Seek's.
3. **Your wife's history: yes**, copied in the same pass, with her own token.

## Rough size

Bigger than the books move, comparable to the household work: about five releases. The copy and
comparison (step 2) and the webhook matching are where the care goes; the screens mostly swap their
data source.
