/** Determines whether native anime is workable for Seek.
 *  Reuses the EXISTING stray tmdb-anime item rather than creating new
 *  undeletable ones. The MAL path is tested with real adds (deletable). */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(74)}\n${s}\n${'═'.repeat(74)}`);

line('PATH A — grouped anime (TMDB via anime route). Using the existing stray.');
const before=await call('GET','/api/v1/media/anime/?status=all&limit=10');
const stray=(before.j?.results??[]).find(r=>String(r.item?.media_id)==='224009');
console.log(`  anime row before: progress=${stray?.progress} status=${stray?.status} next_episode=${JSON.stringify(stray?.next_episode)}`);
console.log(`  tv list has it? total=${(await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=5')).j?.pagination?.total}`);

console.log('\n  Marking S01E01 through the tv watch path…');
const w=await call('POST','/api/v1/media/tv/tmdb/224009/1/episodes/1/watch/',{});
console.log(`  → ${w.s}  item_media_type=${w.j?.item?.media_type} library=${w.j?.item?.library_media_type} item_id=${w.j?.item_id}`);

const aAfter=await call('GET','/api/v1/media/anime/?status=all&limit=10');
const sAfter=(aAfter.j?.results??[]).find(r=>String(r.item?.media_id)==='224009');
const tvAfter=await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=5');
console.log(`\n  anime row after : progress=${sAfter?.progress} next=${JSON.stringify(sAfter?.next_episode)}`);
console.log(`  tv list after   : total=${tvAfter.j?.pagination?.total} ` +
  (tvAfter.j?.results??[]).map(x=>`${x.item?.title}[lib=${x.item?.library_media_type}] progress=${x.progress} next=S${x.next_episode?.season_number}E${x.next_episode?.episode_number}`).join(', '));
console.log(sAfter?.progress > 0
  ? '  VERDICT: the mark advanced the ANIME row.'
  : '  VERDICT: the mark did NOT advance the anime row — it created/updated a separate TV row.');

// undo the play and remove the duplicate tv row again
await call('DELETE','/api/v1/media/tv/tmdb/224009/1/episodes/1/watch/');
await call('DELETE','/api/v1/media/tv/tmdb/224009/');

line('PATH B — MAL-sourced anime (the source VALID_SOURCES actually allows)');
const s=await call('GET','/api/v1/search/anime/?search=Frieren&source=mal&limit=3');
for (const r of (s.j?.results??[]).slice(0,3))
  console.log(`  "${r.title}" media_id=${r.media_id} media_type=${r.media_type} source=${r.source} lib=${r.library_media_type}`);
const cand=(s.j?.results??[])[0];
if (!cand) { console.log('  no MAL results — aborting path B'); process.exit(0); }
const MID=String(cand.media_id);

console.log(`\n  Tracking "${cand.title}" (mal:${MID}) …`);
const add=await call('POST','/api/v1/media/anime/',{source:'mal', media_id:MID, progress:0, status:1});
console.log(`  POST → ${add.s}`, add.s>=400?JSON.stringify(add.j).slice(0,180):`item_id=${add.j?.item_id} lib=${add.j?.item?.library_media_type}`);

if (add.s<400) {
  for (const [label,p] of [['GET detail',`/api/v1/media/anime/mal/${MID}/`],['GET list','/api/v1/media/anime/?status=all&limit=10']]) {
    const r=await call('GET',p);
    if (label==='GET detail') console.log(`  ${label} → ${r.s} max_progress=${r.j?.max_progress} title="${r.j?.title}" details_keys=${Object.keys(r.j?.details??{}).join(',')}`);
    else { const row=(r.j?.results??[]).find(x=>String(x.item?.media_id)===MID); console.log(`  ${label} → next_episode=${JSON.stringify(row?.next_episode)} progress=${row?.progress} number_of_pages=${row?.item?.number_of_pages}`); }
  }
  console.log('\n  Episode-level marking on a MAL anime:');
  const ew=await call('POST',`/api/v1/media/tv/mal/${MID}/1/episodes/1/watch/`,{});
  console.log(`  POST tv-path watch → ${ew.s} ${ew.s>=400?JSON.stringify(ew.j).slice(0,160):'ok'}`);
  const pr=await call('POST',`/api/v1/media/anime/mal/${MID}/progress/`,{operation:'increase'});
  console.log(`  POST anime progress increase → ${pr.s} ${pr.s>=400?JSON.stringify(pr.j).slice(0,160):`progress=${pr.j?.progress}`}`);

  console.log('\n  Cleanup:');
  const d=await call('DELETE',`/api/v1/media/anime/mal/${MID}/`);
  console.log(`  DELETE /api/v1/media/anime/mal/${MID}/ → ${d.s} ${d.s>=400?JSON.stringify(d.j).slice(0,120):'removed'}`);
}
