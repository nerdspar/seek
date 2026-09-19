import { env } from '$env/dynamic/private';

function required(name: string): string {
	const v = env[name];
	if (!v) throw new Error(`Missing required env var ${name}. See .env.example.`);
	return v;
}

/** Trailing slashes matter — every Floppy path below is written absolute. */
export const FLOPPY_URL = () => required('FLOPPY_URL').replace(/\/+$/, '');
export const FLOPPY_TOKEN = () => required('FLOPPY_TOKEN');

export const FLOPPY_CALENDAR_TOKEN = () => env.FLOPPY_CALENDAR_TOKEN ?? '';
export const TMDB_API_KEY = () => env.TMDB_API_KEY ?? '';
export const SEEK_PASSPHRASE = () => env.SEEK_PASSPHRASE ?? '';

/**
 * Sonarr / Radarr connection (optional). The API key is a secret and, like the
 * Floppy token, is only ever read server-side — it never reaches the browser.
 * A service is "configured" only when both its URL and key are present; either
 * missing simply hides that service's add button.
 */
export const SONARR_URL = () => (env.SONARR_URL ?? '').replace(/\/+$/, '');
export const SONARR_API_KEY = () => env.SONARR_API_KEY ?? '';
export const RADARR_URL = () => (env.RADARR_URL ?? '').replace(/\/+$/, '');
export const RADARR_API_KEY = () => env.RADARR_API_KEY ?? '';

/**
 * Browser-reachable Floppy address, for the one link the phone follows directly
 * (§8's link out to Floppy's settings). Distinct from FLOPPY_URL, which is only
 * ever resolved server-side and is typically a container name that a phone
 * cannot resolve. Unset means the link is simply not offered.
 */
export const FLOPPY_PUBLIC_URL = () => (env.FLOPPY_PUBLIC_URL ?? '').replace(/\/+$/, '');
