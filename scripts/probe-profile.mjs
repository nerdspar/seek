/** READ-ONLY. Statistics + history shapes for §7. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const get=async p=>{const r=await fetch(B+p,{headers:{'X-API-Key':T,Accept:'application/json'},signal:AbortSignal.timeout(30000)});
 return {s:r.status, j:await r.json().catch(()=>null)}};
const line=s=>console.log(`\n${'═'.repeat(72)}\n${s}\n${'═'.repeat(72)}`);

line('1. /api/v1/statistics/overview/ — params it accepts');
const base=await get('/api/v1/statistics/overview/');
console.log('HTTP', base.s, '| top keys:', Object.keys(base.j??{}).join(', '));
console.log(JSON.stringify(base.j,null,1).slice(0,2200));

line('2. Range selection (§7.1)');
for (const q of ['range=this_month','range=this_year','range=last_year','range=all_time','start_date=2026-01-01&end_date=2026-12-31']) {
  const r=await get(`/api/v1/statistics/overview/?${q}`);
  const keys=Object.keys(r.j??{});
  console.log(`  ?${q.padEnd(46)} HTTP ${r.s} keys=${keys.length}`);
}

line('3. /api/v1/history/ shape (§7.3 diary)');
const h=await get('/api/v1/history/?limit=3');
console.log('keys:', Object.keys(h.j??{}).join(', '));
console.log('pagination:', JSON.stringify(h.j?.pagination));
const d=(h.j?.results??[])[0];
if (d) { console.log('\nday keys:', Object.keys(d).join(', '));
  console.log('entry keys:', Object.keys((d.entries??[])[0]??{}).join(', '));
  console.log('\nfirst day:'); console.log(JSON.stringify(d,null,1).slice(0,1100)); }
