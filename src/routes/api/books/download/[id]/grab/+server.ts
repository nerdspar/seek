import { json, error } from '@sveltejs/kit';
import { grabRelease, searchReleases } from '$lib/server/books/bookorbit';
import { wantIfNew } from '$lib/server/books/shelf';
import type { BookRequest } from '$lib/books';
import { relayRefusal } from '$lib/server/books/http';
import { emptySearchReason, pickBestRelease } from '$lib/books';
import type { RequestHandler } from './$types';

/**
 * Send a release to the download client: the one you picked
 * (`{indexerId, guid}`), or — `{auto: true}` — the best-ranked one that fits
 * your release profile. When Automatic finds nothing to grab it says why, in
 * words ("No releases found (searched 2 sources)…").
 */
export const POST: RequestHandler = async ({ params, request }) => {
	const id = Number(params.id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Bad request id.');
	const body = await request.json().catch(() => ({}));

	if (body.auto === true) {
		const search = await searchReleases(id).catch(relayRefusal);
		const best = pickBestRelease(search.releases);
		if (!best) return json({ grabbed: false, reason: emptySearchReason(search), search });
		const req = await grabRelease(id, best).catch(relayRefusal);
		await onYourList(req);
		return json({ grabbed: true, release: best, request: req });
	}

	const indexerId = Number(body.indexerId);
	const guid = typeof body.guid === 'string' ? body.guid : '';
	if (!Number.isInteger(indexerId) || indexerId <= 0 || !guid) error(400, 'Pick a release.');
	const req = await grabRelease(id, { indexerId, guid }).catch(relayRefusal);
	onYourList(req);
	return json({ grabbed: true, request: req });
};

/** A download is under way: the book goes on your want-to-read list (unless
 *  you already track it). Only now — opening the sheet and walking away doesn't. */
async function onYourList(req: BookRequest) {
	// A shelf hiccup never fails the download.
	if (req.hardcoverId) await wantIfNew(req.hardcoverId).catch(() => {});
}
