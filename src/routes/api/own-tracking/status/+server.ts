import { json } from '@sveltejs/kit';
import { currentUser } from '$lib/server/userctx';
import { listUsers } from '$lib/server/users';
import { lastRun, reviewsFor } from '$lib/server/tracking/store';
import type { RequestHandler } from './$types';

/** How the copy out of Floppy stands for each person in the household
 *  (own-tracking plan, step 2): last run, totals, and anything to review. */
export const GET: RequestHandler = async () => {
	const me = currentUser();
	const people = listUsers().filter((u) => u.householdId === me?.householdId);
	return json(people.map((u) => ({ id: u.id, name: u.name, lastRun: lastRun(u.id), review: reviewsFor(u.id) })));
};
