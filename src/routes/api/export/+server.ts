import { error } from '@sveltejs/kit';
import { currentUser } from '$lib/server/userctx';
import { exportFor } from '$lib/server/exportData';
import type { RequestHandler } from './$types';

/** Download everything you have in Seek, for the native app's import. Open it
 *  in Safari while signed in; it saves as a file. */
export const GET: RequestHandler = async () => {
	const me = currentUser();
	if (!me) error(401);
	const body = JSON.stringify(exportFor(me));
	const day = new Date().toISOString().slice(0, 10);
	return new Response(body, {
		headers: {
			'content-type': 'application/json',
			'content-disposition': `attachment; filename="seek-export-${me.name.replace(/[^\w-]+/g, '-').toLowerCase()}-${day}.json"`,
			'cache-control': 'no-store'
		}
	});
};
