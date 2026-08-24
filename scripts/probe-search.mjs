/** Search shape (read-only) + the add contract, exercised on a throwaway that
 *  is verifiably deletable via the tv route. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};
const line=s=>console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);

line('1. SEARCH shape');
const sr=await call('GET','/api/v1/search/tv/?search=severance&source=tmdb&limit=4');
console.log('HTTP', sr.s, '| envelope keys:', Object.keys(sr.j??{}).join(', '));
const rows=sr.j?.results ?? sr.j ?? [];
console.log('result count:', rows.length);
if (rows[0]) { console.log('\nresult keys:', Object.keys(rows[0]).join(', ')); console.log('\nfirst result:'); console.log(JSON.stringify(rows[0],null,1).slice(0,900)); }
console.log('\npagination:', JSON.stringify(sr.j?.pagination));

line('2. Does a search result say whether it is ALREADY tracked?');
const known=await call('GET','/api/v1/search/tv/?search=Buffy%20the%20Vampire%20Slayer&source=tmdb&limit=3');
for (const r of (known.j?.results??[]).slice(0,3))
  console.log(`  "${r.title}" media_id=${r.media_id} tracked=${r.tracked} status=${r.status} keys_with_track=${Object.keys(r).filter(k=>/track|status|progress/i.test(k)).join(',')||'(none)'}`);

line('3. Search across media types');
for (const mt of ['tv','movie','anime']) {
  const r=await call('GET',`/api/v1/search/${mt}/?search=dune&source=tmdb&limit=3`);
  console.log(`  ${mt.padEnd(6)} HTTP ${r.s} n=${(r.j?.results??[]).length} → ${(r.j?.results??[]).map(x=>`${x.title}(${x.media_id})`).join(', ').slice(0,110)}`);
}

line('4. ADD contract — what body does POST /api/v1/media/tv/ need?');
const ID='224009';
for (const body of [{source:'tmdb',media_id:ID},{source:'tmdb',media_id:ID,progress:0},{source:'tmdb',media_id:ID,progress:0,status:0}]) {
  const r=await call('POST','/api/v1/media/tv/',body);
  console.log(`  ${r.s}  ${JSON.stringify(body)}`);
  if (r.s<400) {
    console.log(`       -> item_id=${r.j?.item_id} media_type=${r.j?.item?.media_type} library=${r.j?.item?.library_media_type} status=${r.j?.status} progress=${r.j?.progress}`);
    const d=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/`);
    console.log(`       cleanup DELETE -> ${d.s}`);
  } else console.log(`       ${JSON.stringify(r.j).slice(0,140)}`);
}
const after=await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=3');
console.log(`\n  final: tv list total=${after.j?.pagination?.total} (expect 0)`);
