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

On this NAS it is **`ix-floppy_floppy-net`** — TrueNAS Apps adds an `ix-` prefix
on top of the compose project prefix. The shipped file already has it.

**The port is the internal one, not the published one.** Floppy listens on 8000
inside the container by default. If you changed the published port to 8007, the
mapping is `8007:8000` and the internal port is still **8000** — Floppy's own
compose comments say not to set `FLOPPY_PORT` merely to change what's published.
Confirm with the right-hand side of the arrow:

```bash
docker ps --filter name=floppy --format '{{.Names}}\t{{.Ports}}'
```

On this NAS that reports `floppy  0.0.0.0:8007->8000/tcp`, so `http://floppy:8000`
is correct and is what the shipped file uses.

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

Set `SEEK_PASSPHRASE` **before** putting Seek behind a reverse proxy, Cloudflare
Tunnel, or anything else reachable off the LAN. With it set, Seek gates every
page and every API route behind a signed session cookie.

### What the gate does

- **One passphrase, then a year of quiet.** A correct passphrase issues an
  HttpOnly cookie lasting a year, so you authenticate once per device and not
  again. On iOS the home-screen app has its own cookie store separate from
  Safari, so expect to enter it twice on a phone — once in Safari, once after
  adding to the home screen.
- **The cookie is per-device.** Every other device and every other person gets
  the login screen.
- **Sessions really expire.** The token carries a signed issue time that the
  server checks, so a copied cookie dies at a year rather than lasting forever.
  The cookie's own `Max-Age` is only a promise the browser makes.
- **Guessing is throttled.** Every wrong answer costs a fixed delay; six wrong
  answers lock that client out for a minute, and each further failure escalates
  the lockout up to two hours. A lockout blocks the *correct* passphrase too,
  and the counters decay after six quiet hours.

Because you type it about once per device, make it long — six random words or
20+ characters from a password manager. Nothing about the UX rewards a short one.

### `ORIGIN` — the one that will bite you

**Set `ORIGIN` to the exact address browsers use, protocol included, whenever the
gate is on.** SvelteKit checks it against the `Origin` header on every POST, and
a mismatch rejects the login form with `403 Cross-site POST form submissions are
forbidden` before the passphrase is read. The symptom is a login page that just
sits there, so Seek now says so on screen rather than failing silently.

It is not really optional: with `ORIGIN` unset, adapter-node assumes `https`, so
a plain-HTTP deployment rejects its own login page.

Reach Seek by the **same hostname inside and outside** the LAN and one value
covers both — the alternative is an origin that is right for one path and wrong
for the other. Seek is already served at `https://seek.nerdspar.com`, and that
name resolves to the NAS on the internal network, so:

```yaml
ORIGIN: "https://seek.nerdspar.com"
```

Then use that URL on the phone too, not `http://10.0.1.14:8100`.

### Exposing it beyond the LAN

A Cloudflare Tunnel avoids opening ports and reuses the hostname you already
have. In order:

1. **Turn the gate on and confirm it.** `SEEK_PASSPHRASE` and
   `SEEK_SESSION_SECRET` set, `ORIGIN` set, container restarted, login screen
   reached and passed — *before* the name resolves publicly. Scanners find new
   hostnames within hours of a certificate being issued.
2. **Set `ADDRESS_HEADER`** so the throttle can tell clients apart. Without it
   every request carries the proxy's address and one stranger's failures would
   lock out the household.

Verify after cutover — the cookie must come back marked `Secure`:

```bash
curl -s -X POST https://seek.nerdspar.com/login \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'Origin: https://seek.nerdspar.com' \
  --data-urlencode 'passphrase=YOUR_PASSPHRASE' -D - -o /dev/null | grep -i set-cookie
```

Cloudflare's own rate limiting on `/login` is worth adding as a second layer, but
Seek does not depend on it.

#### Tunnel setup

Add `cloudflared` to this same compose file. Nothing about Seek's own config
changes.

The `networks:` key is not optional. Compose puts a service on the default
network *only* while it names no networks of its own — and `seek` names
`floppy-net`, so it is not on the default one. Omit this and `cloudflared` lands
somewhere `seek` isn't, the hostname fails to resolve, and the Cloudflare
dashboard shows the Host leg in error while the tunnel itself looks healthy.

```yaml
  cloudflared:
    image: cloudflare/cloudflared:latest
    container_name: seek-tunnel
    restart: unless-stopped
    command: tunnel --no-autoupdate run
    environment:
      # Zero Trust → Networks → Tunnels → Create a tunnel → Docker → copy the token.
      TUNNEL_TOKEN: "PASTE_TUNNEL_TOKEN_HERE" # ⬅ TUNNEL_TOKEN
    networks:
      - floppy-net # must match seek's, or it cannot resolve `seek`
```

Confirm they landed together before debugging anything else:

```bash
docker inspect -f '{{range $n,$_ := .NetworkSettings.Networks}}{{$n}} {{end}}' seek seek-tunnel
docker exec seek-tunnel sh -c 'wget -qO- http://seek:8100/api/health'   # {"ok":true}
```

In the Zero Trust dashboard, give the tunnel one public hostname:

| Field | Value |
|---|---|
| Subdomain / domain | `seek` / `nerdspar.com` |
| Type | `HTTP` |
| URL | `seek:8100` |

`HTTP` is correct on that last row — the hop is container-to-container inside the
NAS, and Cloudflare terminates TLS at the edge. Seek still sees `https` because
`ORIGIN` says so, which is what sets the cookie's `Secure` flag.

**Keep LAN traffic off the internet.** Creating the hostname replaces the DNS
record with a proxied CNAME, so without this step every request from the couch
would leave the house and come back. Add a local override on whatever resolves
DNS for the LAN:

```
seek.nerdspar.com  →  10.0.1.14
```

That is also worth doing on its own account: publishing an A record for a private
address tells anyone who asks how the inside of the network is laid out.

**Then verify, in this order:**

```bash
# 1. From outside (phone on cellular): the tunnel is up and the gate holds.
curl -s -o /dev/null -w '%{http_code}\n' https://seek.nerdspar.com/     # 303 → /login

# 2. The address header survives the extra hop. A 500 here means cloudflared
#    does not send what ADDRESS_HEADER names — adapter-node throws when the
#    configured header is missing, which takes down every route, not just this
#    one. Switch ADDRESS_HEADER to cf-connecting-ip if so.
curl -s -w '\n%{http_code}\n' https://seek.nerdspar.com/api/health      # {"ok":true} 200

# 3. From the LAN: still resolving locally, not via Cloudflare.
dig +short seek.nerdspar.com                                            # 10.0.1.14
```

Remote clients may share one throttle bucket, because the forwarded-for chain is
a hop longer through the tunnel than it is over the LAN and `XFF_DEPTH` can only
match one of them. The throttle still works; it is just coarser for traffic from
outside. LAN clients stay individually counted.

### Revoking access

There is one shared secret and no per-device records, so a lost phone means
rotating `SEEK_SESSION_SECRET` and restarting. That invalidates every session on
every device, and everyone logs in once more.

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
| App works, but TrueNAS shows it stuck "Deploying" / "Starting" | The container healthcheck is failing. `/api/health` is deliberately reachable without a session so it can pass while the gate is on; if this comes back on an older image, that is the cause. Check with `docker inspect --format '{{json .State.Health}}' seek`. |
| Undo fails with a 405 | Floppy removed `DELETE` on the episode watch path. See the API findings in [README.md](README.md). |
