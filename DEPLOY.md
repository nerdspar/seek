# Deploying Seek

The container image is built automatically by **GitHub Actions** and published to
**GitHub Container Registry (GHCR)**. TrueNAS just pulls that image and runs it
via [`docker-compose.yml`](docker-compose.yml).

There is **no `.env` file** on the NAS — you paste the secrets straight into
`docker-compose.yml`. (`.env` is only used for local development.)

Seek stores **no watch state**. Floppy is the single source of truth; the one
folder below holds Seek's own preferences and nothing else.

---

## How the image is built (nothing to run — this is automatic)

[`.github/workflows/docker-publish.yml`](.github/workflows/docker-publish.yml)
builds and pushes on every push to `main` (and on `v*` tags), for `linux/amd64`.
It uses the built-in `GITHUB_TOKEN`, so there are no secrets to configure.

```
ghcr.io/nerdspar/seek:latest      # newest main build
ghcr.io/nerdspar/seek:sha-abc1234 # per-commit
ghcr.io/nerdspar/seek:v1.2.3      # per release tag
```

> First time: the workflow has to be on `main` before it can run. Push it, then
> check **GitHub → seek → Packages** to confirm the image published, or trigger
> it manually from the **Actions** tab ("Run workflow").

---

## 1. Let TrueNAS pull the image (one-time)

The repo is private, so the GHCR package is private too.

1. **Create a Personal Access Token (classic)** with the **`read:packages`**
   scope: GitHub → *Settings → Developer settings → Personal access tokens →
   Tokens (classic)*.

2. **Log Docker in on the TrueNAS host** (SSH or the TrueNAS shell):

   ```bash
   docker login ghcr.io -u nerdspar
   # Password: paste the token, NOT your GitHub password
   ```

> Prefer not to manage a token? Make just the **package** public (the repo stays
> private): GitHub → Packages → `seek` → *Package settings → Change visibility →
> Public*. Then skip this step entirely.

## 2. Create the dataset / folder

Seek needs exactly one path. Either create a TrueNAS **dataset** named `seek`
under your `Data` dataset, or just make the directory:

```bash
mkdir -p /mnt/NAS/Data/seek
chown -R 1000:1000 /mnt/NAS/Data/seek
```

The container runs as the `node` user (uid 1000), so it needs to own that path.

A dataset is slightly nicer if you want snapshots, but this folder holds only
Seek's preferences — swipe direction, default sort, theme. Losing it costs you
nothing but a few toggles. **Do not** put anything about watch history here.

## 3. Put `docker-compose.yml` on the NAS and fill in the secrets

Copy just that one file (the image is prebuilt — you don't need the repo):

```bash
mkdir -p /mnt/NAS/apps/seek && cd /mnt/NAS/apps/seek
# copy docker-compose.yml here, then edit it
```

Fill in the three values marked ⬅ :

| Setting | Where it comes from |
|---|---|
| `FLOPPY_URL` | `http://floppy:8000` if Floppy runs on this same Docker host — note 8000 is the *internal* port, not the published one (see below). Otherwise its LAN address, e.g. `http://10.0.1.14:8007` |
| `FLOPPY_TOKEN` | Floppy → Settings → Integrations → API Token |
| `SEEK_SESSION_SECRET` | `openssl rand -hex 32` |

`SEEK_PASSPHRASE`, `FLOPPY_CALENDAR_TOKEN` and `TMDB_API_KEY` can stay empty for
now — see "Security" and "Not wired up yet" below.

**If Floppy runs on this same host** — including in a *different compose stack* —
prefer reaching it by container name. `docker-compose.yml` ships configured that
way (`FLOPPY_URL: http://floppy:8000` plus the two `networks:` blocks). Two things
to verify first, because both are easy to get wrong:

**The network name is project-prefixed.** Floppy's compose declares `floppy-net`
with no `name:` override, so Compose creates it as `<project>_floppy-net` — most
often `floppy_floppy-net`. `external: true` does no fuzzy matching:

```bash
docker network ls | grep floppy
```

Put that exact string in the `name:` field at the bottom of `docker-compose.yml`.
A mismatch fails loudly at startup with "network ... declared as external, but
could not be found".

**The port is the internal one, not the published one.** Floppy listens on 8000
inside the container by default. If you changed the published port to 8007, the
mapping is `8007:8000` and the internal port is still **8000** — Floppy's own
compose comments say not to set `FLOPPY_PORT` merely to change what's published.
Confirm with the right-hand side of the arrow:

```bash
docker ps --filter name=floppy --format '{{.Names}}\t{{.Ports}}'
```

Then prove the route works from inside the container:

```bash
docker compose up -d && sleep 5
docker compose exec seek node -e \
  "fetch('http://floppy:8000/api/v1/info/').then(r=>r.json()).then(j=>console.log('reached Floppy',j.version)).catch(e=>console.log('FAILED',e.message))"
```

To skip all of this, comment out both `networks:` blocks and set `FLOPPY_URL`
back to the LAN address (`http://10.0.1.14:8007`). It works fine; it just
hairpins through the router.

## 4. Launch

```bash
docker compose up -d
docker compose logs -f seek     # expect: Listening on http://0.0.0.0:8100
```

Confirm it can actually reach Floppy:

```bash
curl -s http://localhost:8100/api/health
# {"ok":true,"floppy":{"reachable":true,"version":"v26.8.20",...},"token":"accepted"}
```

The container's healthcheck runs that same endpoint, so a bad token or an
unreachable Floppy shows up as `unhealthy` in `docker ps` rather than as a blank
screen on your phone.

## 5. Add it to the iPhone home screen

Open `http://<nas-ip>:8100` in Safari → **Share → Add to Home Screen**. It
launches standalone with no browser chrome. Safari is required for this — Chrome
on iOS can't install PWAs.

---

## Updating

```bash
docker compose pull && docker compose up -d
docker image prune -f
```

Pushing to `main` publishes a new `:latest` within a couple of minutes, so this
is all it takes. If you run Watchtower, it will pick it up on its own.

## Security

Seek holds your Floppy API token and proxies every call server-side, so the
browser never sees it — but **anyone who can reach Seek can control your Floppy
library**. On a trusted LAN that's fine and `SEEK_PASSPHRASE` can stay empty.

Set `SEEK_PASSPHRASE` to a shared household passphrase **before** putting Seek
behind a reverse proxy, Cloudflare Tunnel, or anything else reachable off the
LAN. With it set, Seek gates every page and every API route behind a signed
session cookie.

## Not wired up yet

`FLOPPY_CALENDAR_TOKEN` (Upcoming) and `TMDB_API_KEY` (search and Discovery)
belong to build steps that aren't written. Leave them blank; Seek only reads them
when those features exist.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `denied` / `manifest unknown` on pull | Not logged in to GHCR, or the first build hasn't published. Check GitHub → Packages. |
| Health shows `"token":"rejected"` | `FLOPPY_TOKEN` is wrong or was regenerated in Floppy. |
| `network ... declared as external, but could not be found` | The `name:` under the top-level `networks:` doesn't match. Run `docker network ls \| grep floppy` — it's project-prefixed, e.g. `floppy_floppy-net`. |
| Health shows `reachable:false` with a container-name URL | Wrong internal port (it's 8000, not the published 8007), or Seek isn't actually on Floppy's network. |
| Watchlist empty, health OK | No shows are `in_progress` with an unwatched episode — check Floppy directly. |
| Undo fails with a 405 | Floppy removed `DELETE` on the episode watch path. See the API findings in [README.md](README.md). |
