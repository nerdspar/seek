/**
 * Read-only reconnaissance against the live Floppy instance.
 * Writes nothing. Run: node scripts/probe.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8')
		.split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
		.map((l) => {
			const i = l.indexOf('=');
			return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
		})
);

const BASE = (env.FLOPPY_URL || '').replace(/\/+$/, '');
const TOKEN = env.FLOPPY_TOKEN;
if (!BASE) throw new Error('FLOPPY_URL missing from .env');
if (!TOKEN) throw new Error('FLOPPY_TOKEN missing from .env — fill it in first.');

async function get(path, { anon = false } = {}) {
	const res = await fetch(`${BASE}${path}`, {
		headers: anon ? {} : { 'X-API-Key': TOKEN, Accept: 'application/json' },
		signal: AbortSignal.timeout(20_000)
	});
	const text = await res.text();
	let json;
	try {
		json = JSON.parse(text);
	} catch {
		json = text.slice(0, 300);
	}
	return { status: res.status, json };
}

const line = (s) => console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

line('1. Build (unauthenticated)');
console.log(JSON.stringify((await get('/api/v1/info/', { anon: true })).json, null, 2));

line('2. Token check — GET /api/v1/user/preferences/');
const prefs = await get('/api/v1/user/preferences/');
console.log('HTTP', prefs.status);
if (prefs.status !== 200) {
	console.log(JSON.stringify(prefs.json, null, 2));
	console.log('\n!! Token rejected. Everything below will fail.');
	process.exit(1);
}
console.log(JSON.stringify(prefs.json, null, 2).slice(0, 1200));

line('3. Watchlist query (spec §4.1) — tv, in_progress, not_caught_up');
const wl = await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=5');
console.log('HTTP', wl.status);
const payload = wl.json;
const rows = Array.isArray(payload) ? payload : (payload?.results ?? payload?.data ?? null);
console.log('envelope keys:', Array.isArray(payload) ? '(bare array)' : Object.keys(payload ?? {}));
console.log('row count:', Array.isArray(rows) ? rows.length : 'n/a');

if (Array.isArray(rows) && rows.length) {
	const r = rows[0];
	console.log('\nrow keys:', Object.keys(r));
	console.log('\nnext_episode:', JSON.stringify(r.next_episode));
	console.log('progress:', r.progress, '| status:', r.status, '| item_id:', r.item_id);
	console.log('\nitem keys:', r.item ? Object.keys(r.item) : null);
	console.log('\nitem (full, first row):');
	console.log(JSON.stringify(r.item, null, 2).slice(0, 2000));

	line('4. Does the list carry max_progress? (needed for the progress bar)');
	const hasMax = rows.map((x) => ({
		title: x.item?.title,
		progress: x.progress,
		max_in_row: x.max_progress ?? null,
		max_in_item: x.item?.max_progress ?? null
	}));
	console.table(hasMax);

	line('5. Undocumented endpoints the spec does not mention');
	for (const p of ['/api/v1/home/', '/api/v1/media/?status=in_progress&limit=3']) {
		const r2 = await get(p);
		const j = r2.json;
		console.log(
			`GET ${p} → ${r2.status} |`,
			Array.isArray(j) ? `array(${j.length})` : `keys: ${Object.keys(j ?? {}).join(', ')}`
		);
	}
} else {
	console.log('\nNo rows returned — check the status/progress filter values.');
	console.log(JSON.stringify(payload, null, 2).slice(0, 1500));
}
