import { json } from '@sveltejs/kit';
import { getInfo, whoami } from '$lib/server/api';
import type { RequestHandler } from './$types';

/** Step 1 health check: is Floppy up, and is our token actually accepted? */
export const GET: RequestHandler = async () => {
	const out: Record<string, unknown> = { ok: false };

	try {
		const info = await getInfo();
		out.floppy = { reachable: true, version: info.version, timezone: info.timezone };
	} catch (err) {
		out.floppy = { reachable: false, error: String(err) };
		return json(out, { status: 503 });
	}

	try {
		await whoami();
		out.token = 'accepted';
		out.ok = true;
	} catch (err) {
		out.token = 'rejected';
		out.error = String(err);
		return json(out, { status: 503 });
	}

	return json(out);
};
