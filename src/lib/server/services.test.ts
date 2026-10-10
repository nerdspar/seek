import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { openDatabase, useDatabase, db } from './db';
import { importEnvSettings, setSettings, setting, settingsForDisplay } from './services';

const saved = { ...process.env };
function restoreEnv(saved: NodeJS.ProcessEnv) {
	// Mutate in place: the $env stub holds this very object.
	for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
	Object.assign(process.env, saved);
}


beforeEach(() => {
	useDatabase(openDatabase(':memory:'));
	for (const k of ['SONARR_URL', 'TMDB_API_KEY', 'HARDCOVER_TOKEN', 'BOOKORBIT_URL']) delete process.env[k];
});
afterEach(() => {
	restoreEnv(saved);
	useDatabase(null);
});

describe('service settings', () => {
	it('stores secrets encrypted and shows only whether they are set', () => {
		setSettings({ SONARR_URL: 'http://10.0.1.14:8989/', TMDB_API_KEY: ' tmdb-secret ' });
		expect(setting('SONARR_URL')).toBe('http://10.0.1.14:8989'); // trailing slash dropped
		expect(setting('TMDB_API_KEY')).toBe('tmdb-secret');
		const raw = db().prepare("SELECT value FROM settings WHERE key = 'TMDB_API_KEY'").get() as { value: string };
		expect(raw.value).not.toContain('tmdb-secret');
		const shown = settingsForDisplay();
		expect(shown.SONARR_URL).toEqual({ value: 'http://10.0.1.14:8989', set: true });
		expect(shown.TMDB_API_KEY).toEqual({ set: true });
		expect(JSON.stringify(shown)).not.toContain('tmdb-secret');
	});

	it('ignores keys it does not know', () => {
		setSettings({ NOPE: 'x' } as never);
		expect(db().prepare('SELECT COUNT(*) AS n FROM settings').get()).toEqual({ n: 0 });
	});

});

describe('upgrading from env', () => {
	it('copies env values in once; after that Settings wins and env can go', () => {
		process.env.SONARR_URL = 'http://old:8989';
		process.env.TMDB_API_KEY = 'tmdb';
		expect(importEnvSettings().sort()).toEqual(['SONARR_URL', 'TMDB_API_KEY']);
		expect(importEnvSettings()).toEqual([]); // idempotent

		setSettings({ SONARR_URL: 'http://new:8989' });
		process.env.SONARR_URL = 'http://edited-in-compose:8989';
		expect(setting('SONARR_URL')).toBe('http://new:8989');

		delete process.env.SONARR_URL;
		delete process.env.TMDB_API_KEY;
		expect(setting('TMDB_API_KEY')).toBe('tmdb');
	});

	it('a setting turned off in Settings stays off, even with the env line still there', () => {
		process.env.HARDCOVER_TOKEN = 'hc';
		importEnvSettings();
		setSettings({ HARDCOVER_TOKEN: '' });
		expect(setting('HARDCOVER_TOKEN')).toBe('');
		expect(importEnvSettings()).toEqual([]);
	});
});
