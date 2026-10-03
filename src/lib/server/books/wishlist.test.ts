import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from '../db';
import * as users from '../users';
import { runAs } from '../userctx';
import { addToWishlist, listWishlist, removeFromWishlist, wishlistIds } from './wishlist';

let owner: users.User;
let member: users.User;
const book = (id: number, title = `Book ${id}`) => ({ hardcoverId: id, title, author: 'A', coverUrl: null, year: 2026 });

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
});
afterEach(() => useDatabase(null));

describe('wishlist', () => {
	it('is per person', () => {
		runAs(member, () => addToWishlist(book(1)));
		expect(runAs(member, () => listWishlist()).map((b) => b.hardcoverId)).toEqual([1]);
		expect(runAs(owner, () => listWishlist())).toEqual([]);
	});

	it('re-adding refreshes the snapshot instead of duplicating', () => {
		runAs(member, () => {
			addToWishlist(book(1, 'Old title'));
			addToWishlist(book(1, 'New title'));
			expect(listWishlist().map((b) => b.title)).toEqual(['New title']);
			expect(wishlistIds()).toEqual(new Set([1]));
		});
	});

	it('removes', () => {
		runAs(member, () => {
			addToWishlist(book(1));
			addToWishlist(book(2));
			removeFromWishlist(1);
			expect(listWishlist().map((b) => b.hardcoverId)).toEqual([2]);
		});
	});

	it('rejects a book without an id or title, and needs a user', () => {
		runAs(member, () => {
			expect(() => addToWishlist({ ...book(0) })).toThrow(/Hardcover id/);
			expect(() => addToWishlist({ ...book(3), title: '  ' })).toThrow(/title/);
		});
		expect(() => listWishlist()).toThrow(/signed-in user/);
	});

	it('goes away with the account', () => {
		runAs(member, () => addToWishlist(book(1)));
		users.removeMember(owner, member.id);
		expect(runAs(owner, () => listWishlist())).toEqual([]);
	});
});
