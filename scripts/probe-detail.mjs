/** READ-ONLY. Shapes needed for step 4: show page, season list, episode sheet. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};
const line=s=>console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);
const ID='95'; // Buffy — 7 seasons, partially watched

line('SHOW detail: /api/v1/media/tv/tmdb/95/');
const d=await get(`/api/v1/media/tv/tmdb/${ID}/`);
console.log('top keys:', Object.keys(d.j).join(', '));
console.log('\nscalars:', JSON.stringify({title:d.j.title, max_progress:d.j.max_progress, score:d.j.score,
  score_count:d.j.score_count, genres:d.j.genres, tracked:d.j.tracked, consumptions_number:d.j.consumptions_number,
  image:(d.j.image||'').slice(0,60)}, null, 1));
console.log('\ndetails keys:', Object.keys(d.j.details??{}).join(', '));
for (const k of ['format','status','first_air_date','last_air_date','runtime','studios','country','languages','last_episode_season','next_episode_season'])
  if (k in (d.j.details??{})) console.log(`  details.${k} =`, JSON.stringify(d.j.details[k]).slice(0,120));

const seasons=d.j.details?.seasons;
console.log('\ndetails.seasons:', Array.isArray(seasons)?`array(${seasons.length})`:typeof seasons);
if (Array.isArray(seasons)) { console.log('  [0] keys:', Object.keys(seasons[0]).join(', ')); console.log('  [0]:', JSON.stringify(seasons[0]).slice(0,400)); }
const eps=d.j.details?.episodes;
console.log('\ndetails.episodes:', Array.isArray(eps)?`array(${eps.length})`:typeof eps);
if (Array.isArray(eps)&&eps.length) console.log('  [0]:', JSON.stringify(eps[0]).slice(0,300));

console.log('\ncast:', Array.isArray(d.j.cast)?`array(${d.j.cast.length})`:typeof d.j.cast);
if (d.j.cast?.[0]) console.log('  [0]:', JSON.stringify(d.j.cast[0]).slice(0,240));
console.log('related:', JSON.stringify(d.j.related).slice(0,220));
console.log('\nconsumptions (per-season progress?):', JSON.stringify(d.j.consumptions).slice(0,400));

line('SEASON detail: /api/v1/media/tv/tmdb/95/6/');
const se=await get(`/api/v1/media/tv/tmdb/${ID}/6/`);
console.log('top keys:', Object.keys(se.j).join(', '));
console.log('max_progress:', se.j.max_progress, '| title:', JSON.stringify(se.j.title), '| tracked:', se.j.tracked);
console.log('details keys:', Object.keys(se.j.details??{}).join(', '));
const sEps=se.j.details?.episodes;
console.log('details.episodes:', Array.isArray(sEps)?`array(${sEps.length})`:typeof sEps);
if (Array.isArray(sEps)&&sEps.length) {
  console.log('  [0] keys:', Object.keys(sEps[0]).join(', '));
  console.log('  [0]:', JSON.stringify(sEps[0]).slice(0,420));
}
console.log('\nconsumptions:', JSON.stringify(se.j.consumptions).slice(0,300));
console.log('consumptions_number:', se.j.consumptions_number);
