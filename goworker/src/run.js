// CLI: node src/run.js <arquivo-ou-glob...>  -> roda o motor e imprime o resumo
//
// Passa pelo esbuild em vez de importar os .ts direto: o Node remove tipos mas
// nao resolve import sem extensao, e engine.ts importa './regras'. Empacotar
// aqui e o mesmo caminho que os testes usam, entao o CLI nunca roda contra um
// artefato velho.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const files = process.argv.slice(2);
if (!files.length) {
  console.error('uso: node src/run.js <arquivo.json> [outro.json ...]');
  process.exit(1);
}

const aqui = path.dirname(new URL(import.meta.url).pathname);
const saida = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'goworker-')), 'lib.mjs');
execFileSync('npx', ['esbuild', path.join(aqui, '..', 'test', 'lib-entry.ts'),
  '--bundle', '--format=esm', '--platform=neutral', `--outfile=${saida}`], { stdio: 'pipe' });
const L = await import(saida);

const seen = new Map();
for (const f of files) {
  for (const rec of JSON.parse(fs.readFileSync(f, 'utf8'))) seen.set(rec.validationId, rec);
}
const raw = [...seen.values()];
const all = L.engine.enrich(raw);
const now = Date.parse('2026-09-18T13:40:00Z');
const a = L.engine.analyze(all, { now });
console.log(JSON.stringify({ rawCount: raw.length, ...L.engine.summarize(a) }, null, 2));

// O que o AGENTE faz com a mesma fila. Sem os niveis de aprovador a checagem de
// alcada (Art. 7) nao roda, entao o contexto recebe a tabela real.
const ctx = L.agent.montarContexto(all, { agora: now, niveis: L.aprovadores.NIVEIS_APROVADORES });
const out = L.agent.processarFila(a.pending, ctx);
console.log('\n=== AGENTE ===');
console.log(JSON.stringify({ porAcao: out.porAcao, reroteadosPorAlcada: out.reroteadosPorAlcada,
  correcoesAutomaticas: out.correcoesAutomaticas, devolucoesRedigidas: out.devolucoesRedigidas }, null, 2));

console.log('\n=== TOP 12 BLOQUEIOS ===');
for (const r of a.pending.filter(x => x.action === 'BLOQUEAR').sort((x, y) => y.risk - x.risk).slice(0, 12)) {
  console.log(`#${r.id} [risco ${r.risk}] ${r.approver} | ${(r.supplier || r.kind || '').slice(0, 48)}`);
  for (const f of r.findings) console.log(`    - ${f.code}: ${f.msg}`);
}
