# Seek → Floppy MCP server

A [Model Context Protocol](https://modelcontextprotocol.io) server that exposes
your Floppy library — what you have watched, what you have rated, and your
aggregate taste — to a Claude client, so Claude can make recommendations
grounded in your real history rather than guesses ("recommend me anime based on
what I've watched and rated").

It is **read-only**: every tool is a GET. Nothing here marks, rates, or deletes
anything in Floppy.

## Why a server, not an export

Floppy is self-hosted on your LAN, and neither claude.ai nor a cloud Claude
session can reach a private address. This server runs on a machine that *can*
reach Floppy (the Floppy host itself is fine), and a **local** Claude — Claude
Desktop or Claude Code on that same network — reaches it. The connection to
Floppy never leaves your network, and your API token never leaves this process.

## Two ways to run it

Pick one, set by the `MCP_TRANSPORT` env var:

- **stdio** (default) — the Claude client launches this as a subprocess and
  talks over stdin/stdout. No port, no daemon. Right for a **local Claude
  Desktop** on the same machine. See [stdio setup](#stdio-run-it-locally).
- **http** (`MCP_TRANSPORT=http`) — a long-lived HTTP service on `PORT`
  (default 8110), speaking MCP at `POST /mcp`. Right for running **in a Docker
  compose stack** next to Floppy and Seek. See [Docker setup](#http-run-it-in-docker-compose).

Either way the tools are identical and read-only.

## stdio: run it locally

Needs Node 20+.

```sh
cd mcp
npm install
npm run build      # compiles src/ → dist/
```

### Configure Claude Desktop

Add it to Claude Desktop's config file:

- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "floppy": {
      "command": "node",
      "args": ["/absolute/path/to/seek/mcp/dist/index.js"],
      "env": {
        "FLOPPY_URL": "http://192.168.1.10:8007",
        "FLOPPY_TOKEN": "your-floppy-api-token"
      }
    }
  }
}
```

- `FLOPPY_URL` — Floppy's address **as the machine running this server can reach
  it**. A LAN address is the safe choice. (Unlike Seek, this server is not in a
  container, so a container name usually will not resolve.)
- `FLOPPY_TOKEN` — Floppy → Settings → Integrations → API Token.

Restart Claude Desktop. Then ask, e.g., *"recommend me 5 anime based on what I've
watched and rated"* — Claude will call the tools below. There is also a built-in
**`recommend_anime`** prompt (a slash command in Claude Desktop) that scripts
that flow.

For Claude Code, add the same server with `claude mcp add` or a `.mcp.json`, run
from a machine that can reach Floppy.

## http: run it in Docker compose

This is the option for running it as a service alongside Floppy and Seek. Like
the app, the image is built by [`.github/workflows/docker-publish.yml`](../.github/workflows/docker-publish.yml)
and pushed to GHCR as `ghcr.io/<owner>/seek-mcp`, so a pull-only host (TrueNAS
Apps) can run it without building. The repo's
[`docker-compose.yml`](../docker-compose.yml) already includes a `seek-mcp`
service pointing at that image — fill in `FLOPPY_TOKEN` (and `MCP_AUTH_TOKEN`,
see below) and bring it up the way you deploy the rest of the stack.

It joins Floppy's Docker network and reaches Floppy at `http://floppy:8000`
internally — the same address Seek uses, no LAN hop. It listens on `:8110` and
serves MCP at `POST /mcp`, with an unauthenticated `/health` for the container
healthcheck.

Two things about the GHCR image on a first deploy:

- The workflow publishes the `:latest` tag only on the **default branch**, so
  the image appears after this lands on `main` (or a manual `workflow_dispatch`
  run — but that only pushes an `sha-…` tag off a feature branch, not `latest`).
- `seek-mcp` is its **own** GHCR package. After the first push, set its
  visibility to match `seek` (or grant your pull token access), or the pull 403s.

To build and run it by hand instead (any machine with Docker and this repo):

```sh
docker build -t seek-mcp ./mcp
docker run -d --name seek-mcp -p 8110:8110 \
  -e FLOPPY_URL=http://192.168.1.10:8007 \
  -e FLOPPY_TOKEN=your-token \
  -e MCP_AUTH_TOKEN=your-long-random-secret \
  seek-mcp
```

That same `docker build … && docker push ghcr.io/<owner>/seek-mcp:latest` (after
`docker login ghcr.io`) is also how to get the image into GHCR without waiting
for CI.

### Point a client at the HTTP server

- **Claude Code:**
  ```sh
  claude mcp add --transport http floppy http://<host>:8110/mcp \
    --header "Authorization: Bearer <your MCP_AUTH_TOKEN>"
  ```
- **Claude Desktop:** Settings → Connectors → Add custom connector → paste
  `http://<host>:8110/mcp` (custom connectors require a paid plan).

The client still has to run somewhere that can reach `<host>:8110`.

### Security when exposed

The server holds your Floppy token and will hand your library to anyone who can
reach `:8110`. It is **read-only** — nothing here can change your library — but
before exposing that port beyond a trusted LAN:

- set `MCP_AUTH_TOKEN` to a long random string (`openssl rand -hex 32`) so
  requests need `Authorization: Bearer <token>`, and
- prefer putting it behind your existing reverse proxy / tunnel rather than
  publishing the port directly.

With `MCP_AUTH_TOKEN` unset the endpoint is open to anyone who can reach it —
fine on a trusted LAN, not fine on the open internet.

## Tools

| Tool | What it does |
|---|---|
| `check_connection` | Confirms Floppy is reachable and the token is accepted. Run this first if anything fails. |
| `list_titles` | Your library with your rating and status. Filter by media type / status, or `ratedOnly` / `minScore`. Rows carry `source` + `mediaId` for `get_title_details`. |
| `get_title_details` | Full detail for one title — genres, studios, synopsis, cast, community score, and your own rating/progress. |
| `get_stats` | Aggregate taste profile: media counts, top genres, top studios, highest-rated titles. |

## A note on anime

This is built for the "recommend me anime" case, but Floppy's anime handling has
a wrinkle worth knowing (see [`../docs/floppy-api-notes.md`](../docs/floppy-api-notes.md)):
whether anime is filed in a separate bucket or mixed into the TV library depends
on the instance's `anime_library_mode`. If `list_titles` with `mediaType:
"anime"` comes back empty, your anime lives in the TV library — pull `mediaType:
"tv"` and let Claude identify the anime by title and genre. `list_titles` says so
in a `note` when it detects this.

## Scope

This server front-ends **Floppy only**, and lives in the Seek repo because it is
built on Seek's knowledge of Floppy's API. Servers for other apps belong with
those apps (or in a dedicated collection), sharing a common core rather than
being folded into this one — separate credentials, reachability, and trust
levels are easier to reason about kept apart.
