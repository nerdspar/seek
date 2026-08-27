# Floppy API notes

What was learned by driving [Floppy](https://github.com/dannyvfilms/Floppy)'s API
hard enough to migrate roughly 13,000 plays through it. Everything here was
verified against a live instance rather than read off the schema — several of
these entries exist precisely because the schema was wrong or silent.

Floppy ships daily. Re-verify against `GET /api/openapi.yaml` before trusting any
of it, and treat a disagreement between this file and a live instance as this
file being out of date.

Section markers (§) refer to [seek-spec.md](../seek-spec.md).

## Endpoint behaviour

Verified live against Floppy **v26.8.20**. These differ from, or add to, spec §3.

| Finding | Detail |
|---|---|
| `DELETE` on the watch path works | Absent from `openapi.yaml` (documented POST-only), but returns 204 and pops exactly the newest play. Measured: 2 plays → DELETE → the newer `consumption_id` was gone, the older remained. This is undo. |
| Don't use the episode-path DELETE for undo | `DELETE /{media_type}/{source}/{id}/{season}/{episode}/` is documented as deleting the tracked episode *item*. On a rewatched episode that takes more than the one play undo means to reverse. |
| `max_progress` is absent from the list response | The show's episode total arrives as `item.number_of_pages`. Overloaded name, but it matches `max_progress` from show detail exactly. Avoids an N+1. |
| `next_episode.title` is unreliable | Sometimes the SHOW title, not the episode's (Outer Banks S05E01 reports "Outer Banks", not "The Crossing"). Real titles come from the episode endpoint and are cached. |
| `next_episode` exists ONLY on the list endpoint | Show detail omits it, and the watch POST responds about the *episode* (`item_media_type: "episode"`, `progress: 1` = one play). Post-write refresh must go back to the list. |
| The list has no id filter | Refresh narrows by `search` then matches on `media_id` — `search=Below Deck` returns three different shows. |
| `sort` is a closed enum | Floppy 400s on anything else. There is no `progressed_at`; `updated` backs "Recently watched". |
| Air times are mostly placeholders | Most `air_date` values end `T11:59:59.999999Z` — a padded date, not a real time. Relevant to §5.2 and open question §14.2. |
| `POST /api/v1/discover/refresh/` does not exist | GET only. (§6.1) |
| `EpisodeDetails` is typed | `air_date`, `runtime`, `episode_number`, `season_number`, `episode_type` are stable. §12.6 still holds for show-level `details`/`related`. |
| Undocumented endpoints | `GET /api/v1/home/` (returns `groups`), `GET /api/v1/media/` (all types at once), and `POST\|DELETE /api/v1/media/movie/{source}/{media_id}/watch/` (`MediaMovieWatchView` — mirrors episode watch semantics, optional `external_id` for idempotency). |
| Never POST anime with `source=tmdb` | `POST /api/v1/media/anime/` skips the tracking-type resolver and creates an item that GET/PATCH/DELETE then reject. Grouped anime is `media_type=tv` + `library_media_type=anime`. See below. |

### Calendar feed (§5.1) — verified

```
GET {FLOPPY_URL}/calendar/download/{token}?media_types=tv&media_types=season&media_types=movie&media_types=anime
```

The token is the **path segment only** — everything after `?` is filtering. The
token is itself the credential: the feed returns 200 with no API key, so treat
the URL as a secret and regenerate it in Floppy if it leaks.

Confirmed against the live feed: 200 `text/calendar`, 163 `VEVENT`s, and the
`media_types` filters are honoured (`media_types=movie` correctly returns 0 for a
library with no movies). Still absent from `/api/v1/`, so §5.1's plan of fetching
and parsing this server-side stands.

**Air times are real for only about a third of events — this changes §5.2.**
Every event carries a full timestamp (none are `VALUE=DATE`), but the values are:

| DTSTART | Count | Meaning |
|---|---|---|
| `11:59:59Z` | 97 of 163 | Placeholder — a date with no known time |
| Genuine times (`01:00`, `03:00`, `14:00`, `19:00`, `21:00`, `03:29`…) | 57 | Real air times |
| `00:00:00Z` | 9 | Ambiguous; can be a genuine 8pm ET slot |

This matches what `next_episode.air_date` returns from the API, so the feed is not
a better source of *times* — its value is covering every upcoming episode rather
than only next-up.

So Upcoming must **render a time only when one is known**, and fall back to a
date otherwise. Displaying the placeholder as "11:59 PM" would be wrong for 60% of
rows. Detect it on `11:59:59` exactly; do not treat `00:00:00` as a placeholder.

### Removing an item cascades — verified

`DELETE /api/v1/media/{media_type}/{source}/{media_id}/` destroys the tracking
record and every play hanging off it. Measured: added a show, marked S1E1
(status 1, progress 1), deleted it, re-added it — status 0, progress 0. The
plays do not come back. Rating, dates and tags live on that same record and go
with it.

This is what Seek's Remove does, and it is the only unrecoverable action in the
app — hence the confirm.

### A film's status and its plays drift apart — verified

Floppy accepts **all five** statuses on a movie. PATCH returned 200 and stored
0–4 correctly, so "planned or completed and nothing between" is wrong; In
progress in particular is a real state for a film, and the Jellyfin webhook
below writes it.

Status and plays are coupled in one direction only:

| Action | Effect |
|---|---|
| `PATCH {"status":3}` on an unwatched film | **creates a play** — progress 0 → 1 |
| `POST .../watch/` (mark watched) | sets status to Completed |
| `DELETE .../watch/` (Seek's unmark) | pops the play, **leaves status at Completed** |
| Completed → Dropped, Dropped → Planning | the play stays |

So a film can sit at Planning with a play on record, or at Completed with none.
Anything reading status alone will be wrong about whether a film was watched,
which is why Seek derives that from `progress > 0`.

### Jellyfin webhook — what it writes

Read from upstream Yamtrack source
(`src/integrations/webhooks/{jellyfin,movie,tv,base}.py`), **not** measured
against this instance — Floppy is a fork. Confirm from the container log on the
first real webhook: the handler logs the payload at debug and the resulting
status at info. There is no webhook path under `/api/v1/`; it lives on the
tokenised URL from Floppy's own Integrations page.

Only two statuses are ever written. Planning, Paused and Dropped never are.

| Jellyfin event | Movie | Show |
|---|---|---|
| `Play` / `Stop`, unfinished | In progress, `start_date=now`, progress 0 | forces show **and** season to In progress, records the episode play |
| finished, or `MarkPlayed` | Completed, `end_date=now`, progress 1 | as above, plus the play |
| `MarkUnplayed` | **deletes the whole tracking row** | deletes **one episode play**, the most recent |

`MarkPlayed` and `MarkUnplayed` fire only if enabled per-user
(`jellyfin_mark_played_enabled` / `jellyfin_mark_unplayed_enabled`); `Play` and
`Stop` are always handled.

Three traps:

- **`MarkUnplayed` on a film removes it from the library**, rating and dates
  with it — the same destruction as Seek's Remove, driven from Jellyfin's UI.
  Nothing in the webhook can remove a *show*: it only ever pops episode plays.
  Worth knowing before enabling that setting.
- **Completed is sticky on films.** The update branch is guarded by
  `status != COMPLETED`, so once a film is Completed the webhook skips it
  entirely — no second play, no `repeats`. Rewatches have to be marked in Seek.
- **Any episode play forces a show back to In progress**, from Completed,
  Paused or Dropped alike (`elif tv_instance.status != IN_PROGRESS: ... =
  IN_PROGRESS`, and the same for the season). Rewatch one episode of something
  finished and it moves back to Watching on its own, so the watchlist will
  reshuffle with no action taken in Seek. This is the opposite of the movie
  behaviour above.

Duplicate webhooks for the same episode within 5 seconds are dropped upstream,
so double-fires do not double-count.

### Anime: how it actually works

Corrected after a first pass got this wrong. Floppy does support native anime for
a TMDB-sourced library — the earlier conclusion tested the wrong creation path.

`get_tracking_media_type(anime, source=tmdb)` returns **`tv`**
(`services/metadata_resolution.py:164`). So a correct grouped-anime item is:

```
media_type = tv          library_media_type = anime          source = tmdb
```

That shape works with every route Seek needs, because `tmdb` is a valid source for
`media_type=tv`: show detail, the episode watch POST/DELETE, and the list endpoint
all behave normally. It also appears in `GET /api/v1/media/anime/`, which is what
backs an Anime segment. **Marking is unaffected — it keeps using the tv routes.**

The broken artifact from the first pass was `media_type=anime, source=tmdb`, which
`POST /api/v1/media/anime/` creates because it skips the resolver the web UI
applies. `VALID_SOURCES[anime]` is `["mal","manual"]`, so GET/PATCH/DELETE on that
item all 400 with "Cannot query `tmdb` for `anime` media type" — creatable but
unmanageable. **Never POST to `/api/v1/media/anime/` with `source=tmdb`.**

Two things gate a working setup:

1. **`anime_library_mode` must be `both`** (or `anime`). Verified empirically: with
   `tv`, a grouped-anime item appears in **neither** list — the TV query excludes
   `library_media_type=anime` unless the mode is `both`, and the anime query only
   includes grouped rows when the mode is `anime`/`both`. `both` puts each show
   once in the TV list and once in the Anime list.

2. **The import source has to separate anime.** This is why a Trakt-imported
   library is entirely `library_media_type=tv` — Trakt does not distinguish anime.

   | Importer | Anime classification |
   |---|---|
   | Simkl | Explicit `anime_destination` param, default `anime`; Simkl's own catalogue separates anime |
   | Plex | Section title: `"anime" in section.title.lower()` |
   | MAL / AniList / Kitsu | Native, but **flat** — `next_episode: null`, no per-episode marking, progress counter only |
   | Stremio | Has anime handling |
   | Trakt | **None** |
   | Jellyfin (playback reporting) | **None** — no section-name logic despite Jellyfin library separation |

Imports are dispatchable via `POST /api/v1/imports/{service}/` (free-form body,
returns a `task_id` pollable at `GET /api/v1/tasks/{task_id}/`).

**None of the self-hosted importers classify anime.** Sonarr does not read its own
`seriesType`; Floppy's Jellyfin importer has no section-name logic. Only Plex does,
via section title. So for a self-hosted setup the bucket has to be set directly
rather than imported — see the migration below.

### Anime bucket migration — abandoned

A migration to move shows into Floppy's anime bucket was prepared and never
run; the generator scripts and the SQL have been removed. The section above
still describes how the classification works, which is the part worth keeping:
it is a property of Floppy, not of that plan.

### Known traps (§12) as implemented

- **§12.1** anime bucket — this instance reports `anime_library_mode: "tv"`, so the
  UNIQUE-constraint path is dormant. The retry with `library_media_type: "anime"`
  is implemented and guarded on that exact error anyway.
- **§12.2** `media_id` is the show's TMDB id. The client only echoes back what the
  row carried.
- **§12.3** POST appends. There is **no retry** on the watch call. `FloppyUnreachable`
  (connect-stage failure, provably nothing sent) is distinguished from a timeout,
  which is ambiguous and never retried.
- **§12.4** season/episode numbering always comes from `next_episode`, never computed.

## The probe scripts

`scripts/*.mjs` are one-off probes used to establish the findings above. Most are
read-only. The exceptions — `probe-undo.mjs`, `probe5.mjs` and
`probe-season-ops*.mjs` — write, but only to a throwaway show they add and then
delete, which is the pattern to follow if you add one.
