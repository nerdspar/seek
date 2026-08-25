/** READ-ONLY. How does Floppy behave under concurrent load? */
import { readFileSync } from 'node:fs';
const env=Object.fromEntries(readFileSync(new URL('../.env',import.meta.url),'utf8').split('\n')
 .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('=')).map(l=>{const i=l.indexOf('=');return[l.slice(0,i).trim(),l.slice(i+1).trim()]}));
const B=env.FLOPPY_URL.replace(/\/+$/,''),T=env.FLOPPY_TOKEN;
const timed=async p=>{const t=Date.now();
 try{const r=await fetch(B+p,{headers:{'X-API-Key':T},signal:AbortSignal.timeout(120000)}); await r.text();
   return {ms:Date.now()-t, s:r.status};}catch(e){return {ms:Date.now()-t, s:'ERR '+e.name}}};
const line=s=>console.log(`\n${'═'.repeat(70)}\n${s}\n${'═'.repeat(70)}`);

const SEARCH='/api/v1/media/tv/?status=all&progress=all&search=Buffy%20the%20Vampire%20Slayer&limit=50';
const LIST='/api/v1/media/tv/?status=in_progress&progress=not_caught_up&sort=updated&direction=desc&limit=200';
const EP='/api/v1/media/tv/tmdb/95/6/15/';

line('1. Sequential baseline (one at a time)');
for (const [n,p] of [['getRow search',SEARCH],['watchlist list',LIST],['episode detail',EP]]) {
  const r=await timed(p); console.log(`  ${n.padEnd(16)} ${String(r.ms).padStart(6)}ms  ${r.s}`);
}

line('2. Same three, fired CONCURRENTLY (what rapid marking does)');
let t0=Date.now();
let rs=await Promise.all([timed(SEARCH),timed(LIST),timed(EP)]);
console.log('  individual:', rs.map(r=>r.ms+'ms').join(', '));
console.log('  wall clock:', Date.now()-t0+'ms');

line('3. Five concurrent getRow searches (five rapid marks)');
t0=Date.now();
rs=await Promise.all(Array.from({length:5},()=>timed(SEARCH)));
console.log('  individual:', rs.map(r=>r.ms+'ms').join(', '));
console.log('  wall clock:', Date.now()-t0+'ms');
console.log('  → serialised?', Math.max(...rs.map(r=>r.ms)) > rs.reduce((a,b)=>a+b.ms,0)/rs.length*2 ? 'looks like it' : 'mostly parallel');

line('4. Ten concurrent light calls (episode detail)');
t0=Date.now();
rs=await Promise.all(Array.from({length:10},()=>timed(EP)));
console.log('  min/max:', Math.min(...rs.map(r=>r.ms))+'ms /', Math.max(...rs.map(r=>r.ms))+'ms');
console.log('  wall clock:', Date.now()-t0+'ms');
console.log('  errors:', rs.filter(r=>String(r.s).startsWith('ERR')).length);
