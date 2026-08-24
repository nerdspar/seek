/** READ-ONLY. Regenerates anime-list.txt, the reviewable input to the bucket
 *  migration. Writes nothing to Floppy and touches no database. */
import { readFileSync, writeFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};

let off=0, all=[];
for(;;){ const {j}=await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`); all.push(...(j?.results??[])); off+=100; if(!j?.pagination?.next||off>800) break; }
const shows = all.filter(r => r.item?.library_media_type !== 'season' || true);
const anim = shows.filter(r=>(r.item?.genres??[]).includes('Animation'));
const ja = r => (r.item?.languages??[]).includes('Japanese') || r.item?.country==='Japan';
const A = anim.filter(ja).sort((a,b)=>a.item.title.localeCompare(b.item.title));
const Bx = anim.filter(r=>!ja(r)).sort((a,b)=>a.item.title.localeCompare(b.item.title));
const row = r => `${r.item.source}:${r.item.media_id}\t${r.item.title}`;

writeFileSync(new URL('../anime-list.txt', import.meta.url), [
'# Shows to move into the anime library bucket.',
'#',
'# Floppy has no content-based anime detection, so this is your call, not a',
'# detection. Every Animation-genre show is listed. DELETE any line you do NOT',
'# want moved. Add lines for anything missing, in the same source:media_id form.',
'# Lines starting with # are ignored; only the leading source:media_id is read.',
'#',
`# ---- Floppy flags these Japanese (${A.length}) ----`,
...A.map(row),
'#',
`# ---- Other Animation-genre shows (${Bx.length}) ----`,
'# Floppy has no Japanese flag on these, but several ARE anime (Naruto,',
'# SPY x FAMILY, Boruto, My Hero Academia...). Keep those, delete the rest.',
...Bx.map(row),
''].join('\n'));
console.log(`anime-list.txt regenerated: ${anim.length} shows (${A.length} Japanese-flagged, ${Bx.length} not).`);
console.log('Read-only — nothing written to Floppy.');
