import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,300)}}};
const line=s=>console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);

line('A. Is the Trakt movie import still running / did it record anything?');
const h=await get('/api/v1/history/?limit=8');
console.log('  /api/v1/history/ HTTP', h.s, '| keys:', Object.keys(h.j??{}).join(', '));
const hits=h.j?.results ?? h.j?.history ?? [];
for (const x of hits.slice(0,8)) console.log('   ', JSON.stringify(x).slice(0,190));

line('B. /api/v1/home/ groups — does anything mention movies?');
const home=await get('/api/v1/home/');
for (const g of (home.j?.groups??[])) console.log(`   group "${g.name ?? g.title ?? g.key ?? '?'}" items=${(g.items??g.results??[]).length}`);

line('C. Are SEASON entries leaking into the watchlist query?');
const wl=await get('/api/v1/media/tv/?status=in_progress&progress=not_caught_up&limit=100');
const rs=wl.j?.results??[];
const byLib={};
for (const r of rs) byLib[r.item?.library_media_type]= (byLib[r.item?.library_media_type]??0)+1;
console.log('  watchlist rows by library_media_type:', JSON.stringify(byLib), `(total=${wl.j?.pagination?.total})`);

line('D. languages/original-language as an anime signal');
let off=0, all=[];
for(;;){ const {j}=await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`); all.push(...(j?.results??[])); off+=100; if(!j?.pagination?.next||off>500) break; }
const shows=all.filter(r=>r.item?.library_media_type==='tv');
const jaLang=shows.filter(r=>(r.item?.languages??[]).includes('Japanese'));
const anim=shows.filter(r=>(r.item?.genres??[]).includes('Animation'));
const animJa=shows.filter(r=>(r.item?.genres??[]).includes('Animation')&&(r.item?.languages??[]).includes('Japanese'));
console.log(`  shows(excl seasons)=${shows.length}  languages⊇Japanese=${jaLang.length}  Animation=${anim.length}  Animation+Japanese=${animJa.length}`);
console.log('\n  Animation+Japanese →'); console.log('   ', animJa.map(r=>r.item?.title).sort().join(', '));
console.log('\n  Japanese but NOT Animation (false positives for lang-only) →');
console.log('   ', jaLang.filter(r=>!(r.item?.genres??[]).includes('Animation')).map(r=>r.item?.title).join(', ')||'(none)');
console.log('\n  Animation but NOT Japanese (correctly excluded Western animation) →');
console.log('   ', anim.filter(r=>!(r.item?.languages??[]).includes('Japanese')).map(r=>r.item?.title).sort().join(', '));
