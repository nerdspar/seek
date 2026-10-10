/**
 * The household's service configuration, read by name. These used to be env
 * vars (hence the names); they now live in Settings → Services (services.ts),
 * seeded once from env on an upgraded deployment. Everything is read through
 * these getters at call time, so a change in Settings applies immediately.
 *
 * Secrets among them (API keys, tokens) are only ever resolved server-side.
 */
import { setting } from './services';

/** A service isn't configured yet — the owner sets it in Settings → Services. */
export class NotConfiguredError extends Error {
	constructor(readonly service: string) {
		super(`${service} isn't set up yet — the household owner can add it in Settings → Services.`);
		this.name = 'NotConfiguredError';
	}
}

const url = (v: string) => v.replace(/\/+$/, '');

export const TMDB_API_KEY = () => setting('TMDB_API_KEY');

/**
 * Sonarr / Radarr connection (optional). A service is "configured" only when
 * both its URL and key are present; either missing simply hides that service.
 */
export const SONARR_URL = () => url(setting('SONARR_URL'));
export const SONARR_API_KEY = () => setting('SONARR_API_KEY');
export const RADARR_URL = () => url(setting('RADARR_URL'));
export const RADARR_API_KEY = () => setting('RADARR_API_KEY');

/**
 * BookOrbit — the self-hosted book library (optional). Session-authenticated:
 * each person's own login (Your accounts), never a shared one.
 */
export const BOOKORBIT_URL = () => url(setting('BOOKORBIT_URL'));

/** Hardcover — book discovery only (search, trending, new). One per household. */
export const HARDCOVER_TOKEN = () => setting('HARDCOVER_TOKEN');

/** Resend email (optional). */
export const RESEND_API_KEY = () => setting('RESEND_API_KEY');
export const MAIL_FROM = () => setting('MAIL_FROM');

