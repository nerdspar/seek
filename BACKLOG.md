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
