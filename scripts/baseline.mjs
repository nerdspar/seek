import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(20000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};
const {j}=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&sort=updated&direction=desc&limit=1');
const r=j.results[0], ne=r.next_episode;
const id=r.item.media_id, S=ne.season_number, E=ne.episode_number;
console.log(`Top row: "${r.item.title}" tmdb=${id} next=S${S}E${E} progress=${r.progress}/${r.item.number_of_pages}`);
const ep=await get(`/api/v1/media/tv/tmdb/${id}/${S}/${E}/`);
console.log(`  episode "${ep.j.title}" consumptions=${ep.j.consumptions_number} ids=[${(ep.j.consumptions??[]).map(c=>c.consumption_id).join(',')}]`);
console.log(JSON.stringify({id,S,E,progress:r.progress}));
