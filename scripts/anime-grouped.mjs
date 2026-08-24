/** Can a PROPER grouped-anime item (media_type=tv, library_media_type=anime)
 *  be created and fully managed through the API? Uses the throwaway show. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(74)}\n${s}\n${'═'.repeat(74)}`);
const ID='224009';

line('0. Current anime library state');
const a0=await call('GET','/api/v1/media/anime/?status=all&limit=10');
console.log(`  total=${a0.j?.pagination?.total} ` + (a0.j?.results??[]).map(r=>`${r.item?.title}[${r.item_id}]`).join(', '));

line('1. POST /api/v1/media/tv/ with library_media_type=anime');
const add=await call('POST','/api/v1/media/tv/',{source:'tmdb', media_id:ID, progress:0, status:1, library_media_type:'anime'});
console.log(`  → ${add.s}`, add.s>=400?JSON.stringify(add.j).slice(0,200)
  :JSON.stringify({item_id:add.j?.item_id, media_type:add.j?.item?.media_type, library:add.j?.item?.library_media_type}));

line('2. Which lists does it appear in? (anime_library_mode is currently "tv")');
for (const mt of ['tv','anime']) {
  const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  console.log(`  /api/v1/media/${mt}/ → total=${r.j?.pagination?.total} ` +
    (r.j?.results??[]).map(x=>`[mt=${x.item?.media_type},lib=${x.item?.library_media_type}]`).join(', '));
}

line('3. Do the TV routes work on it? (this is what Seek needs)');
const det=await call('GET',`/api/v1/media/tv/tmdb/${ID}/`);
console.log(`  GET detail            → ${det.s} max_progress=${det.j?.max_progress} title="${det.j?.title}"`);
const w=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{});
console.log(`  POST episode watch    → ${w.s} ${w.s>=400?JSON.stringify(w.j).slice(0,150):'ok'}`);
const lst=await call('GET','/api/v1/media/tv/?status=in_progress&progress=not_caught_up&search=Ghosts&limit=5');
const row=(lst.j?.results??[])[0];
console.log(`  list row after mark   → progress=${row?.progress} next=${row?.next_episode?`S${row.next_episode.season_number}E${row.next_episode.episode_number}`:'null'} lib=${row?.item?.library_media_type}`);
const u=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`);
console.log(`  DELETE (undo) watch   → ${u.s}`);

line('4. Can it be reclassified in place? PATCH library_media_type on an existing tv show');
const pat=await call('PATCH',`/api/v1/media/tv/tmdb/${ID}/`,{library_media_type:'tv'});
console.log(`  PATCH library_media_type=tv → ${pat.s} ${pat.s>=400?JSON.stringify(pat.j).slice(0,180):`now lib=${pat.j?.item?.library_media_type}`}`);
const chk=await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=5');
console.log(`  library_media_type now = ${(chk.j?.results??[])[0]?.item?.library_media_type}`);

line('5. Cleanup');
const d=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/`);
console.log(`  DELETE tv → ${d.s}`);
for (const mt of ['tv','anime']) {
  const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  console.log(`  ${mt} total now = ${r.j?.pagination?.total}`);
}
