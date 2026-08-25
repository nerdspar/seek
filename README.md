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
      # Floppy's address as this container can reach it. A LAN address always
      # works; see DEPLOY.md for reaching it by container name instead, which
      # needs a shared Docker network.
      FLOPPY_URL: "http://192.168.1.10:8007"
      FLOPPY_TOKEN: "your-floppy-api-token"
      SEEK_SESSION_SECRET: "run: openssl rand -hex 32"
      TZ: "America/New_York"
```

```sh
mkdir -p data && chown -R 1000:1000 data
docker compose up -d
```

The image is public, so no `docker login` is needed. Open `http://<host>:8100` on your phone, then **Share → Add to Home Screen**.

Check it came up cleanly:

```sh
curl -s http://<host>:8100/api/health
# {"ok":true,"floppy":{"reachable":true,"version":"v26.8.20",...},"token":"accepted"}
```

[DEPLOY.md](DEPLOY.md) covers this in full, including running Seek on Floppy's own Docker network so traffic never touches the LAN.

## Configuration

All configuration is environment variables. Copy [`.env.example`](.env.example) for local development, or set them in your compose file.

| Variable | Required | Description |
|---|---|---|
| `FLOPPY_URL` | **yes** | Floppy's base URL, as the *container* can reach it. A container name works and is preferred. |
| `FLOPPY_TOKEN` | **yes** | Floppy → Settings → Integrations → API Token. |
| `SEEK_SESSION_SECRET` | **yes** | `openssl rand -hex 32`. Signs the session cookie. |
| `TMDB_API_KEY` | for search | Enables search, discovery and the universal search box. |
| `FLOPPY_CALENDAR_TOKEN` | for Upcoming | The token in Floppy's `.ics` feed URL. |
| `FLOPPY_PUBLIC_URL` | no | Floppy's *browser-reachable* address, for the one link the phone opens directly. Blank hides the link. |
| `SEEK_PASSPHRASE` | see below | Enables the login gate. Blank means no gate. |
| `ORIGIN` | if gated | The exact URL browsers use, protocol included. |
| `TZ` | no | Affects how dates are displayed. |

### Security

**Seek holds your Floppy API token and proxies every call server-side**, so the browser never sees it — but that also means anyone who can reach Seek can control your library. On a trusted LAN that is fine and `SEEK_PASSPHRASE` can stay empty.

Before exposing Seek to the internet, set `SEEK_PASSPHRASE` and `ORIGIN`. With the gate on:

- one passphrase per device, then a year-long signed cookie — you do not log in again
- sessions expire server-side, so a copied cookie dies rather than lasting forever
- failed attempts are throttled, escalating to a two-hour lockout
- the cookie is marked `Secure` automatically when the request is HTTPS

See [DEPLOY.md](DEPLOY.md#security) for the full setup, including a Cloudflare Tunnel walkthrough and the `ORIGIN` trap that will otherwise 403 your own login form.

## Development

```sh
npm install
cp .env.example .env    # fill in FLOPPY_URL and FLOPPY_TOKEN
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
