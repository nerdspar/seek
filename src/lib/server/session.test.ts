import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { issue, verify, setupTokenRequired, passphraseMatches, SESSION_MAX_AGE_MS } from './session';

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

	it('requires a session secret', () => {
		delete process.env.SEEK_SESSION_SECRET;
		expect(() => issue(1, 1)).toThrow(/SEEK_SESSION_SECRET/);
	});
});

describe('setup token', () => {
	it('is required only when SEEK_PASSPHRASE is set, and must match it', () => {
		expect(setupTokenRequired()).toBe(false);
		process.env.SEEK_PASSPHRASE = 'open sesame';
		expect(setupTokenRequired()).toBe(true);
		expect(passphraseMatches('open sesame')).toBe(true);
		expect(passphraseMatches('open sesam')).toBe(false);
	});
});
