#!/usr/bin/env node
/**
 * Seek → Floppy MCP server.
 *
 * Exposes your Floppy library — what you have watched, what you have rated, and
 * your aggregate taste — as Model Context Protocol tools, so a Claude client
 * (Claude Desktop, Claude Code) can read it and make recommendations grounded in
 * your actual history rather than guesses.
 *
 * WHY A SERVER AND NOT AN EXPORT: Floppy is self-hosted on your LAN, and neither
 * claude.ai nor a cloud Claude session can reach a private address. Run this
 * server on a machine that CAN reach Floppy (the Floppy host itself is fine) and
 * a local Claude launches it over stdio, so the connection never leaves your
 * network and your API token never leaves this process.
 *
 * READ-ONLY BY DESIGN. Every tool here is a GET. Nothing marks, rates, or deletes
 * anything in Floppy — recommendations should never mutate the library they read.
 *
 * stdio discipline: an MCP stdio server speaks JSON-RPC on stdout, so nothing
 * else may be written there. All diagnostics go to stderr (console.error).
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { floppy } from './floppy.js';

/* ── small coercion helpers (Floppy's JSON is loosely typed) ─────────────── */
type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec => (v && typeof v === 'object' ? (v as Rec) : {});
const str = (v: unknown): string | null => (typeof v === 'string' && v ? v : null);
const num = (v: unknown): number | null => (typeof v === 'number' ? v : null);
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const strings = (v: unknown): string[] => arr(v).filter((x): x is string => typeof x === 'string');

/** Floppy stores user status as an int; these are the labels the list endpoint
 *  also accepts as query values. Mirrors src/lib/types.ts `Status`. */
const STATUS_LABEL: Record<number, string> = {
	0: 'planning',
	1: 'in_progress',
	2: 'paused',
	3: 'completed',
	4: 'dropped'
};

type MediaKind = 'tv' | 'movie' | 'anime';

/** One library row, flattened to just what recommendation reasoning needs. */
type Title = {
	title: string;
	year: number | null;
	mediaType: MediaKind;
	source: string;
	mediaId: string;
	status: string | null;
	/** Your rating on Floppy's scale (typically 0–10); null if unrated. */
	score: number | null;
	/** Episodes watched (tv) or plays (movie). */
	progress: number;
	/** Total episodes, when Floppy reports one. */
	maxProgress: number | null;
	/** Present only when the list row carries genres; otherwise use get_title_details. */
	genres?: string[];
};

type ListResponse = {
	pagination?: { total?: number; limit?: number; offset?: number; next?: string | null };
	results?: Rec[];
};

function mapTitle(row: Rec, mediaType: MediaKind): Title | null {
	const item = rec(row.item);
	const mediaId = str(item.media_id);
	if (!mediaId) return null;
	const statusInt = num(row.status);
	const genres = strings(item.genres);
	return {
		title: str(item.title) ?? 'Untitled',
		year: num(item.year),
		mediaType,
		source: str(item.source) ?? 'tmdb',
		mediaId,
		status: statusInt !== null ? (STATUS_LABEL[statusInt] ?? null) : null,
		score: num(row.score),
		progress: num(row.progress) ?? 0,
		maxProgress: num(item.number_of_pages),
		...(genres.length ? { genres } : {})
	};
}

/**
 * Page a whole media list. Floppy caps `limit` at 200, so a larger library needs
 * paging; `hardCap` stops an enormous library from flooding the model's context.
 */
async function fetchList(
	mediaType: MediaKind,
	status: string,
	hardCap: number
): Promise<Title[]> {
	const PAGE = 200;
	const out: Title[] = [];
	let offset = 0;
	// `updated` desc = most recently touched first, so a truncated pull keeps the
	// titles most representative of current taste.
	for (;;) {
		const res = await floppy<ListResponse>(`/api/v1/media/${mediaType}/`, {
			query: {
				status: status === 'all' ? undefined : [status],
				sort: 'updated',
				direction: 'desc',
				limit: PAGE,
				offset
			},
			timeoutMs: 60_000
		});
		const rows = res.results ?? [];
		for (const r of rows) {
			const t = mapTitle(rec(r), mediaType);
			if (t) out.push(t);
			if (out.length >= hardCap) return out;
		}
		const total = res.pagination?.total ?? out.length;
		offset += PAGE;
		if (!rows.length || offset >= total) break;
	}
	return out;
}

/** Named range → the explicit dates the overview endpoint honours. Mirrors the
 *  logic in src/lib/server/stats.ts (`range=`/`period=` are silently ignored). */
function rangeDates(key: string): { start?: string; end?: string } {
	const now = new Date();
	const y = now.getFullYear();
	const iso = (d: Date) => d.toISOString().slice(0, 10);
	switch (key) {
		case 'this_month':
			return { start: iso(new Date(y, now.getMonth(), 1)), end: iso(new Date(y, now.getMonth() + 1, 0)) };
		case 'this_year':
			return { start: `${y}-01-01`, end: `${y}-12-31` };
		case 'last_year':
			return { start: `${y - 1}-01-01`, end: `${y - 1}-12-31` };
		default:
			return {};
	}
}

/** Wrap a tool body so any thrown error becomes a clean, visible tool error
 *  rather than crashing the transport. */
type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };
async function guard(run: () => Promise<unknown>): Promise<ToolResult> {
	try {
		const value = await run();
		const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
		return { content: [{ type: 'text', text }] };
	} catch (err) {
		return { content: [{ type: 'text', text: `Error: ${err instanceof Error ? err.message : String(err)}` }], isError: true };
	}
}

/* ── server ──────────────────────────────────────────────────────────────── */

const server = new McpServer({ name: 'seek-floppy', version: '0.1.0' });

server.tool(
	'check_connection',
	'Verify the server can reach Floppy and that the API token is accepted. Call ' +
		'this first if anything else fails. Returns Floppy version and token status.',
	{},
	async () =>
		guard(async () => {
			const info = rec(await floppy('/api/v1/info/', { anonymous: true }));
			let tokenOk = true;
			let tokenError: string | null = null;
			try {
				// Authenticated probe — confirms the token, not just that Floppy is up.
				await floppy('/api/v1/user/preferences/');
			} catch (err) {
				tokenOk = false;
				tokenError = err instanceof Error ? err.message : String(err);
			}
			return {
				reachable: true,
				version: str(info.version),
				timezone: str(info.timezone),
				token: tokenOk ? 'accepted' : 'rejected',
				...(tokenError ? { tokenError } : {})
			};
		})
);

server.tool(
	'list_titles',
	'List titles from your Floppy library with your rating and status — the raw ' +
		'material for recommendations. Filter by media type and status, or set ' +
		'ratedOnly/minScore to see only what you have scored. Each row includes ' +
		'source and mediaId, which get_title_details takes. NOTE: many Floppy ' +
		'instances file anime inside the regular TV library rather than a separate ' +
		'anime bucket; if the anime list comes back empty, pull mediaType "tv" and ' +
		'identify anime yourself from titles and genres.',
	{
		mediaType: z
			.enum(['all', 'tv', 'movie', 'anime'])
			.default('all')
			.describe('Which library to read. "all" merges tv, movie and anime.'),
		status: z
			.enum(['all', 'planning', 'in_progress', 'paused', 'completed', 'dropped'])
			.default('all')
			.describe('Filter by your tracking status.'),
		ratedOnly: z.boolean().default(false).describe('Return only titles you have given a score.'),
		minScore: z.number().min(0).max(10).optional().describe('Return only titles scored at or above this.'),
		limit: z
			.number()
			.int()
			.min(1)
			.max(2000)
			.default(500)
			.describe('Maximum rows to return, after filtering. Sorted by your score, highest first.')
	},
	async ({ mediaType, status, ratedOnly, minScore, limit }) =>
		guard(async () => {
			const kinds: MediaKind[] = mediaType === 'all' ? ['tv', 'movie', 'anime'] : [mediaType];
			// A generous per-list cap before filtering; the final `limit` trims the merged result.
			const perList = Math.max(limit, 500);
			const lists = await Promise.all(kinds.map((k) => fetchList(k, status, perList)));

			let rows = lists.flat();
			if (ratedOnly || typeof minScore === 'number') {
				const floor = typeof minScore === 'number' ? minScore : 0;
				rows = rows.filter((r) => typeof r.score === 'number' && r.score >= floor);
			}
			// Highest-rated first (unrated last), then alphabetical.
			rows.sort((a, b) => (b.score ?? -1) - (a.score ?? -1) || a.title.localeCompare(b.title));

			const total = rows.length;
			const returned = rows.slice(0, limit);

			// Surface the anime-bucket caveat when it actually applies to this instance.
			const animeRequested = mediaType === 'all' || mediaType === 'anime';
			const animeEmpty = (lists[kinds.indexOf('anime')] ?? []).length === 0;
			const note =
				animeRequested && animeEmpty && kinds.includes('anime')
					? 'The anime list is empty, which usually means this Floppy instance files anime inside the TV library (anime_library_mode "tv"). Anime titles are present under mediaType "tv" — identify them from their titles and genres.'
					: undefined;

			return { total, returned: returned.length, rows: returned, ...(note ? { note } : {}) };
		})
);

server.tool(
	'get_title_details',
	'Full detail for one title: genres, studios, synopsis, cast, community score, ' +
		'and your own rating/progress. Use it to reason about WHY you liked ' +
		'something. Pass source and mediaId from a list_titles row.',
	{
		mediaType: z.enum(['tv', 'movie', 'anime']).describe('The title\'s media type.'),
		source: z.string().describe('The source from the list row, e.g. "tmdb".'),
		mediaId: z.string().describe('The mediaId from the list row.')
	},
	async ({ mediaType, source, mediaId }) =>
		guard(async () => {
			// Grouped anime is media_type=tv under the hood (source tmdb): the
			// /api/v1/media/anime/{source}/... path 400s for tmdb sources. See
			// docs/floppy-api-notes.md "Anime: how it actually works".
			const pathType = mediaType === 'anime' ? 'tv' : mediaType;
			const d = rec(
				await floppy(`/api/v1/media/${pathType}/${source}/${encodeURIComponent(mediaId)}/`)
			);
			const details = rec(d.details);
			const consumption = rec(arr(d.consumptions)[0]);
			return {
				title: str(d.title) ?? 'Untitled',
				mediaType,
				source: str(d.source) ?? source,
				mediaId: str(d.media_id) ?? mediaId,
				synopsis: str(d.synopsis),
				genres: strings(d.genres),
				studios: strings(details.studios),
				communityScore: num(d.score),
				communityScoreCount: num(d.score_count),
				firstAirDate: str(details.first_air_date) ?? str(details.release_date),
				lastAirDate: str(details.last_air_date),
				runtime: num(details.runtime),
				status: str(details.status),
				cast: arr(d.cast)
					.slice(0, 20)
					.map((c) => {
						const p = rec(c);
						return { name: str(p.name), role: str(p.role) };
					})
					.filter((c) => c.name),
				you: {
					score: num(consumption.score),
					progress: num(consumption.progress) ?? 0,
					status: (() => {
						const s = num(consumption.status);
						return s !== null ? (STATUS_LABEL[s] ?? null) : null;
					})(),
					startDate: str(consumption.start_date),
					endDate: str(consumption.end_date)
				}
			};
		})
);

server.tool(
	'get_stats',
	'Aggregate taste profile from Floppy\'s statistics overview: media counts, your ' +
		'top genres, top studios, and highest-rated titles. A cheap one-call summary ' +
		'to anchor recommendations before drilling into specific titles.',
	{
		range: z
			.enum(['this_month', 'this_year', 'last_year', 'all_time'])
			.default('all_time')
			.describe('Time window for the stats.')
	},
	async ({ range }) =>
		guard(async () => {
			const { start, end } = rangeDates(range);
			const res = rec(
				await floppy('/api/v1/statistics/overview/', {
					query: { start_date: start, end_date: end },
					// The all-time overview genuinely takes ~9s and returns ~500KB.
					timeoutMs: 90_000
				})
			);
			const st = rec(res.statistics);
			const counts = rec(st.media_count);
			const tv = rec(st.tv_consumption);
			return {
				range,
				counts: {
					tv: num(counts.tv) ?? 0,
					movie: num(counts.movie) ?? 0,
					anime: num(counts.anime) ?? 0,
					total: num(counts.total) ?? 0
				},
				topGenres: arr(tv.top_genres)
					.slice(0, 10)
					.map((g) => str(rec(g).name))
					.filter((n): n is string => Boolean(n)),
				topStudios: arr(rec(st.top_talent).top_studios)
					.slice(0, 10)
					.map((s) => str(rec(s).name))
					.filter((n): n is string => Boolean(n)),
				topRated: arr(st.top_rated)
					.slice(0, 20)
					.map((raw) => {
						const r = rec(raw);
						const item = rec(r.item);
						// Floppy sends score as a string here ("9.0"), unlike the list endpoint.
						const score = Number(r.score);
						return {
							title: str(item.title) ?? 'Untitled',
							mediaType: str(item.media_type) ?? null,
							source: str(item.source) ?? 'tmdb',
							mediaId: str(item.media_id),
							score: Number.isFinite(score) ? score : null
						};
					})
					.filter((t) => t.mediaId)
			};
		})
);

server.prompt(
	'recommend_anime',
	'Recommend anime grounded in your Floppy watch history and ratings.',
	{ count: z.string().optional().describe('How many recommendations to make (default 5).') },
	({ count }) => {
		const n = count && /^\d+$/.test(count) ? count : '5';
		return {
			messages: [
				{
					role: 'user' as const,
					content: {
						type: 'text' as const,
						text:
							`Recommend ${n} anime for me, grounded in my Floppy library.\n\n` +
							'Steps:\n' +
							'1. Call get_stats to see my top genres, studios and highest-rated titles.\n' +
							'2. Call list_titles with ratedOnly=true to see everything I have scored, and note what I rated highly vs. dropped.\n' +
							'3. If the anime list is empty, anime is filed in my TV library — identify anime among my tv titles yourself.\n' +
							'4. Recommend anime I have NOT already tracked. For each, give one or two sentences tying it to specific things I rated highly, and note where it streams if you know.\n' +
							'5. Prefer variety over near-duplicates of a single show, and call out anything you are unsure I have not already seen.'
					}
				}
			]
		};
	}
);

const transport = new StdioServerTransport();
await server.connect(transport);
console.error('[seek-floppy-mcp] ready on stdio');
