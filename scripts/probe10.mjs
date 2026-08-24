import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,300)}}};

const wl=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=100');
const seasons=(wl.j?.results??[]).filter(r=>r.item?.library_media_type==='season');
console.log('Season-scoped rows: does show detail recover max_progress?\n');
for (const s of seasons.slice(0,8)) {
  const d=await get(`/api/v1/media/tv/tmdb/${s.item.media_id}/`);
  console.log(`  ${(s.item.title??'').padEnd(28).slice(0,28)} list.progress=${String(s.progress).padStart(3)} list.number_of_pages=${s.item.number_of_pages} → detail.max_progress=${d.j?.max_progress}  progress_scope=${s.progress_scope}`);
}
console.log('\nFor comparison, a normal show row:');
const show=(wl.j?.results??[]).find(r=>r.item?.library_media_type==='tv');
const d2=await get(`/api/v1/media/tv/tmdb/${show.item.media_id}/`);
console.log(`  ${show.item.title} list.number_of_pages=${show.item.number_of_pages} detail.max_progress=${d2.j?.max_progress} progress_scope=${show.progress_scope}`);
