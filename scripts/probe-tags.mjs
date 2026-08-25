/** READ-ONLY. Tags (§11) and filter facets (§4.6). */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(40000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);

line('1. Existing tags');
const tags=await get('/api/v1/tags/');
console.log('HTTP', tags.s, '| keys:', Object.keys(tags.j??{}).join(', '));
console.log(JSON.stringify(tags.j).slice(0,500));

line('2. Tags on one show');
const t1=await get('/api/v1/media/tv/tmdb/95/tags/');
console.log('HTTP', t1.s, JSON.stringify(t1.j).slice(0,300));

line('3. Status counts (for the status filter)');
for (const st of ['planning','in_progress','paused','completed','dropped']) {
  const r=await get(`/api/v1/media/tv/?status=${st}&limit=1`);
  console.log(`  tv ${st.padEnd(12)} ${r.j?.pagination?.total}`);
}
for (const st of ['all','completed']) {
  const r=await get(`/api/v1/media/movie/?status=${st}&limit=1`);
  console.log(`  movie ${st.padEnd(9)} ${r.j?.pagination?.total}`);
}

line('4. What platforms exist in the library? (platform[] filter)');
let off=0, plats=new Map();
for(;;){ const {j}=await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`);
  for (const r of (j?.results??[])) for (const p of (r.item?.platforms??[])) {
    const name = typeof p==='string'?p:(p?.name??JSON.stringify(p));
    plats.set(name,(plats.get(name)??0)+1);
  }
  off+=100; if(!j?.pagination?.next||off>500) break; }
const sorted=[...plats.entries()].sort((a,b)=>b[1]-a[1]);
console.log(`  ${sorted.length} distinct platforms`);
for (const [n,c] of sorted.slice(0,14)) console.log(`    ${String(c).padStart(4)}  ${n}`);

line('5. Does platform[] actually filter?');
if (sorted.length) {
  const p=sorted[0][0];
  const r=await get(`/api/v1/media/tv/?status=all&platform=${encodeURIComponent(p)}&limit=3`);
  console.log(`  ?platform=${p} → total=${r.j?.pagination?.total}`, (r.j?.results??[]).map(x=>x.item?.title).join(', ').slice(0,90));
}
