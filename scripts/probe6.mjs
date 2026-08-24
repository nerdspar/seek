import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 const t=await r.text(); try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,200)}}};

console.log('A. Show detail — does it carry next_episode at runtime?');
const d=await get('/api/v1/media/tv/tmdb/95/');
console.log('   keys:', Object.keys(d.j).join(', '));
console.log('   next_episode present?', 'next_episode' in d.j, '| value:', JSON.stringify(d.j.next_episode));
console.log('   max_progress:', d.j.max_progress);

console.log('\nB. Can the list endpoint be narrowed to one show?');
for (const q of ['search=Buffy', 'search=Buffy%20the%20Vampire%20Slayer']) {
  const r=await get(`/api/v1/media/tv/?status=in_progress&progress=not_caught_up&${q}&limit=5`);
  console.log(`   ${q} → total=${r.j?.pagination?.total} titles=[${(r.j?.results??[]).map(x=>x.item?.title).join(' | ')}]`);
  const hit=(r.j?.results??[]).find(x=>String(x.item?.media_id)==='95');
  if (hit) console.log(`     matched by media_id: next=S${hit.next_episode?.season_number}E${hit.next_episode?.episode_number} progress=${hit.progress}/${hit.item?.number_of_pages}`);
}

console.log('\nC. Ambiguous-title check — how bad is `search` as an identifier?');
for (const q of ['ONE PIECE','The Seven Deadly Sins','Below Deck']) {
  const r=await get(`/api/v1/media/tv/?status=all&search=${encodeURIComponent(q)}&limit=10`);
  console.log(`   "${q}" → ${r.j?.pagination?.total} matches: ${(r.j?.results??[]).map(x=>`${x.item?.title}(${x.item?.media_id})`).join(', ')}`);
}
