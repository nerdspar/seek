# Sonarr / Radarr management in Seek — plan

**Goal:** manage your *arr stack inside Seek instead of bouncing to Rudarr /
Helmarr — edit a monitored title's settings, control per-season/episode and movie
monitoring, run **automatic** and **interactive (manual release)** searches, and
watch/manage downloads. One place for watching *and* getting.

Seek already has the foundation: a clean Sonarr/Radarr **v3 API wrapper**
(`arr.ts`), plus **add**, reference-data **options** (quality profiles, root
folders, tags), and **"is it in the library?"** status, surfaced via
`ArrButton`/`ArrAddSheet`. This plan adds the **management layer** on top.

---

## How it fits Seek

Seek indexes by **TMDB id**; Floppy is the source of *watch* state. Sonarr/Radarr
are separate systems with their own library (Sonarr is TVDB-native).

The guiding UX decision: **don't build a parallel "Downloads" episode list.**
Download state belongs *on the episode rows Seek already shows*, so one list
answers both "did I watch it?" (Floppy) and "do I have it?" (Sonarr), with the
search/grab action inline. Things that aren't per-episode — series settings and
cross-title activity — get their own compact homes. Concretely:

- **Episode rows (season page): integrated.** Each existing episode row gains a
  **download state** — have it / missing / downloading — and a tap to
  search + grab. The watched checkmark (Floppy) and the availability glyph
  (Sonarr) sit on the same row. This is the "all in one place" surface.
- **Show page: a compact "Downloads" strip** for what *isn't* per-episode —
  series monitored state, quality profile, root folder, tags (all editable), and
  "search whole series". The season rows that already exist there gain a file
  count + monitor toggle + "search season".
- **Movie page: inline.** A movie is one unit, so its download status + monitor +
  search sit directly on the movie page — there's no episode list to merge.
- **A new `/activity` area** (reached from Profile / a header icon — the tab bar
  stays at four): **Queue**, **History**, **Wanted/Missing**. Genuinely
  cross-title, so it's separate by nature.
- **An interactive-search sheet** launched from a show/season/episode/movie.

### Id mapping (verified live against Floppy)
Floppy fetches from both TMDB and TVDB as metadata providers, and **persists the
cross-ids at the series level**: a show record carries
`ids: { tmdb, imdb, tvdb }`. At the **episode level it stores only TMDB-style
`season_number` + `episode_number`** — `ids` / `provider_external_ids` come back
empty. So:

- **Series → exact.** Match Floppy's `ids.tvdb` straight to the Sonarr series
  (Sonarr is TVDB-keyed). No `tmdbId` round-trip, no guessing. (`libraryStatus`
  keeps the `tmdbId` cross-ref too; either works for Radarr, which is TMDB-native.)
- **Season → exact** once the series is matched.
- **Episode → by `(season_number, episode_number)`.** Because Floppy exposes no
  per-episode TVDB id, each Floppy episode row is lined up with its Sonarr episode
  by number. Standard shows number episodes identically across TMDB/TVDB, so it's
  reliable; the oddballs (anime absolute-numbering, specials, re-split seasons)
  can diverge, and an episode that doesn't match just shows **no** download
  control rather than a wrong one. Graceful, not blocking.

---

## Settings gate (per your request)

A `arrManage` preference (default **on**) sits on top of the existing env check,
exposed through `/api/arr/status` as a single `manage` flag the client reads. When
off, every download affordance disappears (the plain "Add to Sonarr/Radarr" button
stays). It's Seek-wide for now; when the household multi-user work lands it becomes
per-user, so your wife's login won't show it. Toggle lives in Settings under the
existing Sonarr/Radarr section.

## File replace / delete (added)

On a downloaded episode or movie: **Delete file** (`DELETE /episodefile/{id}` or
`/moviefile/{id}`, with a confirm) and **Replace** (delete the file, then open the
interactive sheet so you pick the swap — not a silent auto-grab). Surfaced from the
file-detail row.

## Verified API facts (probed live, Sonarr 4.0 / Radarr 6.4)

- Series and movie both carry `tmdbId` → the library match reuses the proven
  tmdbId path (no TVDB needed; `tvdbId` is also present as a fallback).
- Episodes carry `id`, `seasonNumber`, `episodeNumber`, `hasFile`, `monitored`,
  `episodeFileId`, `airDateUtc`.
- `episodefile.mediaInfo.audioLanguages` is a slash list (`"eng/jpn"`) — the dub
  signal — plus `subtitles`, `audioChannels`. `episodefile.languages` is the
  parsed-name array; `quality.quality.name` the quality.
- Release objects carry `guid`, `indexerId`, `indexer`, `size`, `age` (days),
  `protocol` (`usenet`), `quality`, `languages`, `customFormatScore`,
  `rejections`, `rejected`, `approved`. Grab = `POST /release {guid, indexerId}`.

## Server layer — extend `arr.ts`

- Add **PUT** to the request wrapper (it does GET/POST/DELETE today).
- A thin **Sonarr↔Radarr adapter** for the field-name split (`seriesId` vs
  `movieId`, command names, `seriesType`/`seasonFolder` vs `minimumAvailability`,
  legacy `languageProfileId`). Build once; branch on `GET /system/status`.
- New functions (all server-only, keyed off the existing `arr()` helper):
  - **Detail:** `getSeriesByTvdb` (exact, from Floppy's `ids.tvdb`) with a
    `getSeriesByTmdb` fallback, `getEpisodes(seriesId)`, `getMovieByTmdb`. The
    show/season pages pass Floppy's `ids.tvdb` so the series match is exact;
    episodes are keyed back to Floppy rows by `(season, episode)` number.
  - **Edit:** `editSeries` / `editMovie` (PUT full object), `setEpisodeMonitor`,
    `seasonPass` (bulk season monitoring).
  - **Search:** `runCommand(name, ids)` + `pollCommand(id)` (the async pattern);
    `getReleases({episodeId|seriesId+season|movieId})`, `grabRelease(guid,
    indexerId, shouldOverride?)`.
  - **Activity:** `getQueue(page)`, `removeQueueItem(id, {removeFromClient,
    blocklist})`, `getHistory`, `getWantedMissing`, `getWantedCutoff`.
- **Caching:** reference data (profiles/rootfolders/tags/system-status) cached on
  the existing `TTLCache`; queue/releases are always live.

## API routes (new, under `/api/arr/`)
- `GET|PUT /api/arr/[service]/title/[tmdbId]` — detail + edit settings.
- `PUT /api/arr/[service]/monitor` — episode/season monitoring.
- `POST /api/arr/[service]/search` — automatic search (series/season/episode/movie).
- `GET /api/arr/[service]/releases` — interactive-search candidates.
- `POST /api/arr/[service]/grab` — grab a chosen release.
- `GET|DELETE /api/arr/[service]/queue` — activity + remove/blocklist.
- `GET /api/arr/[service]/history`, `GET /api/arr/[service]/wanted`.

All gated by the existing session, and no-op/hidden when that service isn't
configured (same rule as today's Add button).

---

## UI surfaces
- **Integrated episode rows** (season page): each existing row gains a download
  glyph (have / missing / downloading) beside the watched checkmark, and tapping
  a missing episode offers **Search** (auto) / **Interactive**. One list, both
  functions. Rows that don't map to a Sonarr episode (by season+episode number)
  simply omit the download affordance.
- **Downloads strip** on the show page (series-level, not an episode re-list):
  status chips + an edit sheet (profile / root / tags / monitored; Sonarr series
  type + season folder). The existing season rows gain a file count + monitor
  toggle + **Search** (auto) / **Interactive**.
- **Movie page:** download status chip + monitor + **Search** / **Interactive**
  inline (Radarr adds min-availability to the edit sheet). One unit, no list.
- **Interactive-search sheet:** fires the release query (shows a spinner — it can
  take 5–30s while indexers respond), lists releases with **quality · size ·
  seeders · age · indexer · custom-format score**, badges for freeleech / already-
  grabbed, and a tappable **rejections** list; one tap grabs (with an "override"
  for flagged releases). This is the headline — most of the care goes here.
- **/activity:** Queue (live progress bars, status/warnings, remove + blocklist),
  History (grabbed/imported/failed, retry), Wanted (missing + cutoff-unmet, with
  "search all"). Sub-nav between the three.

---

## Build order (each shippable)

- **Phase 1 — Manage + search (your core ask).** The show-page Downloads strip
  (edit series settings) + **download state integrated onto the existing episode
  rows** and the season rows, with per-season/episode monitoring, **automatic
  search**, and **interactive search → grab**; plus the movie page's inline
  controls and a **minimal queue peek** so a grab visibly starts downloading.
  Covers "edit a monitored media's settings" and "individual episode/movie
  downloading with automatic and interactive search."
- **Phase 2 — Activity.** Full `/activity`: Queue management (remove/blocklist),
  History (+ retry failed), Wanted (missing + cutoff-unmet). This is the "see and
  manage what's downloading" half.
- **Phase 3 — Power/polish.** Season Pass bulk monitoring, bulk editor, health +
  system status banner, blocklist, manual-import resolution, calendar tie-in with
  Seek's existing Upcoming. Add-flow gains `addOptions` (monitor + search-on-add)
  if not already.

## The ~15 endpoints that cover ~80%
`system/status`; `series`/`movie` (+ `/{id}`, `episode?seriesId=`);
`series|movie/lookup`; `POST series|movie` (add); `PUT series|movie/{id}` (edit);
`PUT episode/monitor` + `seasonpass`; `POST command` + `GET command/{id}` (auto
search + poll); `GET release?…` + `POST release` (interactive search + grab);
`GET queue` + `DELETE queue/{id}`; `GET history` + `wanted/missing` +
`wanted/cutoff`; `qualityprofile` + `rootfolder` + `tag` (bootstrap bundle).

## Risks / notes
- **Id mapping** (above, verified live) — series/season match exactly via Floppy's
  `ids.tvdb`; per-episode falls back to `(season, episode)` number, which is
  reliable for standard shows and degrades gracefully (no control) for the
  oddballs. No wrong-episode grabs.
- **Interactive search latency** (indexers): optimistic UI + spinner, never block.
- **Grabbing is a real action** — confirm before grab, and (as with marking) I'll
  verify flows against your live instances carefully / read-only where possible.
- **Sonarr v4 vs legacy v3** language-profile split — handled by the adapter via
  `system/status` + presence of `/languageprofile`.
- Verify exact body shapes (`/seasonpass`, `POST /release` optional `movieId`,
  `DELETE /queue/bulk`) against each instance's live `/api/v3/openapi.json` during
  Phase 1.
</content>
