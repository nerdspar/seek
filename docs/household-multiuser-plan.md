# Household multi-user — implementation plan

**Goal:** you and your wife each sign into Seek as yourselves, see your own
Floppy library, and mark certain shows as **shared** so a play by either of you
(in Seek *or* via Jellyfin auto-scrobble) is mirrored to the other with the same
watched time. Everything else — ratings, status, solo shows — stays individual.

**Scope now:** one household, two people. Built so a multi-household / friends
version is a later extension, not a rewrite. Auth is real email + password
(Resend) from the start, per your call.

---

## What this changes about Seek

Today Seek is stateless: one shared passphrase → a boolean "authed" cookie, one
global `FLOPPY_TOKEN` for every request, and the only thing it persists is two
JSON files in `/data`. Multi-user needs three new things:

1. **Its own user store** (a small SQLite DB in `/data`) — email, password hash,
   verification state, that person's Floppy token, household membership.
2. **Identity in the session** — the cookie says *who* you are, not just that
   you're in.
3. **Per-user Floppy token** threaded through every Seek→Floppy call, so each
   person's requests hit their own library.

Plus the household logic: a shared-show list, fan-out writes, and a reconciler.

---

## Prerequisites (your side — needed before the later phases)

- **Your wife's Floppy account + token.** Floppy has no API to create users or
  tokens, so this is manual: sign her up on Floppy's web signup, log into her
  account, and mint an **Integration Token** (Settings → Integrations → Tokens,
  scopes `watchlist:write` + `sync:read` + `progress:*`). It shows the `flp_…`
  secret once. (Not needed to start Phase A/B.)
- **Resend.** A Resend account, an API key, and a verified sending domain (or use
  Resend's test domain to start). Env: `RESEND_API_KEY`, `MAIL_FROM`.
- **New env:** `SEEK_DB_PATH` (default `/data/seek.db`), `SEEK_SESSION_SECRET`
  (already used), a `SEEK_TOKEN_KEY` to encrypt stored Floppy tokens at rest.

---

## Storage: SQLite (`better-sqlite3`) in `/data`

A real DB rather than JSON — it's the groundwork for friends, and auth wants
transactions + lookups. `better-sqlite3` is synchronous and battle-tested; it
needs the Alpine build toolchain (`python3`, `make`, `g++`) added to the build
stages of the Dockerfile. `/data/seek.db` sits next to the existing JSON files on
the persisted volume. Simple hand-rolled migrations run at boot.

### Schema (v1)

- **households**(id, name, created_at)
- **users**(id, household_id, email unique, password_hash, name, role
  [`owner`|`member`], floppy_token_enc, bookorbit_username,
  bookorbit_password_enc, bookorbit_library_id, email_verified_at, created_at)
- **email_tokens**(id, user_id, kind [`verify`|`reset`], token_hash, expires_at,
  used_at) — for verification + password reset
- **shared_shows**(household_id, source, media_id, added_by, created_at) — the
  shows that mirror between the two members
- **sync_cursors**(user_id, feed [`changes`], cursor) — the reconciler's position
  in each person's Floppy change feed
- **mirror_log**(household_id, external_id unique, source, media_id, season,
  episode, origin_user, created_at) — what we've already mirrored, so fan-out and
  the reconciler stay idempotent and reversible

Floppy tokens are encrypted at rest with `SEEK_TOKEN_KEY` (AES-GCM); they're only
ever used server-side.

---

## Auth (email + password, Resend)

- **Password hashing:** Node's built-in `scrypt` (no new dep).
- **Flows:** sign up → verification email → set password / verify → login.
  Password reset by emailed token. Reuses the existing login throttle/lockout.
- **Sessions:** extend `session.ts` so the signed cookie carries the user id (and
  a version, so a password change can invalidate old sessions). `locals.user` is
  resolved in `hooks.server.ts` from it.
- **Resend:** a thin `mail.ts` that POSTs to Resend's API (no SDK dep).
- Signup is invite/allowlist-gated for now (just the two of you) — not open
  self-serve until the multi-household phase.

---

## Per-user Floppy token threading

`floppy()` currently reads the one global `FLOPPY_TOKEN`. It becomes:
`getRequestEvent().locals.user.floppyToken` during a request, with an explicit
token argument for background jobs (scheduler, warmup, reconciler) that have no
request. `FLOPPY_TOKEN` stays as the fallback / your own token.

---

## Shared shows + mirroring

- **Registry:** a "Shared with <name>" toggle on the show page writes to
  `shared_shows`. A show is identified by `source`+`media_id`.
- **Fan-out (Seek marks):** marking an episode/season on a shared show writes to
  the partner's Floppy too — `POST …/watch/` with the **same `end_date`** and a
  **deterministic `external_id`** (so it's idempotent and an unmark can
  `DELETE ?external_id=…`). Logged in `mirror_log`.
- **Reconciler (the important one):** since you mostly watch via **Jellyfin
  auto-scrobble**, which only credits your Floppy, a background poller walks each
  member's `/api/v1/sync/changes/` feed (cursor-based, conflict-safe) and mirrors
  any play on a *shared* show to the partner — same `end_date` + `external_id`,
  skipping anything already in `mirror_log` (including the fan-out's own writes,
  so marks don't echo). Handles the `409 cursor_expired` re-snapshot contract.
  Runs on the existing scheduler interval.
- **One-time migration:** when a show is first shared, backfill the partner's
  account with the sharer's existing plays for it (bounded, idempotent via
  `external_id`).

---

### As built (2026-10-03)

- **Reconciler reads `/api/v1/history/?flat=1`, not `/sync/changes/`.** Probed
  live: the sync feed answers but is empty (`newest_sequence: null`) on the
  owner's token, while history has every play with `played_at`, `instance_id`
  and `entry_source` (e.g. `jellyfin`), filterable by show (`source`+`media_id`).
  Each pass re-reads history back to 2 days before the last scan.
- **Idempotency without Floppy's help.** The watch POST appends (no upsert), so
  before carrying a play at time T the partner's own plays of that episode are
  checked: one within ±12h means they have credit already (watched together,
  a previous run, a timed-out POST that landed). That check alone makes runs
  idempotent and stops echoes; `mirror_log` (v3) just saves API calls.
  A rewatch long after the partner's viewing does carry over.
- **"Together" is the shared list.** Once two people have Floppy linked, the
  show page's Together/Alone chip shares/unshares (and keeps everyone's `joint`
  tag in step, so filters agree). First share runs the backfill (episodes the
  other hasn't seen at all). Settings → Household lists shared shows.
- Seek marks nudge a debounced pass (~4s); the timer runs every 10 minutes.
  One pass at a time per household.
- **Not mirrored:** unmarking. A carried play is the partner's history; theirs to
  undo. Untested against live Floppy writes (no second account yet) — the first
  real share is the end-to-end test; watch the `[mirror]` logs.

## Phases (each shippable + tested)

- **A — Data + auth core:** SQLite layer + schema/migrations; scrypt passwords;
  session carries user id; `locals.user`; login/logout; signup gated to the two
  of you. (No email yet — verify can be a no-op/admin-approve to start.)
- **B — Email (Resend):** verification + password reset emails.
- **C — Per-user backend credentials:** store each user's Floppy token **and
  BookOrbit login + `bookorbitLibraryId`** (encrypted with `SEEK_TOKEN_KEY`);
  thread them through `floppy()` and the BookOrbit client (per-user session +
  cache); background jobs use the owner's credentials. Each person now sees their
  own TV library and their own reading. (Books: see `docs/books-plan.md`.)
- **D — Shared-show registry + UI:** the toggle + storage; the watchlist/show
  pages read it.
- **E — Fan-out + reconciler:** mirror Seek marks; the change-feed poller; idempotency via `mirror_log`.
- **F — Backfill migration:** copy existing shared history on first share.

Phases A–B need nothing from you. C needs your wife's token. B/C need Resend.

---

## Risks / decisions to confirm

- **`better-sqlite3` native build** on Alpine (adds build tools to the image), or
  Node's built-in `node:sqlite` (no native build). Re-checked 2026-10-03: on the
  image's Node 22 `node:sqlite` now runs without a flag but still warns as
  experimental. **Decided: `better-sqlite3`** — stable API matters more than a few
  Dockerfile lines.
- **Reconciler cadence:** polling every few minutes is fine for a household; it's
  not instant. Acceptable for "we watched it, credit us both."
- **Echo prevention** relies on `external_id` + `mirror_log`; designed so a
  mirrored play is never re-mirrored back.
- **Deploy:** this is still one container; the DB is a file on the existing
  `/data` volume, so nothing new to run on TrueNAS besides the env vars.
</content>
