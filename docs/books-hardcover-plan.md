# Books on Hardcover — plan

**Goal:** the simplest, most robust way to track books for each person. Status, rating, dates,
want-to-read, history and the reading goal live in **Hardcover**. BookOrbit is the **library**:
files, downloads, Send to Kindle, OPDS and e-reader sync. Same shape as shows: Floppy tracks,
Sonarr fetches, Jellyfin plays.

Decided 2026-10-04. Checked live, read-only, before writing this:
- Hardcover's API takes a person's own token and can add **any** catalog book with a status
  and rating (`insert_user_book` / `update_user_book` / `delete_user_book`). It can record
  start/finish/pause dates and page or audio progress (`insert_user_book_read` /
  `update_user_book_read`). It has reading goals (`goals`: books or pages, any date range,
  progress computed by Hardcover).
- BookOrbit's Hardcover sync is **change-driven only**. It pushes when status, progress or
  rating changes in BookOrbit (three switches), and never on a timer. Its manual "Sync now"
  pushes everything and is the one thing not to press.
- Trade-off accepted: BookOrbit's streaks, monthly challenge and achievements go. They only
  ever saw books read inside BookOrbit, so they'd disagree with everything else.

## One home per fact

| Fact | Lives in | Seek reads | Seek writes |
|---|---|---|---|
| Status, rating, started/finished dates, want-to-read, history | Hardcover | ✓ | ✓ |
| Reading goal (books this year) | Hardcover | ✓ | ✓ |
| Page progress | Hardcover (e-readers get there via BookOrbit's sync) | ✓ | ✓ (pages you type in) |
| What's in the library, files, downloads, requests, shelves, Send to Kindle | BookOrbit | ✓ | ✓ |

Seek never writes reading state to BookOrbit again, so there's nothing to keep in step. BookOrbit's
own status for a book can go stale; nothing reads it.

**Joining the two:** a library book counts as "yours" through its Hardcover id (BookOrbit already
stores `hardcoverId`). A library book BookOrbit hasn't matched yet gets matched by title and author
(`matchHardcover`, exists today) the first time you give it a status.

**Statuses** become Hardcover's: Want to read · Reading · Paused · Read · Did not finish. A
library book you haven't touched has no status ("In your library"). Seek's extra states fold in:
*Re-reading* → Reading (the read count says it's a re-read), *Skimmed* → Read, *Unread* → no status.

## What changes, surface by surface

- **Reading list (`/books`):** sections come from your Hardcover shelves, with BookOrbit adding
  "in your library", the format and the download state. Library books with no status get their
  own "In your library" section. `settleArrivals` goes: a download no longer needs moving
  across, because the status was in Hardcover all along.
- **Book sheet:** status, rating and pages write to Hardcover, through one endpoint
  (`/api/books/mine`) instead of today's three (`status`, `rating`, `entries`).
- **Profile → Reading and the Diary:** the same local stats (`readingStats`, `bookDiary`), fed from
  Hardcover. Her Goodreads history shows up here. The goal card reads the Hardcover goal; streaks,
  challenge and achievements are removed.
- **Goal editor:** sets this year's Hardcover goal, creating it if there isn't one.
- **Discover, Add a book, Upcoming:** the "on your list / in your library" badges and the + button
  use the Hardcover shelves. Upcoming's "new books by authors you read" uses them too.
- **Recommendations:** already read the Hardcover shelf; that becomes the only input.
- **Downloads and requests:** "goes on your list after a real download" writes Want to read to
  Hardcover instead of Seek's table.

## The new code (one small module)

`src/lib/server/books/shelf.ts`: your Hardcover shelf, as you.
- `myShelf()`: every `user_book` with its latest read, paged, cached per person for a few minutes
  and updated in place after each write (Hardcover allows 60 requests a minute per token).
- `setStatus`, `setRating`, `setPages`, `removeBook`: each one call; unknown → insert.
- `getGoal` / `setGoal`: this year's book goal.
- Errors say what happened ("Hardcover didn't answer — nothing changed"). Hardcover being down
  makes book tracking read-only from the cache; nothing else in Seek is affected.

Pure mapping (Hardcover row ↔ `MyBook`, status ids) lives in `src/lib/books.ts` with unit tests.
The module is tested against a fake GraphQL endpoint, the same way `hardcover.ts` is today.

## Moving what you already have (one time, automatic)

On each person's first visit after the deploy, Seek copies into Hardcover:
1. **Seek-only books** (`book_entries`): status, rating, dates and pages.
2. **Library books with a BookOrbit status or rating** that aren't on your Hardcover shelf yet.

It **never overwrites** anything already in Hardcover (her Goodreads import wins). It records that
it ran, and leaves the old table in place until the next release so nothing is lost if something
looks wrong.

## Your part, once, in BookOrbit (each of you)

Settings → Hardcover:
1. Paste **your own** Hardcover token.
2. Turn on sync on **status**, **progress** and **rating**.
3. Never press **Sync now**.

This is what carries e-reader progress and "finished" into Hardcover.

## Order

1. `shelf.ts` and the mapping, with tests.
2. Switch every read and write listed above, and add the one-time move.
3. Delete what's dead: `book_entries` and `entries.ts`, `settleArrivals`, BookOrbit
   `setReadStatus`/`setBookRating`/`setReadingGoal`/`getReadingSnapshot`, the old endpoints, and the
   streak/challenge/achievement UI.
4. Deploy once (reads and writes have to switch together). Check both your Reading pages, then
   drop the old table in the following release.

**Risks:** Hardcover's API is officially beta. Seek only uses its stable, documented parts (shelves,
reads, goals) and caches reads. A book missing from Hardcover's catalog can't be tracked until
someone adds it on hardcover.app; that's rare, and Seek says so instead of failing silently.
