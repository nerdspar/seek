/**
 * Linking a person's own accounts (household phase C): Floppy, the Floppy
 * calendar feed, and BookOrbit. Every credential is tried against the real
 * service before it's saved, so a typo is caught at the form rather than
 * surfacing later as a broken tab.
 */
import { FLOPPY_URL, BOOKORBIT_URL } from './env';
import { invalidate } from './memo';
import { forgetUpcoming } from './upcoming';
import { refreshCredentials } from './userctx';
import { dropBooksCache } from './books/bookorbit';

export type Check = { ok: true } | { ok: false; error: string };

const unreachable = (service: string, err: unknown): { ok: false; error: string } => ({
	ok: false,
	error: `Couldn't reach ${service} to check that (${err instanceof Error ? err.message : err}).`
});

/** Does this Floppy integration token authenticate? */
export async function checkFloppyToken(token: string): Promise<Check> {
	if (!token.trim()) return { ok: false, error: 'Paste your Floppy token.' };
	try {
		const res = await fetch(`${FLOPPY_URL()}/api/v1/user/preferences/`, {
			headers: { Accept: 'application/json', 'X-API-Key': token.trim() },
			signal: AbortSignal.timeout(10_000)
		});
		if (res.status === 401 || res.status === 403) {
			return { ok: false, error: 'Floppy rejected that token — check it was copied in full and has the right scopes.' };
		}
		if (!res.ok) return { ok: false, error: `Floppy answered HTTP ${res.status}.` };
		return { ok: true };
	} catch (err) {
		return unreachable('Floppy', err);
	}
}

/** People copy the whole feed link out of Floppy rather than the bare token;
 *  accept either. `…/calendar/download/<token>?media_types=…` → `<token>`. */
export function normalizeCalendarToken(raw: string): string {
	const s = raw.trim();
	const m = s.match(/\/calendar\/download\/([^/?#\s]+)/);
	return m ? decodeURIComponent(m[1]) : s;
}

/** Does this calendar token serve a feed? */
export async function checkCalendarToken(token: string): Promise<Check> {
	if (!token.trim()) return { ok: false, error: 'Paste your calendar token.' };
	try {
		const res = await fetch(`${FLOPPY_URL()}/calendar/download/${encodeURIComponent(token.trim())}`, {
			signal: AbortSignal.timeout(15_000)
		});
		if (res.status === 404 || res.status === 401 || res.status === 403) {
			return { ok: false, error: 'Floppy has no calendar for that token.' };
		}
		if (!res.ok) return { ok: false, error: `Floppy answered HTTP ${res.status}.` };
		return { ok: true };
	} catch (err) {
		return unreachable('Floppy', err);
	}
}

export type BookOrbitLibrary = { id: number; name: string };
export type BookOrbitCheck = { ok: true; libraries: BookOrbitLibrary[] } | { ok: false; error: string };

/** Can this login sign in to BookOrbit? On success, the libraries it can see
 *  (for choosing where this person's uploads and downloads land). */
export async function checkBookOrbitLogin(username: string, password: string): Promise<BookOrbitCheck> {
	if (!BOOKORBIT_URL()) return { ok: false, error: 'BookOrbit isn’t set up yet — the owner adds its address in Settings → Services.' };
	if (!username.trim() || !password) return { ok: false, error: 'Enter your BookOrbit username and password.' };
	const api = `${BOOKORBIT_URL()}/api/v1`;
	try {
		const login = await fetch(`${api}/auth/login`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
			body: JSON.stringify({ username: username.trim(), password }),
			signal: AbortSignal.timeout(15_000)
		});
		if (login.status === 401 || login.status === 400) {
			return { ok: false, error: 'BookOrbit rejected that username or password.' };
		}
		if (!login.ok) return { ok: false, error: `BookOrbit answered HTTP ${login.status}.` };
		const { accessToken } = (await login.json()) as { accessToken?: string };
		if (!accessToken) return { ok: false, error: 'BookOrbit signed in but returned no session.' };

		const libs = await fetch(`${api}/libraries`, {
			headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
			signal: AbortSignal.timeout(15_000)
		});
		const list = libs.ok ? ((await libs.json()) as { id?: unknown; name?: unknown }[]) : [];
		return {
			ok: true,
			libraries: list
				.filter((l) => typeof l.id === 'number')
				.map((l) => ({ id: l.id as number, name: typeof l.name === 'string' ? l.name : `Library ${l.id}` }))
		};
	} catch (err) {
		return unreachable('BookOrbit', err);
	}
}

/** After someone relinks an account, drop everything cached under the old one
 *  — their watchlist, stats, calendar — so nothing from it lingers. */
export function forgetCurrentUserData(): void {
	refreshCredentials();
	invalidate(''); // every memo key in this user's namespace
	forgetUpcoming();
	dropBooksCache({ session: true });
}
