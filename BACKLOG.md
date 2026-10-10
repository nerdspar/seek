# Backlog

Things flagged but deliberately not built. Build order is in
[seek-spec.md](seek-spec.md) §13; how Seek keeps its own records is in
[docs/own-tracking-plan.md](docs/own-tracking-plan.md).

Everything in §13's build order has shipped, along with filters, sort, the
joint/solo tag, the collection views, settings, deployment, the session gate,
themes, movie tracking and its own detail page. What is left is below.

Anime is Seek's rule over TMDB (Animation plus an East Asian origin or TMDB's
"anime" keyword) with per-show household overrides: see
src/lib/server/tracking/anime.ts.

## Done since

- **Seek keeps its own records** (2026-10-09): Floppy retired. What you track
  and every play live in Seek; TMDB + TVmaze for show info; Seek's own Jellyfin
  webhook; shared shows write both plays at once. See docs/own-tracking-plan.md.
- **Together or solo for new shows** (2026-10-04): household setting Ask /
  Together / Solo; the + confirmation and Sonarr add sheet ask; shows added
  elsewhere land in a Watchlist inbox (and a push). Undecided stays solo.

## Accepted, not open

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
