import { json } from '@sveltejs/kit';
import { listLibraries, bookorbitLinked } from '$lib/server/books/bookorbit';
import type { RequestHandler } from './$types';

/** The BookOrbit libraries the signed-in person can see (Settings' library picker). */
export const GET: RequestHandler = async () => {
	if (!bookorbitLinked()) return json({ libraries: [] });
	try {
		return json({ libraries: await listLibraries() });
	} catch (err) {
		return json({ libraries: [], error: err instanceof Error ? err.message : String(err) }, { status: 502 });
	}
};
