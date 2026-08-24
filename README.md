# Seek

Self-hosted PWA front-ending [Floppy](https://github.com/dannyvfilms/Floppy) for fast
episode marking. See [seek-spec.md](seek-spec.md) for the full specification.

**Status: build order §13 steps 1–3 complete.** Watchlist + swipe-to-mark + undo.
Stop point is deliberate — the interaction gets a day of real use before anything
else is built.

## Running it

```bash
npm install
cp .env.example .env   # fill in FLOPPY_TOKEN
npm run dev            # http://<your-lan-ip>:8100
```

Production / container:

```bash
mkdir -p data
docker compose up -d --build
```

Then open `http://<docker-host>:8100` on the phone and add it to the home screen.

`compose.yaml` defaults to whatever `FLOPPY_URL` is in `.env`, so it runs from any
host on the LAN. To run it on Floppy's own Docker host instead — the spec §2 shape,
reaching Floppy by container name rather than traversing the LAN — set
`FLOPPY_URL=http://floppy:8000` in `.env` and uncomment the `floppy-net` blocks at
the bottom of `compose.yaml`.

The runtime image carries only `build/` and `package.json`: adapter-node bundles its
own dependencies, verified by running the build with no `node_modules` present.

Health check: `GET /api/health` — reports Floppy reachability, its build version,
and whether the API token is accepted.

## What is built

- **Watchlist** (§4.1) — TV/Movies/Anime segments, poster, title, episode pill,
  gradient progress bar, "N left". Server-rendered.
- **Swipe to mark** (§4.2) — right-to-left by default, direction configurable via
  the header toggle. Reveal shows the eye icon and "Mark as Watched" on the signal
  gradient.
- **Undo** (§4.3) — 6s toast; removes the most recent play.
- **Session gate** (§2) — off unless `SEEK_PASSPHRASE` is set.

Not built yet: episode sheet, show page, season list, search/add, Upcoming,
Discover, Profile, sort/filter. Those affordances are present but inert and say so
when tapped — the layout needs to be real for the ergonomics to be judged fairly.

## API findings

Verified live against Floppy **v26.8.20**. These differ from, or add to, spec §3 —
re-verify against `GET /api/openapi.yaml` if behaviour changes, since Floppy ships
daily.

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

### Anime bucket migration

**Parked** — prepared but not run.

`scripts/anime-list.mjs` (read-only) regenerates `anime-list.txt`, the reviewable
list of shows to move. Anime means **Japanese-produced animation**, not animation
generally: the list is a curated set matched by title, because Floppy's metadata
is wrong in both directions (it misses Naruto and SPY x FAMILY, and marks Star
Wars: Visions Japanese). Currently 18 shows, with 7 borderline titles — Blood of
Zeus, Blue Eye Samurai, Lord of Mysteries, Pantheon, Star Wars: Visions, Tomb
Raider, Twilight of the Gods — commented out rather than silently included. `scripts/anime-migration-sql.mjs` turns that list into
`migrate-anime.sql`. **The generator never connects to a database and runs
nothing**; the SQL ends in `ROLLBACK` until deliberately changed to `COMMIT`.

One `UPDATE` per show is sufficient: a show, its seasons and its episodes are all
`app_item` rows sharing `(source, media_id)`, and Floppy's `_child_bucket` rule is
that children follow the show's bucket, so they move together.

The update is collision-free only while there are no existing anime-bucket rows —
every `app_item` uniqueness constraint includes `library_media_type`. The generated
SQL checks for that first and expects 0 rows.

`anime_library_mode` must be set to `both` (or `anime`) for any of this to be
visible. Floppy's own CSV export/import also round-trips `library_media_type`, but
the importer's lookup includes the bucket, so an edited CSV adds a second copy
rather than moving the item.

Because `Item` is unique on `(media_id, source, media_type, library_media_type)`,
the same show can legitimately exist in both the tv and anime buckets — see
`imports/helpers.py:find_item_across_buckets`. Re-importing anime without removing
the tv-bucket copies leaves duplicates.

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

## Scripts

`scripts/*.mjs` are one-off probes used to establish the findings above. `probe.mjs`,
`probe2.mjs`, `probe3.mjs`, `probe4.mjs`, `probe6.mjs` and `baseline.mjs` are
read-only. `probe-undo.mjs` and `probe5.mjs` write, but only to a throwaway show
they add and then delete.
