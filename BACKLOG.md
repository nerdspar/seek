# Backlog

Things flagged but deliberately not built. Build order is in
[seek-spec.md](seek-spec.md) §13; API behaviour is in
[docs/floppy-api-notes.md](docs/floppy-api-notes.md).

Everything in §13's build order has shipped, along with filters, sort, the
joint/solo tag, the collection views, settings, deployment, the session gate,
themes, movie tracking and its own detail page. What is left is below.

Anime was dropped deliberately. Floppy can file shows in a separate anime
bucket and the migration to do it was prepared, but it was never worth the
database surgery — see the note in docs/floppy-api-notes.md for how the
classification works if it ever comes back.

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

- **Re-sort after marking covers two orderings**, "Recently watched" and
  "Episodes left". The others either do not move when you mark (Alphabetical,
  Total episodes) or key on values Floppy computes server-side, which are left to
  the next load rather than guessed at.
- **Saturday Night Live is inherently slow.** Floppy needs ~1.07s for its 1.4 MB,
  53-season payload. Nothing in Seek can fix that; it is a Floppy-side cost.
- **The diary date jump is approximate.** Floppy pages history by *days with
  activity* rather than calendar days, so jumping lands near a date rather than
  on it.
