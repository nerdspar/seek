import { json, error } from '@sveltejs/kit';
import { deleteGoal, listGoals, saveGoal, type GoalDraft } from '$lib/server/books/shelf';
import { HardcoverError } from '$lib/server/books/hardcover';
import { NotLinkedError } from '$lib/server/userctx';
import type { RequestHandler } from './$types';

/**
 * Your reading goals on Hardcover (always private): GET lists the ones still
 * running, with Hardcover's progress; PUT creates (no id) or changes one;
 * DELETE removes one.
 */
async function hardcover<T>(job: () => Promise<T>): Promise<T> {
	try {
		return await job();
	} catch (e) {
		if (e instanceof NotLinkedError) error(409, e.message);
		if (e instanceof HardcoverError) error(502, `${e.message} — nothing changed.`);
		throw e;
	}
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** A goal from the editor, checked. */
function parseDraft(b: Record<string, unknown>): GoalDraft {
	const target = Number(b.target);
	if (!['book', 'page', 'hour'].includes(b.metric as string)) error(400, 'Count books, pages or hours.');
	if (!['any', 'read', 'listen'].includes(b.format as string)) error(400, 'Pick read, listen or both.');
	if (!Number.isFinite(target) || target <= 0 || target > 1_000_000) error(400, 'Pick a target above zero.');
	if (typeof b.startDate !== 'string' || typeof b.endDate !== 'string' || !DAY.test(b.startDate) || !DAY.test(b.endDate)) {
		error(400, 'Pick a start and end date.');
	}
	if (b.endDate < b.startDate) error(400, 'The end date is before the start.');
	const id = Number(b.id);
	return {
		id: Number.isInteger(id) && id > 0 ? id : null,
		title: typeof b.title === 'string' ? b.title.slice(0, 120) : '',
		metric: b.metric as GoalDraft['metric'],
		format: b.format as GoalDraft['format'],
		target: Math.round(target),
		startDate: b.startDate,
		endDate: b.endDate
	};
}

export const GET: RequestHandler = async () => json({ goals: await hardcover(() => listGoals()) });

export const PUT: RequestHandler = async ({ request }) => {
	const draft = parseDraft(await request.json().catch(() => ({})));
	const id = await hardcover(() => saveGoal(draft));
	return json({ id, goals: await hardcover(() => listGoals()) });
};

export const DELETE: RequestHandler = async ({ request }) => {
	const id = Number((await request.json().catch(() => ({}))).id);
	if (!Number.isInteger(id) || id <= 0) error(400, 'Which goal?');
	await hardcover(() => deleteGoal(id));
	return json({ ok: true });
};
