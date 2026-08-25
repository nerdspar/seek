import { json, error } from '@sveltejs/kit';
import { getPrefs, setPrefs, type Prefs } from '$lib/server/prefs';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(await getPrefs());

export const PATCH: RequestHandler = async ({ request }) => {
	let patch: Partial<Prefs>;
	try {
		patch = await request.json();
	} catch {
		error(400, 'Body must be JSON.');
	}
	return json(await setPrefs(patch));
};
