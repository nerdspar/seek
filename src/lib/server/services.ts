/**
 * Service settings storage. The owner edits them in Settings → Services; they
 * live in the `settings` table, secret ones encrypted.
 *
 * Upgrading from env config: on boot, any env var Seek used to read (TMDB_API_KEY,
 * SONARR_URL, …) that has no stored row yet is copied in, once. From then on
 * the stored value is the one used — editing the compose file no longer changes
 * anything, and the old env lines can simply be deleted. A setting cleared in
 * Settings is stored as empty, so it stays off rather than falling back to env.
 */
import { env } from '$env/dynamic/private';
import { db, nowIso } from './db';
import { decryptSecret, encryptSecret } from './crypto';
import { SERVICE_FIELDS, SERVICE_KEYS, type ServiceKey } from '$lib/serviceFields';

const SECRET = new Set<string>(SERVICE_FIELDS.filter((f) => f.secret).map((f) => f.key));

/* Read on nearly every request, so decrypted values are kept in memory; every
   write goes through set(). */
let cache: Map<string, string> | null = null;
let cacheFor: unknown = null; // the database the cache was read from

function load(): Map<string, string> {
	if (cache && cacheFor === db()) return cache;
	cacheFor = db();
	const rows = db().prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
	cache = new Map(
		rows
			.filter((r) => SERVICE_KEYS.has(r.key))
			.map((r) => [r.key, SECRET.has(r.key) && r.value ? decryptSecret(r.value) : r.value])
	);
	return cache;
}

/** A service setting's value ('' when unset). Stored rows win; env is consulted
 *  only for a key that has never been stored (before the boot import runs). */
export function setting(key: ServiceKey): string {
	const stored = load().get(key);
	if (stored !== undefined) return stored;
	return env[key] ?? '';
}

/** Save settings. URLs lose trailing slashes; an empty string turns a setting off. */
export function setSettings(values: Partial<Record<ServiceKey, string>>): void {
	const put = db().prepare(
		`INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
		 ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
	);
	const now = nowIso();
	db().transaction(() => {
		for (const [key, raw] of Object.entries(values)) {
			if (!SERVICE_KEYS.has(key) || raw === undefined) continue;
			const field = SERVICE_FIELDS.find((f) => f.key === key)!;
			let value = raw.trim();
			if (field.kind === 'url') value = value.replace(/\/+$/, '');
			put.run(key, SECRET.has(key) && value ? encryptSecret(value) : value, now);
		}
	})();
	cache = null;
}

/** What the Settings page may show: plain values, and only *whether* each
 *  secret is set. */
export function settingsForDisplay(): Record<string, { value?: string; set: boolean }> {
	const out: Record<string, { value?: string; set: boolean }> = {};
	for (const f of SERVICE_FIELDS) {
		const v = setting(f.key);
		out[f.key] = f.secret ? { set: Boolean(v) } : { value: v, set: Boolean(v) };
	}
	return out;
}

/**
 * Copy env values into the store for keys never stored before. Runs at boot;
 * idempotent. Returns the keys it copied.
 */
export function importEnvSettings(): string[] {
	const stored = new Set((db().prepare('SELECT key FROM settings').all() as { key: string }[]).map((r) => r.key));
	const fresh: Partial<Record<ServiceKey, string>> = {};
	for (const f of SERVICE_FIELDS) {
		const v = env[f.key];
		if (!stored.has(f.key) && v) fresh[f.key] = v;
	}
	if (Object.keys(fresh).length) setSettings(fresh);
	return Object.keys(fresh);
}

/** Tests: drop the in-memory copy. */
export function resetSettingsCache(): void {
	cache = null;
}
