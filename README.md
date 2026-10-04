# Seek

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io-nerdspar%2Fseek-2496ed)](https://github.com/nerdspar/seek/pkgs/container/seek)
[![Built with SvelteKit](https://img.shields.io/badge/SvelteKit-5-ff3e00)](https://svelte.dev/)

A phone-first web app for [Floppy](https://github.com/dannyvfilms/Floppy), the self-hosted media tracker. Add it to your iPhone home screen and it behaves like a native app: one swipe to mark an episode watched, a calendar of what is coming, and discovery that actually knows what you have already seen.

Floppy is an excellent tracker with a web UI built for a desktop. Seek is the thing you reach for on the sofa.

> **Floppy stays the source of truth.** Seek stores nothing but your own display preferences. Every play, every status, every rating lives in Floppy exactly as it did before — point Seek at your instance and point it away again, and nothing has changed.

## What it does

- **Mark an episode in one swipe.** The row slides away, the next episode slides back in its place, and a 6-second undo sits at the bottom in case your thumb was faster than your brain. Swipe direction is configurable.
- **See what is coming.** A calendar rail grouped by day, with real air times where Floppy knows them and a date where it does not.
- **Find something to watch.** Floppy's own recommendation rows, plus a search box that answers whatever you type at it — an actor, a title you want more things like, a genre, a mood, or a streaming service.
- **Browse by show.** Season list with per-season progress, cast, episode list with air times, mark-all, and a sheet that opens over the list rather than navigating away.
- **Know your habits.** Hours, plays, streaks, most-watched, top genres and networks, and a scrollable diary of everything you have watched.
- **Never feel slow.** Every route streams its shell immediately and fills in with skeletons; results are cached server-side and refreshed in the background, and the expensive queries are warmed at startup so no tap ever pays for them.

## Requirements

- A [Floppy](https://github.com/dannyvfilms/Floppy) instance, and its API token
- Docker, on `linux/amd64` (see [below](#running-on-arm) for ARM)
- Optional: a [TMDB API key](https://www.themoviedb.org/settings/api) for search and discovery, and Floppy's calendar token for the Upcoming tab

## Quick start

```yaml
services:
  seek:
    image: ghcr.io/nerdspar/seek:latest
    container_name: seek
    restart: unless-stopped
    ports:
      - "8100:8100"
    volumes:
      - ./data:/data
    environment:
      TZ: "America/New_York"
```

```sh
mkdir -p data && chown -R 1000:1000 data
docker compose up -d
```

The image is public, so no `docker login` is needed. Then:

1. `docker compose logs seek` shows a **setup code** (`First-run setup code: ABCD-EFGH`).
2. Open `http://<host>:8100`, create your account with that code.
3. Seek opens **Settings → Services**: add Floppy's address (and TMDB's key, and anything else you use). Then link your own Floppy token under **Your accounts**.
4. On your phone: **Share → Add to Home Screen**.

[DEPLOY.md](DEPLOY.md) covers this in full, including running Seek on Floppy's own Docker network so traffic never touches the LAN.

## Configuration

There's nothing to configure in the compose file beyond `TZ`. Seek generates its own secrets into `/data/secrets.json`, and everything else is set in the app:

- **Settings → Services** (the household owner): Floppy's address, TMDB key, BookOrbit address and Hardcover token, Sonarr, Radarr, and Resend email. Secrets are stored encrypted and never sent back to the browser; each service is checked when saved.
- **Settings → Your accounts** (each person): their own Floppy token, Floppy calendar, and BookOrbit login.

Optional environment variables: `ORIGIN` and `ADDRESS_HEADER` behind a reverse proxy or tunnel (see [DEPLOY.md](DEPLOY.md#security)); `SEEK_TOKEN_KEY` to keep the encryption key outside `/data`. A Seek upgraded from the older env-based setup copies its old variables in on first boot, after which they can be removed — see [`.env.example`](.env.example).

### Security

Seek proxies every Floppy call server-side, so no browser ever sees a token — and everyone signs in with their own account and acts only with their own linked credentials. Creating the first account needs the setup code from the server log, so a stranger who finds a fresh install can't claim it.

- a year-long signed session per device, revocable by changing the password or "Sign out everywhere"
- failed sign-ins are throttled, escalating to a two-hour lockout
- the cookie is marked `Secure` automatically when the request is HTTPS

See [DEPLOY.md](DEPLOY.md#security) for the full setup, including a Cloudflare Tunnel walkthrough and the `ORIGIN` trap that will otherwise 403 your own login form.

## Development

```sh
npm install
cp .env.example .env    # nothing to fill in; set services up in the app
npm run dev             # http://<your-lan-ip>:8100
```

```sh
npm run check           # svelte-check
npm run build           # production build
node build              # run it
```

Seek is [SvelteKit](https://svelte.dev/) 2 with Svelte 5 runes, `adapter-node`, and no client-side state library. A few things are worth knowing before changing it:

- **Nothing secret reaches the browser.** Floppy and TMDB are only ever called from `src/lib/server/`; the client talks to Seek's own routes.
- **Routes stream.** `load` returns promises rather than awaiting them, so the shell renders immediately and content fills in behind skeletons.
- **The cache serves stale while it refreshes.** `src/lib/server/memo.ts` returns a stale entry instantly and revalidates behind it, which is why switching filters feels instant.
- **Expensive queries are warmed at boot.** See the top of `src/hooks.server.ts`. Floppy needs ~13s to page a full library and ~9s for an all-time statistics overview; neither should ever land on a tap.

### Running on ARM

The published image is `linux/amd64` only, because it is built for TrueNAS SCALE. On a Raspberry Pi or an ARM NAS, build it yourself:

```sh
git clone https://github.com/nerdspar/seek && cd seek
docker build -t seek .
```

Then use `image: seek` in your compose file instead of the GHCR one.

## Project notes

- **[docs/floppy-api-notes.md](docs/floppy-api-notes.md)** — what was learned driving Floppy's API hard enough to migrate ~13,000 plays through it. Where the OpenAPI schema is wrong or silent, which endpoints are undocumented, how anime classification actually works, and which mistakes cost real data. Worth reading before writing anything against Floppy yourself.
- **[seek-spec.md](seek-spec.md)** — the original specification. Section markers (§) throughout the code refer to it.
- **[BACKLOG.md](BACKLOG.md)** — what is not built yet, and why.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before opening a PR.

If you change anything that talks to Floppy, verify it against a live instance rather than the schema — [docs/floppy-api-notes.md](docs/floppy-api-notes.md) exists because the schema is not reliable, and it is worth adding to when you find something new.

## Related

- [Floppy](https://github.com/dannyvfilms/Floppy) — the tracker Seek front-ends
- [MMM-seek](https://github.com/nerdspar/MMM-seek) — a MagicMirror² module showing the same upcoming episodes

## Licence

[MIT](LICENSE)
