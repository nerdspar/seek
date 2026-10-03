import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/* prefs.ts caches per user at module level, so each test loads fresh modules
   (and therefore a fresh cache) against its own temp data dir + in-memory DB. */
let dir: string;

async function setup(legacy?: object) {
	vi.resetModules();
	dir = mkdtempSync(join(tmpdir(), 'seek-prefs-'));
	process.env.SEEK_DATA_DIR = dir;
	process.env.SEEK_TOKEN_KEY = 'k';
	if (legacy) writeFileSync(join(dir, 'preferences.json'), JSON.stringify(legacy));
	const db = await import('./db');
	db.useDatabase(db.openDatabase(':memory:'));
	const users = await import('./users');
	const prefs = await import('./prefs');
	const ctx = await import('./userctx');
	const owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	const member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
	return { users, prefs, ctx, owner, member };
}

afterEach(() => {
	rmSync(dir, { recursive: true, force: true });
	delete process.env.SEEK_DATA_DIR;
	delete process.env.SEEK_TOKEN_KEY;
});

const LEGACY = {
	accent: 'teal',
	appearance: 'dark',
	services: ['Netflix'],
	sonarr: { rootFolderPath: '/tv', qualityProfileId: 4 },
	companyTracking: false,
	arrManage: true
};

describe('per-user prefs', () => {
	it('the owner inherits everything set before accounts existed', async () => {
		const { prefs, ctx, owner } = await setup(LEGACY);
		const p = await ctx.runAs(owner, () => prefs.getPrefs());
		expect(p).toMatchObject({ accent: 'teal', appearance: 'dark', services: ['Netflix'], arrManage: true });
	});

	it('a member gets the household fields but personal defaults, with download management off', async () => {
		const { prefs, ctx, member } = await setup(LEGACY);
		const p = await ctx.runAs(member, () => prefs.getPrefs());
		expect(p.services).toEqual(['Netflix']);
		expect(p.sonarr).toEqual({ rootFolderPath: '/tv', qualityProfileId: 4 });
		expect(p.companyTracking).toBe(false);
		expect(p.accent).toBe('violet');
		expect(p.appearance).toBe('system');
		expect(p.arrManage).toBe(false);
	});

	it("one person's change never touches the other's prefs", async () => {
		const { prefs, ctx, owner, member } = await setup(LEGACY);
		await ctx.runAs(member, () => prefs.setPrefs({ accent: 'rose', arrManage: true }));
		expect((await ctx.runAs(member, () => prefs.getPrefs())).accent).toBe('rose');
		const o = await ctx.runAs(owner, () => prefs.getPrefs());
		expect(o.accent).toBe('teal');
	});

	it('persists to the account row, surviving a cold cache', async () => {
		const { users, prefs, ctx, member } = await setup();
		await ctx.runAs(member, () => prefs.setPrefs({ markDirection: 'ltr' }));
		expect(JSON.parse(users.getPrefsJson(member.id)!).markDirection).toBe('ltr');
	});

	it('has books on by default', async () => {
		const { prefs, ctx, member } = await setup();
		expect((await ctx.runAs(member, () => prefs.getPrefs())).booksEnabled).toBe(true);
	});

	it('outside any user, reads and writes the legacy file as before', async () => {
		const { prefs } = await setup(LEGACY);
		expect((await prefs.getPrefs()).accent).toBe('teal');
		await prefs.setPrefs({ accent: 'sky' });
		expect((await prefs.getPrefs()).accent).toBe('sky');
	});
});

describe('memberStartingPrefs', () => {
	it('copies only the household fields', async () => {
		const { prefs } = await setup();
		const start = prefs.memberStartingPrefs({ ...prefs.DEFAULTS, accent: 'ember', services: ['Hulu'], arrManage: true });
		expect(start.services).toEqual(['Hulu']);
		expect(start.accent).toBe('violet');
		expect(start.arrManage).toBe(false);
	});
});
