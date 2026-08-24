/** Tests the native anime route on a throwaway show. Cleans up after itself. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};
const line=s=>console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);
const ID='224009'; // Ghosts of Beirut — live-action, definitively NOT anime

line('1. Does searching the ANIME route return non-anime TMDB shows?');
const sr=await call('GET','/api/v1/search/anime/?search=Ghosts%20of%20Beirut&source=tmdb&limit=3');
for (const r of (sr.j?.results??[]).slice(0,3))
  console.log(`   "${r.title}" media_type=${r.media_type} library_media_type=${r.library_media_type} identity=${r.identity_media_type} source=${r.source}`);

line('2. Track it via the ANIME route');
const add=await call('POST','/api/v1/media/anime/',{source:'tmdb',media_id:ID,status:'in_progress'});
console.log('   POST /api/v1/media/anime/ →', add.s);
console.log('   item:', JSON.stringify({title:add.j?.item?.title, media_type:add.j?.item?.media_type,
  library_media_type:add.j?.item?.library_media_type, item_id:add.j?.item_id}));

line('3. Which lists does it appear in? (anime_library_mode is currently "tv")');
for (const mt of ['anime','tv']) {
  const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  const hits=(r.j?.results??[]).map(x=>`${x.item?.title}[mt=${x.item?.media_type},lib=${x.item?.library_media_type}]`);
  console.log(`   /api/v1/media/${mt}/ → total=${r.j?.pagination?.total} ${hits.join(', ')||'(none)'}`);
}

line('4. Can episodes still be marked on an anime-routed show? (§12.1 trap)');
const w=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{});
console.log(`   POST watch via tv path → ${w.s}`, w.s>=400?JSON.stringify(w.j).slice(0,200):'ok');
if (w.s>=400) {
  const w2=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{library_media_type:'anime'});
  console.log(`   retry with library_media_type:anime → ${w2.s}`, w2.s>=400?JSON.stringify(w2.j).slice(0,200):'ok');
}

line('5. Cleanup');
await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`);
for (const mt of ['anime','tv']) {
  const d=await call('DELETE',`/api/v1/media/${mt}/tmdb/${ID}/`);
  console.log(`   DELETE /api/v1/media/${mt}/tmdb/${ID}/ → ${d.s}`);
}
for (const mt of ['anime','tv']) {
  const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  console.log(`   ${mt} list now: total=${r.j?.pagination?.total}`);
}
