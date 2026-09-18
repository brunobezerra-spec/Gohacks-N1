// Sobe o worker contra um SQLite real e exercita todas as rotas + MCP.
import { DatabaseSync } from 'node:sqlite';
import worker from '/tmp/bundle.js';
// pelo bundle, nao pelos .ts soltos: o engine importa './regras' sem extensao,
// que o Node nao resolve mas o bundler sim.
import * as L from '/tmp/lib.js';
import { expandSnapshot } from '/Users/bruno/orca/projects/Gohacks-N1/goworker/src/snapshot.ts';
const engine = L.engine;

// Expectativas calculadas na hora, com o mesmo relogio do servidor. Assim o teste
// valida a LIGACAO servidor<->motor sem envelhecer toda vez que uma regra muda.
const ANALISE = engine.analyze(engine.enrich(expandSnapshot()));
const EXP = engine.summarize(ANALISE);
// A lixeira sai da base de trabalho (regra 1), entao as contagens da fila sao
// sobre o que NAO foi arquivado. Calculamos o mesmo recorte aqui.
const AG = L.agent.processarFila(ANALISE.pending, L.agent.montarContexto(engine.enrich(expandSnapshot()), {}));
const NA_LIXEIRA = new Set(AG.itens.filter(x => x.acao === 'ARQUIVAR_NA_LIXEIRA').map(x => x.id));
const TRABALHO = ANALISE.pending.filter(r => !NA_LIXEIRA.has(r.id));
const contaTrabalho = (f) => TRABALHO.filter(f).length;
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
ok('pendentes = motor', b.totalPending === EXP.totalPending, `${b.totalPending} vs ${EXP.totalPending}`);
ok('origem snapshot', String(b.origem).includes('snapshot'), b.origem);
ok('distribuicao de acoes = motor', JSON.stringify(b.byAction) === JSON.stringify(EXP.byAction), JSON.stringify(b.byAction));
ok('filas orfas = motor', b.orphanApprovers === EXP.orphanApprovers && b.orphanPending === EXP.orphanPending, `${b.orphanApprovers}/${b.orphanPending}`);
const runId = b.runId;

console.log('\n== 3. summary ==');
r = await call('/api/summary'); b = await j(r);
ok('summary 200', r.status === 200);
ok('runId persistido', b.runId === runId, b.runId);
ok('gargalos ordenados desc', b.gargalos[0].pending >= b.gargalos[1].pending);
ok('registros = snapshot', b.totalRecords === expandSnapshot().length, b.totalRecords);

console.log('\n== 4. queue com filtros ==');
r = await call('/api/queue?acao=BLOQUEAR&limite=500'); const bloq = await j(r);
ok('BLOQUEAR = base de trabalho', bloq.length === contaTrabalho(r => r.action === 'BLOQUEAR'), `${bloq.length} vs ${contaTrabalho(r => r.action === 'BLOQUEAR')}`);
ok('todos com acao BLOQUEAR', bloq.every(x => x.action === 'BLOQUEAR'));
ok('ordenado por risco desc', bloq[0].risk >= bloq[bloq.length-1].risk);
r = await call('/api/queue?sinal=APROVADOR_INATIVO&limite=200'); const inat = await j(r);
ok('filtro por sinal = base de trabalho', inat.length === contaTrabalho(r => r.findings.some(f => f.code === 'APROVADOR_INATIVO')), inat.length);
r = await call('/api/queue?aprovador=joao.conde&limite=500'); const jc = await j(r);
ok('filtro por aprovador', jc.length === contaTrabalho(r => r.approver === 'joao.conde') && jc.every(x=>x.approver==='joao.conde'), jc.length);

console.log('\n== 5. dossie ==');
const alvo = bloq[0].approval_id;
r = await call('/api/item?id=' + alvo); b = await j(r);
ok('dossie 200', r.status === 200);
ok('tem recomendacao', !!b.recomendacao?.acao);
ok('tem sinais', Array.isArray(b.sinais) && b.sinais.length > 0);
ok('declara limite de dados', String(b.limiteConhecido).includes('não estão disponíveis'));
ok('declara decisao humana', String(b.decisaoFinal).includes('não aprova nem recusa'));
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
ok('22 ferramentas', m.result?.tools?.length === 22, m.result?.tools?.length);
ok('nomes corretos', m.result.tools.map(t=>t.name).sort().join(',') ===
  ['goworker_agente_fila','goworker_agente_parecer','goworker_agente_resumo','goworker_auditoria_retroativa',
   'goworker_despachar','goworker_diagnostico_de_perfil','goworker_dossie','goworker_executar','goworker_fila',
   'goworker_filas_orfas','goworker_gargalos','goworker_lixeira','goworker_lotes_cap','goworker_motivos_de_recusa',
   'goworker_outbox','goworker_premissas_hh','goworker_regras','goworker_registrar_decisao','goworker_restaurar_da_lixeira',
   'goworker_resumo','goworker_status_execucao','goworker_tipos_de_alto_risco'].sort().join(','),
  m.result?.tools?.map(t=>t.name).join(','));
m = await rpc('tools/call', { name:'goworker_auditoria_retroativa', arguments:{} });
{ const A = m.result?.structuredContent;
  ok('aprovados com doc invalido = 162', A?.aprovadosComDocInvalido === 162 && A.aprovadosComDocInvalido === EXP_RETRO.aprovadosComDocInvalido, A?.aprovadosComDocInvalido);
  ok('9 conflitos de grafia', A?.totalConflitos === 9, A?.totalConflitos);
  const sefaz = A?.conflitosDeGrafia?.[0];
  ok('SEFAZ SP com 88 aprovados em grafia invalida', sefaz?.aprovadosEmGrafiaInvalida === 88, sefaz?.aprovadosEmGrafiaInvalida);
  ok('SEFAZ SP tem 3 grafias, 1 valida', sefaz?.grafias?.length === 3 && sefaz.grafias.filter(g=>g.valido).length === 1); }
m = await rpc('tools/call', { name:'goworker_resumo', arguments:{} });
ok('resumo via MCP', m.result?.structuredContent?.totalPending === EXP.totalPending, m.result?.structuredContent?.totalPending);
m = await rpc('tools/call', { name:'goworker_filas_orfas', arguments:{} });
ok('filas orfas via MCP', JSON.parse(m.result.content[0].text).length === EXP.orphanApprovers);
m = await rpc('tools/call', { name:'goworker_fila', arguments:{ acao:'REDIRECIONAR', limite:100 } });
ok('fila filtrada via MCP', JSON.parse(m.result.content[0].text).length === contaTrabalho(r => r.action === 'REDIRECIONAR'));
m = await rpc('tools/call', { name:'goworker_dossie', arguments:{ id: alvo } });
ok('dossie via MCP', !!m.result?.structuredContent?.recomendacao);
m = await rpc('tools/call', { name:'goworker_registrar_decisao', arguments:{ id: alvo, decisao:'adiado' } });
ok('registrar decisao', m.result?.structuredContent?.registrado === true);
ok('avisa que nao escreve no GoService',
   String(m.result?.structuredContent?.aviso).includes('continua sendo manual'), m.result?.structuredContent?.aviso);
m = await rpc('tools/call', { name:'inexistente', arguments:{} });
ok('ferramenta inexistente = erro JSON-RPC', m.error?.code === -32602);

console.log('\n== 8. SEGURANCA: o agente escreve, mas nao decide ==');
{
  const src = (await import('node:fs')).readFileSync('/tmp/bundle.js','utf8');

  // O bundle tem DUAS coisas que nao sao codigo do agente e poluem qualquer
  // varredura: o snapshot (dado escrito por usuario no GLPI) e o pdf.js
  // (biblioteca de terceiro, que carrega dezenas de URL de namespace XML como
  // string). As duas sao isoladas ANTES da checagem, e cada isolamento tem
  // asserçao propria: um filtro que silenciosamente nao encontrasse nada
  // deixaria as checagens passando sobre texto vazio.
  //
  // O esbuild marca a origem de cada trecho com um comentario de banner. Isso
  // separa o que e nosso do que e vendorizado sem depender de heuristica.
  const banners = [...src.matchAll(/^\/\/ (node_modules\/|src\/|test\/).*$/gm)]
    .map(m => ({ origem: m[0].slice(3), i: m.index }));
  const regiao = (filtro) => banners
    .map((b, k) => ({ ...b, fim: k + 1 < banners.length ? banners[k + 1].i : src.length }))
    .filter(b => filtro(b.origem))
    .map(b => src.slice(b.i, b.fim)).join('');

  const nosso = regiao(o => o.startsWith('src/'));
  ok('bundle separado por origem', banners.length > 10 && nosso.length > 100_000,
     `${banners.length} banners, ${nosso.length} bytes nossos`);

  // A varredura so vale se a lista de terceiros for a esperada. Dependencia
  // nova entra por aqui e derruba o teste, que e o ponto: alguem tem que olhar.
  const pacotes = [...new Set(banners.filter(b => b.origem.startsWith('node_modules/'))
    .map(b => b.origem.split('/')[1]))];
  ok('dependencia de terceiro e so a esperada',
     pacotes.length === 1 && pacotes[0] === 'unpdf', pacotes.join(', '));

  const ini = nosso.indexOf('SNAPSHOT =');
  const fim = nosso.indexOf('expandSnapshot', ini);
  const semDados = ini >= 0 && fim > ini ? nosso.slice(0, ini) + nosso.slice(fim) : nosso;
  const code = semDados.replace(/\/\*[\s\S]*?\*\//g,'')
    .split('\n').filter(l => !l.trim().startsWith('//')).join('\n');

  // Nao e razao sobre o bundle inteiro: com o pdf.js dentro, o snapshot deixou
  // de ser metade do arquivo sem ter encolhido um byte. O que importa e que o
  // bloco foi ACHADO e removido, e ele tem mais de 1 MB.
  ok('snapshot isolado antes da checagem',
     ini >= 0 && fim > ini && nosso.length - semDados.length > 1_000_000,
     `${nosso.length - semDados.length} bytes removidos`);

  // O app AGORA escreve no GLPI de proposito. A garantia nao e mais "nao toca
  // em rede": e que ele nao consegue tomar a decisao de pagamento.
  ok('nunca chama review_approval do MCP', !/review_approval/.test(code));

  // 1. Um unico host externo NO CODIGO DO AGENTE. O pdf.js ficou de fora da
  //    varredura porque carrega w3.org, ns.adobe.com e xfa.org como string de
  //    namespace XML. A contrapartida e a asserçao acima: se aparecer uma
  //    dependencia nova, o teste cai antes de chegar aqui.
  const hosts = [...new Set((code.match(/https?:\/\/[a-z0-9.-]+/gi) || []).map(h => h.toLowerCase()))];
  ok('um unico host externo, o proprio GoService',
     hosts.length === 1 && hosts[0] === 'https://goservice.gocase.com.br', hosts.join(', '));

  // 2. Escrita so nos tres endpoints necessarios.
  const escritas = [...new Set((code.match(/\$\{GLPI_BASE\}\/[A-Za-z]+/g) || []))];
  ok('endpoints do GLPI restritos ao necessario',
     escritas.every(e => /initSession|killSession|changeActiveProfile|getActiveProfile|ITILFollowup|ITILSolution|TicketValidation|search/.test(e)),
     escritas.join(', '));

  // 3. A trava de veredito existe e roda antes de montar a requisicao.
  ok('existe trava de campos de veredito', /CAMPOS_DE_VEREDITO/.test(code));
  for (const campo of ['status','is_approved','comment_validation','validation_date','users_id_approval'])
    ok('trava cobre o campo ' + campo, code.includes(`"${campo}"`) || code.includes(`'${campo}'`));
  ok('a trava e chamada antes de trocar o aprovador', /assertNaoEhAprovacao\s*\(\s*input\s*\)/.test(code));

  // 4. Executar exige credencial E modo explicito.
  ok('modo padrao e ensaio, executar precisa ser ligado no secret',
     code.includes('GLPI_MODO') && /"on"|"executar"|"ligado"/.test(code) && code.includes('"ensaio"'));
  ok('sem credencial nao ha sessao', /credenciaisOk/.test(code));
}

console.log('\n== 9. re-run e idempotencia ==');
r = await call('/api/run', { method:'POST' }); b = await j(r);
ok('segundo run 200', r.status === 200);
ok('triagem nao duplica', (await (await call('/api/queue?acao=BLOQUEAR&limite=500')).json()).length === contaTrabalho(r => r.action === 'BLOQUEAR'));
r = await call('/api/audit'); b = await j(r);
ok('auditoria acumula', b.length >= 4, b.length);

console.log('\n== 10. rota inexistente ==');
r = await call('/api/nada'); ok('404 com lista de rotas', r.status === 404 && (await j(r)).rotas?.length > 0);

console.log('\n== 7b. priorizacao e motivos de recusa ==');
{
  let mm = await rpc('tools/call', { name:'goworker_tipos_de_alto_risco', arguments:{} });
  const T = mm.result?.structuredContent;
  ok('3 tipos sobrevivem a Bonferroni', T?.tipos?.length === 3, T?.tipos?.length);
  ok('todos com p ajustado < 0.05', T.tipos.every(t => t.pAjustado < 0.05), JSON.stringify(T.tipos.map(t=>t.pAjustado)));
  ok('encolhimento reduz o lift de amostra pequena',
     T.tipos.find(t=>t.kind==='novo_servico')?.liftEncolhido < T.tipos.find(t=>t.kind==='novo_servico')?.lift);
  mm = await rpc('tools/call', { name:'goworker_motivos_de_recusa', arguments:{} });
  const M = mm.result?.structuredContent;
  ok('152 recusas com motivo registrado', M?.recusas === 152 && M?.comMotivoRegistrado === 152,
     `${M?.recusas}/${M?.comMotivoRegistrado}`);
  ok('motivos que dependem de campo financeiro contabilizados', M?.dependemDeCampoFinanceiro > 0, M?.dependemDeCampoFinanceiro);
  const fila = await j(await call('/api/queue?limite=300'));
  ok('fila ordenada por prioridade decrescente',
     fila.every((x,i) => i===0 || fila[i-1].prioridade >= x.prioridade),
     fila.slice(0,4).map(x=>x.prioridade).join(','));
  ok('prioridade fica entre 0 e 100', fila.every(x => x.prioridade >= 0 && x.prioridade <= 100));
  const compras = await j(await call('/api/queue?tipo=compra&limite=100'));
  ok('filtro por tipo funciona', compras.length > 0 && compras.every(x => x.kind === 'compra'), compras.length);
}

console.log('\n== 10b. regressoes apontadas pelo red team ==');
{
  const todos = await j(await call('/api/queue?limite=500'));
  const acha = (re) => todos.find(x => re.test(x.title || ''));
  const pctec = acha(/PCTEC/i);
  ok('fornecedor com AUTOMACAO no nome nao vira ARQUIVAR', !pctec || pctec.action !== 'ARQUIVAR', pctec?.action);
  const auto = await j(await call('/api/queue?sinal=AUTOAPROVACAO&limite=100'));
  // AUTOAPROVACAO agora roteia (regra 14: "ROTEAR_PARA_ALCADA(alguem que nao solicitou)")
  const autoAg = await j(await call('/api/agente/fila?acao=ROTEAR&limite=500'));
  ok('autoaprovacao roteia para outra pessoa',
     autoAg.some(x => /segregacao|solicitante e aprovador/i.test(x.porque || '')), autoAg.length);
  const div = await j(await call('/api/queue?sinal=NOME_DIVERGE&limite=100'));
  ok('divergencia nome-CNPJ detectada', div.length === contaTrabalho(r => r.findings.some(f => f.code === 'NOME_DIVERGE_DO_CNPJ')), div.length);
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
  ok('triagem regravada no formato novo', bb.totalPending === EXP.totalPending, bb.totalPending);
  rr = await c2('/api/health'); bb = await j(rr);
  ok('schema marcado na versao atual', bb.schemaVersion === 8, bb.schemaVersion);
  const q = await j(await c2('/api/queue?acao=BLOQUEAR&limite=500'));
  ok('linha velha some apos migracao', q.every(x => x.action !== 'VELHO') && q.length === contaTrabalho(r => r.action === 'BLOQUEAR'), q.length);
}

console.log('\n== login canonico do aprovador (Art. 7 nao pode ser pulado) ==');
{
  // O GLPI grava o mesmo aprovador ora como login, ora como e-mail. Se as duas
  // formas nao colapsarem, a alcada nao e checada e o pedido passa limpo.
  const base = {
    validationId: 1, ticketId: 1, statusLabel: 'Aguardando',
    submissionDate: '2026-09-10 10:00:00', validationDate: null,
    paymentRequestTitle: 'Solicitacao de pagamento : ACME LTDA 11.222.333/0001-81 ',
    fornecedor: 'ACME LTDA', valor: 100, vencimento: '2026-10-01',
  };
  const e = L.engine.enrich([
    { ...base, approver: 'Carla.Alencar@gobeaute.com.br', requester: 'X.Y@gocase.com.br' },
    { ...base, validationId: 2, approver: ' carla.alencar ' },
  ]);
  ok('e-mail do aprovador vira login', e[0].approver === 'carla.alencar', e[0].approver);
  ok('as duas grafias colapsam no mesmo login', e[0].approver === e[1].approver, e[1].approver);
  ok('solicitante tambem e canonizado', e[0].requester === 'x.y', e[0].requester);
}

console.log('\n== aprovador do piloto tem nivel declarado ==');
{
  const src = (await import('node:fs')).readFileSync('src/aprovadores.ts', 'utf8');
  const niv = {};
  for (const m of src.matchAll(/"([a-z0-9._-]+)":\s*"(SOCIO|DIRETOR|GERENTE|COORDENADOR|ANALISTA|DESCONHECIDO)"/g)) niv[m[1]] = m[2];
  ok('vinicius.nishide mapeado como DIRETOR', niv['vinicius.nishide'] === 'DIRETOR', niv['vinicius.nishide']);
  // Todo login que o Teamguide conhece com cargo precisa ter nivel aqui, senao
  // o Art. 7 e pulado em silencio para ele.
  const tg = (await import('node:fs')).readFileSync('src/teamguide.ts', 'utf8');
  const semNivel = [];
  for (const m of tg.matchAll(/"([a-z0-9._-]+)":\s*\{\s*"ativo":\s*true,\s*"nome":\s*"[^"]*",\s*"cargo":\s*"[^"]*"/g))
    if (!niv[m[1]]) semNivel.push(m[1]);
  ok('nenhum ativo do Teamguide fica sem nivel', semNivel.length === 0, semNivel.join(','));
}

console.log(`\n${'='.repeat(46)}\nPASS ${pass}  FAIL ${fail}\n${'='.repeat(46)}`);
process.exit(fail ? 1 : 0);
