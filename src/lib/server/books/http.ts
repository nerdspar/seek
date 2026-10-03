import { error } from '@sveltejs/kit';
import { BookOrbitError } from './bookorbit';

/** Pass BookOrbit's refusals on in its own words ("This library does not
 *  accept pdf files"); anything else is a real failure and propagates. */
export function relayRefusal(e: unknown): never {
	if (e instanceof BookOrbitError && e.status < 500) error(e.status === 403 ? 403 : e.status === 404 ? 404 : 400, e.message);
	throw e;
}

/** Upload sessions are UUIDs — refuse anything else before it reaches a URL. */
export function uploadId(raw: string): string {
	if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) error(400, 'Bad upload id.');
	return raw;
}

/** Seek relays chunks of at most this (BookOrbit takes up to 16 MB; this keeps
 *  each request well inside the proxy and adapter-node body limits). */
export const SEEK_CHUNK_BYTES = 8 * 1024 * 1024;
