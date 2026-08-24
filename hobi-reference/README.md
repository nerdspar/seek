# Hobi reference screenshots

Hobi is the iOS app Seek replaces. It's Trakt-only, and Trakt removed free API
access — that's why Seek exists.

**These are references, not targets.** Hobi got the core interaction right;
match that. Where the spec deviates, the spec wins — deviations are deliberate
and noted below.

Hobi has three tabs. Seek has four (Discover is new).

---

## Watchlist

**`01-watchlist-main.png`** — the main screen and the one that matters most.
Poster, title, next episode, progress bar, "N left". Segmented TV/Movies control
at top with sort/filter beside it. FAB bottom-right.

> **Deviation:** Seek drops the wide "Episode Info" button. The
> `SxxEyy · Title` line becomes a tappable pill (raised surface, info glyph)
> that opens the episode sheet; the rest of the row opens the show page. Same two
> destinations, less width spent. See spec §4.1.

> **Deviation:** Seek adds an Anime segment alongside TV Shows and Movies.

**`06-swipe-to-mark.png`** — the swipe reveal, showing the eye icon and "Mark as
Watched" behind the poster. This is the single most important interaction in the
app.

> **Deviation:** Hobi swipes left-to-right. Seek defaults right-to-left, with
> direction configurable. Leave the opposite direction unbound.

**`07-sort-sheet.png`** — sort options: Recently watched, Newest episode, Oldest
episode, Alphabetical, Total episodes, Episodes left to watch.

---

## Show and episode detail

**`02-show-page-top.png`** — untracked show. Poster, ratings row, primary action
button, status/genre/network chips, synopsis, trailer.

**`03-show-page-seasons.png`** — season list with per-season progress bars and
completion checks, then Created by / Starring / You may also like.

**`13-show-page-tracked.png`** / **`14-show-page-tracked-seasons.png`** — same
page for a tracked show. Primary button becomes "Completed"; a "S04E04 airs in 2
days" row appears.

> **Deviation:** Seek shows the actual **air time**, not just a relative day
> count. Hobi omits it and the user specifically wants it. The Floppy iCal feed
> carries datetimes.

**`04-season-episode-list.png`** — episodes within a season: title, `SxxEyy`,
air date, a check circle per episode, and a mark-all control top-right.

**`05-episode-sheet.png`** — the bottom sheet: still, "Mark as Watched", air
date, runtime, `SxxEyy`, title, synopsis. Reached from the episode pill on the
watchlist row or by tapping an episode in the season list. Note it's a sheet
over the current screen, not a navigation push.

---

## Search and add

**`08-search-empty-trending.png`** — search opened from the FAB. Empty state
shows Trending now. Filter chips: Best Match / TV Shows / Movies.

**`09-search-results.png`** — results with poster, type icon, season count,
rating, and an inline Add button per row. Live search fires ~1s after typing
stops.

**`10-search-show-detail-add.png`** — detail page reached from a result; can add
from here or from the row.

> **Deviation:** Seek adds an Anime chip.

---

## Upcoming

**`11-upcoming-timeline.png`** — gradient rail with relative markers (9 Hours, 2
Days, 4 Days), poster and `SxxEyy` and absolute air datetime on the right. Only
covers tracked shows.

**`12-discover-shelves.png`** — Trending Now / Premiering in August / Returning
in August / Most Wanted, currently at the bottom of Upcoming.

> **Deviation:** these shelves move to Seek's Discover tab. Upcoming becomes
> only the timeline.

---

## Profile

**`15-profile-collection.png`** — Collection rows (My TV Shows, My Movies,
Archive) each with View All, then Stats.

**`16-profile-stats-graph.png`** — monthly watch-time line chart with range
chips (This month / This year / Last year / All time), a headline total, and
episode/movie/show counts.

**`17-profile-stats-detail.png`** — Most Watched, Binge Rhythm (day-of-week
histogram), Streak, Finish Rate.

**`18-profile-stats-genres.png`** — Favourite Genres bar, Rarest Watch, Top
Network, watchlist backlog hours, Share stats.

> **Deviation:** Seek computes **none** of this. Everything comes from
> `GET /api/v1/statistics/overview/`. If Floppy doesn't expose a given stat
> (binge rhythm, streak, finish rate are likely candidates), it doesn't ship in
> v1. Do not derive stats client-side.

**`19-profile-diary.png`** — watch history grouped by day, newest first, with
timestamps. Backed by `GET /api/v1/history/`.

---

## Settings

**`20-settings.png`** — grouped list: Automation, Notifications, Help.

> **Deviation:** Seek's settings are much smaller. Notifications live in
> **Floppy**, which already integrates Apprise — Seek only links there. Seek
> stores swipe direction, theme, default tab, default sort, and subscribed
> streaming services. Nothing about watch state.

---

## Visual direction

Hobi's palette is near-black with a blue→violet gradient accent. Seek keeps that
family — see spec §10 for exact tokens. The gradient is reserved for progress
bars, the swipe reveal, the FAB, the active tab icon, and primary buttons.
Nothing else.
