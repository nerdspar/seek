import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(20000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};

// Ghosts of Beirut again — untracked throwaway, S1E1.
const ID='224009';
console.log('POST watch response shape:');
const p = await call('POST', `/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`, {});
console.log('  HTTP', p.s);
console.log(' ', JSON.stringify({progress:p.j?.progress, next_episode:p.j?.next_episode, status:p.j?.status,
  progress_scope:p.j?.progress_scope, item_media_type:p.j?.item?.media_type, item_title:p.j?.item?.title,
  item_season:p.j?.item?.season_number, item_episode:p.j?.item?.episode_number, parent_id:p.j?.parent_id, item_id:p.j?.item_id}, null, 2));
console.log('\n  → the response describes the EPISODE, not the show.');

console.log('\nShow row after the write (what the UI actually needs):');
const s = await call('GET', `/api/v1/media/tv/?status=in_progress&progress=not_caught_up&search=Ghosts%20of%20Beirut&limit=1`);
const row=s.j?.results?.[0];
console.log(' ', row ? JSON.stringify({title:row.item?.title, progress:row.progress, max:row.item?.number_of_pages, next:row.next_episode}) : '(not in list)');

await call('DELETE', `/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`);
await call('DELETE', `/api/v1/media/tv/tmdb/${ID}/`);
console.log('\ncleaned up.');
