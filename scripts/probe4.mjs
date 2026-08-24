import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(25000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,200)}}};
const line=s=>console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);

line('A. Is `total` stable across limits? (pagination correctness)');
for (const lim of [4,12,20,50]) {
  const {j}=await get(`/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=${lim}`);
  console.log(`  limit=${String(lim).padEnd(3)} total=${j?.pagination?.total} returned=${j?.results?.length}`);
}

line('B. Movie library — any movies at all, under any status?');
for (const st of ['all','planning','in_progress','completed','paused','dropped']) {
  const {j}=await get(`/api/v1/media/movie/?status=${st}&limit=1`);
  console.log(`  movie status=${st.padEnd(12)} total=${j?.pagination?.total}`);
}

line('C. Anime — can it be distinguished inside the tv bucket?');
const {j}=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=60');
const known=['ONE PIECE','Solo Leveling','Re:ZERO','That Time','Frieren','Dan Da Dan','Jujutsu'];
for (const r of (j.results??[])) {
  const t=r.item?.title??'';
  if (known.some(k=>t.toLowerCase().includes(k.toLowerCase().slice(0,7)))) {
    console.log(`  "${t}"`);
    console.log(`     library_media_type=${r.item?.library_media_type} media_type=${r.item?.media_type} format=${r.item?.format} source=${r.item?.source}`);
    console.log(`     genres=${JSON.stringify(r.item?.genres)} themes=${JSON.stringify(r.item?.themes)} country=${r.item?.country} source_material=${r.item?.source_material}`);
  }
}
line('D. Does a genre/country filter isolate anime?');
for (const q of ['genre=Animation','country=JP','country=Japan']) {
  const {s,j}=await get(`/api/v1/media/tv/?status=in_progress&progress=not_caught_up&${q}&limit=60`);
  console.log(`  ${q.padEnd(16)} HTTP ${s} total=${j?.pagination?.total} → ${(j?.results??[]).slice(0,6).map(r=>r.item?.title).join(', ')}`);
}
