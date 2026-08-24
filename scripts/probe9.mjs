import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,300)}}};
const line=s=>console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);

const wl=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=100');
const rs=wl.j?.results??[];

line('A. What a SEASON row looks like vs a SHOW row');
const season=rs.find(r=>r.item?.library_media_type==='season');
const show=rs.find(r=>r.item?.library_media_type==='tv');
for (const [lbl,r] of [['SEASON',season],['SHOW',show]]) {
  if(!r) continue;
  console.log(`  ${lbl}: item_id=${r.item_id} parent_id=${r.parent_id}`);
  console.log(`    title="${r.item?.title}" media_id=${r.item?.media_id} season_number=${r.item?.season_number}`);
  console.log(`    progress=${r.progress} number_of_pages=${r.item?.number_of_pages} next=${JSON.stringify(r.next_episode)}`);
}

line('B. Do season rows DUPLICATE a show already in the list?');
const shows=rs.filter(r=>r.item?.library_media_type==='tv');
const seasons=rs.filter(r=>r.item?.library_media_type==='season');
const showIds=new Set(shows.map(r=>String(r.item?.media_id)));
const dup=seasons.filter(s=>showIds.has(String(s.item?.media_id)));
console.log(`  ${shows.length} shows, ${seasons.length} seasons`);
console.log(`  seasons whose parent show is ALSO in the list: ${dup.length}`);
console.log('  examples:', dup.slice(0,6).map(s=>`${s.item?.title} S${s.item?.season_number}`).join(' | '));
console.log('  seasons with NO parent show row:', seasons.filter(s=>!showIds.has(String(s.item?.media_id))).slice(0,8).map(s=>`${s.item?.title} S${s.item?.season_number}`).join(' | ')||'(none)');

line('C. Can the API filter them out server-side?');
for (const q of ['media_type=tv','format=tv','library_media_type=tv','type=tv']) {
  const r=await get(`/api/v1/media/tv/?status=in_progress&progress=not_caught_up&${q}&limit=100`);
  const c={}; for(const x of (r.j?.results??[])) c[x.item?.library_media_type]=(c[x.item?.library_media_type]??0)+1;
  console.log(`  ?${q.padEnd(24)} HTTP ${r.s} total=${r.j?.pagination?.total} breakdown=${JSON.stringify(c)}`);
}

line('D. Import tasks / did movies land anywhere?');
for (const p of ['/api/v1/media/?status=all&limit=1','/api/v1/media/movie/?status=all&limit=1']) {
  const r=await get(p); console.log(`  ${p} → total=${r.j?.pagination?.total}`);
}
const allm=await get('/api/v1/media/?status=all&limit=200');
const types={}; for(const x of (allm.j?.results??[])) types[x.item?.library_media_type]=(types[x.item?.library_media_type]??0)+1;
console.log('  library_media_type across /api/v1/media/ (first 200):', JSON.stringify(types));
