/** How do you mark/unmark a WHOLE season? Throwaway show, cleaned up after. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(40000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);
const ID='224009'; // Ghosts of Beirut, 1 season, 4 episodes, untracked

const state=async(label)=>{
  const d=await call('GET',`/api/v1/media/tv/tmdb/${ID}/1/`);
  const eps=(d.j?.related?.episodes??[]).map(e=>e.progress??0);
  console.log(`  ${label}: season progress=${d.j?.consumptions?.[0]?.progress ?? 'none'}/${d.j?.max_progress} episodes=[${eps}]`);
};

line('Baseline');
await state('before');

line('A. POST /{season}/progress/ — what operations does it take?');
for (const body of [{operation:'increase'},{operation:'increase',value:4},{progress:4},{operation:'max'}]) {
  const r=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/progress/`,body);
  console.log(`  ${r.s}  ${JSON.stringify(body).padEnd(34)} → ${r.s<400?`progress=${r.j?.progress}`:JSON.stringify(r.j).slice(0,110)}`);
}
await state('after progress ops');

line('B. Does bumping season progress mark the individual episodes?');
const d=await call('GET',`/api/v1/media/tv/tmdb/${ID}/1/`);
console.log('  episode progress values:', (d.j?.related?.episodes??[]).map(e=>`E${e.item?.episode_number}=${e.progress??0}`).join(' '));

line('C. DELETE the season — does it clear everything?');
const del=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/1/`);
console.log('  DELETE season →', del.s);
await state('after season DELETE');

line('Cleanup');
const c=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/`);
console.log('  DELETE show →', c.s);
const fin=await call('GET',`/api/v1/media/tv/?status=all&search=Ghosts&limit=3`);
console.log('  tv list total =', fin.j?.pagination?.total, '(expect 0)');
