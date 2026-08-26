# Backlog

Things flagged but deliberately not built. Build order is in
[seek-spec.md](seek-spec.md) §13; API behaviour is in
[docs/floppy-api-notes.md](docs/floppy-api-notes.md).

Everything in §13's build order has shipped, along with filters, sort, the
joint/solo tag, the collection views, settings, deployment, the session gate,
themes, and movie marking. What is left is below.

## Anime bucket migration — parked by choice

`anime-list.txt` (18 shows) and `migrate-anime.sql` are generated and **unrun**.
The SQL ends in `ROLLBACK` until deliberately changed. It needs Floppy's
`anime_library_mode` set to `both` (or `anime`) and a database backup first — see
[docs/floppy-api-notes.md](docs/floppy-api-notes.md#anime-bucket-migration) for
why the bucket cannot simply be imported.

Once migrated, anime belongs in the **filter control** (§4.6) alongside status
and service — explicitly *not* a top-level segment. The segmented control stays
TV Shows / Movies.

## Movie watch history is mostly absent

Floppy's statistics count **9** of the 53 tracked movies — 1,118 minutes against
roughly 8,500 hours of television. The other 44 arrived from the Trakt import as
`status=completed` with an `end_date` but **no play record**, so they contribute
nothing to hours, and the Movies tile reads 0 for every range except all-time.

Worth checking Trakt itself before assuming the importer dropped them: Hobi,
which reads Trakt, also reported "0 Movies watched" for the same year. If Trakt
holds no movie plays either, there is nothing to re-import and those 53 are
watchlist entries rather than history.

## Smaller items

- **Confirmation toast for actions with no undo of their own** — mark-all-season
  and adding a show. Marking an episode already toasts because undo needs it.
  Raised because iOS Safari has no Vibration API, so §4.2's haptic cannot fire
  on the one platform Seek targets; see `src/lib/haptics.ts`.
- **Re-sort after marking covers two orderings**, "Recently watched" and
  "Episodes left". The others either do not move when you mark (Alphabetical,
  Total episodes) or key on values Floppy computes server-side, which are left to
  the next load rather than guessed at.
- **Saturday Night Live is inherently slow.** Floppy needs ~1.07s for its 1.4 MB,
  53-season payload. Nothing in Seek can fix that; it is a Floppy-side cost.
- **The diary date jump is approximate.** Floppy pages history by *days with
  activity* rather than calendar days, so jumping lands near a date rather than
  on it.
