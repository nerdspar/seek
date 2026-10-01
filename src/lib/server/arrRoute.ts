/**
 * Shared bits for the /api/arr/* management routes: pick the service for a media
 * type, and turn an arr.ts error into the right HTTP status. Kept out of the
 * endpoints so the dozen of them don't each re-implement the same try/catch.
 */
import { error } from '@sveltejs/kit';
import { ArrError, ArrUnreachable, configured, type Service } from './arr';
import { getPrefs } from './prefs';

export const serviceFor = (mediaType: string | undefined): Service =>
	mediaType === 'movie' ? 'radarr' : 'sonarr';

export const serviceLabel = (service: Service): string =>
	service === 'sonarr' ? 'Sonarr' : 'Radarr';

/** Guard a route: 400 if the service isn't configured at all. */
export function requireConfigured(service: Service): void {
	if (!configured(service)) error(400, `${serviceLabel(service)} is not configured.`);
}

/** Gate the management routes on the Settings toggle, so a feature hidden in the
 *  UI isn't reachable by hand either. The basic add flow is unaffected. */
export async function requireManage(): Promise<void> {
	const prefs = await getPrefs();
	if (prefs.arrManage === false) error(403, 'Download management is turned off.');
}

/** Translate an arr.ts failure into a SvelteKit error. Never swallows an
 *  unexpected throw — only the two typed ones are mapped. */
export function arrFail(err: unknown, service: Service): never {
	if (err instanceof ArrUnreachable) error(503, `${serviceLabel(service)} is unreachable.`);
	if (err instanceof ArrError) error(err.status === 404 ? 404 : 502, err.message);
	throw err;
}
