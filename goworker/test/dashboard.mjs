// Renderiza o dashboard num DOM real, alimentado pelo payload que o servidor devolve.
import { JSDOM } from '/Users/bruno/orca/projects/Gohacks-N1/goworker/node_modules/jsdom/lib/api.js';
import fs from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import worker from '/tmp/bundle.js';

const db = new DatabaseSync(':memory:');
const env = { DB: {
  async query(s,p=[]) { const rows=db.prepare(s).all(...p.map(v=>v===undefined?null:v));
    return { columns: rows.length?Object.keys(rows[0]):[], rows, rowsRead: rows.length }; },
  async exec(s,p=[]) { return { rowsWritten: Number(db.prepare(s).run(...p.map(v=>v===undefined?null:v)).changes??0) }; } } };
const api = (path, o={}) => worker.fetch(new Request('https://t.local'+path, o), env);
await api('/api/run', { method: 'POST' });

const html = fs.readFileSync('/Users/bruno/orca/projects/Gohacks-N1/goworker/public/index.html','utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://t.local/' });
const erros = [];
dom.virtualConsole.on('jsdomError', e => erros.push('jsdomError: ' + e.message));
dom.window.addEventListener('error', e => erros.push('window.error: ' + e.message));
dom.window.fetch = async (u) => { const r = await api(String(u).replace('https://t.local','')); 
  return { json: async () => JSON.parse(await r.text()), status: r.status }; };
dom.window.HTMLDialogElement.prototype.showModal = function(){ this.setAttribute('open',''); };
dom.window.HTMLDialogElement.prototype.close = function(){ this.removeAttribute('open'); };

// re-executa o script agora que o fetch existe
const src = html.match(/<script>([\s\S]*)<\/script>/)[1];
try { dom.window.eval(src); } catch (e) { erros.push('eval: ' + e.message); }
await new Promise(r => setTimeout(r, 900));

const d = dom.window.document;
const t = (sel) => (d.querySelector(sel)?.textContent || '').replace(/\s+/g,' ').trim();
let pass=0, fail=0;
const ok=(n,c,x='')=>{ if(c){pass++;console.log('  PASS',n);} else {fail++;console.log('  FAIL',n,x);} };

console.log('== painel do agente ==');
ok('KPIs do agente renderizam', d.querySelectorAll('#agKpis .kpi').length === 5, d.querySelectorAll('#agKpis .kpi').length);
ok('mostra quantos nao chegam ao diretor', t('#agKpis').includes('nunca chegam ao diretor'));
ok('mostra horas substituidas', /\d+h/.test(t('#agKpis')));
ok('tabela de acoes do agente', d.querySelectorAll('#agAcoes tbody tr').length >= 4, d.querySelectorAll('#agAcoes tbody tr').length);
ok('acoes mostram o dono da bola', t('#agAcoes').includes('solicitante') && t('#agAcoes').includes('aprovador'));
ok('outbox renderiza com base legal', t('#agOutbox').includes('Art.'), t('#agOutbox').slice(0,80));
ok('declara a lista fechada e a trava', t('#agTrava').includes('Nenhuma delas aprova ou recusa'));
ok('lotes de CAP com data e PIX', t('#agLotes').includes('PIX'), t('#agLotes').slice(0,80));
ok('declara por que o valor e nulo', t('#agLotes').includes('não é legível'));

console.log('\n== parecer do agente (modal) ==');
{
  const linha = d.querySelector('#agOutbox tbody tr');
  const idm = linha && linha.getAttribute('onclick').match(/\d+/);
  if (idm) {
    await dom.window.verParecer(Number(idm[0]));
    await new Promise(r => setTimeout(r, 400));
    const body = t('#dbody');
    ok('parecer abriu', d.querySelector('#dlg').hasAttribute('open'));
    ok('parecer mostra base normativa', body.includes('Base normativa'));
    ok('parecer mostra roteamento de alcada', body.includes('Roteamento de alçada'));
    ok('parecer declara o limite do agente', /não aprova nem recusa/i.test(body));
    ok('sem undefined no parecer do agente', !body.includes('undefined'),
       (body.match(/.{0,40}undefined.{0,40}/)||[''])[0]);
  } else { ok('parecer abriu', false, 'sem linha na outbox'); }
}

console.log('\n== dashboard renderizado ==');
ok('sem erro de JS', erros.length===0, erros.join(' | '));
ok('titulo presente', t('h1')==='Goworker do Financeiro', t('h1'));
ok('cabecalho tem a execucao', /execução #\d+ .* \d{2}\.\d{3} registros/.test(t('#run')), t('#run'));
const kpis = [...d.querySelectorAll('#kpis .kpi')];
ok('7 KPIs (6 base + auditoria retroativa)', kpis.length===7, kpis.length);
ok('KPI de fila mostra o total de parados', /\d\.\d{3}parados na fila/.test(t('#kpis').replace(/\s+/g,'')) || /1\.0\d\d/.test(t('#kpis')), t('#kpis').slice(0,90));
ok('KPI de auditoria mostra 162', t('#kpis').includes('162'), '');
const tabs=[...d.querySelectorAll('#tabs .tab')].map(x=>x.textContent.trim());
ok('abas = as 6 acoes', tabs.length===6, tabs.join(' | '));
console.log('    abas:', tabs.join(' | '));
const rows=[...d.querySelectorAll('#rows tr')];
ok('tabela da fila preenchida', rows.length>0 && rows.length<=80, rows.length);
ok('primeira linha e BLOQUEAR', (rows[0]?.textContent||'').includes('BLOQUEAR'), (rows[0]?.textContent||'').slice(0,60));
ok('tabela de orfas preenchida', d.querySelectorAll('#orfas tr').length>0);
ok('tabela de gargalos preenchida', d.querySelectorAll('#gargalos tr').length>0);
const retro=t('#retro');
ok('auditoria retroativa renderiza SEFAZ', retro.includes('SEFAZ') && retro.includes('INVÁLIDO'), retro.slice(0,150));
ok('mostra 88 aprovados em grafia invalida', retro.includes('88'), '');
ok('rodape lista os sinais', t('#foot').includes('FILA_ZUMBI'));
ok('rodape declara que nao escreve', t('#foot').includes('não tem credencial de escrita'));

ok('painel de tipos de alto risco', t('#tipos').includes('estorno') && t('#tipos').includes('compra'), t('#tipos').slice(0,90));
ok('mostra lift encolhido', t('#tipos').includes('×'), '');
ok('nota explica Bonferroni', t('#notaPrio').includes('Bonferroni'));
ok('painel de motivos de recusa', t('#motivos').includes('centro de custo'), t('#motivos').slice(0,90));
ok('motivos marcam o que depende de valor', t('#motivos').includes('precisa de valor'), '');
ok('coluna Prio no cabecalho da fila', [...d.querySelectorAll('thead')].some(h => h.textContent.includes('Prio')));

console.log('\n== dossie (modal) ==');
const id = rows[0].getAttribute('onclick').match(/\d+/)[0];
dom.window.abrir(Number(id));
await new Promise(r => setTimeout(r, 500));
const body = t('#dbody');
ok('modal abriu', d.querySelector('#dlg').hasAttribute('open'));
ok('dossie tem recomendacao', body.includes('Recomendação do agente'), body.slice(0,80));
ok('dossie lista sinais', /Sinais \(\d+\)/.test(body));
ok('dossie declara decisao humana', body.includes('não aprova nem recusa'));
ok('dossie declara limite de dados', body.includes('não estão disponíveis') || body.includes('NAO estao disponiveis'));
ok('sem "undefined" vazando na tela', !body.includes('undefined') && !t('#kpis').includes('undefined') && !retro.includes('undefined'),
   (body.match(/.{0,40}undefined.{0,40}/)||[''])[0]);

console.log(`\nPASS ${pass}  FAIL ${fail}`);
process.exit(fail?1:0);
