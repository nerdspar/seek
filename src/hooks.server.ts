import { redirect, type Handle } from '@sveltejs/kit';
import { COOKIE, gateEnabled, verify } from '$lib/server/session';

export const handle: Handle = async ({ event, resolve }) => {
	if (gateEnabled() && event.url.pathname !== '/login') {
		if (!verify(event.cookies.get(COOKIE))) {
			// API routes get a status, not a redirect to an HTML page.
			if (event.url.pathname.startsWith('/api/')) {
				return new Response('Unauthorized', { status: 401 });
			}
			redirect(303, '/login');
		}
	}
	return resolve(event);
};
