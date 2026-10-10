import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase } from './db';
import * as users from './users';
import { importEnvCredentials } from './upgrade';

const saved = { ...process.env };
function restoreEnv(saved: NodeJS.ProcessEnv) {
	// Mutate in place: the $env stub holds this very object.
	for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
	Object.assign(process.env, saved);
}


beforeEach(() => useDatabase(openDatabase(':memory:')));
afterEach(() => {
	restoreEnv(saved);
	useDatabase(null);
});

describe('importEnvCredentials', () => {
	it('moves the old single-user logins onto the owner, once', async () => {
		process.env.BOOKORBIT_USER = 'scott';
		process.env.BOOKORBIT_PASSWORD = 'pw';
		expect(importEnvCredentials()).toEqual([]); // no owner yet: nothing to attach to

		const owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
		expect(importEnvCredentials()).toEqual(['BOOKORBIT_USER/PASSWORD']);
		expect(users.getCredentials(owner.id)).toEqual({
			bookorbit: { username: 'scott', password: 'pw', libraryId: null },
			hardcoverToken: null
		});
		expect(importEnvCredentials()).toEqual([]);
	});

	it("never overwrites what the owner linked themselves, and never touches a member", async () => {
		const owner = await users.createOwner({ email: 'o@x.co', name: 'O', password: 'password-1' });
		const { token } = users.createInvite(owner, 'm@x.co');
		const member = await users.acceptInvite(token, { name: 'M', password: 'password-2' });
		users.setBookOrbit(owner.id, { username: 'mine', password: 'pw', libraryId: null });
		process.env.BOOKORBIT_USER = 'env';
		process.env.BOOKORBIT_PASSWORD = 'env-pw';
		importEnvCredentials();
		expect(users.getCredentials(owner.id).bookorbit?.username).toBe('mine');
		expect(users.getCredentials(member.id).bookorbit).toBeNull();
	});
});
