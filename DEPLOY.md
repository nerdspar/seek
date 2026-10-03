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

It holds Seek's accounts and settings (`seek.db`) and the secrets Seek generates
for itself (`secrets.json` — session signing, the key that encrypts stored
logins, Web Push keys). Back it up with the rest of `/mnt/NAS/Data`; losing it
means setting Seek up again (nobody's Floppy or BookOrbit data is affected).
**Do not** put anything about watch history here — Floppy owns that.

## 3. Put `docker-compose.yml` on the NAS

Copy just that one file (the image is prebuilt — you don't need the repo):

```bash
mkdir -p /mnt/NAS/apps/seek && cd /mnt/NAS/apps/seek
# copy docker-compose.yml here
```

There is nothing to fill in. The only variable is `TZ`; no secrets, tokens or
addresses go in the compose file. (Behind a tunnel you'll also set `ORIGIN` —
see "Security".)

**If Floppy runs on this same host** — including in a *different compose stack* —
reach it by container name: keep the two `networks:` blocks, and in Settings →
Services give Floppy's address as `http://floppy:8000`. Two things to verify,
because both are easy to get wrong:

**The network name is project-prefixed.** Floppy's compose declares `floppy-net`
with no `name:` override, so Compose creates it as `<project>_floppy-net` — most
often `floppy_floppy-net`. `external: true` does no fuzzy matching:

```bash
docker network ls | grep floppy
```

Put that exact string in the `name:` field at the bottom of `docker-compose.yml`.
On this NAS it is **`ix-floppy_floppy-net`** (TrueNAS Apps adds an `ix-` prefix);
the shipped file already has it.

**The port is the internal one, not the published one.** Floppy listens on 8000
inside its container; `8007:8000` publishes it as 8007. Use 8000:

```bash
docker ps --filter name=floppy --format '{{.Names}}\t{{.Ports}}'
```

To skip all of this, comment out both `networks:` blocks and use Floppy's LAN
address (`http://192.168.1.10:8007`) in Settings → Services instead.

## 4. Launch and set up

```bash
docker compose up -d
docker compose logs seek
# [seek] First-run setup code: ABCD-EFGH  (open Seek in a browser to create your account)
```

1. Open `http://<nas-ip>:8100`. Enter your name, email, a password and the
   **setup code** from the log (TrueNAS → Apps → Seek → Logs). The code proves
   you're the one who deployed Seek; it changes on every restart until the
   first account exists.
2. Seek opens **Settings → Services**. Add **Floppy**'s address, then the
   rest you use: **TMDB** key, **Books** (BookOrbit address + Hardcover token),
   **Sonarr / Radarr**, **Jellyfin**, **Email**. Each one is checked when you
   save, so a typo shows up immediately.
3. Under **Your accounts**, link your own Floppy (and calendar, and BookOrbit).
4. Invite the household from **Settings → Household**. Each person links their
   own accounts the same way.

The container healthcheck hits `/api/health`, which reports unhealthy only if
Floppy is configured but unreachable.

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

### Upgrading from an env-configured Seek (one time)

The accounts release moves everything out of the compose file. **Don't change
the compose file before upgrading** — Seek needs the old values on its first
boot to carry them over.

1. **Pull and restart.** On boot Seek copies your old settings in and logs what
   it took: service addresses and keys go to Settings → Services; the session
   secret and VAPID keys go to `/data/secrets.json` (so nobody is signed out
   twice and notifications keep working).
2. **Every device lands on `/setup` once** (old sessions named no user). Create
   your account with your old `SEEK_PASSPHRASE` as the setup code. Your old
   `FLOPPY_TOKEN` / `FLOPPY_CALENDAR_TOKEN` (and `BOOKORBIT_USER/PASSWORD`, if
   set) become *your* linked accounts; your preferences and notification
   devices carry over. Seek then looks exactly as it did.
3. **Add anything new** in Settings → Services (e.g. Books: BookOrbit address +
   Hardcover token), and link your BookOrbit login under Your accounts.
4. **Invite the household** from Settings → Household.
5. **Optional cleanup:** delete every variable except `TZ` from the compose file
   (and `ORIGIN`/`ADDRESS_HEADER` if you're behind a tunnel). They're ignored
   now — later changes belong in Settings.

## Security

Seek proxies every Floppy call server-side, so the browser never sees a token —
but **anyone who can sign in can control that person's Floppy library**, so
every page and API route requires an account.

- **Accounts, not a shared secret.** Each person signs in with their own email
  and password; the owner invites everyone else (there's no open signup).
  Creating the first (owner) account needs the setup code printed in the
  server log, so a stranger who finds a fresh install can't claim it.
- **Nobody runs on someone else's account.** Each request runs as the signed-in
  person with *their* Floppy token, caches and preferences. A household member
  who hasn't linked Floppy sees a "link your account" prompt — never the
  owner's library. The owner is no exception.
- **Stored secrets are encrypted.** Floppy/calendar tokens, BookOrbit passwords
  and the API keys in Settings → Services are AES-GCM encrypted at rest, and
  each is checked against the real service when it's saved. The key is
  generated into `/data/secrets.json`; to keep it apart from the database (so a
  copy of `/data` alone can't decrypt anything), set `SEEK_TOKEN_KEY` in the
  compose file instead — and then never remove it.
- **Keys never reach the browser.** Settings → Services is owner-only and shows
  a secret only as "set".

### How sessions work

- **Sign in once per device, then a year of quiet.** A correct password issues
  an HttpOnly cookie lasting a year. On iOS the home-screen app has its own
  cookie store separate from Safari, so expect to sign in twice on a phone —
  once in Safari, once after adding to the home screen.
- **Sessions really expire, and can be revoked.** The token carries a signed
  issue time the server checks, plus the account's session version: changing a
  password or tapping "Sign out everywhere" kills every other device's cookie.
- **Guessing is throttled.** Every wrong answer costs a fixed delay; six wrong
  answers lock that client out for a minute, and each further failure escalates
  the lockout up to two hours. A lockout blocks the *correct* password too, and
  the counters decay after six quiet hours. Password-reset emails count toward
  the same throttle, so the form can't be used to flood an inbox.
- **Forgotten passwords.** With email configured, "Forgot password?" emails a
  one-hour reset link. Without it, the owner can hand out a reset link from
  Settings → Household.

### `ORIGIN` — the one that will bite you

**Set `ORIGIN` to the exact address browsers use, protocol included.** SvelteKit
checks it against the `Origin` header on every POST, and a mismatch rejects the
sign-in form with `403 Cross-site POST form submissions are forbidden` before the
password is read. The symptom is a sign-in page that just sits there, so Seek
says so on screen rather than failing silently. `ORIGIN` is also the base of the
invite and password-reset links Seek generates, so a wrong value hands out links
that don't work.

It is not really optional: with `ORIGIN` unset, adapter-node assumes `https`, so
a plain-HTTP deployment rejects its own login page.

Reach Seek by the **same hostname inside and outside** the LAN and one value
covers both — the alternative is an origin that is right for one path and wrong
for the other. Seek is already served at `https://seek.example.com`, and that
name resolves to the NAS on the internal network, so:

```yaml
ORIGIN: "https://seek.example.com"
```

Then use that URL on the phone too, not `http://192.168.1.10:8100`.

### Exposing it beyond the LAN

A Cloudflare Tunnel avoids opening ports and reuses the hostname you already
have. In order:

1. **Finish setup first.** `ORIGIN` set, container restarted, the owner account
   created at `/setup`, sign-in reached and passed — *before* the name resolves
   publicly. Scanners find new hostnames within hours of a certificate being
   issued, and an un-set-up Seek would offer them the setup page (the setup code
   from the log is what stops them).
2. **Set `ADDRESS_HEADER`** so the throttle can tell clients apart. Without it
   every request carries the proxy's address and one stranger's failures would
   lock out the household.

Verify after cutover — the cookie must come back marked `Secure`:

```bash
curl -s -X POST https://seek.example.com/login \
  -H 'content-type: application/x-www-form-urlencoded' \
  -H 'Origin: https://seek.example.com' \
  --data-urlencode 'email=YOU@EXAMPLE.COM' \
  --data-urlencode 'password=YOUR_PASSWORD' -D - -o /dev/null | grep -i set-cookie
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
| Subdomain / domain | `seek` / `example.com` |
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
seek.example.com  →  192.168.1.10
```

That is also worth doing on its own account: publishing an A record for a private
address tells anyone who asks how the inside of the network is laid out.

**Then verify, in this order:**

```bash
# 1. From outside (phone on cellular): the tunnel is up and sign-in is required.
curl -s -o /dev/null -w '%{http_code}\n' https://seek.example.com/     # 303 → /login

# 2. The address header survives the extra hop. A 500 here means cloudflared
#    does not send what ADDRESS_HEADER names — adapter-node throws when the
#    configured header is missing, which takes down every route, not just this
#    one. Switch ADDRESS_HEADER to cf-connecting-ip if so.
curl -s -w '\n%{http_code}\n' https://seek.example.com/api/health      # {"ok":true} 200

# 3. From the LAN: still resolving locally, not via Cloudflare.
dig +short seek.example.com                                            # 192.168.1.10
```

Remote clients may share one throttle bucket, because the forwarded-for chain is
a hop longer through the tunnel than it is over the LAN and `XFF_DEPTH` can only
match one of them. The throttle still works; it is just coarser for traffic from
outside. LAN clients stay individually counted.

### Revoking access

- **A lost phone:** sign in elsewhere and tap Settings → **Sign out everywhere**
  (or change your password). Every other device's session dies; nobody else in
  the household is affected.
- **Someone leaving the household:** the owner removes them in Settings →
  Household. Their Seek account and its stored links are deleted; their own
  Floppy and BookOrbit data are untouched.
- **Nuclear option:** delete `sessionSecret` from `/data/secrets.json` and restart
  — every session for everyone is invalidated (Seek makes a new one).

## Optional features

Everything is in the app — nothing to add to the compose file:

- **Upcoming and the daily notification** — each person links their Floppy
  calendar under Your accounts.
- **Search, Discover, artwork** — TMDB key in Settings → Services.
- **Books** — BookOrbit address + Hardcover token in Settings → Services; each
  person links their BookOrbit login.
- **Push notifications** — always available (Seek makes its own VAPID keys). On
  iPhone they only work from the Home-Screen app (iOS 16.4+).
- **Sonarr, Radarr, Jellyfin, Email** — Settings → Services.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `denied` / `manifest unknown` on pull | Not logged in to GHCR, or the first build hasn't published. Check GitHub → Packages. |
| Health shows `"token":"rejected"` | Your linked Floppy token is wrong or was regenerated in Floppy — re-link it under Settings → Your accounts. |
| Lost the setup code | It's printed on every boot (and every time `/setup` is opened) until the first account exists: TrueNAS → Apps → Seek → Logs. |
| `network ... declared as external, but could not be found` | The `name:` under the top-level `networks:` doesn't match. Run `docker network ls \| grep floppy` — it's project-prefixed, e.g. `floppy_floppy-net`. |
| Health shows `reachable:false` with a container-name URL | Wrong internal port (it's 8000, not the published 8007), or Seek isn't actually on Floppy's network. |
| Watchlist empty, health OK | No shows are `in_progress` with an unwatched episode — check Floppy directly. |
| App works, but TrueNAS shows it stuck "Deploying" / "Starting" | The container healthcheck is failing. `/api/health` is deliberately reachable without a session so it can pass while the gate is on; if this comes back on an older image, that is the cause. Check with `docker inspect --format '{{json .State.Health}}' seek`. |
| Undo fails with a 405 | Floppy removed `DELETE` on the episode watch path. See the API findings in [README.md](README.md). |
