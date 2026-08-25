import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(40000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);
const ID='224009';
const state=async(l)=>{const d=await call('GET',`/api/v1/media/tv/tmdb/${ID}/1/`);
  console.log(`  ${l}: seasonProgress=${d.j?.consumptions?.[0]?.progress ?? '—'}/${d.j?.max_progress} eps=[${(d.j?.related?.episodes??[]).map(e=>e.progress??0)}]`);};

line('1. Track E1 so the season exists (auto-created)');
console.log('  POST watch E1 →', (await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{})).s);
await state('after E1');

line('2. Now try season progress increase');
for (let i=0;i<3;i++) {
  const r=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/progress/`,{operation:'increase'});
  console.log(`  increase #${i+1} → ${r.s} progress=${r.j?.progress}`);
}
await state('after 3 increases');
const d=await call('GET',`/api/v1/media/tv/tmdb/${ID}/1/`);
console.log('  per-episode:', (d.j?.related?.episodes??[]).map(e=>`E${e.item?.episode_number}=${e.progress??0}`).join(' '));
console.log('  → does increasing SEASON progress mark individual episodes?',
  (d.j?.related?.episodes??[]).filter(e=>(e.progress??0)>0).length > 1 ? 'YES' : 'NO — season counter only');

line('3. DELETE the season: one call to clear it?');
const del=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/1/`);
console.log('  DELETE season →', del.s);
await state('after DELETE season');

line('4. Cleanup');
for (const p of [`/api/v1/media/tv/tmdb/${ID}/`]) console.log('  DELETE show →', (await call('DELETE',p)).s);
console.log('  tv total =', (await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=3')).j?.pagination?.total);
