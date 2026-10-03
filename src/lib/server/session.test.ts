import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issue, verify, setupCode, setupCodeIsPassphrase, setupCodeMatches, SESSION_MAX_AGE_MS } from './session';

beforeEach(() => {
	process.env.SEEK_SESSION_SECRET = 'session-secret';
});
afterEach(() => {
	vi.useRealTimers();
	delete process.env.SEEK_SESSION_SECRET;
	delete process.env.SEEK_PASSPHRASE;
});

describe('session tokens', () => {
	it('round-trips the user and session version', () => {
		expect(verify(issue(7, 3))).toEqual({ userId: 7, version: 3 });
	});

	it('rejects a forged user id', () => {
		const parts = issue(7, 1).split('.');
		parts[1] = '1';
		expect(verify(parts.join('.'))).toBeNull();
	});

	it('rejects a token signed with another secret', () => {
		const t = issue(7, 1);
		process.env.SEEK_SESSION_SECRET = 'other-secret';
		expect(verify(t)).toBeNull();
	});

	it('does not accept the old passphrase-era cookie', () => {
		expect(verify('1700000000000.abcdef')).toBeNull();
		expect(verify(undefined)).toBeNull();
		expect(verify('')).toBeNull();
	});

	it('expires after the max age', () => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-01-01T00:00:00Z'));
		const t = issue(1, 1);
		vi.setSystemTime(new Date(Date.now() + SESSION_MAX_AGE_MS + 1000));
		expect(verify(t)).toBeNull();
	});

	it('works without a configured secret (Seek generates its own)', () => {
		delete process.env.SEEK_SESSION_SECRET;
		expect(verify(issue(1, 1))).toEqual({ userId: 1, version: 1 });
	});
});

describe('setup code', () => {
	it('is a generated code by default, forgiving case and spaces', () => {
		expect(setupCodeIsPassphrase()).toBe(false);
		const code = setupCode();
		expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
		expect(setupCode()).toBe(code); // stable for the life of the process
		expect(setupCodeMatches(` ${code.toLowerCase()} `)).toBe(true);
		expect(setupCodeMatches('ABCD-EFGH')).toBe(code === 'ABCD-EFGH');
		expect(setupCodeMatches('')).toBe(false);
	});

	it('is the old SEEK_PASSPHRASE on an upgraded deployment, matched exactly', () => {
		process.env.SEEK_PASSPHRASE = 'open sesame';
		expect(setupCodeIsPassphrase()).toBe(true);
		expect(setupCodeMatches('open sesame')).toBe(true);
		expect(setupCodeMatches('OPEN SESAME')).toBe(false);
		expect(setupCodeMatches('open sesam')).toBe(false);
	});
});
