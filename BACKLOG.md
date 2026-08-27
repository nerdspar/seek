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
