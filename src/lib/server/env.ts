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
