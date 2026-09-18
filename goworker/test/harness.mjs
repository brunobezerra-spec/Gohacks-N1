// Sobe o worker contra um SQLite real e exercita todas as rotas + MCP.
import { DatabaseSync } from 'node:sqlite';
import worker from '/tmp/bundle.js';
import * as engine from '/Users/bruno/orca/projects/Gohacks-N1/goworker/src/engine.ts';
import { expandSnapshot } from '/Users/bruno/orca/projects/Gohacks-N1/goworker/src/snapshot.ts';

// Expectativas calculadas na hora, com o mesmo relogio do servidor. Assim o teste
// valida a LIGACAO servidor<->motor sem envelhecer toda vez que uma regra muda.
const EXP = engine.summarize(engine.analyze(engine.enrich(expandSnapshot())));
const EXP_RETRO = engine.auditRetroativo(engine.enrich(expandSnapshot()));
console.log('expectativa do motor:', JSON.stringify(EXP.byAction));

const db = new DatabaseSync(':memory:');
const env = {
  DB: {
    async query(sql, params = []) {
      if (params.length > 100) throw new Error(`too many SQL variables (${params.length}) — limite do GoDeploy e ~100`);
      const rows = db.prepare(sql).all(...params.map(v => v === undefined ? null : v));
      return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowsRead: rows.length };
    },
    async exec(sql, params = []) {
      if (params.length > 100) throw new Error(`too many SQL variables (${params.length}) — limite do GoDeploy e ~100`);
      const r = db.prepare(sql).run(...params.map(v => v === undefined ? null : v));
      return { rowsWritten: Number(r.changes ?? 0) };
    },
  },
};

const call = (path, opts = {}) => worker.fetch(
  new Request('https://t.local' + path, opts), env);
const j = async (r) => { const t = await r.text(); try { return JSON.parse(t); } catch { return t.slice(0,200); } };

let pass = 0, fail = 0;
const ok = (name, cond, extra='') => { if (cond) { pass++; console.log('  PASS', name); }
  else { fail++; console.log('  FAIL', name, extra); } };

console.log('\n== 1. health (base vazia) ==');
let r = await call('/api/health'); let b = await j(r);
ok('health 200', r.status === 200, JSON.stringify(b).slice(0,200));
ok('fonte = snapshot embutido', b.fonte === 'snapshot embutido', b.fonte);
ok('regras expostas', b.regras?.ZOMBIE_DAYS === 45);

console.log('\n== 2. run do agente sobre o snapshot ==');
const t0 = Date.now();
r = await call('/api/run', { method: 'POST' }); b = await j(r);
console.log(`  (${Date.now()-t0} ms)`);
ok('run 200', r.status === 200, JSON.stringify(b).slice(0,300));
ok('1058 pendentes', b.totalPending === 1058, b.totalPending);
ok('origem snapshot', String(b.origem).includes('snapshot'), b.origem);
ok('distribuicao de acoes = motor', JSON.stringify(b.byAction) === JSON.stringify(EXP.byAction), JSON.stringify(b.byAction));
ok('filas orfas = motor', b.orphanApprovers === EXP.orphanApprovers && b.orphanPending === EXP.orphanPending, `${b.orphanApprovers}/${b.orphanPending}`);
const runId = b.runId;

console.log('\n== 3. summary ==');
r = await call('/api/summary'); b = await j(r);
ok('summary 200', r.status === 200);
ok('runId persistido', b.runId === runId, b.runId);
ok('gargalos ordenados desc', b.gargalos[0].pending >= b.gargalos[1].pending);
ok('18926 registros', b.totalRecords === 18926, b.totalRecords);

console.log('\n== 4. queue com filtros ==');
r = await call('/api/queue?acao=BLOQUEAR&limite=50'); const bloq = await j(r);
ok('BLOQUEAR = motor', bloq.length === EXP.byAction.BLOQUEAR, `${bloq.length} vs ${EXP.byAction.BLOQUEAR}`);
ok('todos com acao BLOQUEAR', bloq.every(x => x.action === 'BLOQUEAR'));
ok('ordenado por risco desc', bloq[0].risk >= bloq[bloq.length-1].risk);
r = await call('/api/queue?sinal=APROVADOR_INATIVO&limite=200'); const inat = await j(r);
ok('filtro por sinal = motor', inat.length === EXP.byCode.APROVADOR_INATIVO, `${inat.length} vs ${EXP.byCode.APROVADOR_INATIVO}`);
r = await call('/api/queue?aprovador=joao.conde&limite=500'); const jc = await j(r);
ok('filtro por aprovador', jc.length === 184 && jc.every(x=>x.approver==='joao.conde'), jc.length);

console.log('\n== 5. dossie ==');
const alvo = bloq[0].approval_id;
r = await call('/api/item?id=' + alvo); b = await j(r);
ok('dossie 200', r.status === 200);
ok('tem recomendacao', !!b.recomendacao?.acao);
ok('tem sinais', Array.isArray(b.sinais) && b.sinais.length > 0);
ok('declara limite de dados', String(b.limiteConhecido).includes('NAO estao disponiveis'));
ok('declara decisao humana', String(b.decisaoFinal).includes('nao aprova'));
ok('carga do aprovador presente', b.cargaDoAprovador && typeof b.cargaDoAprovador.parados === 'number', JSON.stringify(b.cargaDoAprovador));
r = await call('/api/item?id=999999'); ok('dossie inexistente = 404', r.status === 404);

console.log('\n== 6. trilha de auditoria ==');
r = await call('/api/audit', { method:'POST', headers:{'X-Godeploy-User-Email':'bruno@x.com','Content-Type':'application/json'},
  body: JSON.stringify({ id: alvo, evento:'decisao_humana', decisao:'acatado', observacao:'cadastro corrigido' })});
ok('audit POST 200', r.status === 200);
r = await call('/api/item?id=' + alvo); b = await j(r);
ok('trilha aparece no dossie', b.trilhaDeAuditoria.length === 1 && b.trilhaDeAuditoria[0].actor === 'bruno@x.com',
   JSON.stringify(b.trilhaDeAuditoria));

console.log('\n== 7. MCP ==');
const rpc = async (method, params) => j(await call('/_mcp', { method:'POST',
  headers:{'Content-Type':'application/json','X-Godeploy-User-Email':'bruno@x.com'},
  body: JSON.stringify({ jsonrpc:'2.0', id:1, method, params })}));
let m = await rpc('initialize', { protocolVersion:'2025-06-18' });
ok('initialize', m.result?.protocolVersion === '2025-06-18', JSON.stringify(m).slice(0,200));
m = await rpc('tools/list', {});
ok('7 ferramentas', m.result?.tools?.length === 7, m.result?.tools?.length);
ok('nomes corretos', m.result.tools.map(t=>t.name).sort().join(',') ===
  'goworker_auditoria_retroativa,goworker_dossie,goworker_fila,goworker_filas_orfas,goworker_gargalos,goworker_registrar_decisao,goworker_resumo',
  m.result?.tools?.map(t=>t.name).join(','));
m = await rpc('tools/call', { name:'goworker_auditoria_retroativa', arguments:{} });
{ const A = m.result?.structuredContent;
  ok('aprovados com doc invalido = 162', A?.aprovadosComDocInvalido === 162 && A.aprovadosComDocInvalido === EXP_RETRO.aprovadosComDocInvalido, A?.aprovadosComDocInvalido);
  ok('9 conflitos de grafia', A?.totalConflitos === 9, A?.totalConflitos);
  const sefaz = A?.conflitosDeGrafia?.[0];
  ok('SEFAZ SP com 88 aprovados em grafia invalida', sefaz?.aprovadosEmGrafiaInvalida === 88, sefaz?.aprovadosEmGrafiaInvalida);
  ok('SEFAZ SP tem 3 grafias, 1 valida', sefaz?.grafias?.length === 3 && sefaz.grafias.filter(g=>g.valido).length === 1); }
m = await rpc('tools/call', { name:'goworker_resumo', arguments:{} });
ok('resumo via MCP', m.result?.structuredContent?.totalPending === 1058, JSON.stringify(m).slice(0,200));
m = await rpc('tools/call', { name:'goworker_filas_orfas', arguments:{} });
ok('filas orfas via MCP', JSON.parse(m.result.content[0].text).length === EXP.orphanApprovers);
m = await rpc('tools/call', { name:'goworker_fila', arguments:{ acao:'REDIRECIONAR', limite:100 } });
ok('fila filtrada via MCP', JSON.parse(m.result.content[0].text).length === EXP.byAction.REDIRECIONAR);
m = await rpc('tools/call', { name:'goworker_dossie', arguments:{ id: alvo } });
ok('dossie via MCP', !!m.result?.structuredContent?.recomendacao);
m = await rpc('tools/call', { name:'goworker_registrar_decisao', arguments:{ id: alvo, decisao:'adiado' } });
ok('registrar decisao', m.result?.structuredContent?.registrado === true);
ok('avisa que nao escreve no GoService',
   String(m.result?.structuredContent?.aviso).includes('manual'), m.result?.structuredContent?.aviso);
m = await rpc('tools/call', { name:'inexistente', arguments:{} });
ok('ferramenta inexistente = erro JSON-RPC', m.error?.code === -32602);

console.log('\n== 8. SEGURANCA: nenhum caminho de escrita no GoService ==');
const src = (await import('node:fs')).readFileSync('/tmp/bundle.js','utf8');
ok('nao referencia review_approval', !src.includes('review_approval'));
// remove comentarios antes de procurar por chamada real de API
const code = src.replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(l=>!l.trim().startsWith('//')).join('\n');
ok('nenhuma chamada a endpoint GLPI/GoService no codigo executavel',
   !/TicketValidation|\/apirest|review_approval|goservice\\.[a-z]/i.test(code),
   (code.match(/TicketValidation|apirest|review_approval/ig)||[]).join(','));
ok('nenhum metodo HTTP de escrita para fora',
   !/fetch\s*\([^)]*method\s*:\s*["'`](POST|PUT|PATCH|DELETE)/i.test(code));
ok('nao faz fetch externo', !/fetch\s*\(\s*["'`]https?:/.test(src));

console.log('\n== 9. re-run e idempotencia ==');
r = await call('/api/run', { method:'POST' }); b = await j(r);
ok('segundo run 200', r.status === 200);
ok('triagem nao duplica', (await (await call('/api/queue?acao=BLOQUEAR&limite=200')).json()).length === EXP.byAction.BLOQUEAR);
r = await call('/api/audit'); b = await j(r);
ok('auditoria acumula', b.length >= 4, b.length);

console.log('\n== 10. rota inexistente ==');
r = await call('/api/nada'); ok('404 com lista de rotas', r.status === 404 && (await j(r)).rotas?.length > 0);

console.log('\n== 10b. regressoes apontadas pelo red team ==');
{
  const todos = await j(await call('/api/queue?limite=500'));
  const acha = (re) => todos.find(x => re.test(x.title || ''));
  const pctec = acha(/PCTEC/i);
  ok('fornecedor com AUTOMACAO no nome nao vira ARQUIVAR', !pctec || pctec.action !== 'ARQUIVAR', pctec?.action);
  const auto = await j(await call('/api/queue?sinal=AUTOAPROVACAO&limite=100'));
  ok('autoaprovacao detectada e bloqueada', auto.length === EXP.byCode.AUTOAPROVACAO && auto.every(x => x.action === 'BLOQUEAR'),
     `${auto.length} vs ${EXP.byCode.AUTOAPROVACAO}`);
  const div = await j(await call('/api/queue?sinal=NOME_DIVERGE&limite=100'));
  ok('divergencia nome-CNPJ detectada', div.length === EXP.byCode.NOME_DIVERGE_DO_CNPJ, `${div.length} vs ${EXP.byCode.NOME_DIVERGE_DO_CNPJ}`);
  const lib = await j(await call('/api/queue?acao=LIBERAR&limite=500'));
  ok('nenhum LIBERAR carrega achado de severidade 2 ou 3',
     lib.every(x => (x.findings || []).every(f => f.severity < 2)),
     lib.filter(x => (x.findings||[]).some(f => f.severity >= 2)).slice(0,2).map(x=>x.approval_id).join(','));
  ok('CONFIRMAR nao engoliu pendencia de cadastro',
     (await j(await call('/api/queue?acao=CONFIRMAR&limite=600'))).every(
       x => !(x.findings||[]).some(f => ['BENEFICIARIO_NOVO','SEM_BENEFICIARIO','BENEFICIARIO_ALTA_RECUSA','VALOR_NO_TITULO'].includes(f.code))));
}

console.log('\n== 11. migracao de schema antigo (env.DB sobrevive a updateApp) ==');
{
  const db2 = new DatabaseSync(':memory:');
  // simula a base deixada pela v1: triage com o formato velho
  db2.exec(`CREATE TABLE triage (approval_id INTEGER PRIMARY KEY, run_id INTEGER, action TEXT,
    action_label TEXT, risk INTEGER, why TEXT, age_days REAL, approver TEXT, kind TEXT,
    supplier TEXT, cnpj TEXT, title TEXT, submitted_at TEXT, findings TEXT)`);
  db2.exec(`INSERT INTO triage (approval_id, action) VALUES (1, 'VELHO')`);
  const env2 = { DB: {
    async query(sql, p = []) { if (p.length > 100) throw new Error('too many SQL variables');
      const rows = db2.prepare(sql).all(...p.map(v => v === undefined ? null : v));
      return { columns: rows.length ? Object.keys(rows[0]) : [], rows, rowsRead: rows.length }; },
    async exec(sql, p = []) { if (p.length > 100) throw new Error('too many SQL variables');
      const r = db2.prepare(sql).run(...p.map(v => v === undefined ? null : v));
      return { rowsWritten: Number(r.changes ?? 0) }; } } };
  const mod = await import('/tmp/bundle.js?v=2');
  const c2 = (path, o = {}) => mod.default.fetch(new Request('https://t.local' + path, o), env2);
  let rr = await c2('/api/run', { method: 'POST' }); let bb = await j(rr);
  ok('run sobre base com schema antigo', rr.status === 200, JSON.stringify(bb).slice(0, 200));
  ok('triagem regravada no formato novo', bb.totalPending === 1058, bb.totalPending);
  rr = await c2('/api/health'); bb = await j(rr);
  ok('schema marcado na versao atual', bb.schemaVersion === 3, bb.schemaVersion);
  const q = await j(await c2('/api/queue?acao=BLOQUEAR&limite=50'));
  ok('linha velha some apos migracao', q.every(x => x.action !== 'VELHO') && q.length === EXP.byAction.BLOQUEAR, q.length);
}

console.log(`\n${'='.repeat(46)}\nPASS ${pass}  FAIL ${fail}\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
