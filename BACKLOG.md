# Backlog

Things flagged but deliberately not built. Build order is in
[seek-spec.md](seek-spec.md) §13; API behaviour is in
[docs/floppy-api-notes.md](docs/floppy-api-notes.md).

Everything in §13's build order has shipped, along with filters, sort, the
joint/solo tag, the collection views, settings, deployment, the session gate,
themes, movie tracking and its own detail page. What is left is below.

Anime is a Floppy tag, not Floppy's separate anime bucket (that migration was
never worth the database surgery): see src/lib/server/anime-sync.ts.

## Done since

- **Together or solo for new shows** (2026-10-04): household setting Ask /
  Together / Solo; the + confirmation and Sonarr add sheet ask; shows added
  elsewhere land in a Watchlist inbox (and a push). Undecided stays solo.
- **Widow's Bay 10/10** (2026-10-04): Floppy's season progress is the furthest
  episode, not a count; in-progress seasons are now counted from their episodes.
- **Anime** (2026-10-04): decided by Floppy's "Anime" genre plus a per-show
  override in the show menu, for everyone's library — no longer the Jellyfin
  Anime library. Jellyfin is now unused by Seek.

## Accepted, not open

- **Saturday Night Live is the slowest show to open**, at 2.2s cold against 1.1s
  for a normal one, and 98ms warm. Measured: Floppy spends 2.5s returning 1.4 MB
  for it, and the bulk of that is **2,754 cast entries**, not the 53 seasons —
  Seek displays 20 of them. Nothing here can trim what Floppy sends, the page
  streams so the shell is immediate, and 2× a normal show is not worth chasing.

## Accepted, not open (continued)

- **Two toast mechanisms, deliberately.** The global one in `+layout.svelte`
  carries confirmations; each page keeps its own `note` for errors. Folding them
  together looks tidier and is not: the watchlist renders its error as
  `{:else if note}` against the undo toast, so exactly one thing occupies the
  bottom of the screen at a time. A global error toast would let both appear at
  once, on the screen that matters most. Errors also belong to the page that
  raised them in a way a confirmation does not.

## Smaller items

- **Re-sort after marking skips two orderings on purpose**: Alphabetical and
  Total episodes key on values marking cannot change. The other four all move.
