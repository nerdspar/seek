import { redirect, type Handle, type HandleServerError } from '@sveltejs/kit';
import { COOKIE, verify } from '$lib/server/session';
import { getPrefs } from '$lib/server/prefs';
import { startScheduler } from '$lib/server/scheduler';
import { warmEveryone } from '$lib/server/warmup';
import { getUser, userCount } from '$lib/server/users';
import { runAs, NotLinkedError } from '$lib/server/userctx';
import { NotConfiguredError, floppyConfigured } from '$lib/server/env';
import { announceSetupCode } from '$lib/server/session';
import { upgradeFromEnv } from '$lib/server/upgrade';

/* An upgraded deployment's env config moves into Seek (Settings → Services and
   the owner's account) before anything reads it. Idempotent; see upgrade.ts. */
upgradeFromEnv();

/* A fresh install: print the code that unlocks creating the owner account. */
if (userCount() === 0) announceSetupCode();

/* The scheduler: digest/at-air pushes, anime sync, shared-show mirroring. */
startScheduler();

/* Fire the expensive lookups once at startup, for every account, so nobody's
   first tap after a restart pays the cold cost. See warmup.ts. */
void warmEveryone().catch((err) => console.warn('[seek] warmup failed:', err));

/* Reachable without signing in. Everything else needs an account.
   - /api/health: the container HEALTHCHECK can't hold a session; gating it made
     the container permanently "unhealthy" in TrueNAS. It answers an
     unauthenticated caller with nothing but ok/not-ok.
   - the account pages: signing in, first-run setup, redeeming an emailed link. */
const PUBLIC_EXACT = new Set(['/login', '/setup', '/forgot', '/api/health']);
// /webhook/: Jellyfin posts without a session; the token in the URL is the credential.
const PUBLIC_PREFIX = ['/invite/', '/reset/', '/verify/', '/webhook/'];
const isPublic = (path: string) => PUBLIC_EXACT.has(path) || PUBLIC_PREFIX.some((p) => path.startsWith(p));

/* Once anyone has an account it never goes back to zero (the owner can't be
   removed), so remember that rather than counting on every request. */
let setUp = false;
const hasAccounts = () => setUp || (setUp = userCount() > 0);

/** Page background per appearance — must track --bg in app.css. */
const BG_DARK = '#08080C';
const BG_LIGHT = '#EEF0F6';

export const handle: Handle = async ({ event, resolve }) => {
	const path = event.url.pathname;

	/* Who is this? The cookie names a user and their session version; a version
	   bump (password change, sign out everywhere) or a removed account makes an
	   otherwise valid cookie worthless. */
	const claims = verify(event.cookies.get(COOKIE));
	const user = claims ? getUser(claims.userId) : null;
	event.locals.user = user && claims && user.sessionVersion === claims.version ? user : null;
	event.locals.authed = Boolean(event.locals.user);

	if (!hasAccounts()) {
		// First run: nobody exists yet, so the only thing to do is create the owner.
		if (path !== '/setup' && path !== '/api/health') {
			if (path.startsWith('/api/')) return new Response('Seek is not set up yet', { status: 503 });
			redirect(303, '/setup');
		}
	} else if (!event.locals.user && !isPublic(path)) {
		// API routes get a status, not a redirect to an HTML page.
		if (path.startsWith('/api/')) return new Response('Unauthorized', { status: 401 });
		const next = path === '/' ? '' : `?next=${encodeURIComponent(path + event.url.search)}`;
		redirect(303, `/login${next}`);
	} else if (
		event.locals.user?.role === 'owner' &&
		!floppyConfigured() &&
		!path.startsWith('/api/') &&
		!path.startsWith('/profile/settings') &&
		!isPublic(path) &&
		path !== '/logout' &&
		event.request.method === 'GET'
	) {
		// Nothing works until Seek knows where Floppy is: finish setting up first.
		redirect(303, '/profile/settings?s=services&welcome=1');
	}

	const render = async () => {
		/* Appearance is stamped into the HTML server-side rather than applied on
		   hydrate. Doing it in script means the first paint uses whatever was hard
		   coded and then snaps — a white flash on a dark theme is exactly the thing
		   people notice on a phone at night. Per person: this runs as them. */
		const prefs = await getPrefs().catch(() => null);
		const appearance = prefs?.appearance ?? 'system';
		const accent = prefs?.accent ?? 'violet';

		/* `system` leaves both theme-color entries in place and lets their media
		   queries decide; a fixed choice pins both to the same value so the browser
		   chrome cannot disagree with the page. */
		const dark = appearance !== 'light';
		const light = appearance !== 'dark';

		return resolve(event, {
			transformPageChunk: ({ html }) =>
				html
					.replace('%seek.appearance%', appearance)
					.replace('%seek.accent%', accent)
					.replace('%seek.themeColorDark%', dark ? BG_DARK : BG_LIGHT)
					.replace('%seek.themeColorLight%', light ? BG_LIGHT : BG_DARK)
					.replace('%seek.colorScheme%', appearance === 'system' ? 'light dark' : appearance)
					/* Always `default`, never `black-translucent`. iOS 26+/27 draws an
					   uncloseable "Liquid Glass" blur over the top edge of a standalone
					   PWA *only* when it uses black-translucent (confirmed root cause;
					   no meta or CSS disables the blur otherwise). `default` gives an
					   opaque status bar coloured by the body background — and since the
					   chrome shell already keeps content out of that strip, we lose
					   nothing but the blur. The status-bar meta is frozen at install, so
					   this only takes effect after the app is re-added to the Home
					   Screen. */
					.replace('%seek.statusBar%', 'default')
		});
	};

	// Everything this request does — Floppy calls, caches, prefs — is for them.
	return event.locals.user ? runAs(event.locals.user, render) : render();
};

/* Unexpected errors reach the browser as a bare "Internal Error" (their messages
   can carry internals). "You haven't linked X" is the exception: it's written to
   be shown, and it's a normal state for a new household member, so it's passed
   through with the service — pages turn it into a link-your-account prompt. This
   covers streamed promises too, which are how most tabs load. */
export const handleError: HandleServerError = ({ error }) => {
	if (error instanceof NotLinkedError) return { message: error.message, notLinked: error.service };
	if (error instanceof NotConfiguredError) return { message: error.message };
	return { message: 'Internal Error' };
};
