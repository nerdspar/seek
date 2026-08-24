import { json, error } from '@sveltejs/kit';
import { search, type SearchScope } from '$lib/server/search';
import { FloppyError, FloppyUnreachable } from '$lib/server/floppy';
import type { RequestHandler } from './$types';

const SCOPES: SearchScope[] = ['best', 'tv', 'movie'];

export const GET: RequestHandler = async ({ url }) => {
	const q = url.searchParams.get('q') ?? '';
	const raw = url.searchParams.get('scope') ?? 'best';
	const scope = (SCOPES as string[]).includes(raw) ? (raw as SearchScope) : 'best';

	try {
		return json({ results: await search(scope, q) });
	} catch (err) {
		if (err instanceof FloppyUnreachable) error(503, 'Floppy unreachable.');
		if (err instanceof FloppyError) error(502, err.message);
		throw err;
	}
};
