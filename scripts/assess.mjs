/** READ-ONLY damage assessment. Writes nothing. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text(); try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,200)}}};

console.log('Ghosts of Beirut (tmdb 224009) — the throwaway used for probing:');
for (const mt of ['tv','anime','movie','season','episode']) {
  const r=await get(`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  console.log(`  /api/v1/media/${mt}/  total=${r.j?.pagination?.total ?? r.s}`);
}
const d=await get('/api/v1/media/tv/tmdb/224009/');
console.log(`  GET tv detail → ${d.s} tracked=${d.j?.tracked} consumptions=${d.j?.consumptions_number}`);
const ep=await get('/api/v1/media/tv/tmdb/224009/1/1/');
console.log(`  GET S01E01    → ${ep.s} tracked=${ep.j?.tracked} consumptions=${ep.j?.consumptions_number}`);

console.log('\nWhole-library totals (should be unchanged from baseline 370):');
const all=await get('/api/v1/media/?status=all&limit=1');
console.log(`  /api/v1/media/ total = ${all.j?.pagination?.total}`);
for (const mt of ['tv','anime','movie']) {
  const r=await get(`/api/v1/media/${mt}/?status=all&limit=1`);
  console.log(`  ${mt}: ${r.j?.pagination?.total}`);
}
const wl=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=1');
console.log(`  watchlist (in_progress, not_caught_up): ${wl.j?.pagination?.total}`);

console.log('\nDoes it show anywhere user-visible? (history / recent)');
const h=await get('/api/v1/history/?limit=3');
const recent=(h.j?.results??[]).flatMap(d=>(d.entries??[]).map(e=>e.item?.title));
console.log('  most recent history titles:', recent.slice(0,6).join(', '));
