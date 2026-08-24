import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};
const ID='224009';
const line=s=>console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

line('Add via ANIME route with progress supplied');
const a=await call('POST','/api/v1/media/anime/',{source:'tmdb', media_id:ID, progress:0, status:1});
console.log(`  ${a.s}`, a.s>=400?JSON.stringify(a.j).slice(0,200):JSON.stringify({title:a.j?.item?.title, media_type:a.j?.item?.media_type, library_media_type:a.j?.item?.library_media_type, item_id:a.j?.item_id}));

if (a.s<400) {
  line('Which list does it land in? (anime_library_mode = "tv")');
  for (const mt of ['anime','tv']) {
    const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
    console.log(`  /api/v1/media/${mt}/ → total=${r.j?.pagination?.total} ` +
      (r.j?.results??[]).map(x=>`${x.item?.title}[mt=${x.item?.media_type},lib=${x.item?.library_media_type}]`).join(', '));
  }

  line('Does the tv-path watch call still work on an anime-filed show? (§12.1)');
  const w=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{});
  console.log(`  POST watch (tv path) → ${w.s}`, w.s>=400?JSON.stringify(w.j).slice(0,220):'ok');
  if (w.s>=400) {
    const w2=await call('POST',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`,{library_media_type:'anime'});
    console.log(`  retry with {library_media_type:"anime"} → ${w2.s}`, w2.s>=400?JSON.stringify(w2.j).slice(0,220):'OK — the §12.1 retry is the fix');
  }
  await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/1/episodes/1/watch/`);
}

line('Cleanup');
for (const mt of ['anime','tv']) { const d=await call('DELETE',`/api/v1/media/${mt}/tmdb/${ID}/`); console.log(`  DELETE ${mt} → ${d.s}`); }
for (const mt of ['anime','tv']) { const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`); console.log(`  ${mt} total now = ${r.j?.pagination?.total}`); }
