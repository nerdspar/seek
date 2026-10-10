import { json } from '@sveltejs/kit';
import { userByFeedToken } from '$lib/server/users';
import { runAs } from '$lib/server/userctx';
import { getUpcoming } from '$lib/server/upcoming';
import type { RequestHandler } from './$types';

const DAY = 24 * 60 * 60 * 1000;

/**
 * What's coming up for one person, as JSON — for the MagicMirror module and
 * anything else that can't sign in. The token in the URL says whose; it opens
 * nothing but this list. From yesterday on, so "today" stays whole in every
 * time zone.
 */
export const GET: RequestHandler = async ({ params }) => {
	const user = userByFeedToken(params.token);
	if (!user) return new Response('Unknown feed', { status: 404 });
	const from = Date.now() - DAY;
	const events = (await runAs(user, () => getUpcoming()))
		.filter((e) => Date.parse(e.start) >= from)
		.map((e) => ({
			title: e.title,
			season: e.season,
			episode: e.episode,
			start: e.start,
			hasTime: e.hasTime,
			mediaType: e.mediaType,
			mediaId: e.mediaId
		}));
	return json({ events }, { headers: { 'Cache-Control': 'private, max-age=300' } });
};
