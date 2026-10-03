import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { openDatabase, useDatabase, MIGRATIONS, migrate } from '../db';
import * as users from '../users';
import { runAs } from '../userctx';
import { entryStatuses, getEntry, listEntries, removeEntry, saveEntry } from './entries';

let owner: users.User;
let member: users.User;
const book = (id: number, extra: Record<string, unknown> = {}) => ({
	hardcoverId: id,
	title: `Book ${id}`,
	author: 'A',
	coverUrl: null,
	year: 2026,
	...extra
});

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
});
afterEach(() => useDatabase(null));

describe('your own books', () => {
	it('are per person, and default to want to read', () => {
		runAs(member, () => saveEntry(book(1)));
		expect(runAs(member, () => listEntries()).map((e) => [e.hardcoverId, e.status])).toEqual([[1, 'want_to_read']]);
		expect(runAs(owner, () => listEntries())).toEqual([]);
	});

	it('stamp started and finished dates as the status moves, and fill pages when read', () => {
		runAs(member, () => {
			saveEntry(book(1, { pages: 300 }), { status: 'reading', progressPages: 120 });
			const reading = getEntry(1)!;
			expect(reading.startedAt).toBeTruthy();
			expect(reading.finishedAt).toBeNull();
			expect(reading.progressPages).toBe(120);

			const read = saveEntry(book(1), { status: 'read', rating: 4 });
			expect(read.startedAt).toBe(reading.startedAt);
			expect(read.finishedAt).toBeTruthy();
			expect(read.progressPages).toBe(300);
			expect(read.myRating).toBe(4);
			expect(read.pages).toBe(300); // kept though this save didn't send it
		});
	});

	it('keep what you did not change, and clamp pages to the book', () => {
		runAs(member, () => {
			saveEntry(book(1, { pages: 200 }), { status: 'reading', rating: 5 });
			const e = saveEntry(book(1), { progressPages: 999 });
			expect(e).toMatchObject({ status: 'reading', myRating: 5, progressPages: 200 });
			expect(saveEntry(book(1), { rating: null }).myRating).toBeNull();
		});
	});

	it('refuse bad input', () => {
		runAs(member, () => {
			expect(() => saveEntry(book(0))).toThrow(/Hardcover id/);
			expect(() => saveEntry({ ...book(2), title: ' ' })).toThrow(/title/);
			expect(() => saveEntry(book(2), { rating: 6 })).toThrow(/1 to 5/);
			expect(() => saveEntry(book(2), { status: 'unread' as never })).toThrow(/status/);
			expect(() => saveEntry(book(2), { progressPages: -1 })).toThrow(/whole number/);
		});
		expect(() => listEntries()).toThrow(/signed-in user/);
	});

	it('remove, and map to statuses for badging', () => {
		runAs(member, () => {
			saveEntry(book(1));
			saveEntry(book(2), { status: 'read' });
			removeEntry(1);
			expect(entryStatuses()).toEqual(new Map([[2, 'read']]));
		});
	});

	it('go away with the account', () => {
		runAs(member, () => saveEntry(book(1)));
		users.removeMember(owner, member.id);
		expect(runAs(owner, () => listEntries())).toEqual([]);
	});
});

describe('upgrading from the wishlist', () => {
	it('carries every wished book over as want to read', async () => {
		const old = new Database(':memory:');
		old.pragma('foreign_keys = ON');
		for (const m of MIGRATIONS.slice(0, 4)) old.exec(m);
		old.pragma('user_version = 4');
		useDatabase(old);
		const o = await users.createOwner({ email: 'x@x.co', name: 'X', password: 'password-1' });
		old.prepare(
			`INSERT INTO wishlist (user_id, hardcover_id, title, author, cover_url, year, added_at) VALUES (?, 7, 'Hyperion', 'Dan Simmons', NULL, 1989, '2026-09-01T00:00:00Z')`
		).run(o.id);

		migrate(old);
		const [e] = runAs(o, () => listEntries());
		expect(e).toMatchObject({ hardcoverId: 7, title: 'Hyperion', status: 'want_to_read', addedAt: '2026-09-01T00:00:00Z' });
	});
});
