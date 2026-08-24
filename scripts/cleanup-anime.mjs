import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};

const cur=await call('GET','/api/v1/media/anime/?status=all&search=Ghosts&limit=5');
const row=(cur.j?.results??[])[0];
if (!row) { console.log('Nothing to clean — anime list is already empty.'); process.exit(0); }
console.log('Stray item:', JSON.stringify({item_id:row.item_id, id:row.id, consumption_id:row.consumption_id, media_id:row.item?.media_id, status:row.status}));

console.log('\nWhy did DELETE 400?');
const d=await call('DELETE','/api/v1/media/anime/tmdb/224009/');
console.log('  DELETE /api/v1/media/anime/tmdb/224009/ →', d.s, JSON.stringify(d.j).slice(0,220));

console.log('\nTrying the exact-consumption route:');
if (row.consumption_id != null) {
  const d2=await call('DELETE',`/api/v1/media/anime/tmdb/224009/history/${row.consumption_id}/`);
  console.log(`  DELETE history/${row.consumption_id}/ →`, d2.s, d2.s>=400?JSON.stringify(d2.j).slice(0,200):'');
}
const after=await call('GET','/api/v1/media/anime/?status=all&search=Ghosts&limit=5');
console.log('\n  anime total now =', after.j?.pagination?.total);
