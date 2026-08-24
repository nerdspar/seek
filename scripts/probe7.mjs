import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 const t=await r.text();try{return{s:r.status,j:JSON.parse(t)}}catch{return{s:r.status,j:t.slice(0,200)}}};
const line=s=>console.log(`\n${'─'.repeat(70)}\n${s}\n${'─'.repeat(70)}`);

line('A. Movie library now (post Trakt import)');
for (const st of ['all','planning','in_progress','completed','paused','dropped']) {
  const {j}=await get(`/api/v1/media/movie/?status=${st}&limit=1`);
  console.log(`  movie status=${st.padEnd(12)} total=${j?.pagination?.total}`);
}
const mv=await get('/api/v1/media/movie/?status=all&limit=5&sort=updated&direction=desc');
for (const r of (mv.j?.results??[])) {
  console.log(`   "${r.item?.title}" progress=${r.progress} max=${r.item?.number_of_pages} status=${r.status} runtime=${r.item?.runtime_minutes ?? r.item?.runtime} next=${JSON.stringify(r.next_episode)}`);
}

line('B. Does ANY tracked item report library_media_type other than tv/movie?');
const seen={};
for (const mt of ['tv','movie','anime']) {
  let off=0;
  for(;;){
    const {j}=await get(`/api/v1/media/${mt}/?status=all&limit=100&offset=${off}`);
    const rs=j?.results??[];
    for (const r of rs) {
      const k=`${mt} → library_media_type=${r.item?.library_media_type} media_type=${r.item?.media_type} source=${r.item?.source}`;
      seen[k]=(seen[k]??0)+1;
    }
    off+=100; if(!j?.pagination?.next || off>500) break;
  }
}
for (const [k,v] of Object.entries(seen)) console.log(`  ${v.toString().padStart(4)}  ${k}`);

line('C. Anime signal candidates across the whole TV library');
let off=0, all=[];
for(;;){ const {j}=await get(`/api/v1/media/tv/?status=all&limit=100&offset=${off}`); all.push(...(j?.results??[])); off+=100; if(!j?.pagination?.next||off>500) break; }
console.log(`  ${all.length} tv items total`);
const anim=all.filter(r=>(r.item?.genres??[]).includes('Animation'));
const jp=all.filter(r=>r.item?.country==='Japan');
const both=all.filter(r=>(r.item?.genres??[]).includes('Animation')&&r.item?.country==='Japan');
console.log(`  genres⊇Animation: ${anim.length}   country=Japan: ${jp.length}   both: ${both.length}`);
console.log(`\n  Animation but NOT Japan (would be false positives):`);
console.log('   ', anim.filter(r=>r.item?.country!=='Japan').map(r=>r.item?.title).join(', '));
console.log(`\n  Japan but NOT Animation (live-action JP, false positives for a country-only rule):`);
console.log('   ', jp.filter(r=>!(r.item?.genres??[]).includes('Animation')).map(r=>r.item?.title).join(', ') || '(none)');
console.log(`\n  Animation AND Japan (the intersection):`);
console.log('   ', both.map(r=>r.item?.title).join(', '));
console.log('\n  Other fields on a known anime:');
const one=all.find(r=>r.item?.title?.includes('Solo Leveling'));
if(one) console.log('   ', JSON.stringify({source_material:one.item?.source_material, themes:one.item?.themes, studios:one.item?.studios, format:one.item?.format, languages:one.item?.languages, provider_keywords:(one.item?.provider_keywords??[]).slice(0,12)}));
