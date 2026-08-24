import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,200)}}};

console.log('Segment behaviour — anime_library_mode is "tv", so where does anime land?\n');
for (const mt of ['tv','movie','anime']) {
  const q = `/api/v1/media/${mt}/?status=in_progress&progress=not_caught_up&limit=4`;
  const {s,j} = await get(q);
  const rows = j?.results ?? [];
  console.log(`${mt.padEnd(6)} HTTP ${s} total=${j?.pagination?.total ?? '?'}`);
  for (const r of rows) console.log(`         ${(r.item?.title??'').slice(0,34).padEnd(34)} lib=${r.item?.library_media_type} mt=${r.item?.media_type} next=${r.next_episode?`S${r.next_episode.season_number}E${r.next_episode.episode_number}`:'—'} prog=${r.progress}/${r.item?.number_of_pages}`);
  console.log();
}
console.log('Movies without the progress filter:');
const m = await get('/api/v1/media/movie/?status=in_progress&limit=4');
console.log(`  total=${m.j?.pagination?.total}`, (m.j?.results??[]).map(r=>`${r.item?.title} prog=${r.progress}`).join(' | ') || '(none)');
const mp = await get('/api/v1/media/movie/?status=planning&limit=4');
console.log(`  planning total=${mp.j?.pagination?.total}`, (mp.j?.results??[]).map(r=>r.item?.title).join(' | ').slice(0,140));
