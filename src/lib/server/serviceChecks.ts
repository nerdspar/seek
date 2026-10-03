/**
 * "Does this work?" for Settings → Services: one cheap request per service —
 * read-only, except email, whose test sends you a real test message (the only
 * way to know the From address's domain is verified, not just the key).
 *
 * Runs against the values being edited, so a Test before Save checks what you
 * typed; anything not being edited (a secret left as "set") uses the saved one.
 */
import { setting } from './services';
import type { ServiceKey } from '$lib/serviceFields';

export type ServiceCheck = { ok: boolean; message: string };

type Fetch = typeof fetch;

export type CheckOptions = {
	/** Values being edited; a key missing here falls back to the saved value. */
	values?: Partial<Record<ServiceKey, string>>;
	/** Just saved (wording: "Saved, but …") rather than a test. */
	saved?: boolean;
	/** Email test: where to send the test message. */
	sendTo?: string | null;
	fetch?: Fetch;
};

async function reach(
	f: Fetch,
	url: string,
	init: RequestInit = {},
	accept: (res: Response) => boolean | Promise<boolean> = (r) => r.ok
): Promise<Response | string> {
	try {
		const res = await f(url, { ...init, signal: AbortSignal.timeout(8000) });
		return (await accept(res)) ? res : await why(res);
	} catch (err) {
		return unreachable(err);
	}
}

/** Why a request never got an answer, in words: Node's fetch hides the real
 *  reason (refused, unknown host, bad certificate…) a level or two down. */
export function unreachable(err: unknown): string {
	const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string; errors?: { code?: string }[] } };
	if (e.name === 'TimeoutError' || e.name === 'AbortError') return 'no answer (timed out)';
	const code = e.cause?.code ?? e.cause?.errors?.find((x) => x.code)?.code;
	if (code) return `can't connect (${code})`;
	if (e.cause?.message) return `can't connect (${e.cause.message})`;
	return e.message ?? String(err);
}

/** The service's own explanation when it gives one, else the status. */
async function why(res: Response): Promise<string> {
	const body = (await res.clone().json().catch(() => null)) as { message?: unknown; error?: unknown } | null;
	const msg = typeof body?.message === 'string' ? body.message : typeof body?.error === 'string' ? body.error : '';
	return msg ? `${msg} (HTTP ${res.status})` : `HTTP ${res.status}`;
}

export async function checkGroup(group: string, opts: CheckOptions = {}): Promise<ServiceCheck | null> {
	const f = opts.fetch ?? fetch;
	const get = (key: ServiceKey) => {
		const v = opts.values?.[key];
		return (v !== undefined ? v.trim() : setting(key)).replace(/\/+$/, '');
	};
	const off = (what: string): ServiceCheck => ({ ok: true, message: `${what} is off.` });
	const failed = (what: string, reason: string): ServiceCheck => ({
		ok: false,
		message: `${opts.saved ? 'Saved, but ' : ''}${what}: ${reason}.`
	});
	const both = (name: string): ServiceCheck => ({ ok: false, message: `${name} needs both an address and an API key.` });

	switch (group) {
		case 'floppy': {
			const url = get('FLOPPY_URL');
			if (!url) return { ok: false, message: 'Seek needs Floppy’s address to do anything.' };
			const r = await reach(f, `${url}/api/v1/info/`);
			if (typeof r === 'string') return failed('Floppy didn’t answer', r);
			const info = (await r.json().catch(() => ({}))) as { version?: string };
			return { ok: true, message: `Connected to Floppy${info.version ? ` ${info.version}` : ''}.` };
		}
		case 'tmdb': {
			const key = get('TMDB_API_KEY');
			if (!key) return off('TMDB');
			const r = await reach(f, `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(key)}`);
			return typeof r === 'string' ? failed('TMDB refused the key', r) : { ok: true, message: 'TMDB key works.' };
		}
		case 'books': {
			const notes: string[] = [];
			let ok = true;
			const url = get('BOOKORBIT_URL');
			const token = get('HARDCOVER_TOKEN');
			if (url) {
				// Any answer from its API (a 401 without a login is fine) means it's there.
				const r = await reach(f, `${url}/api/v1/auth/me`, {}, (res) => res.status === 401 || res.ok);
				if (typeof r === 'string') {
					ok = false;
					notes.push(`BookOrbit didn’t answer: ${r}`);
				} else notes.push('BookOrbit is reachable');
			}
			if (token) {
				const r = await reach(
					f,
					'https://api.hardcover.app/v1/graphql',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token.replace(/^Bearer\s+/i, '')}` },
						body: JSON.stringify({ query: '{ me { id } }' })
					},
					async (res) => res.ok && !((await res.clone().json().catch(() => ({}))) as { errors?: unknown }).errors
				);
				if (typeof r === 'string') {
					ok = false;
					notes.push(`Hardcover refused the token: ${r}`);
				} else notes.push('Hardcover token works');
			}
			if (!notes.length) return off('Books');
			return { ok, message: `${ok || !opts.saved ? '' : 'Saved, but '}${notes.join('; ')}.` };
		}
		case 'sonarr':
		case 'radarr': {
			const name = group === 'sonarr' ? 'Sonarr' : 'Radarr';
			const url = get(group === 'sonarr' ? 'SONARR_URL' : 'RADARR_URL');
			const key = get(group === 'sonarr' ? 'SONARR_API_KEY' : 'RADARR_API_KEY');
			if (!url || !key) return url || key ? both(name) : off(name);
			const r = await reach(f, `${url}/api/v3/system/status`, { headers: { 'X-Api-Key': key } });
			if (typeof r === 'string') return failed(`${name} didn’t accept it`, r);
			const info = (await r.json().catch(() => ({}))) as { version?: string };
			return { ok: true, message: `Connected to ${name}${info.version ? ` ${info.version}` : ''}.` };
		}
		case 'jellyfin': {
			const url = get('JELLYFIN_URL');
			const key = get('JELLYFIN_API_KEY');
			if (!url || !key) return url || key ? both('Jellyfin') : off('Jellyfin');
			const r = await reach(f, `${url}/System/Info`, { headers: { Authorization: `MediaBrowser Token="${key}"` } });
			return typeof r === 'string' ? failed('Jellyfin didn’t accept it', r) : { ok: true, message: 'Connected to Jellyfin.' };
		}
		case 'email': {
			const key = get('RESEND_API_KEY');
			const from = opts.values?.MAIL_FROM !== undefined ? opts.values.MAIL_FROM.trim() : setting('MAIL_FROM');
			if (!key) return from ? { ok: false, message: 'Email needs a Resend API key too.' } : off('Email');
			if (!from) return { ok: false, message: 'Email needs a From address too.' };
			const auth = { Authorization: `Bearer ${key}` };

			// A real test message proves the key *and* that the From domain is verified.
			if (opts.sendTo) {
				const r = await reach(f, 'https://api.resend.com/emails', {
					method: 'POST',
					headers: { ...auth, 'Content-Type': 'application/json' },
					body: JSON.stringify({
						from,
						to: [opts.sendTo],
						subject: 'Seek test email',
						text: 'Seek can send email. Invites and password resets will arrive like this.'
					})
				});
				return typeof r === 'string'
					? failed('Resend didn’t send it', r)
					: { ok: true, message: `Sent a test email to ${opts.sendTo} — check your inbox.` };
			}

			/* Without sending: is the key real? A send-only key (Resend's
			   recommended "Sending access") isn't allowed to list domains and
			   answers 401 restricted_api_key — that's a working key. A wrong key
			   answers 400 "API key is invalid". */
			const r = await reach(f, 'https://api.resend.com/domains', { headers: auth }, async (res) => {
				if (res.ok) return true;
				const body = (await res.clone().json().catch(() => ({}))) as { name?: string };
				return res.status === 401 && body.name === 'restricted_api_key';
			});
			return typeof r === 'string' ? failed('Resend refused the key', r) : { ok: true, message: 'Resend key works.' };
		}
		default:
			return null;
	}
}
