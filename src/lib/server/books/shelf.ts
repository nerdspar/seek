/**
 * Your shelf on Hardcover — where each person's reading lives: status, rating,
 * started/finished dates, page progress and the reading goal, for any book, in
 * the library or not (docs/books-hardcover-plan.md). BookOrbit is only the
 * library; Seek never writes reading state there.
 *
 * Everything runs as you, with your own Hardcover token (Your accounts). The
 * whole shelf is read in a couple of requests and cached per person; any write
 * drops that cache so the next read is fresh. Hardcover allows 60 requests a
 * minute per token, which a person tapping through Seek never gets near.
 *
 * Reads and writes are deliberately few and plain: a shelf entry (user_book)
 * holds the status and rating; its latest read (user_book_read) holds the
 * dates and the page. Nothing here is retried — a failed write says so, and the
 * shelf is re-read either way.
 */
import { hcAs, HardcoverError } from './hardcover';
import { hardcoverUserToken, NotLinkedError } from '../userctx';
import { invalidate, memo } from '../memo';
import {
	HC_STATUS_ID,
	currentGoals,
	goalFormatId,
	mapGoal,
	mapShelfRow,
	type EntryStatus,
	type ReadingGoalItem,
	type ShelfBook
} from '$lib/books';

const PAGE = 500;

/* Depth stays within Hardcover's limit: me → user_books → book → image. */
const SHELF_QUERY = `query Shelf($offset: Int!) {
  me {
    user_books(where: {status_id: {_neq: 6}}, order_by: {id: asc}, limit: ${PAGE}, offset: $offset) {
      id status_id rating date_added updated_at
      book { id title release_year pages cached_contributors cached_tags image { url } }
      user_book_reads(order_by: {id: desc}, limit: 1) { id started_at finished_at progress_pages }
    }
  }
}`;

/** Whether this person has linked their own Hardcover account. */
export const shelfLinked = () => Boolean(hardcoverUserToken());

function token(): string {
	const t = hardcoverUserToken();
	if (!t) throw new NotLinkedError('hardcover');
	return t;
}

/** Your whole shelf (Ignored books left out), oldest entry first. */
export function myShelf(): Promise<ShelfBook[]> {
	return memo('books:shelf', 5 * 60 * 1000, async () => {
		const t = token();
		const out: ShelfBook[] = [];
		for (let offset = 0; ; offset += PAGE) {
			const data = await hcAs<{ me: { user_books?: unknown[] }[] }>(t, SHELF_QUERY, { offset });
			const rows = data.me?.[0]?.user_books ?? [];
			for (const r of rows) {
				const b = mapShelfRow(r);
				if (b) out.push(b);
			}
			if (rows.length < PAGE) break;
		}
		return out;
	});
}

/** Your shelf entry for one book, if it's on your shelf. */
async function entryFor(hardcoverId: number): Promise<ShelfBook | undefined> {
	return (await myShelf()).find((b) => b.hardcoverId === hardcoverId);
}

/** Hardcover's calendar day for "today", in the server's time zone. */
export const today = (now = new Date()) => now.toLocaleDateString('en-CA');
/** A stored instant (midday UTC for a calendar day) back to its day. */
const dayOf = (iso: string | null) => (iso ? iso.slice(0, 10) : null);

/* ── Writes ─────────────────────────────────────────────────────────────── */

type Result = { id?: number | null; error?: string | null } | null | undefined;

function ok(res: Result, what: string): number {
	if (!res || res.error || !res.id) throw new HardcoverError(res?.error || `${what} failed`);
	return res.id;
}

async function insertBook(t: string, hardcoverId: number, fields: Record<string, unknown>): Promise<number> {
	const d = await hcAs<{ insert_user_book: Result }>(
		t,
		'mutation($o: UserBookCreateInput!) { insert_user_book(object: $o) { id error } }',
		{ o: { book_id: hardcoverId, ...fields } }
	);
	return ok(d.insert_user_book, 'Adding the book');
}

async function updateBook(t: string, userBookId: number, fields: Record<string, unknown>): Promise<void> {
	const d = await hcAs<{ update_user_book: Result }>(
		t,
		'mutation($id: Int!, $o: UserBookUpdateInput!) { update_user_book(id: $id, object: $o) { id error } }',
		{ id: userBookId, o: fields }
	);
	ok(d.update_user_book, 'Updating the book');
}

async function deleteBook(t: string, userBookId: number): Promise<void> {
	await hcAs(t, 'mutation($id: Int!) { delete_user_book(id: $id) { id } }', { id: userBookId });
}

async function insertRead(t: string, userBookId: number, read: Record<string, unknown>): Promise<void> {
	const d = await hcAs<{ insert_user_book_read: Result }>(
		t,
		'mutation($id: Int!, $r: DatesReadInput!) { insert_user_book_read(user_book_id: $id, user_book_read: $r) { id error } }',
		{ id: userBookId, r: read }
	);
	ok(d.insert_user_book_read, 'Recording the read');
}

async function updateRead(t: string, readId: number, read: Record<string, unknown>): Promise<void> {
	const d = await hcAs<{ update_user_book_read: Result }>(
		t,
		'mutation($id: Int!, $r: DatesReadInput!) { update_user_book_read(id: $id, object: $r) { id error } }',
		{ id: readId, r: read }
	);
	ok(d.update_user_book_read, 'Updating the read');
}

/** A read you've started and not finished. */
const openRead = (b: ShelfBook | undefined) => (b && b.readId && !b.finishedAt ? b : null);

/** Run a write, then drop the cached shelf whatever happened. */
async function write<T>(job: (t: string) => Promise<T>): Promise<T> {
	const t = token();
	try {
		return await job(t);
	} finally {
		invalidate('books:shelf');
		invalidate('books:goals');
	}
}

/**
 * Put a book on a shelf, or (null) take it off your shelf. Reading starts a read
 * dated today unless one is open; Read finishes the open read today (or records
 * one finished today), so the diary and the goal count it.
 */
export function setStatus(hardcoverId: number, status: EntryStatus | null, now = new Date()): Promise<void> {
	return write(async (t) => {
		const b = await entryFor(hardcoverId);
		if (status === null) {
			if (b) await deleteBook(t, b.userBookId);
			return;
		}
		const statusId = HC_STATUS_ID[status];
		let userBookId: number;
		if (b) {
			if (b.status !== status) await updateBook(t, b.userBookId, { status_id: statusId });
			userBookId = b.userBookId;
		} else {
			userBookId = await insertBook(t, hardcoverId, { status_id: statusId });
		}
		const open = openRead(b);
		if (status === 'reading' && !open) await insertRead(t, userBookId, { started_at: today(now) });
		if (status === 'read' && b?.status !== 'read') {
			if (open) {
				await updateRead(t, open.readId!, {
					started_at: dayOf(open.startedAt),
					finished_at: today(now),
					progress_pages: open.pages ?? open.progressPages
				});
			} else {
				await insertRead(t, userBookId, { finished_at: today(now) });
			}
		}
	});
}

/** Rate a book 1–5 (null clears it). Rating one that isn't on your shelf puts it
 *  under Read — you rate what you've read. */
export function setRating(hardcoverId: number, rating: number | null): Promise<void> {
	return write(async (t) => {
		const b = await entryFor(hardcoverId);
		if (b) await updateBook(t, b.userBookId, { rating });
		else if (rating !== null) await insertBook(t, hardcoverId, { status_id: HC_STATUS_ID.read, rating });
	});
}

/** The page you're on. A book you weren't reading becomes Reading. */
export function setPages(hardcoverId: number, pages: number, now = new Date()): Promise<void> {
	return write(async (t) => {
		const b = await entryFor(hardcoverId);
		const userBookId = b ? b.userBookId : await insertBook(t, hardcoverId, { status_id: HC_STATUS_ID.reading });
		if (b && b.status !== 'reading') await updateBook(t, b.userBookId, { status_id: HC_STATUS_ID.reading });
		const open = openRead(b);
		if (open) await updateRead(t, open.readId!, { started_at: dayOf(open.startedAt), progress_pages: pages });
		else await insertRead(t, userBookId, { started_at: today(now), progress_pages: pages });
	});
}

/* ── Reading goals ──────────────────────────────────────────────────────── */

/* Hardcover's privacy_settings: 3 is Private. */
const PRIVATE = 3;

const GOALS_QUERY = `query {
  me { goals(where: {archived: {_eq: false}}, order_by: {end_date: asc}) {
    id description metric goal progress start_date end_date archived conditions
  } }
}`;

/** Your goals that are still running, with Hardcover's progress brought up to
 *  date first (Hardcover recounts a goal only when asked). */
export function listGoals(now = new Date()): Promise<ReadingGoalItem[]> {
	return memo('books:goals', 5 * 60 * 1000, async () => {
		const t = token();
		const data = await hcAs<{ me: { goals?: unknown[] }[] }>(t, GOALS_QUERY);
		const goals = currentGoals((data.me?.[0]?.goals ?? []).map(mapGoal).filter((g): g is ReadingGoalItem => g !== null), today(now));
		// Recount each in parallel; a recount that fails keeps the last number.
		return Promise.all(
			goals.map(async (g) => {
				const r = await hcAs<{ update_goal_progress: { goal?: { progress?: number | null } | null } | null }>(
					t,
					'mutation($id: Int!) { update_goal_progress(id: $id) { goal { progress } } }',
					{ id: g.id }
				).catch(() => null);
				const p = r?.update_goal_progress?.goal?.progress;
				return typeof p === 'number' ? { ...g, done: Math.round(p * 10) / 10 } : g;
			})
		);
	});
}

export type GoalDraft = Omit<ReadingGoalItem, 'id' | 'done'> & { id?: number | null };

type GoalResult = { id?: number | null; errors?: string | null } | null;

/**
 * Create or change a goal. Always private: Hardcover ignores privacy when a goal
 * is created, so a new one is created and then set Private straight away.
 */
export function saveGoal(draft: GoalDraft): Promise<number> {
	return write(async (t) => {
		const formatId = goalFormatId(draft.format);
		const object = {
			description: draft.title.trim() || `${draft.startDate.slice(0, 4)} Reading Goal`,
			metric: draft.metric,
			goal: draft.target,
			start_date: draft.startDate,
			end_date: draft.endDate,
			privacy_setting_id: PRIVATE,
			conditions: formatId === null ? {} : { readingFormatId: formatId }
		};
		const update = async (id: number) => {
			const d = await hcAs<{ update_goal: GoalResult }>(
				t,
				'mutation($id: Int!, $o: GoalInput!) { update_goal(id: $id, object: $o) { id errors } }',
				{ id, o: object }
			);
			if (!d.update_goal || d.update_goal.errors) throw new HardcoverError(d.update_goal?.errors || 'Saving the goal failed');
		};
		if (draft.id) {
			await update(draft.id);
			return draft.id;
		}
		const d = await hcAs<{ insert_goal: GoalResult }>(
			t,
			'mutation($o: GoalInput!) { insert_goal(object: $o) { id errors } }',
			{ o: object }
		);
		const id = d.insert_goal?.id;
		if (!id || d.insert_goal?.errors) throw new HardcoverError(d.insert_goal?.errors || 'Creating the goal failed');
		await update(id); // make it private
		return id;
	});
}

/** Delete a goal. Hardcover finishes deleting a moment later and answers
 *  without an id, so only an error counts as failure. */
export function deleteGoal(id: number): Promise<void> {
	return write(async (t) => {
		const d = await hcAs<{ delete_goal: GoalResult }>(t, 'mutation($id: Int!) { delete_goal(id: $id) { id errors } }', { id });
		if (d.delete_goal?.errors) throw new HardcoverError(d.delete_goal.errors);
	});
}

/* ── Moving books in (once) ─────────────────────────────────────────────── */

/** A book as it was tracked before, with its own dates. */
export type ImportedBook = {
	hardcoverId: number;
	status: EntryStatus;
	rating: number | null;
	startedAt: string | null;
	finishedAt: string | null;
	progressPages: number | null;
};

/** Put a book on your shelf exactly as it was — status, rating and the read
 *  with its original dates. Never touches a book already on your shelf. */
export function importBook(book: ImportedBook): Promise<'added' | 'already'> {
	return write(async (t) => {
		if (await entryFor(book.hardcoverId)) return 'already';
		const userBookId = await insertBook(t, book.hardcoverId, {
			status_id: HC_STATUS_ID[book.status],
			...(book.rating !== null ? { rating: book.rating } : {})
		});
		const read = {
			...(book.startedAt ? { started_at: dayOf(book.startedAt) } : {}),
			...(book.finishedAt ? { finished_at: dayOf(book.finishedAt) } : {}),
			...(book.progressPages !== null ? { progress_pages: book.progressPages } : {})
		};
		if (Object.keys(read).length) await insertRead(t, userBookId, read);
		return 'added';
	});
}

/** Put a book under Want to read if it isn't on your shelf at all — what a
 *  download or request does. Never moves a book you've already shelved. */
export function wantIfNew(hardcoverId: number): Promise<void> {
	return write(async (t) => {
		if (!(await entryFor(hardcoverId))) await insertBook(t, hardcoverId, { status_id: HC_STATUS_ID.want_to_read });
	});
}

/** Your shelf entry for one book (for the book sheet), or null. */
export async function shelfEntry(hardcoverId: number): Promise<ShelfBook | null> {
	return (await entryFor(hardcoverId)) ?? null;
}
