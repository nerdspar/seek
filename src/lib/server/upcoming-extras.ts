/**
 * Upcoming beyond the episode calendar (which also carries tracked films'
 * release dates): when the films you're waiting on reach theaters and digital, and
 * when books you want — or new ones by authors you read — come out.
 *
 * Its own stream, separate from the calendar, so episodes never wait on it.
 */
import { db } from './db';
import { currentUser } from './userctx';
import { TMDB_API_KEY } from './env';
import { TTLCache } from './cache';
import { memo } from './memo';
import { myBookList } from './books/discovery';
import { hardcoverConfigured, upcomingBooks } from './books/hardcover';
import { recommendationSeeds, type MyBook } from '$lib/books';
import type { UpcomingItem } from '$lib/types';

const DAY = 24 * 60 * 60 * 1000;
/** The same window as the calendar: 30 days back, a year ahead. */
export const windowAround = (now: number) => ({ from: now - 30 * DAY, to: now + 365 * DAY });

/* ── Films ──────────────────────────────────────────────────────────────────── */

type ReleaseDate = { type: number; release_date: string };

/**
 * When a film can be seen, from TMDB's US release dates: in theaters (type 3,
 * or a limited 2 when there's no wide one) and at home (digital, type 4).
 * Premieres (1) and disc (5) are left out — not when you'd watch it.
 */
export function filmReleases(dates: ReleaseDate[]): { what: 'In theaters' | 'On digital'; date: string }[] {
	const first = (types: number[]) =>
		dates
			.filter((d) => types.includes(d.type) && d.release_date)
			.map((d) => d.release_date)
			.sort()[0];
	const theaters = first([3]) ?? first([2]);
	const digital = first([4]);
	return [
		...(theaters ? [{ what: 'In theaters' as const, date: theaters }] : []),
		...(digital ? [{ what: 'On digital' as const, date: digital }] : [])
	];
}

const releaseCache = new TTLCache<ReleaseDate[]>(24 * 60 * 60 * 1000, 500);

async function usReleaseDates(tmdbId: string): Promise<ReleaseDate[]> {
	const hit = releaseCache.get(tmdbId);
	if (hit) return hit;
	const res = await fetch(
		`https://api.themoviedb.org/3/movie/${encodeURIComponent(tmdbId)}/release_dates?api_key=${encodeURIComponent(TMDB_API_KEY())}`,
		{ signal: AbortSignal.timeout(10_000) }
	);
	if (!res.ok) throw new Error(`TMDB release dates → ${res.status}`);
	const body = (await res.json()) as { results?: { iso_3166_1: string; release_dates: ReleaseDate[] }[] };
	const us = body.results?.find((r) => r.iso_3166_1 === 'US')?.release_dates ?? [];
	releaseCache.set(tmdbId, us);
	return us;
}

/** Theater and digital dates for the films in your library you haven't watched. */
async function filmItems(now: number): Promise<UpcomingItem[]> {
	const me = currentUser();
	if (!TMDB_API_KEY() || !me) return [];
	// Planning, Watching or Paused: not yet seen, still wanted.
	const films = (
		db()
			.prepare(
				`SELECT k.tmdb_id, t.title, t.poster FROM tracked k
				LEFT JOIN titles t ON t.media_type = 'movie' AND t.tmdb_id = k.tmdb_id
				WHERE k.user_id = ? AND k.media_type = 'movie' AND k.status IN (0, 1, 2)`
			)
			.all(me.id) as { tmdb_id: number; title: string | null; poster: string | null }[]
	).map((f) => ({ media_id: String(f.tmdb_id), title: f.title, image: f.poster }));
	const { from, to } = windowAround(now);
	const out: UpcomingItem[] = [];
	await Promise.all(
		films.map(async (f) => {
			const dates = await usReleaseDates(String(f.media_id)).catch(() => []);
			for (const r of filmReleases(dates)) {
				const t = Date.parse(r.date);
				if (t < from || t > to) continue;
				out.push({
					title: String(f.title ?? 'Untitled'),
					season: null,
					episode: null,
					// A release is a date, not a moment: midday UTC keeps it on the same
					// calendar day from Hawaii to Japan (midnight UTC is the evening before here).
					start: `${r.date.slice(0, 10)}T12:00:00.000Z`,
					hasTime: false,
					poster: typeof f.image === 'string' ? f.image : null,
					mediaId: String(f.media_id),
					source: 'tmdb',
					mediaType: 'movie',
					kind: 'movie',
					note: r.what
				});
			}
		})
	);
	return out;
}

/* ── Books ──────────────────────────────────────────────────────────────────── */

/** The authors you read most (from what you finished or loved), for "new from". */
export function authorsYouRead(books: MyBook[], max = 10): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const b of recommendationSeeds(books, 40)) {
		const a = b.authors[0];
		if (!a || seen.has(a.toLowerCase())) continue;
		seen.add(a.toLowerCase());
		out.push(a);
		if (out.length >= max) break;
	}
	return out;
}

async function bookItems(now: number): Promise<UpcomingItem[]> {
	if (!hardcoverConfigured()) return [];
	const books = await myBookList().catch(() => []);
	const wanted = books.filter((b) => b.status === 'want_to_read' && b.hardcoverId).map((b) => b.hardcoverId!);
	const authors = authorsYouRead(books);
	if (!wanted.length && !authors.length) return [];
	const { from, to } = windowAround(now);
	const found = await upcomingBooks(wanted, authors, new Date(from), new Date(to));
	const have = new Set(books.map((b) => b.hardcoverId).filter(Boolean));
	return found
		.filter((b) => wanted.includes(b.hardcoverId) || !have.has(b.hardcoverId))
		.map((b) => ({
			title: b.title,
			season: null,
			episode: null,
			start: new Date(`${b.releaseDate}T12:00:00Z`).toISOString(),
			hasTime: false,
			poster: b.coverUrl,
			mediaId: null,
			source: null,
			mediaType: 'tv' as const,
			kind: 'book' as const,
			note: wanted.includes(b.hardcoverId) ? 'On your list' : b.author ? `New from ${b.author}` : 'New book',
			hardcoverId: b.hardcoverId,
			author: b.author
		}));
}

/**
 * Films and books for Upcoming, for the current person. Each source stands
 * alone — one failing never blanks the other. Cached for a few hours: release
 * dates move slowly.
 */
export function getUpcomingExtras(opts: { books: boolean; films: boolean }): Promise<UpcomingItem[]> {
	return memo(`upcoming:extras:${opts.books ? 'b' : ''}${opts.films ? 'f' : ''}`, 3 * 60 * 60 * 1000, async () => {
		const now = Date.now();
		const [films, books] = await Promise.all([
			opts.films ? filmItems(now).catch(() => []) : Promise.resolve([]),
			opts.books ? bookItems(now).catch(() => []) : Promise.resolve([])
		]);
		return [...films, ...books].sort((a, b) => a.start.localeCompare(b.start));
	});
}
