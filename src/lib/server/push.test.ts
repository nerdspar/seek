import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const sendNotification = vi.fn();
vi.mock('web-push', () => ({
	default: { setVapidDetails: vi.fn(), sendNotification: (...a: unknown[]) => sendNotification(...a) }
}));

import { openDatabase, useDatabase } from './db';
import * as users from './users';
import { runAs } from './userctx';
import * as push from './push';

let owner: users.User;
let member: users.User;
let dir: string;
const sub = (endpoint: string) => ({ endpoint, keys: { p256dh: 'p', auth: 'a' } });

beforeEach(async () => {
	useDatabase(openDatabase(':memory:'));
	dir = mkdtempSync(join(tmpdir(), 'seek-push-'));
	process.env.SEEK_DATA_DIR = dir;
	process.env.VAPID_PUBLIC_KEY = 'pub';
	process.env.VAPID_PRIVATE_KEY = 'priv';
	sendNotification.mockReset();
	owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
	const { token } = users.createInvite(owner, 'm@x.co');
	member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
});
afterEach(() => {
	useDatabase(null);
	rmSync(dir, { recursive: true, force: true });
	for (const k of ['SEEK_DATA_DIR', 'VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY']) delete process.env[k];
});

describe('per-user subscriptions', () => {
	it('each person only counts and reaches their own devices', async () => {
		await runAs(owner, () => push.addSubscription(sub('https://push.example/o1')));
		await runAs(owner, () => push.addSubscription(sub('https://push.example/o2')));
		await runAs(member, () => push.addSubscription(sub('https://push.example/m1')));
		expect(await runAs(owner, () => push.subscriptionCount())).toBe(2);
		expect(await runAs(member, () => push.subscriptionCount())).toBe(1);

		await runAs(member, () => push.sendToDevices({ title: 't', body: 'b' }));
		expect(sendNotification.mock.calls.map((c) => (c[0] as { endpoint: string }).endpoint)).toEqual([
			'https://push.example/m1'
		]);
	});

	it('a device that switches accounts moves to the new account', async () => {
		await runAs(owner, () => push.addSubscription(sub('https://push.example/shared')));
		await runAs(member, () => push.addSubscription(sub('https://push.example/shared')));
		expect(await runAs(owner, () => push.subscriptionCount())).toBe(0);
		expect(await runAs(member, () => push.subscriptionCount())).toBe(1);
	});

	it("unsubscribing can't remove someone else's device", async () => {
		await runAs(owner, () => push.addSubscription(sub('https://push.example/o1')));
		await runAs(member, () => push.removeSubscription('https://push.example/o1'));
		expect(await runAs(owner, () => push.subscriptionCount())).toBe(1);
	});

	it('prunes endpoints the push service says are gone', async () => {
		await runAs(owner, () => push.addSubscription(sub('https://push.example/dead')));
		sendNotification.mockRejectedValueOnce({ statusCode: 410 });
		const res = await runAs(owner, () => push.sendToDevices({ title: 't', body: 'b' }));
		expect(res).toEqual({ sent: 0, pruned: 1 });
		expect(await runAs(owner, () => push.subscriptionCount())).toBe(0);
	});

	it('keeps the once-a-day guards per person', async () => {
		await runAs(owner, () => push.setLastDigest('2026-10-03'));
		expect(await runAs(owner, () => push.getLastDigest())).toBe('2026-10-03');
		expect(await runAs(member, () => push.getLastDigest())).toBeNull();
	});

	it('refuses to act without a signed-in user', async () => {
		await expect(push.subscriptionCount()).rejects.toThrow(/signed-in user/);
	});
});

describe('legacy import', () => {
	it('moves the old file’s devices and guards to the owner, once', async () => {
		writeFileSync(
			join(dir, 'push-subscriptions.json'),
			JSON.stringify({ subs: [sub('https://push.example/old')], lastDigest: '2026-10-02', lastAtTime: null })
		);
		expect(await push.importLegacyPush(owner.id)).toBe(1);
		expect(await runAs(owner, () => push.subscriptionCount())).toBe(1);
		expect(await runAs(owner, () => push.getLastDigest())).toBe('2026-10-02');
		expect(existsSync(join(dir, 'push-subscriptions.json'))).toBe(false);
		expect(await push.importLegacyPush(owner.id)).toBe(0);
	});
});
