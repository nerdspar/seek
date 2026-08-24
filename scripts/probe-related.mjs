import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};
const line=s=>console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);

line('SHOW related — where the season list actually lives');
const d=await get('/api/v1/media/tv/tmdb/95/');
const rel=d.j.related;
console.log('related keys:', Object.keys(rel??{}).join(', '));
for (const [k,v] of Object.entries(rel??{})) console.log(`  related.${k}: ${Array.isArray(v)?`array(${v.length})`:typeof v}`);
const seasons=rel?.seasons;
if (Array.isArray(seasons)) {
  console.log('\nseason entry keys:', Object.keys(seasons[0]).join(', '));
  console.log('\nfirst 3 seasons — does each carry progress?');
  for (const s of seasons.slice(0,3)) {
    console.log(`  "${s.item?.title}" season_number=${s.item?.season_number} id=${s.id} progress=${s.progress} status=${s.status} max?=${s.item?.number_of_pages} next=${JSON.stringify(s.next_episode)}`);
  }
  console.log('\nfull first entry:'); console.log(JSON.stringify(seasons[0],null,1).slice(0,900));
}

line('SEASON related — where the episode list lives');
const se=await get('/api/v1/media/tv/tmdb/95/6/');
const srel=se.j.related;
console.log('related keys:', Object.keys(srel??{}).join(', '));
for (const [k,v] of Object.entries(srel??{})) console.log(`  related.${k}: ${Array.isArray(v)?`array(${v.length})`:typeof v}`);
const eps = srel?.episodes;
if (Array.isArray(eps)) {
  console.log('\nepisode entry keys:', Object.keys(eps[0]).join(', '));
  console.log('\nfirst 4 episodes — watched state and air date present?');
  for (const e of eps.slice(0,4)) {
    const it=e.item??e;
    console.log(`  E${it.episode_number ?? e.episode_number}  "${it.title ?? e.title}"  watched=${e.progress ?? e.consumptions_number ?? '?'} air=${it.release_datetime ?? e.air_date ?? '?'} runtime=${it.runtime_minutes ?? '?'}`);
  }
  console.log('\nfull first episode entry:'); console.log(JSON.stringify(eps[0],null,1).slice(0,900));
}
