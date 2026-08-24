import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const call=async(m,p,b)=>{const r=await fetch(B+p,{method:m,headers:{'X-API-Key':T,Accept:'application/json',...(b?{'Content-Type':'application/json'}:{})},body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(30000)});
 const t=await r.text(); let j; try{j=t?JSON.parse(t):null}catch{j=t.slice(0,300)} return {s:r.status,j}};
const ID='224009';

console.log('Finding the accepted body shape for POST /api/v1/media/anime/\n');
const bodies=[
  {source:'tmdb', media_id:ID},
  {source:'tmdb', media_id:ID, status:1},
  {item:{source:'tmdb', media_id:ID, media_type:'anime'}},
  {source:'tmdb', media_id:ID, media_type:'anime', library_media_type:'anime'},
  {source:'tmdb', media_id:ID, identity_media_type:'tv', library_media_type:'anime'},
];
for (const b of bodies) {
  const r=await call('POST','/api/v1/media/anime/',b);
  const err = r.s>=400 ? JSON.stringify(r.j).slice(0,170) : `OK item lib=${r.j?.item?.library_media_type} mt=${r.j?.item?.media_type}`;
  console.log(`  ${r.s}  ${JSON.stringify(b).slice(0,78).padEnd(78)} ${err}`);
  if (r.s<400) {
    // clean up immediately
    for (const mt of ['anime','tv']) await call('DELETE',`/api/v1/media/${mt}/tmdb/${ID}/`);
  }
}
console.log('\nFor contrast, the TV route with the same minimal body:');
const t1=await call('POST','/api/v1/media/tv/',{source:'tmdb', media_id:ID});
console.log(`  ${t1.s} ${t1.s>=400?JSON.stringify(t1.j).slice(0,170):`OK lib=${t1.j?.item?.library_media_type}`}`);
if (t1.s<400) { const d=await call('DELETE',`/api/v1/media/tv/tmdb/${ID}/`); console.log('  cleanup →',d.s); }

console.log('\nFinal state:');
for (const mt of ['anime','tv']) {
  const r=await call('GET',`/api/v1/media/${mt}/?status=all&search=Ghosts&limit=5`);
  console.log(`  ${mt}: total=${r.j?.pagination?.total}`);
}
