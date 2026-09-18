// Sobe o worker contra um SQLite real e exercita todas as rotas + MCP.
import { DatabaseSync } from 'node:sqlite';
import worker from '/tmp/bundle.js';

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
ok('distribuicao de acoes bate', b.byAction?.BLOQUEAR === 11 && b.byAction?.LIBERAR === 328, JSON.stringify(b.byAction));
ok('filas orfas detectadas', b.orphanApprovers === 12, b.orphanApprovers);
const runId = b.runId;

console.log('\n== 3. summary ==');
r = await call('/api/summary'); b = await j(r);
ok('summary 200', r.status === 200);
ok('runId persistido', b.runId === runId, b.runId);
ok('gargalos ordenados desc', b.gargalos[0].pending >= b.gargalos[1].pending);
ok('18926 registros', b.totalRecords === 18926, b.totalRecords);

console.log('\n== 4. queue com filtros ==');
r = await call('/api/queue?acao=BLOQUEAR&limite=50'); const bloq = await j(r);
ok('BLOQUEAR retorna 11', bloq.length === 11, bloq.length);
ok('todos com acao BLOQUEAR', bloq.every(x => x.action === 'BLOQUEAR'));
ok('ordenado por risco desc', bloq[0].risk >= bloq[bloq.length-1].risk);
r = await call('/api/queue?sinal=APROVADOR_INATIVO&limite=200'); const inat = await j(r);
ok('filtro por sinal funciona', inat.length === 41, inat.length);
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
ok('6 ferramentas', m.result?.tools?.length === 6, m.result?.tools?.length);
ok('nomes corretos', m.result.tools.map(t=>t.name).sort().join(',') ===
  'goworker_dossie,goworker_fila,goworker_filas_orfas,goworker_gargalos,goworker_registrar_decisao,goworker_resumo',
  m.result?.tools?.map(t=>t.name).join(','));
m = await rpc('tools/call', { name:'goworker_resumo', arguments:{} });
ok('resumo via MCP', m.result?.structuredContent?.totalPending === 1058, JSON.stringify(m).slice(0,200));
m = await rpc('tools/call', { name:'goworker_filas_orfas', arguments:{} });
ok('filas orfas via MCP', JSON.parse(m.result.content[0].text).length === 12);
m = await rpc('tools/call', { name:'goworker_fila', arguments:{ acao:'REDIRECIONAR', limite:100 } });
ok('fila filtrada via MCP', JSON.parse(m.result.content[0].text).length === 35);
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
ok('triagem nao duplica', (await (await call('/api/queue?acao=BLOQUEAR&limite=200')).json()).length === 11);
r = await call('/api/audit'); b = await j(r);
ok('auditoria acumula', b.length >= 4, b.length);

console.log('\n== 10. rota inexistente ==');
r = await call('/api/nada'); ok('404 com lista de rotas', r.status === 404 && (await j(r)).rotas?.length > 0);

console.log(`\n${'='.repeat(46)}\nPASS ${pass}  FAIL ${fail}\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
