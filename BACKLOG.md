# Backlog

Things flagged but deliberately not built yet. Build order is in
[seek-spec.md](seek-spec.md) §13.

## Swipe commit animation and re-sort

*Flagged after the first real use, 2026-08-24. This is the highest-value item —
it is the core interaction.*

Today the row snaps back to its resting position the moment the mark commits.
It should instead:

1. **Continue sliding all the way off screen** rather than springing back. The
   gesture should complete the direction it was going.
2. Then resolve where the row belongs, using the show's *new* next episode:
   - if it still sorts ahead of everything else in the list, it **stays in
     place** and slides back in;
   - otherwise it **animates to its correct position** under the active sort.

Notes for whoever builds this:

- The authoritative post-mark state already arrives from `POST /api/watch`,
  which re-reads the show row server-side. No extra call is needed to decide
  the new position.
- Re-sorting client-side means replicating Floppy's `sort` semantics locally.
  Cheaper and more honest: reorder using the same field the active sort names,
  and let the next server load be the tiebreak.
- Respect `prefers-reduced-motion` — the reorder should be instant, not
  animated, when that is set.
- The undo toast has to survive the reorder: undo must put the row back where
  it was, not merely restore its data.

## Anime

- **Bucket migration is parked.** `anime-list.txt` (18 shows) and
  `migrate-anime.sql` are generated and unrun. See README → "Anime bucket
  migration".
- Once migrated, anime belongs in the **filter control** (§4.6) alongside status
  and platform — explicitly *not* a top-level segment. The segmented control
  stays TV Shows / Movies.

## Settings

The settings sheet currently holds only the swipe direction. §8 also calls for
theme, default tab, default sort, subscribed streaming services, and a link out
to Floppy's own settings.

One wrinkle, and it applies **only** to that outbound link. Every other Floppy
call is proxied server-side, so `FLOPPY_URL=http://floppy:8000` is correct and
the browser never resolves it — verified: nothing served to the client mentions
the Floppy host, port, or API key, and the only external host the page loads is
`image.tmdb.org` for posters.

A settings link is different, because it makes the *phone* navigate to Floppy
directly, and `floppy:8000` does not resolve outside Docker. So that one link
needs a separate LAN-reachable address — add a `FLOPPY_PUBLIC_URL` env var
(e.g. `http://10.0.1.14:8007`) and omit the link when it is unset.

## Not yet built from the spec

- **Sort control** (§4.5) — Recently watched / Newest / Oldest / Alphabetical /
  Total episodes / Episodes left. Maps to the `sort` and `direction` params;
  note `sort` is a closed enum and there is no `progressed_at`.
- **Filters** (§4.6) — status and platform, plus the anime chip once the bucket
  migration lands.
- **Joint/solo tag** (§11) — `tag[]`/`tag_mode` on the list endpoint and
  `PUT .../tags/` already support it; the payload is the Solo/Joint/All filter.
- **Collection rows** (§7.2) — My TV Shows / My Movies / Archive with View All.
  Profile currently links only to the Diary.

## Smaller items

- Confirmation-toast setting for actions that have no undo of their own
  (mark-all-season, add show). Marking already toasts because undo needs it.
  Raised because iOS Safari has no Vibration API, so §4.2's haptic cannot fire —
  see `src/lib/haptics.ts`.
- The statistics endpoint ignores `range=` and `period=`; only explicit
  `start_date`/`end_date` narrow the window. §7.1 guessed that binge rhythm,
  streaks and finish rate would be missing — they are not, Floppy reports all of
  them, so they ship.
- Movies use a different watch endpoint:
  `POST|DELETE /api/v1/media/movie/{source}/{media_id}/watch/`, undocumented but
  mirroring episode semantics with an optional `external_id`. Wire it up when the
  movie library is populated.
- Upcoming must render an air **time** only when one is genuinely known —
  roughly a third of feed events carry a real time and the rest are a
  `11:59:59Z` placeholder. See README → "Calendar feed".
