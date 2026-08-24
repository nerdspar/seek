import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN,CAL=env.FLOPPY_CALENDAR_TOKEN;

const ics=await (await fetch(`${B}/calendar/download/${CAL}?media_types=tv&media_types=season&media_types=movie&media_types=anime`)).text();
const unfold=t=>t.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
const unesc=v=>v.replace(/\\n/gi,'\n').replace(/\\([,;\\])/g,'$1');
const parseSummary=s=>{const m=s.match(/^(.*?)\s+S(\d+)\s*E(\d+)\s*$/);
 if(!m) return {title:s.trim(),season:null,episode:null};
 return {title:m[1].replace(/\s+Season\s+\d+\s*$/i,'').trim(), season:+m[2], episode:+m[3]};};
const events=unfold(ics).split('BEGIN:VEVENT').slice(1).map(b=>{
 const c=b.split('END:VEVENT')[0];
 const f=n=>{const m=c.match(new RegExp(`^${n}(?:;[^:\n]*)?:(.*)$`,'m'));return m?m[1].trim():null};
 const d=f('DTSTART'); const mm=d.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z?$/);
 const iso=mm?new Date(`${mm[1]}-${mm[2]}-${mm[3]}T${mm[4]}:${mm[5]}:${mm[6]}Z`).toISOString():null;
 return {...parseSummary(unesc(f('SUMMARY')||'')), start:iso, hasTime: mm ? !(mm[4]==='11'&&mm[5]==='59'&&mm[6]==='59') : false};
}).filter(e=>e.start).sort((a,b)=>a.start.localeCompare(b.start));

// library index, same logic as upcoming.ts
const index=new Map();
for (const mt of ['tv','movie']) {
  let off=0;
  for(;;){ const j=await (await fetch(`${B}/api/v1/media/${mt}/?status=all&limit=100&offset=${off}`,{headers:{'X-API-Key':T}})).json();
    const rows=j.results||[];
    for (const r of rows){ const t=(r.item?.title||'').toLowerCase(); const id=String(r.item?.media_id||'');
      if(t&&id&&!index.has(t)) index.set(t,{poster:r.item?.image??null,mediaId:id}); }
    off+=100; if(rows.length<100||off>1000) break; }
}
console.log('library index size:', index.size);

const now=Date.now();
const future=events.filter(e=>new Date(e.start).getTime() >= now - 12*3600*1000);
console.log('events total:', events.length, '| after past-filter:', future.length);
console.log('\nnow (UTC):', new Date().toISOString());
console.log('now (local):', new Date().toString().slice(0,33), '| TZ:', Intl.DateTimeFormat().resolvedOptions().timeZone);

console.log('\nFirst 8 upcoming, with match status:');
for (const e of future.slice(0,8)) {
  const hit=index.get(e.title.toLowerCase());
  const local=new Date(e.start);
  console.log(`  ${e.start}  local=${local.toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})}  hasTime=${String(e.hasTime).padEnd(5)} poster=${hit?(hit.poster?'yes':'NULL'):'NO MATCH'}  "${e.title}"`);
}
const missing=future.filter(e=>!index.get(e.title.toLowerCase()));
console.log('\nunmatched titles in upcoming window:', [...new Set(missing.map(m=>m.title))].join(' | ')||'(none)');
const nullPoster=future.filter(e=>{const h=index.get(e.title.toLowerCase()); return h&&!h.poster;});
console.log('matched but poster null:', [...new Set(nullPoster.map(m=>m.title))].join(' | ')||'(none)');
