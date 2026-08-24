/**
 * Determines what DELETE actually removes: one play, or the whole episode record.
 * Uses a throwaway show that is NOT in the library, and untracks it at the end.
 * Every step prints before/after consumption counts.
 */
import { readFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url),'utf8').split('\n')
  .filter(l=>l.trim()&&!l.trim().startsWith('#')&&l.includes('='))
  .map(l=>{const i=l.indexOf('=');return [l.slice(0,i).trim(), l.slice(i+1).trim()];}));
const BASE=env.FLOPPY_URL.replace(/\/+$/,''), TOKEN=env.FLOPPY_TOKEN;

async function call(method, p, body) {
  const r = await fetch(BASE+p, {
    method,
    headers: {'X-API-Key':TOKEN, Accept:'application/json', ...(body!==undefined?{'Content-Type':'application/json'}:{})},
    body: body===undefined?undefined:JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  });
  const t = await r.text();
  let j; try { j = t?JSON.parse(t):null } catch { j = t.slice(0,300) }
  return {s:r.status, j};
}
const line=s=>console.log(`\n${'─'.repeat(72)}\n${s}\n${'─'.repeat(72)}`);

// A deliberately obscure, short, finished series.
const CANDIDATES = ['Ghosts of Beirut','Extrapolations','The Girl From Plainville','Black Bird','Five Days at Memorial'];

line('0. Find a show that is NOT already tracked');
let target = null;
for (const q of CANDIDATES) {
  const sr = await call('GET', `/api/v1/search/tv/?search=${encodeURIComponent(q)}&source=tmdb&limit=3`);
  const hits = sr.j?.results ?? sr.j ?? [];
  for (const h of hits) {
    const id = h.media_id ?? h.id;
    if (!id) continue;
    const det = await call('GET', `/api/v1/media/tv/tmdb/${id}/`);
    const tracked = det.j?.tracked;
    console.log(`  ${q} → tmdb ${id} "${det.j?.title}" tracked=${tracked} consumptions=${det.j?.consumptions_number}`);
    if (tracked === false) { target = {id:String(id), title:det.j?.title}; break; }
  }
  if (target) break;
}
if (!target) { console.log('!! No untracked candidate found. Aborting without writing.'); process.exit(1); }
console.log(`\n  → using tmdb ${target.id} "${target.title}" (currently untracked)`);

const S=1, E=1;
const epPath = `/api/v1/media/tv/tmdb/${target.id}/${S}/${E}/`;
const watchPath = `/api/v1/media/tv/tmdb/${target.id}/${S}/episodes/${E}/watch/`;
const plays = async (label) => {
  const d = await call('GET', epPath);
  const c = d.j?.consumptions ?? [];
  console.log(`  ${label}: HTTP ${d.s} | consumptions_number=${d.j?.consumptions_number} | ids=[${c.map(x=>x.consumption_id).join(',')}]`);
  return c;
};

line('1. Baseline (before any write)');
await plays('baseline');

line('2. POST watch  ×2  — §12.3 says this appends, so expect 2 distinct plays');
const p1 = await call('POST', watchPath, {});
console.log('  POST #1 →', p1.s);
const p2 = await call('POST', watchPath, {});
console.log('  POST #2 →', p2.s);
const after2 = await plays('after 2 POSTs');

line('3. DELETE on the WATCH path (spec §3 claims this exists; contract says POST-only)');
const dw = await call('DELETE', watchPath);
console.log(`  DELETE ${watchPath} → HTTP ${dw.s}`, dw.s===405?'(Method Not Allowed — not implemented)':'');
if (typeof dw.j === 'object' && dw.j) console.log('  body:', JSON.stringify(dw.j).slice(0,200));
const afterDw = await plays('after watch-path DELETE');
console.log(`  → removed ${after2.length - afterDw.length} of ${after2.length} plays`);

line('4. DELETE on the EPISODE path (the documented one)');
const de = await call('DELETE', epPath);
console.log(`  DELETE ${epPath} → HTTP ${de.s}`);
const afterDe = await plays('after episode-path DELETE');
console.log(`  → removed ${afterDw.length - afterDe.length} of ${afterDw.length} remaining plays`);

line('5. VERDICT');
console.log(`  watch-path DELETE   : HTTP ${dw.s}, removed ${after2.length - afterDw.length}`);
console.log(`  episode-path DELETE : HTTP ${de.s}, removed ${afterDw.length - afterDe.length}`);

line('6. Cleanup — untrack the throwaway show entirely');
const cleanup = await call('DELETE', `/api/v1/media/tv/tmdb/${target.id}/`);
console.log('  DELETE show →', cleanup.s);
const final = await call('GET', `/api/v1/media/tv/tmdb/${target.id}/`);
console.log('  tracked now =', final.j?.tracked, '| consumptions_number =', final.j?.consumptions_number);
