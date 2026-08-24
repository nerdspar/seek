/**
 * READ-ONLY. Regenerates anime-list.txt — the reviewable input to the bucket
 * migration. Writes nothing to Floppy and touches no database.
 *
 * Anime means Japanese-produced animation, not animation generally. Floppy has
 * no such flag, and its metadata is wrong in both directions (it misses Naruto
 * and SPY x FAMILY; it marks Star Wars: Visions Japanese). So the classification
 * is an explicit curated list matched against the library by title, not a
 * heuristic — and anything genuinely arguable goes in a separate section for a
 * human to decide rather than being silently included.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const env = Object.fromEntries(
	readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
		.filter((l) => l.trim() && !l.trim().startsWith('#') && l.includes('='))
		.map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const B = env.FLOPPY_URL.replace(/\/+$/, ''), T = env.FLOPPY_TOKEN;
const get = async (p) => {
	const r = await fetch(B + p, { headers: { 'X-API-Key': T, Accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
	return { s: r.status, j: await r.json().catch(() => null) };
};

/** Japanese-produced animation. Matched case-insensitively as a prefix. */
const ANIME = [
	'Accel World',
	'Boruto: Naruto Next Generations',
	'Is It Wrong to Try to Pick Up Girls in a Dungeon?',
	'JUJUTSU KAISEN',
	'My Hero Academia',
	'Naruto',
	'Naruto Shippūden',
	'Re:ZERO',
	"Scum's Wish",
	'Shangri-La Frontier',
	'Solo Leveling',
	'Spice and Wolf',
	'SPY x FAMILY',
	'Sword Art Online',
	'That Time I Got Reincarnated as a Slime',
	'The Seven Deadly Sins',
	'The Slime Diaries'
];

/** Deliberately NOT auto-included — anime-adjacent but not Japanese-produced,
 *  or genuinely contested. Listed commented-out for a human to promote. */
const BORDERLINE = {
	'Star Wars: Visions': 'anthology by Japanese anime studios (S1); S2 is international',
	'Blood of Zeus': 'anime-styled, but produced by Powerhouse Animation (US)',
	'Twilight of the Gods': 'anime-styled, Xilam (France) for Netflix',
	'BLUE EYE SAMURAI': 'Japanese setting, French/American production',
	'Lord of Mysteries': 'Chinese donghua, not Japanese anime',
	'Tomb Raider: The Legend of Lara Croft': 'anime-styled, Powerhouse Animation (US)',
	'Pantheon': 'US production, Japanese-influenced style'
};

const norm = (s) => (s ?? '').toLowerCase().replace(/[‐-―]/g, '-').trim();
const isAnime = (t) => ANIME.some((a) => norm(t).startsWith(norm(a)));
const borderlineFor = (t) => Object.entries(BORDERLINE).find(([k]) => norm(t).startsWith(norm(k)));

let off = 0, all = [];
for (;;) {
	const { j } = await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`);
	all.push(...(j?.results ?? []));
	off += 100;
	if (!j?.pagination?.next || off > 800) break;
}

const shows = all.filter((r) => r.item?.title);
const picked = shows.filter((r) => isAnime(r.item.title)).sort((a, b) => a.item.title.localeCompare(b.item.title));
const border = shows.filter((r) => !isAnime(r.item.title) && borderlineFor(r.item.title))
	.sort((a, b) => a.item.title.localeCompare(b.item.title));

const seen = new Set();
const dedup = picked.filter((r) => { const k = `${r.item.source}:${r.item.media_id}`; if (seen.has(k)) return false; seen.add(k); return true; });

const row = (r) => `${r.item.source}:${r.item.media_id}\t${r.item.title}`;

writeFileSync(new URL('../anime-list.txt', import.meta.url), [
	'# Shows to move into the anime library bucket.',
	'#',
	'# Anime here means Japanese-produced animation. Western animation is NOT',
	'# included, even when Floppy tags it with the Animation genre.',
	'#',
	'# Lines starting with # are ignored. Only the leading source:media_id is read.',
	'# Delete anything you disagree with; uncomment a borderline line to include it.',
	'#',
	`# ---- Anime (${dedup.length}) ----`,
	...dedup.map(row),
	'#',
	`# ---- Borderline: NOT included, uncomment to add (${border.length}) ----`,
	...border.map((r) => `# ${row(r)}   <- ${borderlineFor(r.item.title)[1]}`),
	''
].join('\n'));

console.log(`anime-list.txt: ${dedup.length} anime, ${border.length} borderline (excluded by default).`);
console.log(`\nIncluded:`);
for (const r of dedup) console.log(`  ${r.item.title}`);
console.log(`\nBorderline, left out:`);
for (const r of border) console.log(`  ${r.item.title}  — ${borderlineFor(r.item.title)[1]}`);
console.log('\nRead-only — nothing written to Floppy.');
