import { json, error } from '@sveltejs/kit';
import {
	getCredentials,
	linkedStatus,
	setBookOrbit,
	setBookOrbitLibrary,
	setCalendarToken,
	setFloppyToken,
	setHardcoverToken
} from '$lib/server/users';
import { checkHardcoverToken } from '$lib/server/books/hardcover';
import {
	checkBookOrbitLogin,
	checkCalendarToken,
	checkFloppyToken,
	forgetCurrentUserData,
	normalizeCalendarToken
} from '$lib/server/connections';
import { bookorbitConfigured } from '$lib/server/books/bookorbit';
import { warmInBackground } from '$lib/server/warmup';
import type { RequestHandler } from './$types';

/**
 * Your own linked accounts — the credentials Seek uses on your behalf. Every
 * link is checked against the real service first, and stored encrypted.
 */

const fail = (message: string, status = 400) => json({ error: message }, { status });

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401);
	return json({
		linked: linkedStatus(locals.user.id),
		bookorbit: bookorbitConfigured()
	});
};

export const PUT: RequestHandler = async ({ request, locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const body = await request.json().catch(() => ({}));

	switch (body.service) {
		case 'floppy': {
			// One token does everything: Floppy's account token opens the API and
			// the calendar feed. People paste the calendar link; take the token from it.
			const token = normalizeCalendarToken(String(body.token ?? ''));
			const check = await checkFloppyToken(token);
			if (!check.ok) return fail(check.error);
			const calendar = await checkCalendarToken(token);
			if (!calendar.ok) {
				return fail('That token works for Floppy but not its calendar. Paste the link from Floppy → Calendar instead — it does both.');
			}
			setFloppyToken(me.id, token);
			setCalendarToken(me.id, null);
			forgetCurrentUserData();
			warmInBackground(me);
			return json({ linked: linkedStatus(me.id) });
		}
		case 'bookorbit': {
			const username = String(body.username ?? '');
			const password = String(body.password ?? '');
			const check = await checkBookOrbitLogin(username, password);
			if (!check.ok) return fail(check.error);
			const requested = Number(body.libraryId);
			const libraryId = check.libraries.some((l) => l.id === requested)
				? requested
				: (check.libraries[0]?.id ?? null);
			setBookOrbit(me.id, { username, password, libraryId });
			forgetCurrentUserData();
			return json({ linked: linkedStatus(me.id), libraries: check.libraries });
		}
		case 'hardcover': {
			const token = String(body.token ?? '');
			const check = await checkHardcoverToken(token);
			if (!check.ok) return fail(check.error);
			setHardcoverToken(me.id, token);
			forgetCurrentUserData();
			return json({ linked: linkedStatus(me.id), username: check.username });
		}
		default:
			return fail('Unknown service.');
	}
};

/** Test a saved link against the real service, without changing anything. */
export const POST: RequestHandler = async ({ request, locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const { service } = await request.json().catch(() => ({}));
	const creds = getCredentials(me.id);
	switch (service) {
		case 'floppy': {
			if (!creds.floppyToken) return json({ ok: false, error: 'Not linked.' });
			const api = await checkFloppyToken(creds.floppyToken);
			if (!api.ok) return json(api);
			return json(await checkCalendarToken(creds.calendarToken ?? creds.floppyToken));
		}
		case 'bookorbit': {
			if (!creds.bookorbit) return json({ ok: false, error: 'Not linked.' });
			const check = await checkBookOrbitLogin(creds.bookorbit.username, creds.bookorbit.password);
			return json(check.ok ? { ok: true } : check);
		}
		case 'hardcover':
			if (!creds.hardcoverToken) return json({ ok: false, error: 'Not linked.' });
			return json(await checkHardcoverToken(creds.hardcoverToken));
		default:
			return fail('Unknown service.');
	}
};

/** Change just which BookOrbit library new books land in. */
export const PATCH: RequestHandler = async ({ request, locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const body = await request.json().catch(() => ({}));
	if (body.service !== 'bookorbit') return fail('Unknown service.');
	const id = body.libraryId === null ? null : Number(body.libraryId);
	if (id !== null && !Number.isInteger(id)) return fail('Pick a library.');
	setBookOrbitLibrary(me.id, id);
	return json({ linked: linkedStatus(me.id) });
};

export const DELETE: RequestHandler = async ({ request, locals }) => {
	const me = locals.user;
	if (!me) error(401);
	const body = await request.json().catch(() => ({}));
	switch (body.service) {
		case 'floppy':
			setFloppyToken(me.id, null);
			setCalendarToken(me.id, null);
			break;
		case 'bookorbit':
			setBookOrbit(me.id, null);
			break;
		case 'hardcover':
			setHardcoverToken(me.id, null);
			break;
		default:
			return fail('Unknown service.');
	}
	forgetCurrentUserData();
	return json({ linked: linkedStatus(me.id) });
};
