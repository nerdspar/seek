/** READ-ONLY. Floppy Discover rows + TMDB keyword search viability (§6). */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN,TMDB=env.TMDB_API_KEY;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};
const line=s=>console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);

line('1. Floppy Discover rows');
for (const mt of ['tv','movie']) {
  const r=await get(`/api/v1/discover/?media_type=${mt}`);
  console.log(`  media_type=${mt} HTTP ${r.s} keys=${Object.keys(r.j??{}).join(', ')}`);
  const rows=r.j?.rows??[];
  console.log(`    rows: ${rows.length}`);
  for (const row of rows.slice(0,6)) {
    const items=row.items??row.results??[];
    console.log(`      "${row.title??row.name??row.key??'?'}"  items=${items.length}  rowkeys=${Object.keys(row).join(',')}`);
  }
  if (rows[0]) {
    const it=(rows[0].items??rows[0].results??[])[0];
    if (it) { console.log('\n    first item keys:', Object.keys(it).join(', ')); console.log('    first item:', JSON.stringify(it).slice(0,340)); }
  }
}

line('2. TMDB key check + keyword search (§6.2)');
if (!TMDB) { console.log('  TMDB_API_KEY not set'); }
else {
  const kw=await (await fetch(`https://api.themoviedb.org/3/search/keyword?query=heist&api_key=${TMDB}`)).json();
  console.log('  /search/keyword?query=heist →', (kw.results??[]).slice(0,5).map(k=>`${k.name}(${k.id})`).join(', ') || JSON.stringify(kw).slice(0,160));
  const id=(kw.results??[])[0]?.id;
  if (id) {
    const disc=await (await fetch(`https://api.themoviedb.org/3/discover/tv?with_keywords=${id}&sort_by=popularity.desc&api_key=${TMDB}`)).json();
    console.log(`  /discover/tv?with_keywords=${id} → ${disc.total_results} results:`, (disc.results??[]).slice(0,5).map(r=>r.name).join(', '));
    const dm=await (await fetch(`https://api.themoviedb.org/3/discover/movie?with_keywords=${id}&sort_by=popularity.desc&api_key=${TMDB}`)).json();
    console.log(`  /discover/movie?with_keywords=${id} → ${dm.total_results} results:`, (dm.results??[]).slice(0,5).map(r=>r.title).join(', '));
  }
  const prov=await (await fetch(`https://api.themoviedb.org/3/watch/providers/tv?watch_region=US&api_key=${TMDB}`)).json();
  console.log('  /watch/providers/tv → ', (prov.results??[]).slice(0,6).map(p=>`${p.provider_name}(${p.provider_id})`).join(', '));
}
