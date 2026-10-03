import { json, error } from '@sveltejs/kit';
import {
	AccountError,
	changePassword,
	createVerifyToken,
	renameUser,
	linkedStatus
} from '$lib/server/users';
import { setSession } from '$lib/server/auth';
import { mailConfigured, sendMail, verifyMail } from '$lib/server/mail';
import type { RequestHandler } from './$types';

/** Your own account: name, password, email confirmation. */

const fail = (message: string, status = 400) => json({ error: message }, { status });

export const GET: RequestHandler = async ({ locals }) => {
	if (!locals.user) error(401);
	return json({ user: locals.user, linked: linkedStatus(locals.user.id), mail: mailConfigured() });
};

export const PATCH: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) error(401);
	const body = await request.json().catch(() => ({}));
	try {
		return json({ user: renameUser(locals.user.id, String(body.name ?? '')) });
	} catch (err) {
		if (err instanceof AccountError) return fail(err.message);
		throw err;
	}
};

export const POST: RequestHandler = async ({ request, locals, cookies, url }) => {
	if (!locals.user) error(401);
	const body = await request.json().catch(() => ({}));

	if (body.action === 'password') {
		try {
			const user = await changePassword(locals.user.id, String(body.current ?? ''), String(body.next ?? ''));
			/* The change bumped the session version, signing out every device —
			   re-issue this one's cookie so the person who changed it stays in. */
			setSession(cookies, url, user);
			return json({ ok: true });
		} catch (err) {
			if (err instanceof AccountError) return fail(err.message);
			throw err;
		}
	}

	if (body.action === 'verify') {
		if (!mailConfigured()) return fail('Email isn’t set up on this Seek.');
		const token = createVerifyToken(locals.user.id);
		try {
			await sendMail(verifyMail(locals.user.email, `${url.origin}/verify/${token}`));
		} catch (err) {
			return fail(`Couldn't send the email — ${err instanceof Error ? err.message : err}`, 502);
		}
		return json({ ok: true });
	}

	return fail('Unknown action.');
};
