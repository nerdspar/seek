/**
 * Transactional email (household phase B) — invites, password resets, address
 * verification — through Resend's HTTP API. No SDK: one POST.
 *
 * Optional. Without RESEND_API_KEY + MAIL_FROM, nothing is emailed and the
 * account flows fall back to links the owner hands over directly (Settings →
 * Household shows them), so the household works before email is set up.
 */
import { env } from '$env/dynamic/private';

export const mailConfigured = () => Boolean(env.RESEND_API_KEY && env.MAIL_FROM);

export class MailError extends Error {
	constructor(readonly status: number, body: string) {
		super(`Email failed (HTTP ${status}): ${body.slice(0, 300)}`);
		this.name = 'MailError';
	}
}

export type Mail = { to: string; subject: string; text: string; html: string };

export async function sendMail(mail: Mail): Promise<void> {
	if (!mailConfigured()) throw new Error('Email is not configured (RESEND_API_KEY / MAIL_FROM).');
	const res = await fetch('https://api.resend.com/emails', {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${env.RESEND_API_KEY}`,
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({
			from: env.MAIL_FROM,
			to: [mail.to],
			subject: mail.subject,
			text: mail.text,
			html: mail.html
		}),
		signal: AbortSignal.timeout(15_000)
	});
	if (!res.ok) throw new MailError(res.status, await res.text().catch(() => ''));
}

const escape = (s: string) =>
	s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** One plain layout for every message: a line of text and a single button. */
function layout(intro: string, action: string, link: string, outro: string): { text: string; html: string } {
	return {
		text: `${intro}\n\n${action}: ${link}\n\n${outro}\n`,
		html: `<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f8;font-family:-apple-system,system-ui,sans-serif;color:#1c1c22">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:28px">
<p style="margin:0 0 18px;font-size:22px;font-weight:700;color:#5b6cff">Seek</p>
<p style="margin:0 0 22px;font-size:15px;line-height:1.5">${escape(intro)}</p>
<a href="${escape(link)}" style="display:inline-block;padding:12px 20px;border-radius:10px;background:#5b6cff;color:#fff;font-weight:600;text-decoration:none">${escape(action)}</a>
<p style="margin:22px 0 0;font-size:12.5px;line-height:1.5;color:#6b6b78">${escape(outro)}</p>
</div></body></html>`
	};
}

export function inviteMail(to: string, link: string, inviter: string, household: string): Mail {
	return {
		to,
		subject: `${inviter} invited you to Seek`,
		...layout(
			`${inviter} invited you to join the ${household} household on Seek — your watchlist, shows and books in one place.`,
			'Accept the invite',
			link,
			'The link works once and expires in 7 days. If you weren’t expecting this, ignore it.'
		)
	};
}

export function resetMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Reset your Seek password',
		...layout(
			'Someone asked to reset the password for your Seek account.',
			'Choose a new password',
			link,
			'The link works once and expires in an hour. If it wasn’t you, ignore this — your password is unchanged.'
		)
	};
}

export function verifyMail(to: string, link: string): Mail {
	return {
		to,
		subject: 'Confirm your email for Seek',
		...layout(
			'Confirm this is your email address, so Seek can send you a reset link if you ever need one.',
			'Confirm email',
			link,
			'The link expires in 3 days.'
		)
	};
}
