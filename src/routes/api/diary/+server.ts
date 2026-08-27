import { json, error } from '@sveltejs/kit';
import { floppy, FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import { memo } from '$lib/server/memo';
import type { RequestHandler } from './$types';

type HistoryPage = { results?: { date?: string }[]; pagination?: { total?: number } };

const page = (offset: number) =>
	floppy<HistoryPage>('/api/v1/history/', { query: { limit: 1, offset }, timeoutMs: 30_000 });

const dateAt = async (offset: number): Promise<string | null> =>
	(await page(offset)).results?.[0]?.date ?? null;

/**
 * The diary offset whose page holds a given date.
 *
 * Floppy pages history by *days with activity*, not calendar days, so the
 * distance in calendar days is not the offset. The page used to estimate it
 * that way and the error compounds with every quiet day: asking for 2025-01-01
 * landed on 2023-09-28, over a year adrift.
 *
 * A binary search costs about ten one-row probes — roughly 1.5s — and is exact.
 * That is a fair price for something the user asks for deliberately, and it is
 * cached, so going back to the same month is instant.
 */
export const GET: RequestHandler = async ({ url }) => {
	const date = (url.searchParams.get('date') ?? '').trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) error(400, 'date must be YYYY-MM-DD');

	try {
		const offset = await memo(`diary:offset:${date}`, 30 * 60 * 1000, async () => {
			const first = await page(0);
			const total = first.pagination?.total ?? 0;
			if (!total) return 0;

			const newest = first.results?.[0]?.date ?? null;
			// Asking for anything at or after the newest entry means the top.
			if (!newest || date >= newest) return 0;

			/* Dates descend with offset, so this finds the first page at or before
			   the target — the day you asked for if it has activity, otherwise the
			   most recent one before it, which is where you would want to land. */
			let lo = 0;
			let hi = total - 1;
			while (lo < hi) {
				const mid = Math.floor((lo + hi) / 2);
				const at = await dateAt(mid);
				if (at && at > date) lo = mid + 1;
				else hi = mid;
			}
			return lo;
		});

		return json({ offset });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
