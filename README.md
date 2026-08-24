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
docker compose up -d --build
```

`compose.yaml` joins `floppy-net` and overrides `FLOPPY_URL` to `http://floppy:8000`
so Seek reaches Floppy by container name rather than traversing the LAN (§2).

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
| Undocumented endpoints | `GET /api/v1/home/` (returns `groups`) and `GET /api/v1/media/` (all types at once). |

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
