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
Desktop or Claude Code on that same network — launches it over stdio. The
connection to Floppy never leaves your network, and your API token never leaves
this process.

## Build

Needs Node 20+.

```sh
cd mcp
npm install
npm run build      # compiles src/ → dist/
```

## Configure your Claude client

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
