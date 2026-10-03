import { json, error } from '@sveltejs/kit';
import { setSettings, settingsForDisplay } from '$lib/server/services';
import { checkGroup } from '$lib/server/serviceChecks';
import { invalidateEveryone } from '$lib/server/memo';
import { forgetBookOrbitSessions } from '$lib/server/books/bookorbit';
import { SERVICE_GROUPS, type ServiceKey } from '$lib/serviceFields';
import type { RequestHandler } from './$types';

/** The household's service settings (Settings → Services). Owner only: these
 *  are the keys to every backend the household uses. */

export const GET: RequestHandler = async ({ locals }) => {
	if (locals.user?.role !== 'owner') error(403, 'Only the household owner manages services.');
	return json({ services: settingsForDisplay() });
};

/** Save one group's fields, then check they work. A secret is only sent when
 *  it's being replaced; an empty string turns a setting off. */
export const PUT: RequestHandler = async ({ locals, request }) => {
	if (locals.user?.role !== 'owner') error(403, 'Only the household owner manages services.');
	const { group, values } = readGroup(await request.json().catch(() => ({})));
	setSettings(values);
	// Everything cached was fetched with the old addresses and keys.
	invalidateEveryone('');
	if (group.id === 'books') forgetBookOrbitSessions();
	return json({ services: settingsForDisplay(), check: await checkGroup(group.id, { saved: true }) });
};

/** Test one group's values as typed, without saving them. Email's test sends a
 *  test message to you. */
export const POST: RequestHandler = async ({ locals, request }) => {
	if (locals.user?.role !== 'owner') error(403, 'Only the household owner manages services.');
	const { group, values } = readGroup(await request.json().catch(() => ({})));
	return json({ check: await checkGroup(group.id, { values, sendTo: locals.user.email }) });
};

/** The group named in the body, and just that group's fields from it. */
function readGroup(body: { group?: unknown; values?: Record<string, unknown> }) {
	const group = SERVICE_GROUPS.find((g) => g.id === body.group);
	if (!group) error(400, 'Unknown service.');
	const values: Partial<Record<ServiceKey, string>> = {};
	for (const f of group.fields) {
		const v = body.values?.[f.key];
		if (typeof v === 'string') values[f.key] = v;
	}
	return { group, values };
}
