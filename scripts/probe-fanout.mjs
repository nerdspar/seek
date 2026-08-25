/** READ-ONLY. What does an 89-way concurrent fan-out do to Floppy? */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const timed=async p=>{const t=Date.now();
 try{const r=await fetch(B+p,{headers:{'X-API-Key':T},signal:AbortSignal.timeout(120000)}); await r.text();
   return {ms:Date.now()-t, s:r.status};}catch(e){return {ms:Date.now()-t, s:'ERR '+e.name}}};
const line=s=>console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);

// Real episode coordinates from the watchlist.
const list=await (await fetch(B+'/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=100',{headers:{'X-API-Key':T}})).json();
const eps=(list.results||[]).filter(r=>r.next_episode).map(r=>
  `/api/v1/media/tv/${r.item.source}/${r.item.media_id}/${r.next_episode.season_number}/${r.next_episode.episode_number}/`);
console.log(`episode lookups available: ${eps.length}`);

for (const n of [10, 30, eps.length]) {
  line(`${n}-way concurrent episode lookups`);
  const t0=Date.now();
  const rs=await Promise.all(eps.slice(0,n).map(timed));
  const ok=rs.filter(r=>r.s===200).length;
  const errs=rs.filter(r=>String(r.s).startsWith('ERR'));
  console.log(`  wall clock ${Date.now()-t0}ms | ok ${ok}/${n} | errors ${errs.length}`);
  console.log(`  slowest ${Math.max(...rs.map(r=>r.ms))}ms | median ${rs.map(r=>r.ms).sort((a,b)=>a-b)[Math.floor(n/2)]}ms`);
  if (errs.length) console.log('  error kinds:', [...new Set(errs.map(e=>e.s))].join(', '));

  // Can Floppy still serve anything else while that is in flight?
  const probe = timed('/api/v1/info/');
  const [p] = await Promise.all([probe]);
  console.log(`  /api/v1/info/ right after: ${p.ms}ms ${p.s}`);
}

line('Worst case: full fan-out WHILE the 200-row list runs');
const t0=Date.now();
const [listR, ...fan] = await Promise.all([
  timed('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&sort=updated&direction=desc&limit=200'),
  ...eps.map(timed)
]);
console.log(`  wall clock ${Date.now()-t0}ms | list ${listR.ms}ms | fan slowest ${Math.max(...fan.map(r=>r.ms))}ms`);
console.log(`  fan errors: ${fan.filter(r=>String(r.s).startsWith('ERR')).length}`);
