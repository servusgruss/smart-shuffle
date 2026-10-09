const M = require('../match.js');
const names = ['Kraftklub','Die Ärzte','AnnenMayKantereit','Cro','K.I.Z','Billie Eilish','Rammstein','Peter Fox','The Weeknd','Bilderbuch','Casper','Seeed','Mumford & Sons','Sido','Apache 207','Ed Sheeran'];
const tracks = names.map((n,i)=>({name:'Song'+i, album:'Alb', artists:[{id:'a'+i,name:n}]}));
const genres = {a0:['german indie','indie rock'],a6:['neue deutsche harte','german metal'],a3:['german hip hop'],a14:['german hip hop']};
const idx = M.buildIndex(tracks, genres);
const cases = [
 ['nur Kraft Club', 'Kraftklub'], ['nur Craftclub', 'Kraftklub'], ['von den Ärzten', 'Die Ärzte'],
 ['Annenmaykantereit', 'AnnenMayKantereit'], ['Anna May Kantereit','AnnenMayKantereit'], ['nur Kro', 'Cro'], ['nur cro', 'Cro'],
 ['Billy Eilish', 'Billie Eilish'], ['Ramstein', 'Rammstein'], ['the weekend', 'The Weeknd'],
 ['Seed', 'Seeed'], ['Apatsche', 'Apache 207'], ['Peter Fuchs','Peter Fox'], ['Ed Shiran','Ed Sheeran'],
 ['Sido', 'Sido'], ['Kiz','K.I.Z'],
];
let fail=0;
for (const [q, exp] of cases) {
  const p = M.parseQuery(q); const r = M.resolveTerm(p.include[0]||'', idx);
  const ok = r.type==='artist' && r.label===exp; if(!ok) fail++;
  console.log(ok?'✓':'✗', q.padEnd(22), '→', r.type, r.label, r.score?.toFixed(2)||'');
}
// false positives
for (const q of ['nur Indie','ohne Rap','nur Metal','nur Liebe']) {
  const p = M.parseQuery(q); const term=(p.include[0]||p.exclude[0]); const r=M.resolveTerm(term, idx);
  console.log('  ', q.padEnd(22), '→', r.type, r.label);
}
console.log(JSON.stringify(M.parseQuery('spiel die letzten hundert Lieder von Casper aber keinen Deutschrap')));
console.log(JSON.stringify(M.parseQuery('alle Songs ohne Sido')));
console.log('fails', fail);
