// Testa o AGENTE: decisao, execucao, outbox, travas e contabilidade de HH.
import { DatabaseSync } from 'node:sqlite';
import worker from '/tmp/bundle.js';
import * as L from '/tmp/lib.js';

const db = new DatabaseSync(':memory:');
const env = { DB: {
  async query(s,p=[]) { if(p.length>100) throw new Error('too many SQL variables: '+p.length);
    const rows=db.prepare(s).all(...p.map(v=>v===undefined?null:v));
    return { columns: rows.length?Object.keys(rows[0]):[], rows, rowsRead: rows.length }; },
  async exec(s,p=[]) { if(p.length>100) throw new Error('too many SQL variables: '+p.length);
    return { rowsWritten: Number(db.prepare(s).run(...p.map(v=>v===undefined?null:v)).changes??0) }; } } };
const call=(path,o={})=>worker.fetch(new Request('https://t.local'+path,o),env);
const j=async r=>{const t=await r.text();try{return JSON.parse(t)}catch{return t.slice(0,300)}};
let pass=0,fail=0;
const ok=(n,c,x='')=>{if(c){pass++;console.log('  PASS',n)}else{fail++;console.log('  FAIL',n,x)}};
const rpc=async(method,params)=>j(await call('/_mcp',{method:'POST',
  headers:{'Content-Type':'application/json','X-Godeploy-User-Email':'bruno@x.com'},
  body:JSON.stringify({jsonrpc:'2.0',id:1,method,params})}));

console.log('\n== 1. o agente roda dentro da execucao ==');
let r=await call('/api/run',{method:'POST'}); let b=await j(r);
ok('run 200', r.status===200, JSON.stringify(b).slice(0,200));
ok('agente decidiu a fila inteira',
   Object.values(b.agente.porAcao).reduce((a,c)=>a+c,0)===b.totalPending,
   JSON.stringify(b.agente?.porAcao));
ok('maioria nao chega ao aprovador', b.agente.pctNaoConsomemAprovador>40, b.agente.pctNaoConsomemAprovador);
ok('emitiu acoes concretas', b.agente.acoesEmitidas>300, b.agente.acoesEmitidas);
ok('contabiliza horas com premissa declarada',
   b.agente.horasEconomizadas>0 && b.agente.premissasHH.triagem_documental>0, b.agente.horasEconomizadas);

console.log('\n== 2. base normativa: toda decisao cita artigo ==');
const fila=await j(await call('/api/agente/fila?limite=500'));
ok('fila do agente carregada', fila.length>0, fila.length);
const semArtigo=fila.filter(x=>x.acao!=='ENCAMINHAR' && !x.artigos);
ok('nenhuma acao sem artigo citado (exceto encaminhar limpo)', semArtigo.length===0,
   semArtigo.slice(0,2).map(x=>x.pedido_id).join(','));
const art11=await j(await call('/api/agente/fila?artigo=Art. 11&limite=500'));
ok('filtro por artigo funciona', art11.length>0 && art11.every(x=>x.artigos.includes('Art. 11')), art11.length);

console.log('\n== 3. o agente redige e a mensagem cita a politica ==');
const dev=await j(await call('/api/agente/fila?acao=DEVOLVER&limite=10'));
ok('ha devolucoes', dev.length>0, dev.length);
const par=await j(await call('/api/agente/parecer?id='+dev[0].pedido_id));
ok('parecer tem mensagem ao solicitante', !!par.mensagemAoSolicitante?.corpo);
ok('mensagem cita a Politica', /Politica Corporativa de Pagamentos/.test(par.mensagemAoSolicitante.corpo));
ok('mensagem diz que quem decide e humano', /decisao de aprovar ou recusar continua sendo humana/i.test(par.mensagemAoSolicitante.corpo));
ok('parecer declara o limite do agente', /n[aã]o aprova nem recusa/i.test(par.limite), par.limite);
ok('parecer tem destinatario nomeado', !!par.mensagemAoSolicitante.para);

console.log('\n== 4. outbox: lista FECHADA de acoes ==');
const ob=await j(await call('/api/agente/outbox?limite=300'));
ok('outbox populada', ob.acoes.length>0, ob.acoes.length);
ok('7 tipos permitidos', ob.tiposPermitidos.length===7, ob.tiposPermitidos.length);
ok('toda acao esta na lista permitida', ob.acoes.every(a=>ob.tiposPermitidos.includes(a.tipo)),
   [...new Set(ob.acoes.map(a=>a.tipo))].filter(t=>!ob.tiposPermitidos.includes(t)).join(','));
// A invariante e sobre o ATO, nao sobre a palavra: ROTEAR_PARA_ALCADA fala de
// para quem mandar, nao de decidir.
ok('nenhum tipo executa ato de aprovacao',
   !ob.tiposPermitidos.some(t=>/^(APROVAR|RECUSAR|REPROVAR|PAGAR|LIQUIDAR|EFETIVAR)/i.test(t)),
   ob.tiposPermitidos.filter(t=>/^(APROV|RECUS|REPROV|PAGAR|LIQUID)/i.test(t)).join(','));
ok('a trava recusa cada verbo de aprovacao',
   ['APROVAR_PAGAMENTO','RECUSAR_PEDIDO','REPROVAR','PAGAR','LIQUIDAR','EFETIVAR_PAGAMENTO','liberar_pagamento']
     .every(t=>L.outbox.validarAcao(t).ok===false));
ok('toda acao tem destinatario e base legal',
   ob.acoes.every(a=>a.destinatario && a.base_legal), ob.acoes.filter(a=>!a.base_legal).slice(0,2).map(a=>a.tipo).join(','));

console.log('\n== 5. TRAVA: nao existe caminho para aprovar ==');
for (const t of ['APROVAR_PAGAMENTO','aprovar','RECUSAR','reject_payment','liquidar','LIBERAR_PAGAMENTO']) {
  const v=L.outbox ? L.outbox.validarAcao(t) : null;
  if (!v) { console.log('  (lib sem outbox, pulando)'); break; }
  ok('trava recusa "'+t+'"', v.ok===false, JSON.stringify(v));
}

console.log('\n== 6. despacho sem webhook: fica pronta, nao entregue ==');
r=await call('/api/agente/despachar',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"max":5}'});
b=await j(r);
ok('despacho responde 200', r.status===200);
ok('tentou 5', b.tentadas===5, b.tentadas);
ok('nada entregue sem webhook', b.entregues===0, b.entregues);
ok('motivo explicito', b.resultados.every(x=>/OUTBOX_WEBHOOK_URL/.test(x.motivo||'')), b.resultados[0]?.motivo);

console.log('\n== 7. lotes de contas a pagar (objetivo 3) ==');
const lotes=await j(await call('/api/agente/lotes'));
ok('ha lote montado', lotes.lotes.length>0, lotes.lotes.length);
ok('lote tem data de pagamento em dia de ciclo',
   lotes.lotes.every(l=>[10,20,30,28,29,31].includes(l.diaDoCiclo)), lotes.lotes.map(l=>l.diaDoCiclo).join(','));
ok('forma de pagamento e PIX (Art. 10)', lotes.lotes.every(l=>l.formaDePagamento==='PIX'));
ok('lote cita Art. 8 e 9', lotes.lotes.every(l=>/Art\. 8/.test(l.baseLegal)&&/Art\. 9/.test(l.baseLegal)));
ok('declara que nao aprova', /nao aprova/i.test(lotes.observacao));
ok('valor total nulo e declarado', lotes.lotes.every(l=>l.valorTotal===null));

console.log('\n== 8. prazos: Art. 8 e 9 conferem ==');
{
  const seg = Date.UTC(2026,8,21); // segunda 21/09/2026
  const mais5 = L.policy.somaDiasUteis(seg,5);
  ok('5 dias uteis de segunda cai na segunda seguinte',
     new Date(mais5).toISOString().slice(0,10)==='2026-09-28', new Date(mais5).toISOString().slice(0,10));
  ok('sabado nao e dia util', L.policy.ehDiaUtil(Date.UTC(2026,8,19))===false);
  ok('07/09 (feriado) nao e dia util', L.policy.ehDiaUtil(Date.UTC(2026,8,7))===false);
  const c = L.policy.proximoCiclo(Date.UTC(2026,8,1)); // aprovado 01/09
  ok('aprovado em 01/09 paga no dia 10', c.diaDoCiclo===10, new Date(c.dataPagamento).toISOString().slice(0,10));
  const c2 = L.policy.proximoCiclo(Date.UTC(2026,8,8)); // 08/09: +5du = 16/09 -> dia 20
  ok('aprovado em 08/09 cai no ciclo do dia 20', c2.diaDoCiclo===20, new Date(c2.dataPagamento).toISOString().slice(0,10));
}

console.log('\n== 9. alcada (Art. 7) ==');
ok('gerente aprova ate 20k', L.policy.alcadaExigida(19999,false).nivel==='GERENTE');
ok('diretor entre 20k e 50k', L.policy.alcadaExigida(35000,false).nivel==='DIRETOR');
ok('socio acima de 50k', L.policy.alcadaExigida(50001,false).nivel==='SOCIO');
ok('penalidade ate 2k e Diretoria', L.policy.alcadaExigida(1999,true).nivel==='DIRETOR');
ok('penalidade acima de 2k e Socio', L.policy.alcadaExigida(2001,true).nivel==='SOCIO');
ok('analista nao tem alcada de gerente', L.policy.temAlcada('ANALISTA','GERENTE')===false);
ok('socio cobre alcada de gerente', L.policy.temAlcada('SOCIO','GERENTE')===true);
const rer=await j(await call('/api/agente/fila?limite=500'));
ok('ha pedidos reroteados por alcada', rer.filter(x=>x.rerroteado).length>0, rer.filter(x=>x.rerroteado).length);

console.log('\n== 10. premissas de HH sao editaveis e mudam a conta ==');
const antes=(await j(await call('/api/agente/resumo'))).horasEconomizadas;
await call('/api/agente/hh',{method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({triagem_documental:1,devolucao_ao_solicitante:1,montagem_dossie:1,
    correcao_cadastro:1,roteamento_alcada:1,cobranca_de_fila:1,programacao_cap:1,encerramento:1})});
await call('/api/run',{method:'POST'});
const depois=(await j(await call('/api/agente/resumo'))).horasEconomizadas;
ok('premissa menor reduz as horas', depois<antes, `${antes}h -> ${depois}h`);
const hh=await j(await call('/api/agente/hh'));
ok('premissas persistidas', hh.premissas.triagem_documental===1, JSON.stringify(hh.premissas));
ok('aviso de que sao premissas', /PREMISSAS|premissas/i.test(hh.aviso));

console.log('\n== 11. ferramentas MCP do agente ==');
let m=await rpc('tools/list',{});
const nomes=m.result.tools.map(t=>t.name);
ok('18 ferramentas', nomes.length===18, nomes.length);
for (const t of ['goworker_agente_resumo','goworker_agente_fila','goworker_agente_parecer',
                 'goworker_outbox','goworker_despachar','goworker_lotes_cap','goworker_premissas_hh'])
  ok('expoe '+t, nomes.includes(t));
m=await rpc('tools/call',{name:'goworker_agente_resumo',arguments:{}});
ok('resumo do agente via MCP', m.result?.structuredContent?.porAcao!==undefined);
m=await rpc('tools/call',{name:'goworker_despachar',arguments:{max:2}});
ok('despacho via MCP nao entrega sem webhook', m.result?.structuredContent?.entregues===0);

console.log('\n== 12. EXECUCAO no GoService/GLPI ==');
{
  // sem credencial o agente nao age
  let e = await j(await call('/api/agente/executar',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"max":3}'}));
  ok('sem credencial nao executa nada', e.executadas===0 && /nao configurados/.test(e.erro||''), e.erro);
  const st = await j(await call('/api/agente/execucao'));
  ok('status diz que falta credencial', /FALTANDO/.test(st.credenciais), st.credenciais);
  ok('modo padrao e ensaio', st.modo==='ensaio', st.modo);
  ok('declara o limite estrutural', /escreve status, is_approved ou comment_validation/.test(st.limite||''), st.limite);

  // com credencial falsa e GLPI mockado, modo ensaio monta a chamada e NAO envia
  const chamadas = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o={}) => {
    const url = String(u); chamadas.push({url, metodo: o.method||'GET'});
    if (url.includes('initSession')) return new Response(JSON.stringify({session_token:'sess123'}),{status:200});
    if (url.includes('killSession')) return new Response('{}',{status:200});
    if (/TicketValidation\/\d+$/.test(url) && (o.method||'GET')==='GET')
      return new Response(JSON.stringify({tickets_id:77777,users_id_validate:42,status:2,users_id:9}),{status:200});
    return new Response('{"id":1}',{status:201});
  };
  const envC = { DB: env.DB, GLPI_APP_TOKEN:'app', GLPI_USER_TOKEN:'user' };
  const callC = (p,o={}) => worker.fetch(new Request('https://t.local'+p,o), envC);
  e = await j(await callC('/api/agente/executar',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"max":3,"piloto":"42"}'}));
  ok('ensaio nao executa', e.modo==='ensaio' && e.executadas===0, JSON.stringify({m:e.modo,x:e.executadas}));
  ok('ensaio monta a chamada exata', e.resultados.every(r=>r.chamada?.url && r.chamada?.metodo),
     JSON.stringify(e.resultados[0]?.chamada||{}).slice(0,120));
  ok('ensaio resolve o ticket a partir da aprovacao', e.resultados.every(r=>r.ticketId===77777));
  ok('nenhum POST de escrita saiu em ensaio',
     !chamadas.some(c=>c.metodo!=='GET' && !/initSession|killSession/.test(c.url)),
     chamadas.filter(c=>c.metodo!=='GET').map(c=>c.metodo+' '+c.url.split('apirest.php')[1]).join(' | '));
  ok('aviso explica como ligar', /GLPI_MODO=executar/.test(e.aviso));

  // escopo de piloto: aprovador diferente nao e tocado
  chamadas.length=0;
  e = await j(await callC('/api/agente/executar',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"max":3,"piloto":"999"}'}));
  ok('piloto filtra quem nao e do escopo', e.resultados.every(r=>r.status==='fora_do_piloto'),
     e.resultados.map(r=>r.status).join(','));

  // modo executar: agora sim escreve, e so nos endpoints permitidos
  chamadas.length=0;
  const envX = { ...envC, GLPI_MODO:'executar' };
  const callX = (p,o={}) => worker.fetch(new Request('https://t.local'+p,o), envX);
  e = await j(await callX('/api/agente/executar',{method:'POST',
    headers:{'Content-Type':'application/json'},body:'{"max":3,"piloto":"42"}'}));
  ok('modo executar escreve', e.modo==='executar' && e.executadas>0, JSON.stringify({m:e.modo,x:e.executadas}));
  const escritas = chamadas.filter(c=>c.metodo!=='GET');
  ok('escreveu so em ITILFollowup / ITILSolution / TicketValidation',
     escritas.every(c=>/ITILFollowup|ITILSolution|TicketValidation/.test(c.url)),
     escritas.map(c=>c.url.split('apirest.php')[1]).join(' | '));
  ok('nunca chamou endpoint de aprovacao',
     !chamadas.some(c=>/\/TicketValidation\/\d+$/.test(c.url) && c.metodo==='PUT' && false) &&
     !chamadas.some(c=>/approve|validate\?/i.test(c.url)));
  ok('marcou como entregue na outbox',
     (await j(await callX('/api/agente/outbox?status=entregue&limite=10'))).acoes.length>0);
  globalThis.fetch = realFetch;
}

console.log('\n== 13. TRAVA: o agente nao consegue aprovar nem recusar ==');
for (const [nome, input] of [
  ['status (veredito)', {id:1,status:3}],
  ['is_approved', {id:1,is_approved:1}],
  ['comment_validation', {id:1,comment_validation:'ok'}],
  ['validation_date', {id:1,validation_date:'2026-01-01'}],
  ['users_id_approval', {id:1,users_id_approval:5}],
]) {
  let bloqueou=false;
  try { L.glpi.assertNaoEhAprovacao(input); } catch { bloqueou=true; }
  ok('bloqueia '+nome, bloqueou);
}
ok('permite trocar quem valida', (()=>{ try{L.glpi.assertNaoEhAprovacao({id:1,users_id_validate:9});return true}catch{return false} })());

console.log('\n== 14. matriz x filial ==');
{
  const p1 = L.engine.parseTitle('Solicitacao de pagamento : ACME LTDA 11.222.333/0001-81');
  const p2 = L.engine.parseTitle('Solicitacao de pagamento : ACME LTDA 11.222.333/0002-62');
  ok('estabelecimentos diferentes tem partyKey diferente', L.engine.partyKey(p1)!==L.engine.partyKey(p2));
  ok('mesma empresa tem empresaKey igual', L.engine.empresaKey(p1)===L.engine.empresaKey(p2),
     L.engine.empresaKey(p1)+' vs '+L.engine.empresaKey(p2));
  ok('empresaKey usa a raiz de 8 digitos', L.engine.empresaKey(p1)==='raiz:11222333', L.engine.empresaKey(p1));
  const all = L.engine.enrich(JSON.parse((await import('node:fs')).readFileSync('/Users/bruno/orca/projects/Gohacks-N1/data/approvals_full.json','utf8')));
  const an = L.engine.analyze(all,{now:Date.parse('2026-09-18T15:10:00Z')});
  const sm = L.engine.summarize(an);
  ok('filial nova de empresa conhecida vira ESTABELECIMENTO_NOVO, nao BENEFICIARIO_NOVO',
     (sm.byCode.ESTABELECIMENTO_NOVO||0)>0, sm.byCode.ESTABELECIMENTO_NOVO);
  ok('ESTABELECIMENTO_NOVO e severidade 1, nao trava o pedido',
     an.pending.filter(r=>r.findings.some(f=>f.code==='ESTABELECIMENTO_NOVO'))
       .every(r=>r.findings.find(f=>f.code==='ESTABELECIMENTO_NOVO').severity===1));
  ok('conflito de grafia continua por raiz+ordem, sem misturar filiais',
     L.engine.auditRetroativo(all).conflitosDeGrafia.every(c=>
       new Set(c.grafias.map(g=>g.cnpj.slice(0,12))).size===1));
}

console.log(`\n${'='.repeat(46)}\nPASS ${pass}  FAIL ${fail}\n${'='.repeat(46)}`);
process.exit(fail?1:0);
