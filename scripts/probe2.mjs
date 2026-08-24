import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const BASE=env.FLOPPY_URL.replace(/\/+$/,''), TOKEN=env.FLOPPY_TOKEN;
const get=async(p)=>{const r=await fetch(BASE+p,{headers:{'X-API-Key':TOKEN,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
  const t=await r.text(); try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,300)}}};
const line=s=>console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

line('A. Episode-count candidates per row (Hobi showed Outer Banks 40/50)');
const {j} = await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=12');
console.table(j.results.map(r=>({
  title: r.item?.title?.slice(0,26),
  progress: r.progress,
  number_of_pages: r.item?.number_of_pages ?? null,
  local_sec: r.item?.local_season_episode_count ?? null,
  scope: r.progress_scope,
  unit: r.progress_unit
})));

line('B. next_episode — full object, 4 rows. Is the episode TITLE in there?');
for (const r of j.results.slice(0,4)) {
  console.log(`${r.item?.title}\n  ${JSON.stringify(r.next_episode)}\n  item.image = ${r.item?.image}\n`);
}

line('C. pagination envelope');
console.log(JSON.stringify(j.pagination, null, 2));

line('D. Episode detail for the first row — where does the episode title live?');
const r0 = j.results[0], ne = r0.next_episode;
const ep = await get(`/api/v1/media/tv/${r0.item.source}/${r0.item.media_id}/${ne.season_number}/${ne.episode_number}/`);
console.log('HTTP', ep.s);
console.log('title:', JSON.stringify(ep.j?.title));
console.log('max_progress:', ep.j?.max_progress, '| consumptions_number:', ep.j?.consumptions_number);
console.log('details:', JSON.stringify(ep.j?.details, null, 2)?.slice(0,700));
console.log('consumptions:', JSON.stringify(ep.j?.consumptions)?.slice(0,400));

line('E. Show detail — does it carry max_progress + episode titles?');
const sh = await get(`/api/v1/media/tv/${r0.item.source}/${r0.item.media_id}/`);
console.log('HTTP', sh.s, '| keys:', Object.keys(sh.j??{}).join(', '));
console.log('max_progress:', sh.j?.max_progress);
console.log('details keys:', Object.keys(sh.j?.details ?? {}).join(', '));

line('F. Season detail — max_progress + per-episode titles?');
const se = await get(`/api/v1/media/tv/${r0.item.source}/${r0.item.media_id}/${ne.season_number}/`);
console.log('HTTP', se.s, '| max_progress:', se.j?.max_progress);
console.log('details keys:', Object.keys(se.j?.details ?? {}).join(', '));
const eps = se.j?.details?.episodes;
if (Array.isArray(eps)) { console.log(`episodes[] length ${eps.length}; first:`); console.log(JSON.stringify(eps[0], null, 2).slice(0,600)); }
