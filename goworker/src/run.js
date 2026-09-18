// CLI: node src/run.js <arquivo-ou-glob...>  -> roda o motor e imprime o resumo
import fs from 'node:fs';
import { enrich, analyze, summarize } from './engine.ts';

const files = process.argv.slice(2);
const seen = new Map();
for (const f of files) {
  for (const rec of JSON.parse(fs.readFileSync(f, 'utf8'))) seen.set(rec.validationId, rec);
}
const raw = [...seen.values()];
const all = enrich(raw);
const a = analyze(all, { now: Date.parse('2026-09-18T13:40:00Z') });
const s = summarize(a);
console.log(JSON.stringify({ rawCount: raw.length, ...s }, null, 2));

console.log('\n=== TOP 12 BLOQUEIOS ===');
for (const r of a.pending.filter(x => x.action === 'BLOQUEAR').sort((x, y) => y.risk - x.risk).slice(0, 12)) {
  console.log(`#${r.id} [risco ${r.risk}] ${r.approver} | ${(r.supplier || r.kind || '').slice(0, 48)}`);
  for (const f of r.findings) console.log(`    - ${f.code}: ${f.msg}`);
}
