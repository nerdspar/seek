/** Read-only. Produces a reviewable candidate list for an `anime` tag.
 *  Writes nothing to Floppy. */
import { readFileSync, writeFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};

let off=0, all=[];
for(;;){ const {j}=await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`); all.push(...(j?.results??[])); off+=100; if(!j?.pagination?.next||off>800) break; }
const anim=all.filter(r=>(r.item?.genres??[]).includes('Animation'));

const ja = r => (r.item?.languages??[]).includes('Japanese') || r.item?.country==='Japan';
const strong = anim.filter(ja).sort((a,b)=>a.item.title.localeCompare(b.item.title));
const rest   = anim.filter(r=>!ja(r)).sort((a,b)=>a.item.title.localeCompare(b.item.title));

const line = r => `${r.item.source}:${r.item.media_id}  ${r.item.title}`;
const out = [
  '# Candidate `anime` tag list — REVIEW BEFORE APPLYING',
  '#',
  '# Floppy has no content-based anime classification, so this is a judgement call,',
  '# not a detection. Every Animation-genre show in the library is listed. Delete any',
  '# line you do NOT want tagged `anime`; add lines for anything missing.',
  '# Format: source:media_id  Title   (only source:media_id is read)',
  '',
  `# ── Flagged Japanese by Floppy metadata (${strong.length}) ──`,
  ...strong.map(line),
  '',
  `# ── Other Animation-genre shows (${rest.length}) — Floppy has no Japanese flag on`,
  '#    these, but several ARE anime (Naruto, SPY x FAMILY, Boruto…). Floppy metadata',
  '#    is simply missing the language. Keep the anime, delete the Western animation.',
  ...rest.map(line),
  ''
].join('\n');

writeFileSync(new URL('../anime-candidates.txt', import.meta.url), out);
console.log(`Wrote anime-candidates.txt — ${anim.length} Animation-genre shows (${strong.length} Japanese-flagged, ${rest.length} not).`);
console.log('Nothing was written to Floppy.');
