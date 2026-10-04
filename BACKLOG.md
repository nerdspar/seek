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

## Open

- **Together or solo for newly added shows.** Today a show is solo until someone
  taps Together on its page, so new shows silently miss mirroring. Shows arrive
  three ways, and each needs its own answer:
  - *Added in Seek* (search +, Discover +, the Sonarr add sheet): ask inline, not
    in a blocking modal. The add sheet gets a Together / Solo row; the one-tap +
    shows a toast like "Added · Watching together?" with a one-tap action.
  - *Added by a download* (Sonarr grabbed it, Seek didn't add it) and *added by a
    Jellyfin play* (Floppy auto-adds what Jellyfin logs): Seek only finds out
    afterwards. The mirror pass already reads both people's libraries; have it
    notice shows neither of you has decided on and file them in an **Unsorted**
    inbox, shown as a Watchlist banner ("2 new shows — together or solo?") with
    one-tap chips, plus an optional push that opens it. iOS web push has no
    action buttons, so the decision itself happens in the app.
  - Until a show is decided it stays **solo** (nothing copied), because copying is
    hard to undo and deciding later loses nothing: marking it Together runs the
    usual catch-up, which fills in any plays that happened in between.
  - A household setting, **New shows start as: Ask / Together / Solo**, defaulting
    to Ask. A partner choosing Together decides it for both of you.

- **Next, after the joint import** (saved 2026-10-04):
  - Widow's Bay: only E10 was marked (by accident), yet the show page says 10/10
    with Season 1 checked, while the episode list correctly says 1/10.
  - Rethink how anime is identified. The `anime` tag comes from the Jellyfin
    Anime library, but anime watched on Netflix and other services never goes
    through Jellyfin, so it's filed as a normal show; meanwhile some non-anime
    sits in that library (Invincible, Vox Machina, Pantheon…).

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
