/**
 * "Did that work?" for Settings → Services: one cheap, read-only request per
 * service with the values just saved, so a typo'd address or key shows up
 * immediately instead of as a broken page later.
 */
import {
	BOOKORBIT_URL,
	FLOPPY_URL,
	HARDCOVER_TOKEN,
	JELLYFIN_API_KEY,
	JELLYFIN_URL,
	RADARR_API_KEY,
	RADARR_URL,
	RESEND_API_KEY,
	SONARR_API_KEY,
	SONARR_URL,
	TMDB_API_KEY,
	floppyConfigured
} from './env';

export type ServiceCheck = { ok: boolean; message: string };

type Fetch = typeof fetch;

async function reach(
	f: Fetch,
	url: string,
	init: RequestInit = {},
	accept: (res: Response) => boolean | Promise<boolean> = (r) => r.ok
): Promise<Response | string> {
	try {
		const res = await f(url, { ...init, signal: AbortSignal.timeout(8000) });
		return (await accept(res)) ? res : `HTTP ${res.status}`;
	} catch (err) {
		const cause = (err as { cause?: { code?: string } }).cause?.code;
		return cause ? `can't connect (${cause})` : (err as Error).message;
	}
}

const off = (what: string): ServiceCheck => ({ ok: true, message: `${what} is off.` });
const failed = (what: string, why: string): ServiceCheck => ({ ok: false, message: `Saved, but ${what}: ${why}.` });

export async function checkGroup(group: string, f: Fetch = fetch): Promise<ServiceCheck | null> {
	switch (group) {
		case 'floppy': {
			if (!floppyConfigured()) return { ok: false, message: 'Seek needs Floppy’s address to do anything.' };
			const r = await reach(f, `${FLOPPY_URL()}/api/v1/info/`);
			if (typeof r === 'string') return failed('Floppy didn’t answer', r);
			const info = (await r.json().catch(() => ({}))) as { version?: string };
			return { ok: true, message: `Connected to Floppy${info.version ? ` ${info.version}` : ''}.` };
		}
		case 'tmdb': {
			if (!TMDB_API_KEY()) return off('TMDB');
			const r = await reach(f, `https://api.themoviedb.org/3/configuration?api_key=${encodeURIComponent(TMDB_API_KEY())}`);
			return typeof r === 'string' ? failed('TMDB refused the key', r) : { ok: true, message: 'TMDB key works.' };
		}
		case 'books': {
			const notes: string[] = [];
			let ok = true;
			if (BOOKORBIT_URL()) {
				// Any answer from its API (a 401 without a login is fine) means it's there.
				const r = await reach(f, `${BOOKORBIT_URL()}/api/v1/auth/me`, {}, (res) => res.status === 401 || res.ok);
				if (typeof r === 'string') {
					ok = false;
					notes.push(`BookOrbit didn’t answer: ${r}`);
				} else notes.push('BookOrbit is reachable');
			}
			if (HARDCOVER_TOKEN()) {
				const r = await reach(
					f,
					'https://api.hardcover.app/v1/graphql',
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${HARDCOVER_TOKEN().replace(/^Bearer\s+/i, '')}` },
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
			return { ok, message: `${ok ? '' : 'Saved, but '}${notes.join('; ')}.` };
		}
		case 'sonarr':
		case 'radarr': {
			const [url, key] = group === 'sonarr' ? [SONARR_URL(), SONARR_API_KEY()] : [RADARR_URL(), RADARR_API_KEY()];
			const name = group === 'sonarr' ? 'Sonarr' : 'Radarr';
			if (!url || !key) return url || key ? { ok: false, message: `${name} needs both an address and an API key.` } : off(name);
			const r = await reach(f, `${url}/api/v3/system/status`, { headers: { 'X-Api-Key': key } });
			if (typeof r === 'string') return failed(`${name} didn’t accept it`, r);
			const info = (await r.json().catch(() => ({}))) as { version?: string };
			return { ok: true, message: `Connected to ${name}${info.version ? ` ${info.version}` : ''}.` };
		}
		case 'jellyfin': {
			if (!JELLYFIN_URL() || !JELLYFIN_API_KEY()) {
				return JELLYFIN_URL() || JELLYFIN_API_KEY()
					? { ok: false, message: 'Jellyfin needs both an address and an API key.' }
					: off('Jellyfin');
			}
			const r = await reach(f, `${JELLYFIN_URL()}/System/Info`, {
				headers: { Authorization: `MediaBrowser Token="${JELLYFIN_API_KEY()}"` }
			});
			return typeof r === 'string' ? failed('Jellyfin didn’t accept it', r) : { ok: true, message: 'Connected to Jellyfin.' };
		}
		case 'email': {
			if (!RESEND_API_KEY()) return off('Email');
			const r = await reach(f, 'https://api.resend.com/domains', {
				headers: { Authorization: `Bearer ${RESEND_API_KEY()}` }
			});
			return typeof r === 'string' ? failed('Resend refused the key', r) : { ok: true, message: 'Resend key works.' };
		}
		default:
			return null;
	}
}
