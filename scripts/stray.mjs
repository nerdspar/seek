import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,200)} return {s:r.status,j}};

console.log('Last-resort API deletion attempts:');
for (const [m,p] of [['DELETE','/api/v1/media/anime/tmdb/224009/'],['DELETE','/api/v1/media/anime/mal/224009/'],['DELETE','/api/v1/media/anime/manual/224009/']]) {
  const r=await call(m,p); console.log(`  ${m} ${p} → ${r.s} ${JSON.stringify(r.j).slice(0,90)}`);
}

const cur=await call('GET','/api/v1/media/anime/?status=all&limit=20');
console.log(`\nAnime library contains ${cur.j?.pagination?.total} item(s):`);
for (const r of (cur.j?.results??[])) {
  console.log(`  "${r.item?.title}"  item_id=${r.item_id}  progress=${r.progress}`);
  console.log(`  Remove it here: ${B}${r.item?.url ?? '/'}`);
}

const tv=await call('GET','/api/v1/media/tv/?status=all&search=Ghosts&limit=5');
console.log(`\nTV side is clean: total=${tv.j?.pagination?.total}`);
const ep=await call('GET','/api/v1/media/tv/tmdb/224009/1/1/');
console.log(`Stray plays on S01E01: ${ep.j?.consumptions_number ?? 'n/a'}`);
