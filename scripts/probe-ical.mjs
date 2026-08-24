/** READ-ONLY. Measures how well feed titles match the library. */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN,CAL=env.FLOPPY_CALENDAR_TOKEN;

const ics=await (await fetch(`${B}/calendar/download/${CAL}?media_types=tv&media_types=season&media_types=movie&media_types=anime`)).text();
const { parseIcal } = await import('../src/lib/server/ical.ts').catch(()=>({}));

// Inline the parser rather than importing TS.
const unfold=t=>t.replace(/\r\n/g,'\n').replace(/\n[ \t]/g,'');
const parseSummary=s=>{const m=s.match(/^(.*?)\s+S(\d+)\s*E(\d+)\s*$/);
 if(!m) return {title:s.trim(),season:null,episode:null};
 return {title:m[1].replace(/\s+Season\s+\d+\s*$/i,'').trim(), season:+m[2], episode:+m[3]};};
const events=unfold(ics).split('BEGIN:VEVENT').slice(1).map(b=>{
 const c=b.split('END:VEVENT')[0];
 const f=n=>{const m=c.match(new RegExp(`^${n}(?:;[^:\n]*)?:(.*)$`,'m'));return m?m[1].trim():null};
 return {...parseSummary(f('SUMMARY')||''), start:f('DTSTART'), uid:f('UID')};
});

let off=0, lib=[];
for(;;){ const j=await (await fetch(`${B}/api/v1/media/tv/?status=all&limit=100&offset=${off}`,{headers:{'X-API-Key':T}})).json();
 lib.push(...(j.results||[])); off+=100; if(!j.pagination?.next||off>800) break; }
const byTitle=new Map();
for (const r of lib) { const t=(r.item?.title||'').toLowerCase(); if(t&&!byTitle.has(t)) byTitle.set(t,r); }

let matched=0; const misses=[];
for (const e of events) {
  const hit = byTitle.get(e.title.toLowerCase());
  if (hit) matched++; else misses.push(e.title);
}
console.log(`events: ${events.length}`);
console.log(`exact title match against library: ${matched}  (${Math.round(matched/events.length*100)}%)`);
const uniqueMisses=[...new Set(misses)];
console.log(`unmatched distinct titles: ${uniqueMisses.length}`);
for (const m of uniqueMisses.slice(0,15)) console.log('   ', m);
console.log('\nsample parsed events:');
for (const e of events.slice(0,6)) console.log(`   "${e.title}" S${e.season}E${e.episode} @ ${e.start}`);
