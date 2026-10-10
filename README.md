# Seek

[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)
[![Container](https://img.shields.io/badge/ghcr.io-nerdspar%2Fseek-2496ed)](https://github.com/nerdspar/seek/pkgs/container/seek)
[![Built with SvelteKit](https://img.shields.io/badge/SvelteKit-5-ff3e00)](https://svelte.dev/)

A phone-first, self-hosted tracker for TV, films and books. Add it to your iPhone home screen and it behaves like a native app: one swipe to mark an episode watched, a calendar of what is coming, and discovery that actually knows what you have already seen.

Seek keeps what each person tracks and every play in its own database, takes show and film information from [TMDB](https://www.themoviedb.org/) (air times from [TVmaze](https://www.tvmaze.com/)), and marks what you watch in [Jellyfin](https://jellyfin.org/) as you watch it. A household shares one Seek: shows you watch together count for both of you.

## What it does

- **Mark an episode in one swipe.** The row slides away, the next episode slides back in its place, and a 6-second undo sits at the bottom in case your thumb was faster than your brain. Swipe direction is configurable.
- **See what is coming.** A calendar rail grouped by day, with real air times where TVmaze knows them and a date where it does not.
- **Find something to watch.** Rows built from TMDB and what you watch most, plus a search box that answers whatever you type at it — an actor, a title you want more things like, a genre, a mood, or a streaming service.
- **Browse by show.** Season list with per-season progress, cast, episode list with air times, mark-all, and a sheet that opens over the list rather than navigating away.
- **Know your habits.** Hours, plays, streaks, most-watched, top genres and networks, and a scrollable diary of everything you have watched.
- **Watch from Jellyfin.** Each person gets a private webhook URL; a play in Jellyfin lands in Seek within seconds.
- **Never feel slow.** Everything about your own list reads from Seek's database in milliseconds, every route streams its shell immediately, and the watchlist keeps itself current while it's open.

## Requirements

- A free [TMDB API key](https://www.themoviedb.org/settings/api)
- Docker, on `linux/amd64` (see [below](#running-on-arm) for ARM)
- Optional: Jellyfin with the Webhook plugin, Sonarr/Radarr, and BookOrbit/Hardcover for books

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
3. Seek opens **Settings → Services**: add your TMDB key (and anything else you use). Then copy your Jellyfin webhook URL from **Your accounts** into Jellyfin's Webhook plugin.
4. On your phone: **Share → Add to Home Screen**.

[DEPLOY.md](DEPLOY.md) covers this in full.

## Configuration

There's nothing to configure in the compose file beyond `TZ`. Seek generates its own secrets into `/data/secrets.json`, and everything else is set in the app:

- **Settings → Services** (the household owner): TMDB key, BookOrbit address and Hardcover token, Sonarr, Radarr, and Resend email. Secrets are stored encrypted and never sent back to the browser; each service is checked when saved.
- **Settings → Your accounts** (each person): their Jellyfin webhook URL, BookOrbit login and Hardcover token.

Optional environment variables: `ORIGIN` and `ADDRESS_HEADER` behind a reverse proxy or tunnel (see [DEPLOY.md](DEPLOY.md#security)); `SEEK_TOKEN_KEY` to keep the encryption key outside `/data`. A Seek upgraded from the older env-based setup copies its old variables in on first boot, after which they can be removed — see [`.env.example`](.env.example).

### Security

Every outside service is called server-side, so no browser ever sees a key — and everyone signs in with their own account and acts only with their own linked credentials. Creating the first account needs the setup code from the server log, so a stranger who finds a fresh install can't claim it.

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

- **Nothing secret reaches the browser.** TMDB, TVmaze, Sonarr/Radarr and the book services are only ever called from `src/lib/server/`; the client talks to Seek's own routes.
- **Seek is the record.** What you track and every play live in `tracked` and `plays`; show info is a TMDB copy in `titles` and `episodes`, refreshed on a schedule (hourly for airing shows). See [docs/own-tracking-plan.md](docs/own-tracking-plan.md).
- **Routes stream.** `load` returns promises rather than awaiting them, so the shell renders immediately and content fills in behind skeletons.
- **Only outside lookups are cached.** `src/lib/server/memo.ts` caches TMDB calls (serving stale while it refreshes); anything read from Seek's own tables is read fresh, so a change shows everywhere at once.

### Running on ARM

The published image is `linux/amd64` only, because it is built for TrueNAS SCALE. On a Raspberry Pi or an ARM NAS, build it yourself:

```sh
git clone https://github.com/nerdspar/seek && cd seek
docker build -t seek .
```

Then use `image: seek` in your compose file instead of the GHCR one.

## Project notes

- **[docs/own-tracking-plan.md](docs/own-tracking-plan.md)** — how Seek came to keep its own records, and how TMDB, TVmaze and the Jellyfin webhook fit together.
- **[seek-spec.md](seek-spec.md)** — the original specification. Section markers (§) throughout the code refer to it.
- **[BACKLOG.md](BACKLOG.md)** — what is not built yet, and why.

## Contributing

Issues and pull requests are welcome. Please run `npm run check` before opening a PR.

## Related

- [MMM-seek](https://github.com/nerdspar/MMM-seek) — a MagicMirror² module showing the same upcoming episodes

## Licence

[MIT](LICENSE)
