import { json, error } from '@sveltejs/kit';
import {
	AccountError,
	createInvite,
	createResetToken,
	getUser,
	householdName,
	listMembers,
	listPendingInvites,
	removeMember,
	revokeInvite
} from '$lib/server/users';
import { forgetPrefs } from '$lib/server/prefs';
import { inviteMail, mailConfigured, sendMail } from '$lib/server/mail';
import type { RequestHandler } from './$types';

/** The household: who's in it, invites, and the owner's member management. */

const fail = (message: string, status = 400) => json({ error: message }, { status });

export const GET: RequestHandler = async ({ locals }) => {
	const me = locals.user;
	if (!me) error(401);
	return json({
		name: householdName(me.householdId),
		members: listMembers(me.householdId),
		invites: me.role === 'owner' ? listPendingInvites(me.householdId) : [],
		mail: mailConfigured()
	});
};

export const POST: RequestHandler = async ({ request, locals, url }) => {
	const me = locals.user;
	if (!me) error(401);
	const body = await request.json().catch(() => ({}));

	try {
		switch (body.action) {
			case 'invite': {
				const { token, email } = createInvite(me, String(body.email ?? ''));
				const link = `${url.origin}/invite/${token}`;
				let emailed = false;
				let mailError: string | null = null;
				if (mailConfigured()) {
					try {
						await sendMail(inviteMail(email, link, me.name, householdName(me.householdId)));
						emailed = true;
					} catch (err) {
						mailError = err instanceof Error ? err.message : String(err);
					}
				}
				// The link is always returned: shared by hand when email is off or failed.
				return json({ email, link, emailed, mailError });
			}
			case 'revokeInvite':
				revokeInvite(me, String(body.email ?? ''));
				return json({ ok: true });
			case 'remove': {
				const id = Number(body.userId);
				removeMember(me, id);
				forgetPrefs(id);
				return json({ ok: true });
			}
			case 'resetLink': {
				// The owner's fallback for "I forgot my password" when email is off.
				if (me.role !== 'owner') return fail('Only the household owner can do that.', 403);
				const target = getUser(Number(body.userId));
				if (!target || target.householdId !== me.householdId) return fail('No such member.');
				return json({ link: `${url.origin}/reset/${createResetToken(target.id)}`, email: target.email });
			}
			default:
				return fail('Unknown action.');
		}
	} catch (err) {
		if (err instanceof AccountError) return fail(err.message);
		throw err;
	}
};
