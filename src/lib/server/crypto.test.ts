import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
	hashPassword,
	verifyPassword,
	encryptSecret,
	decryptSecret,
	tokenKeyConfigured,
	newOpaqueToken,
	hashToken
} from './crypto';

describe('password hashing', () => {
	it('verifies the right password and rejects the wrong one', async () => {
		const stored = await hashPassword('correct horse');
		expect(stored.startsWith('scrypt$32768$8$1$')).toBe(true);
		expect(await verifyPassword('correct horse', stored)).toBe(true);
		expect(await verifyPassword('Correct horse', stored)).toBe(false);
	});

	it('salts — the same password hashes differently each time', async () => {
		expect(await hashPassword('x')).not.toBe(await hashPassword('x'));
	});

	it('treats a malformed stored hash as a failed check, not an error', async () => {
		expect(await verifyPassword('x', 'garbage')).toBe(false);
		expect(await verifyPassword('x', 'scrypt$a$b$c$d$e')).toBe(false);
		expect(await verifyPassword('x', 'scrypt$16384$8$1$c2FsdA$')).toBe(false);
	});
});

describe('secret encryption', () => {
	beforeEach(() => {
		process.env.SEEK_TOKEN_KEY = 'test-key-one';
	});
	afterEach(() => {
		delete process.env.SEEK_TOKEN_KEY;
	});

	it('round-trips and never stores the plaintext', () => {
		const enc = encryptSecret('flp_secret_token');
		expect(enc.startsWith('v1:')).toBe(true);
		expect(enc).not.toContain('flp_secret_token');
		expect(decryptSecret(enc)).toBe('flp_secret_token');
	});

	it('uses a fresh IV, so equal secrets encrypt differently', () => {
		expect(encryptSecret('same')).not.toBe(encryptSecret('same'));
	});

	it('fails loudly under the wrong key or a tampered value', () => {
		const enc = encryptSecret('secret');
		process.env.SEEK_TOKEN_KEY = 'a-different-key';
		expect(() => decryptSecret(enc)).toThrow();

		process.env.SEEK_TOKEN_KEY = 'test-key-one';
		const parts = enc.split(':');
		parts[3] = Buffer.from('tampered').toString('base64url');
		expect(() => decryptSecret(parts.join(':'))).toThrow();
		expect(() => decryptSecret('not-a-secret')).toThrow(/format/);
	});

	it('requires SEEK_TOKEN_KEY', () => {
		delete process.env.SEEK_TOKEN_KEY;
		expect(tokenKeyConfigured()).toBe(false);
		expect(() => encryptSecret('x')).toThrow(/SEEK_TOKEN_KEY/);
	});
});

describe('opaque tokens', () => {
	it('hands out a random token and stores only its hash', () => {
		const a = newOpaqueToken();
		const b = newOpaqueToken();
		expect(a.token).not.toBe(b.token);
		expect(a.hash).toBe(hashToken(a.token));
		expect(a.hash).not.toBe(a.token);
	});
});
