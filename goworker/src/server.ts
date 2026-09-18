import { handleMcp } from "./mcp/shim";
import { defineMcp } from "./mcp/define";
import { enrich, analyze, summarize, auditRetroativo, motivosDeRecusa, ACOES, ZOMBIE_DAYS, APPROVER_IDLE_DAYS } from "./engine";
import { expandSnapshot } from "./snapshot";
import { montarContexto, processarFila, montarLotesCAP, acoesDoItem, processar, ACOES_AGENTE, HH_PADRAO } from "./agent";
import { despachar, validarAcao, TIPOS_PERMITIDOS } from "./outbox";
import { executar as executarGlpi, credenciaisOk, modo as modoGlpi, assertNaoEhAprovacao, diagnosticoDePerfil } from "./glpi";
import { NIVEIS_APROVADORES } from "./aprovadores";
import { REGRAS } from "./regras";

// ============================================================================
// Goworker do Financeiro
// Assume a FILA de aprovacao de pagamentos. Nunca assume a DECISAO.
// Este app nao tem, e nao deve ter, credencial de escrita no GLPI/GoService.
// Aprovar e recusar continuam sendo ato humano, fora daqui.
// ============================================================================

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS approvals (
     id INTEGER PRIMARY KEY, status TEXT, approver TEXT, requester TEXT,
     title TEXT, submitted_at TEXT, decided_at TEXT,
     comment_submission TEXT, comment_validation TEXT, ingested_at TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_appr_status ON approvals(status)`,
  `CREATE INDEX IF NOT EXISTS ix_appr_approver ON approvals(approver)`,
  `CREATE TABLE IF NOT EXISTS runs (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ran_at TEXT, source TEXT,
     total_records INTEGER, total_pending INTEGER, summary TEXT)`,
  // Uma linha por pedido, nao duas. env.DB e RPC: cada statement e uma ida na
  // rede, e 300 idas por execucao derrubavam a conexao. Colunas so para o que a
  // API filtra; todo o resto (dossie, violacoes, mensagem, plano de CAP) vai
  // num JSON so.
  // DUAS colunas. env.DB e RPC e cada statement e uma ida na rede; com 9 colunas
  // so cabiam 10 linhas por statement (limite de ~90 variaveis ligadas) e a
  // execucao fazia 195 idas, o bastante para derrubar a conexao. Com 2 colunas
  // cabem 30 linhas e sobram 36 statements. O filtro sai por json_extract, que
  // em 1.058 linhas custa nada.
  `CREATE TABLE IF NOT EXISTS triage (approval_id INTEGER PRIMARY KEY, doc TEXT)`,
  // Outbox: o que o agente emite para o mundo. Lista fechada de tipos.
  `CREATE TABLE IF NOT EXISTS outbox (
     id INTEGER PRIMARY KEY AUTOINCREMENT, tipo TEXT, pedido_id INTEGER, status TEXT,
     doc TEXT, despachado_em TEXT, resultado TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_out_status ON outbox(status)`,
  `CREATE INDEX IF NOT EXISTS ix_out_tipo ON outbox(tipo)`,
  // LIXEIRA (regra 1 do handoff). Area de retencao restauravel, fora da base de
  // trabalho. E ela que separa higienizacao de perda: sem consulta e sem
  // restauracao, a regra viraria exclusao com outro nome.
  // Retencao: nao expira. Decisao do Vinicius pendente; ate la nada e descartado.
  `CREATE TABLE IF NOT EXISTS lixeira (
     pedido_id INTEGER PRIMARY KEY, motivo TEXT, dias_sem_movimento INTEGER,
     movido_em TEXT, execucao INTEGER, snapshot TEXT,
     restaurado_em TEXT, restaurado_por TEXT, busca TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_lix_rest ON lixeira(restaurado_em)`,
  `CREATE TABLE IF NOT EXISTS audit (
     id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT, actor TEXT,
     approval_id INTEGER, event TEXT, detail TEXT)`,
];

// O SQLite do GoDeploy aceita no maximo ~100 variaveis ligadas por statement.
// (node:sqlite local aceita 32k, o que escondeu esse bug no teste ate a v1.)
export const MAX_SQL_VARS = 90;
const chunkFor = (cols: number) => Math.max(1, Math.floor(MAX_SQL_VARS / cols));

// env.DB sobrevive a updateApp, entao CREATE TABLE IF NOT EXISTS NAO migra uma
// tabela cujo formato mudou. Versionamos o schema e recriamos o que e derivado.
export const SCHEMA_VERSION = 8;

let ready = false;
async function init(env: any) {
  if (ready) return;
  await env.DB.exec("CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT)", []);
  const cur = await env.DB.query("SELECT v FROM meta WHERE k = 'schema_version'", []);
  const atual = Number(cur.rows?.[0]?.v ?? 0);

  if (atual < SCHEMA_VERSION) {
    // triage e 100% derivada: recriar e barato e nao perde nada.
    // approvals, runs e audit sao preservadas.
    console.log(`[schema] migrando ${atual} -> ${SCHEMA_VERSION}: recriando triage`);
    await env.DB.exec("DROP TABLE IF EXISTS triage", []);
    await env.DB.exec("DROP TABLE IF EXISTS outbox", []);
    // a lixeira NAO e recriada em migracao: perderia o que foi arquivado.
  }
  for (const stmt of SCHEMA) await env.DB.exec(stmt, []);
  if (atual < SCHEMA_VERSION) {
    await env.DB.exec("INSERT INTO meta (k, v) VALUES ('schema_version', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
      [String(SCHEMA_VERSION)]);
  }
  ready = true;
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

async function logAudit(env: any, actor: string | null, approvalId: number | null, event: string, detail: unknown) {
  await env.DB.exec("INSERT INTO audit (at, actor, approval_id, event, detail) VALUES (?,?,?,?,?)",
    [new Date().toISOString(), actor ?? "sistema", approvalId, event, JSON.stringify(detail ?? null)]);
}

// ---------------------------------------------------------------- ingestao

async function ingest(env: any, rows: any[], actor: string | null) {
  const CHUNK = chunkFor(10);
  let written = 0;
  const now = new Date().toISOString();
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const ph = slice.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
    const params: any[] = [];
    for (const r of slice) {
      params.push(r.validationId, r.statusLabel ?? null, (r.approver ?? "").toLowerCase() || null,
        (r.requester ?? "").toLowerCase() || null, r.paymentRequestTitle ?? null,
        r.submissionDate ?? null, r.validationDate ?? null,
        r.commentSubmission ?? null, r.commentValidation ?? null, now);
    }
    const res = await env.DB.exec(
      `INSERT INTO approvals (id,status,approver,requester,title,submitted_at,decided_at,comment_submission,comment_validation,ingested_at)
       VALUES ${ph}
       ON CONFLICT(id) DO UPDATE SET status=excluded.status, approver=excluded.approver,
         requester=excluded.requester, title=excluded.title, submitted_at=excluded.submitted_at,
         decided_at=excluded.decided_at, comment_submission=excluded.comment_submission,
         comment_validation=excluded.comment_validation, ingested_at=excluded.ingested_at`, params);
    written += res?.rowsWritten ?? slice.length;
  }
  await logAudit(env, actor, null, "ingest", { recebidos: rows.length, gravados: written });
  return written;
}

// ---------------------------------------------------------------- execucao do agente

async function loadAll(env: any) {
  const out: any[] = [];
  const PAGE = 5000;
  for (let off = 0; ; off += PAGE) {
    const r = await env.DB.query(
      `SELECT id,status,approver,requester,title,submitted_at,decided_at,comment_submission,comment_validation
       FROM approvals ORDER BY id LIMIT ? OFFSET ?`, [PAGE, off]);
    const rows = r.rows ?? [];
    for (const x of rows) out.push({
      validationId: x.id, statusLabel: x.status, approver: x.approver, requester: x.requester,
      paymentRequestTitle: x.title, submissionDate: x.submitted_at, validationDate: x.decided_at,
      commentSubmission: x.comment_submission, commentValidation: x.comment_validation,
    });
    if (rows.length < PAGE) break;
  }
  return out;
}

// Fonte de dados. Se alguem ja ingeriu registros frescos via /api/ingest, eles
// mandam. Senao cai no snapshot embutido no bundle (capturado em 18/09/2026).
// O snapshot vive no codigo-fonte, nao nos assets: nao e servido publicamente.
async function getSource(env: any) {
  const c = await env.DB.query("SELECT COUNT(*) n FROM approvals", []);
  if ((c.rows?.[0]?.n ?? 0) > 0) return { raw: await loadAll(env), origem: "ingerido" };
  return { raw: expandSnapshot(), origem: "snapshot-2026-09-18" };
}

// Monta, para cada pedido parado, o dossie que o aprovador teria que juntar na mao.
// Roda uma vez por execucao; servir o dossie depois vira leitura de uma linha so.
function buildContext(all: any[], pendentes: any[]) {
  const porTitulo = new Map<string, any[]>();
  const porParte = new Map<string, any>();
  const porAprovador = new Map<string, any>();
  for (const r of all) {
    if (r.title) { if (!porTitulo.has(r.title)) porTitulo.set(r.title, []); porTitulo.get(r.title)!.push(r); }
    if (r.partyKey) {
      if (!porParte.has(r.partyKey)) porParte.set(r.partyKey, { Aprovado: 0, Recusado: 0, Aguardando: 0, primeiro: null, ultimo: null });
      const e = porParte.get(r.partyKey);
      if (e[r.status] !== undefined) e[r.status]++;
      if (r.submittedAt) {
        const d = new Date(r.submittedAt).toISOString().slice(0, 10);
        if (!e.primeiro || d < e.primeiro) e.primeiro = d;
        if (!e.ultimo || d > e.ultimo) e.ultimo = d;
      }
    }
    if (r.approver) {
      if (!porAprovador.has(r.approver)) porAprovador.set(r.approver, { total: 0, parados: 0, ultima_decisao: null });
      const a = porAprovador.get(r.approver);
      a.total++;
      if (r.status === "Aguardando") a.parados++;
      else if (r.decidedAt) { const d = new Date(r.decidedAt).toISOString().slice(0, 19).replace("T", " ");
        if (!a.ultima_decisao || d > a.ultima_decisao) a.ultima_decisao = d; }
    }
  }
  const ctx = new Map<number, any>();
  for (const r of pendentes) {
    const hist = porParte.get(r.partyKey) ?? null;
    const irmaos = (porTitulo.get(r.title) ?? [])
      .filter((o: any) => o.id !== r.id)
      .sort((a: any, b: any) => (b.submittedAt ?? 0) - (a.submittedAt ?? 0))
      .slice(0, 10)
      .map((o: any) => ({ id: o.id, status: o.status, approver: o.approver,
        submitted_at: o.submittedAt ? new Date(o.submittedAt).toISOString().slice(0, 19).replace("T", " ") : null }));
    ctx.set(r.id, {
      historicoDoBeneficiario: hist ? Object.entries({ Aprovado: hist.Aprovado, Recusado: hist.Recusado, Aguardando: hist.Aguardando })
        .filter(([, n]) => (n as number) > 0)
        .map(([status, n]) => ({ status, n, primeiro: hist.primeiro, ultimo: hist.ultimo })) : [],
      totalComMesmoTitulo: (porTitulo.get(r.title) ?? []).length - 1,
      pedidosComMesmoTitulo: irmaos,
      cargaDoAprovador: r.approver ? porAprovador.get(r.approver) ?? null : null,
    });
  }
  return ctx;
}

async function runAgent(env: any, actor: string | null, source: string, cap = 0) {
  const t0 = Date.now();
  const mark = (etapa: string, extra?: unknown) =>
    console.log(`[run] ${etapa} +${Date.now() - t0}ms`, extra === undefined ? "" : JSON.stringify(extra));

  mark("inicio");
  let { raw, origem } = await getSource(env);
  mark("fonte carregada", { registros: raw.length, origem });
  if (cap > 0) { raw = raw.slice(-cap); mark("cap aplicado", { registros: raw.length }); }
  if (!raw.length) throw new Error("Sem dados. Rode POST /api/ingest.");
  const all = enrich(raw);
  mark("enrich");
  const a = analyze(all);
  mark("analyze", { pendentes: a.pending.length });
  const s: any = summarize(a);
  s.auditoriaRetroativa = auditRetroativo(all);
  s.motivosDeRecusa = motivosDeRecusa(all);
  mark("summarize", { aprovadosComDocInvalido: s.auditoriaRetroativa.aprovadosComDocInvalido,
    motivosComCampoFinanceiro: s.motivosDeRecusa.dependemDeCampoFinanceiro });
  const ctx = buildContext(all, a.pending);
  mark("contexto", { dossies: ctx.size });

  await env.DB.exec(
    "INSERT INTO runs (ran_at, source, total_records, total_pending, summary) VALUES (?,?,?,?,?)",
    [new Date().toISOString(), source + ":" + origem, raw.length, s.totalPending, JSON.stringify(s)]);
  const rid = (await env.DB.query("SELECT MAX(id) AS id FROM runs", [])).rows[0].id;

  await env.DB.exec("DELETE FROM triage", []);
  // ---- O AGENTE decide e executa. Nao pergunta item a item.
  const hhSalvo = await lerHH(env);
  const ctxAg = montarContexto(all, { agora: Date.now(), niveis: NIVEIS_APROVADORES, hh: hhSalvo });
  const ag = processarFila(a.pending, ctxAg);
  const lotesCap = montarLotesCAP(ag.itens, ctxAg);
  mark("agente decidiu", { acoes: ag.porAcao, horas: ag.horasEconomizadas });

  // ---- LIXEIRA (regra 1). Quem ja foi restaurado por um humano nunca volta
  // para ca sozinho: respeitar a restauracao e o que torna a lixeira confiavel.
  const rest = await env.DB.query("SELECT pedido_id FROM lixeira WHERE restaurado_em IS NOT NULL", []);
  const restaurados = new Set((rest.rows ?? []).map((x: any) => Number(x.pedido_id)));
  const paraLixeira = ag.itens.filter((x: any) => x.acao === "ARQUIVAR_NA_LIXEIRA" && !restaurados.has(x.id));
  const jaNaLixeira = new Set(((await env.DB.query("SELECT pedido_id FROM lixeira", [])).rows ?? [])
    .map((x: any) => Number(x.pedido_id)));
  const novosNaLixeira = paraLixeira.filter((x: any) => !jaNaLixeira.has(x.id));
  const agoraIso = new Date().toISOString();
  const CL = 12;
  for (let i = 0; i < novosNaLixeira.length; i += CL) {
    const sl = novosNaLixeira.slice(i, i + CL);
    const ph = sl.map(() => "(?,?,?,?,?,?,?)").join(",");
    const p: any[] = [];
    for (const x of sl) {
      const r = a.pending.find((z: any) => z.id === x.id) ?? {};
      p.push(x.id, x.porque, x.idadeDias, agoraIso, rid,
        JSON.stringify({ pedido: { id: x.id, ticketId: r.ticketId, titulo: r.title, fornecedor: r.supplier,
          cnpj: r.cnpj, valor: r.valor, vencimento: r.vencimento, aprovador: r.approver,
          solicitante: r.requester, submetidoEm: r.submittedAt ? new Date(r.submittedAt).toISOString() : null },
          decisao: { acao: x.acao, porque: x.porque, artigos: x.artigosCitados },
          violacoes: x.violacoes }),
        [x.id, r.ticketId, r.title, r.supplier, r.cnpj, r.approver, r.requester].filter(Boolean).join(" ").toLowerCase());
    }
    await env.DB.exec(`INSERT INTO lixeira (pedido_id,motivo,dias_sem_movimento,movido_em,execucao,snapshot,busca) VALUES ${ph}`, p);
  }
  mark("lixeira", { novos: novosNaLixeira.length, total: jaNaLixeira.size + novosNaLixeira.length, restaurados: restaurados.size });
  const naLixeira = new Set([...jaNaLixeira, ...novosNaLixeira.map((x: any) => x.id)]);

  // Uma unica gravacao por pedido, juntando motor e agente.
  const porId = new Map(ag.itens.map((x: any) => [x.id, x]));
  await env.DB.exec("DELETE FROM triage", []);
  const CHUNK = 30;
  for (let i = 0; i < a.pending.length; i += CHUNK) {
    const sl = a.pending.slice(i, i + CHUNK);
    const ph = sl.map(() => "(?,?)").join(",");
    const p: any[] = [];
    for (const r of sl) {
      const x: any = porId.get(r.id) ?? {};
      p.push(r.id,
        JSON.stringify({
          run_id: rid, action: r.action, prioridade: r.prioridade, approver: r.approver,
          usersIdValidate: r.usersIdValidate ?? null, ticketId: r.ticketId ?? null, valor: r.valor ?? null,
          naLixeira: naLixeira.has(r.id) ? 1 : 0,
          kind: r.kind, codes: r.findings.map((f: any) => f.code).join(","), acao_ag: x.acao ?? null,
          // motor
          action_label: r.actionLabel, why: r.why, risk: r.risk, age_days: r.ageDays === null ? null : Math.round(r.ageDays * 10) / 10,
          supplier: r.supplier, cnpj: r.cnpj, title: r.title, liftTipo: r.liftTipo,
          submitted_at: r.submittedAt ? new Date(r.submittedAt).toISOString().slice(0, 19).replace("T", " ") : null,
          findings: r.findings, contexto: ctx.get(r.id) ?? {},
          // agente
          ag: x.acao ? { dono: x.dono, porque: x.porque, artigos: x.artigosCitados.join(", "),
            minutos: x.minutosEconomizados, idadeDias: x.idadeDias,
            rerroteado: x.roteamento?.precisaRerotear ? 1 : 0,
            violacoes: x.violacoes, correcoes: x.correcoes, roteamento: x.roteamento,
            planoCAP: x.planoCAP, mensagem: x.mensagemAoSolicitante, penalidade: x.notificacaoPenalidade } : null,
        }));
    }
    await env.DB.exec(`INSERT INTO triage (approval_id,doc) VALUES ${ph}`, p);
  }
  mark("pedidos gravados", { linhas: a.pending.length, statements: Math.ceil(a.pending.length / CHUNK) });

  // Outbox reconstruida a cada execucao, preservando o que ja foi entregue.
  const entregues = await env.DB.query("SELECT tipo, pedido_id FROM outbox WHERE status = 'entregue'", []);
  const jaEntregue = new Set((entregues.rows ?? []).map((r: any) => r.tipo + ":" + r.pedido_id));
  await env.DB.exec("DELETE FROM outbox WHERE status <> 'entregue'", []);
  const agora = new Date().toISOString();
  const acoes = ag.itens.flatMap(acoesDoItem).filter((x: any) => !jaEntregue.has(x.tipo + ":" + x.pedidoId));
  const C2 = 20;
  for (let i = 0; i < acoes.length; i += C2) {
    const sl = acoes.slice(i, i + C2);
    const ph = sl.map(() => "(?,?,?,?)").join(",");
    const p: any[] = [];
    for (const x of sl) p.push(x.tipo, x.pedidoId, "pronta", JSON.stringify({
      run_id: rid, destinatario: x.destinatario, assunto: x.assunto,
      base_legal: x.baseLegal, criado_em: agora, payload: x.payload }));
    await env.DB.exec(`INSERT INTO outbox (tipo,pedido_id,status,doc) VALUES ${ph}`, p);
  }
  // Regra 4: UM chamado de higiene por execucao, com a lista inteira dos
  // registros de teste encerrados. Nao um por pedido.
  const testes = ag.itens.filter((x: any) => x.violacoes.some((v: any) => v.regra === "REGISTRO_DE_TESTE"));
  if (testes.length) {
    const jaTemHigiene = await env.DB.query(
      "SELECT COUNT(*) n FROM outbox WHERE tipo = 'ABRIR_CHAMADO_DE_HIGIENE' AND status = 'entregue'", []);
    if (!(jaTemHigiene.rows?.[0]?.n)) {
      const linhas = testes.map((x: any) => {
        const r = a.pending.find((z: any) => z.id === x.id);
        return `#${x.id} (chamado ${r?.ticketId ?? "?"}) ${String(r?.title ?? "").slice(0, 70)}`;
      });
      await env.DB.exec("INSERT INTO outbox (tipo,pedido_id,status,doc) VALUES (?,?,?,?)",
        ["ABRIR_CHAMADO_DE_HIGIENE", null, "pronta", JSON.stringify({
          run_id: rid, destinatario: "GoService", criado_em: agora,
          assunto: `Higiene de base: ${testes.length} registros de teste encerrados pelo Goworker`,
          base_legal: "Handoff 18/09/2026, regra 4",
          payload: { titulo: `Higiene de base: ${testes.length} registros de teste encerrados pelo Goworker`,
            corpo: [
              `O Goworker do Financeiro encerrou ${testes.length} pedidos que sao registro de teste e nao obrigacao financeira.`,
              ``,
              `Eles nao foram notificados individualmente e nao consumiram alcada de aprovacao.`,
              `Este chamado existe para deixar a lista num lugar so, em vez de abrir ${testes.length} avisos.`,
              ``,
              `Lista:`,
              ...linhas,
            ].join("\n") } })]);
    }
  }
  mark("outbox gravada", { acoes: acoes.length, higiene: testes.length });

  s.lixeira = { novos: novosNaLixeira.length, total: naLixeira.size, restaurados: restaurados.size,
    retencao: "não expira; restaurável a qualquer momento" };
  s.agente = {
    porAcao: ag.porAcao, porArtigo: ag.porArtigo, porRegra: ag.porRegra,
    correcoesAutomaticas: ag.correcoesAutomaticas, reroteadosPorAlcada: ag.reroteadosPorAlcada,
    devolucoesRedigidas: ag.devolucoesRedigidas, notificacoesDePenalidade: ag.notificacoesDePenalidade,
    naoConsomemAprovador: ag.naoConsomemAprovador, pctNaoConsomemAprovador: ag.pctNaoConsomemAprovador,
    minutosEconomizados: ag.minutosEconomizados, horasEconomizadas: ag.horasEconomizadas,
    premissasHH: ag.premissasHH, acoesEmitidas: acoes.length,
    lotesCAP: { lotes: lotesCap.lotes, pedidosProgramaveis: lotesCap.pedidosProgramaveis,
      pedidosBloqueados: lotesCap.pedidosBloqueados, minutosEconomizados: lotesCap.minutosEconomizados,
      observacao: lotesCap.observacao },
  };
  await env.DB.exec("UPDATE runs SET summary = ? WHERE id = ?", [JSON.stringify(s), rid]);

  await logAudit(env, actor, null, "run", { runId: rid, origem, pendentes: s.totalPending,
    acoes: s.byAction, agente: ag.porAcao, acoesEmitidas: acoes.length });
  mark("fim");
  return { runId: rid, origem, ms: Date.now() - t0, ...s };
}

async function lastSummary(env: any) {
  const r = await env.DB.query("SELECT id, ran_at, total_records, total_pending, summary FROM runs ORDER BY id DESC LIMIT 1", []);
  if (!r.rows?.length) return null;
  const row = r.rows[0];
  return { runId: row.id, ranAt: row.ran_at, totalRecords: row.total_records, ...JSON.parse(row.summary) };
}

async function queue(env: any, f: { action?: string; approver?: string; code?: string; kind?: string; limit?: number; incluirLixeira?: boolean }) {
  const w: string[] = [], p: any[] = [];
  // A lixeira sai da base de trabalho: so aparece se pedida de proposito.
  if (!f.incluirLixeira) w.push("COALESCE(json_extract(doc,'$.naLixeira'),0) = 0");
  if (f.action) { w.push("json_extract(doc,'$.action') = ?"); p.push(f.action.toUpperCase()); }
  if (f.approver) { w.push("json_extract(doc,'$.approver') LIKE ?"); p.push("%" + f.approver.toLowerCase() + "%"); }
  if (f.code) { w.push("json_extract(doc,'$.codes') LIKE ?"); p.push("%" + f.code.toUpperCase() + "%"); }
  if (f.kind) { w.push("json_extract(doc,'$.kind') = ?"); p.push(f.kind); }
  p.push(Math.min(f.limit ?? 50, 500));
  const r = await env.DB.query(
    `SELECT approval_id, doc FROM triage ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY json_extract(doc,'$.prioridade') DESC LIMIT ?`, p);
  return (r.rows ?? []).map((x: any) => {
    const d = JSON.parse(x.doc || "{}");
    return { approval_id: x.approval_id, action: d.action, action_label: d.action_label,
      risk: d.risk, prioridade: d.prioridade, why: d.why, age_days: d.age_days, approver: d.approver,
      kind: d.kind, supplier: d.supplier, cnpj: d.cnpj, title: d.title,
      submitted_at: d.submitted_at, findings: d.findings ?? [],
      acaoDoAgente: d.acao_ag ?? null };
  });
}

// O dossie: tudo que o aprovador precisaria juntar na mao para decidir.
// O contexto pesado ja foi calculado na execucao do agente; aqui e leitura de 1 linha.
async function dossier(env: any, id: number) {
  const t = await env.DB.query("SELECT doc FROM triage WHERE approval_id = ?", [id]);
  if (!t.rows?.length) return null;
  const d = JSON.parse(t.rows[0].doc || "{}");
  const row = { approval_id: id, approver: d.approver, kind: d.kind, prioridade: d.prioridade,
    action: d.action, acao_ag: d.acao_ag };
  const ctx = d.contexto ?? {};
  const trilha = await env.DB.query(
    "SELECT at, actor, event, detail FROM audit WHERE approval_id = ? ORDER BY id DESC LIMIT 20", [id]);

  return {
    pedido: { id: row.approval_id, titulo: d.title, tipo: row.kind, beneficiario: d.supplier,
      cnpj: d.cnpj, aprovador: row.approver, submetidoEm: d.submitted_at, paradoHaDias: d.age_days },
    recomendacao: { acao: row.action, rotulo: d.action_label, porque: d.why, risco: d.risk,
      prioridade: row.prioridade, liftDoTipo: d.liftTipo },
    acaoDoAgente: row.acao_ag ?? null,
    sinais: d.findings ?? [],
    historicoDoBeneficiario: ctx.historicoDoBeneficiario ?? [],
    totalComMesmoTitulo: ctx.totalComMesmoTitulo ?? 0,
    pedidosComMesmoTitulo: ctx.pedidosComMesmoTitulo ?? [],
    cargaDoAprovador: ctx.cargaDoAprovador ?? null,
    trilhaDeAuditoria: trilha.rows ?? [],
    limiteConhecido: "Valor, vencimento, nota fiscal e centro de custo não estão disponíveis no perfil de leitura atual do GoService. Nenhuma recomendação aqui considera valores.",
    decisaoFinal: "Humana. Este agente não aprova nem recusa nada.",
  };
}

// ---------------------------------------------------------------- agente: leitura

async function lerHH(env: any) {
  const r = await env.DB.query("SELECT v FROM meta WHERE k = 'hh'", []);
  if (!r.rows?.length) return { ...HH_PADRAO };
  try { return { ...HH_PADRAO, ...JSON.parse(r.rows[0].v) }; } catch { return { ...HH_PADRAO }; }
}
async function gravarHH(env: any, novo: any) {
  const atual = await lerHH(env);
  const merged: any = { ...atual };
  for (const [k, v] of Object.entries(novo ?? {})) if (k in HH_PADRAO && Number.isFinite(Number(v))) merged[k] = Number(v);
  await env.DB.exec("INSERT INTO meta (k, v) VALUES ('hh', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v",
    [JSON.stringify(merged)]);
  return merged;
}

async function filaAgente(env: any, f: { acao?: string; dono?: string; artigo?: string; limite?: number; incluirLixeira?: boolean }) {
  const w: string[] = [], p: any[] = [];
  if (!f.incluirLixeira) w.push("COALESCE(json_extract(doc,'$.naLixeira'),0) = 0");
  if (f.acao) { w.push("json_extract(doc,'$.acao_ag') = ?"); p.push(f.acao.toUpperCase()); }
  if (f.dono) { w.push("doc LIKE ?"); p.push('%"dono":"%' + f.dono.toLowerCase() + '%'); }
  if (f.artigo) { w.push("doc LIKE ?"); p.push("%" + f.artigo + "%"); }
  p.push(Math.min(f.limite ?? 50, 500));
  const r = await env.DB.query(
    `SELECT approval_id AS pedido_id, doc FROM triage
     ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY json_extract(doc,'$.prioridade') DESC LIMIT ?`, p);
  return (r.rows ?? []).map((x: any) => {
    const full = JSON.parse(x.doc || "{}");
    const ag = full.ag ?? {};
    return { pedido_id: x.pedido_id, acao: full.acao_ag, prioridade: full.prioridade,
      dono: ag.dono ?? null, porque: ag.porque ?? null, artigos: ag.artigos ?? null,
      minutos: ag.minutos ?? null, idade_dias: ag.idadeDias ?? null, rerroteado: ag.rerroteado ?? 0 };
  });
}

async function parecerAgente(env: any, id: number) {
  const r = await env.DB.query("SELECT doc FROM triage WHERE approval_id = ?", [id]);
  if (!r.rows?.length) return null;
  const row: any = JSON.parse(r.rows[0].doc || "{}");
  if (!row.acao_ag) return null;
  const d = row.ag ?? {};
  const x = { pedido_id: id, acao: row.acao_ag, dono: d.dono, porque: d.porque,
    artigos: d.artigos, minutos: d.minutos };
  const t = await env.DB.query("SELECT tipo, status, doc FROM outbox WHERE pedido_id = ?", [id]);
  return {
    pedidoId: x.pedido_id,
    decisao: { acao: x.acao, rotulo: (ACOES_AGENTE as any)[x.acao]?.label ?? x.acao, dono: x.dono, porque: x.porque },
    baseNormativa: x.artigos,
    violacoes: d.violacoes ?? [],
    correcoesAplicadas: d.correcoes ?? [],
    roteamentoDeAlcada: d.roteamento ?? null,
    mensagemAoSolicitante: d.mensagem ?? null,
    notificacaoDePenalidade: d.penalidade ?? null,
    planoContasAPagar: d.planoCAP ?? null,
    acoesEmitidas: (t.rows ?? []).map((a: any) => { const ad = JSON.parse(a.doc || "{}");
      return { tipo: a.tipo, status: a.status, destinatario: ad.destinatario, base_legal: ad.base_legal }; }),
    minutosEconomizados: x.minutos,
    limite: "O agente não aprova nem recusa. O Art. 7 reserva isso à alçada com competência; o Art. 4 trata segregação de funções como regra inviolável.",
  };
}

async function lerOutbox(env: any, f: { tipo?: string; status?: string; limite?: number }) {
  const w: string[] = [], p: any[] = [];
  if (f.tipo) { w.push("tipo = ?"); p.push(f.tipo.toUpperCase()); }
  if (f.status) { w.push("status = ?"); p.push(f.status); }
  p.push(Math.min(f.limite ?? 50, 300));
  const r = await env.DB.query(
    `SELECT id, tipo, pedido_id, status, doc, despachado_em, resultado
     FROM outbox ${w.length ? "WHERE " + w.join(" AND ") : ""} ORDER BY id DESC LIMIT ?`, p);
  return (r.rows ?? []).map((x: any) => { const d = JSON.parse(x.doc || "{}");
    return { id: x.id, tipo: x.tipo, pedido_id: x.pedido_id, status: x.status,
      destinatario: d.destinatario, assunto: d.assunto, base_legal: d.base_legal,
      criado_em: d.criado_em, despachado_em: x.despachado_em, resultado: x.resultado,
      payload: d.payload ?? null }; });
}

// Despacha o que esta pronto. A trava da outbox recusa qualquer tipo fora da
// lista fechada antes de qualquer chamada de rede.
async function despacharPendentes(env: any, actor: string | null, tipo?: string, max = 25) {
  // Reprocessa tudo que ainda NAO foi entregue, nao so o que nunca foi tentado.
  // Uma falha por permissao vira sucesso assim que a permissao existe; deixar
  // "falhou" fora da fila congelava o lote inteiro depois do primeiro erro.
  const w = ["status <> 'entregue'"]; const p: any[] = [];
  if (tipo) { w.push("tipo = ?"); p.push(tipo.toUpperCase()); }
  p.push(Math.min(max, 100));
  const r = await env.DB.query(
    `SELECT id, tipo, pedido_id, doc FROM outbox
     WHERE ${w.join(" AND ")} ORDER BY id LIMIT ?`, p);
  const res: any[] = [];
  for (const row of (r.rows ?? [])) {
    const d = JSON.parse(row.doc || "{}");
    const acao = { tipo: row.tipo, pedidoId: row.pedido_id, destinatario: d.destinatario,
      assunto: d.assunto, payload: d.payload ?? null, baseLegal: d.base_legal };
    const out = await despachar(env, acao as any);
    await env.DB.exec("UPDATE outbox SET status = ?, despachado_em = ?, resultado = ? WHERE id = ?",
      [out.status, new Date().toISOString(), JSON.stringify(out), row.id]);
    res.push({ id: row.id, tipo: row.tipo, pedidoId: row.pedido_id, ...out });
  }
  await logAudit(env, actor, null, "despacho", { tentadas: res.length, entregues: res.filter(x => x.entregue).length });
  return { tentadas: res.length, entregues: res.filter(x => x.entregue).length, resultados: res };
}

// ---------------------------------------------------------------- lixeira

// A lixeira so vale se for consultavel e restauravel. Busca por id do pedido,
// por chamado, por fornecedor, CNPJ, aprovador ou solicitante.
async function lerLixeira(env: any, f: { busca?: string; restaurados?: boolean; limite?: number }) {
  const w: string[] = [], p: any[] = [];
  if (f.busca) { w.push("busca LIKE ?"); p.push("%" + String(f.busca).toLowerCase() + "%"); }
  if (f.restaurados === true) w.push("restaurado_em IS NOT NULL");
  if (f.restaurados === false) w.push("restaurado_em IS NULL");
  p.push(Math.min(f.limite ?? 50, 500));
  const r = await env.DB.query(
    `SELECT pedido_id, motivo, dias_sem_movimento, movido_em, execucao, restaurado_em, restaurado_por, snapshot
     FROM lixeira ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY dias_sem_movimento DESC LIMIT ?`, p);
  const tot = await env.DB.query(
    "SELECT COUNT(*) n, SUM(CASE WHEN restaurado_em IS NULL THEN 1 ELSE 0 END) ativos FROM lixeira", []);
  return {
    total: tot.rows?.[0]?.n ?? 0,
    naLixeira: tot.rows?.[0]?.ativos ?? 0,
    restaurados: (tot.rows?.[0]?.n ?? 0) - (tot.rows?.[0]?.ativos ?? 0),
    retencao: "não expira; nada é apagado",
    itens: (r.rows ?? []).map((x: any) => ({ ...x, snapshot: JSON.parse(x.snapshot || "null") })),
  };
}

// Restaurar devolve o pedido a base de trabalho e marca quem restaurou. A partir
// dai o agente nunca mais arquiva esse pedido sozinho: a decisao humana manda.
async function restaurarDaLixeira(env: any, ids: number[], quem: string | null) {
  if (!ids.length) return { restaurados: 0, erro: "informe ao menos um pedido_id" };
  const agora = new Date().toISOString();
  const ph = ids.map(() => "?").join(",");
  await env.DB.exec(
    `UPDATE lixeira SET restaurado_em = ?, restaurado_por = ? WHERE pedido_id IN (${ph}) AND restaurado_em IS NULL`,
    [agora, quem ?? "desconhecido", ...ids]);
  const conf = await env.DB.query(
    `SELECT pedido_id, restaurado_em, restaurado_por FROM lixeira WHERE pedido_id IN (${ph})`, ids);
  await logAudit(env, quem, null, "restaurar_da_lixeira", { ids, quando: agora });
  return {
    restaurados: (conf.rows ?? []).filter((x: any) => x.restaurado_em === agora).length,
    itens: conf.rows ?? [],
    aviso: "Os pedidos voltam a base de trabalho na proxima execucao do agente e nao serao arquivados de novo automaticamente.",
  };
}

// ---------------------------------------------------------------- execucao no GLPI

const htmlDe = (txt: string) =>
  "<div>" + String(txt || "").split("\n")
    .map(l => l.trim() ? `<p>${l.replace(/[<>&]/g, c => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c] as string))}</p>` : "")
    .join("") + "</div>";

// Pega o que esta pronto na outbox e manda o executor agir no GoService.
// Escopo de piloto vem de env.GLPI_PILOTO_APROVADOR; sem ele, nao age em nada,
// porque agir na base inteira tem que ser decisao explicita.
async function executarNoGlpi(env: any, actor: string | null, o: { tipo?: string; max?: number; piloto?: string | null }) {
  // O cron dispara sem corpo, entao os parametros do lote vem de secrets.
  // GLPI_PILOTO_APROVADOR = "" (vazio) significa SEM escopo de piloto.
  const pilotoEnv = env.GLPI_PILOTO_APROVADOR;
  const piloto = o.piloto !== undefined ? o.piloto
    : (pilotoEnv === undefined || String(pilotoEnv).trim() === "" ? null : pilotoEnv);
  const tipoEnv = env.GLPI_TIPO && String(env.GLPI_TIPO).trim() ? String(env.GLPI_TIPO).trim() : undefined;
  const maxEnv = Number(env.GLPI_MAX ?? 0);
  o = { ...o, tipo: o.tipo ?? tipoEnv, max: o.max ?? (maxEnv > 0 ? maxEnv : undefined) };
  // Reprocessa tudo que ainda NAO foi entregue, nao so o que nunca foi tentado.
  // Uma falha por permissao vira sucesso assim que a permissao existe; deixar
  // "falhou" fora da fila congelava o lote inteiro depois do primeiro erro.
  const w = ["status <> 'entregue'"]; const p: any[] = [];
  if (o.tipo) { w.push("tipo = ?"); p.push(o.tipo.toUpperCase()); }
  // CORRIGIR_CADASTRO fica de fora: corrigir CNPJ em cadastro de fornecedor e
  // ato do Supply/Compras no ERP, nao do agente no chamado.
  // Acoes internas do agente nao viram chamada ao GoService.
  //  CORRIGIR_CADASTRO   -> e ato do Supply/Compras no ERP
  //  MOVER_PARA_LIXEIRA  -> e do proprio livro-razao do agente
  //  ABRIR_DEMANDA_DE_PRODUTO -> vai para produto, nao para o chamado
  w.push("tipo NOT IN ('CORRIGIR_CADASTRO','MOVER_PARA_LIXEIRA','ABRIR_DEMANDA_DE_PRODUTO')");

  // O escopo do piloto entra NA CONSULTA. Filtrar depois de ler as 20 primeiras
  // fazia o agente gastar o lote inteiro com pedidos de outro aprovador.
  if (piloto) {
    const alvo = await env.DB.query(
      "SELECT approval_id FROM triage WHERE json_extract(doc,'$.usersIdValidate') = ?", [Number(piloto)]);
    const ids = (alvo.rows ?? []).map((x: any) => Number(x.approval_id));
    console.log(`[glpi] piloto ${piloto}: ${ids.length} pedidos na fila dele -> ${ids.join(",")}`);
    // Diagnostico: o que existe na outbox para esses pedidos, por status e tipo.
    if (ids.length) {
      const d = await env.DB.query(
        `SELECT tipo, status, COUNT(*) n FROM outbox WHERE pedido_id IN (${ids.map(() => "?").join(",")})
         GROUP BY tipo, status`, ids);
      console.log("[glpi] outbox do piloto: " +
        ((d.rows ?? []).map((r: any) => `${r.tipo}/${r.status}=${r.n}`).join(" | ") || "VAZIA"));
    }
    if (!ids.length) return { modo: modoGlpi(env), piloto, executadas: 0, total: 0, resultados: [],
      aviso: `Nenhum pedido parado para o aprovador ${piloto}.` };
    w.push(`pedido_id IN (${ids.map(() => "?").join(",")})`);
    p.push(...ids);
  }
  p.push(Math.min(o.max ?? 20, 100));
  const r = await env.DB.query(
    `SELECT id, tipo, pedido_id, doc FROM outbox
     WHERE ${w.join(" AND ")} ORDER BY id LIMIT ?`, p);

  const linhas = r.rows ?? [];
  const ordens = linhas.map((row: any) => {
    const dd = JSON.parse(row.doc || "{}");
    const pay = dd.payload ?? null;
    return {
      tipo: row.tipo, validationId: row.pedido_id,
      html: pay?.corpo ? htmlDe(pay.corpo) : htmlDe(dd.assunto ?? ""),
      novoLogin: row.tipo === "ROTEAR_PARA_ALCADA" ? (pay?.aprovadorSugerido ?? null) : null,
      titulo: pay?.titulo ?? dd.assunto ?? null,
    };
  });

  console.log(`[glpi] modo=${modoGlpi(env)} piloto=${piloto ?? "(nenhum)"} ordens=${ordens.length} credencial=${credenciaisOk(env)}`);
  const out = await executarGlpi(env, ordens as any, { piloto });
  const porStatus: Record<string, number> = {};
  for (const r of out.resultados) porStatus[r.status] = (porStatus[r.status] ?? 0) + 1;
  console.log(`[glpi] resultado ${JSON.stringify(porStatus)} erro=${out.erro ?? "-"}`);
  for (const r of out.resultados.filter((x: any) => x.status === "executada" || x.status === "falhou" || x.status === "ensaio").slice(0, 12))
    console.log(`[glpi]   val=${r.validationId} tk=${r.ticketId ?? "-"} ${r.tipo} -> ${r.status} ${r.chamada ? r.chamada.metodo + " " + r.chamada.url : ""} ${r.httpStatus ?? ""} ${String(r.resposta ?? "").slice(0, 90)}`);

  for (let i = 0; i < out.resultados.length; i++) {
    const res = out.resultados[i], linha = linhas[i];
    if (!linha) continue;
    // Idempotencia: "o item ja esta solucionado" significa que o objetivo JA foi
    // alcancado, entao e sucesso, nao falha. Tratar como falha fazia o lote
    // reprocessar sempre os mesmos ids baixos e travar a fila inteira atras deles.
    const jaFeito = /j[aá] est[aá] solucionado|already.*solved/i.test(String(res.resposta ?? ""));
    const novoStatus = (res.status === "executada" || jaFeito) ? "entregue" : res.status;
    await env.DB.exec("UPDATE outbox SET status = ?, despachado_em = ?, resultado = ? WHERE id = ?",
      [novoStatus, new Date().toISOString(), JSON.stringify(res), linha.id]);
  }
  await logAudit(env, actor, null, "execucao_glpi",
    { modo: out.modo, piloto, total: out.total ?? 0, executadas: out.executadas, erro: out.erro ?? null });
  return { ...out, piloto,
    aviso: out.modo === "ensaio"
      ? "Modo ensaio: montei cada chamada e validei a trava, mas NAO enviei. Para agir de verdade, setar o secret GLPI_MODO=executar."
      : "Modo executar: as chamadas marcadas como executada foram gravadas no GoService." };
}

// ---------------------------------------------------------------- MCP

const mcp = defineMcp({
  name: "goworker-financeiro",
  version: "1.0.0",
  tools: [
    { name: "goworker_resumo",
      description: "Panorama da fila de aprovacao de pagamentos: quantos parados, ha quanto tempo, distribuicao por acao recomendada, gargalos e filas orfas. Use para a pergunta 'como esta a fila do financeiro'.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => (await lastSummary(ctx.env)) ?? { erro: "Nenhuma execucao ainda. Chame POST /api/run." } },

    { name: "goworker_fila",
      description: "Lista os pedidos parados ja triados, ordenados por risco. Filtre por acao (BLOQUEAR, REDIRECIONAR, ARQUIVAR, CONFIRMAR, REVISAR, LIBERAR), por aprovador ou por codigo de sinal (ex: FILA_ZUMBI, APROVADOR_INATIVO, CNPJ_INVALIDO).",
      inputSchema: { type: "object", properties: {
        acao: { type: "string", description: "BLOQUEAR | REDIRECIONAR | ARQUIVAR | CONFIRMAR | REVISAR | LIBERAR" },
        aprovador: { type: "string" }, sinal: { type: "string" },
        tipo: { type: "string", description: "classe do pedido: pagamento, compra, estorno, novo_servico, juros, reembolso..." },
        limite: { type: "number" } } },
      handler: async (a: any, ctx: any) => queue(ctx.env, { action: a.acao, approver: a.aprovador, code: a.sinal, kind: a.tipo, limit: a.limite }) },

    { name: "goworker_dossie",
      description: "Dossie completo de um pedido: recomendacao, sinais detectados, historico do beneficiario, pedidos com titulo identico, carga do aprovador e trilha de auditoria. E o parecer que o aprovador nao monta hoje.",
      inputSchema: { type: "object", properties: { id: { type: "number", description: "validationId do pedido" } }, required: ["id"] },
      handler: async (a: any, ctx: any) => (await dossier(ctx.env, Number(a.id))) ?? { erro: "Pedido nao esta na fila triada." } },

    { name: "goworker_filas_orfas",
      description: "Aprovadores que pararam de decidir ha mais de 90 dias e continuam donos de pedidos parados. Cada um desses e uma fila que nunca vai andar sem trocar o aprovador.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const s: any = await lastSummary(ctx.env); return s?.orfas ?? []; } },

    { name: "goworker_auditoria_retroativa",
      description: "Olha para tras, nao para a fila: quais pagamentos JA FORAM APROVADOS com CNPJ ou CPF que reprova no digito verificador, e quais fornecedores aparecem na base com mais de uma grafia de CNPJ sendo pelo menos uma invalida (erro de digitacao no cadastro). Dinheiro que ja saiu contra documento que nao passa na conferencia basica.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const sm: any = await lastSummary(ctx.env); return sm?.auditoriaRetroativa ?? { erro: "sem execucao" }; } },

    { name: "goworker_motivos_de_recusa",
      description: "Le o texto livre que os aprovadores escreveram ao recusar, nas 152 recusas historicas, e classifica os motivos. Mostra quantos desses motivos so seriam detectaveis com os campos financeiros (valor, nota fiscal, centro de custo) que o perfil de leitura atual nao entrega.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const sm: any = await lastSummary(ctx.env); return sm?.motivosDeRecusa ?? { erro: "sem execucao" }; } },

    { name: "goworker_tipos_de_alto_risco",
      description: "Classes de pedido historicamente recusadas acima da media, com lift bruto, lift encolhido (prior bayesiano) e p ajustado por Bonferroni. Sem valor em reais, este e o unico proxy de materialidade que sobrevive a correcao de multiplas comparacoes, e e o que ordena a fila.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const sm: any = await lastSummary(ctx.env);
        return { taxaBaseRecusa: sm?.taxaBaseRecusa, tipos: sm?.tiposDeAltoRisco ?? [] }; } },

    { name: "goworker_gargalos",
      description: "Aprovadores com 10 ou mais pedidos parados, com a mediana historica de decisao de cada um e ha quantos dias agiu pela ultima vez.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const s: any = await lastSummary(ctx.env); return s?.gargalos ?? []; } },

    { name: "goworker_agente_resumo",
      description: "O que o AGENTE decidiu fazer com a fila inteira: quantos pedidos ele encerra, devolve ao solicitante, corrige, reroteia por alcada e encaminha ao aprovador; quantos nunca chegam a consumir tempo de diretor; horas de trabalho humano substituidas; e os lotes de contas a pagar ja montados. Este e o painel do agente, nao da fila.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const sm: any = await lastSummary(ctx.env); return sm?.agente ?? { erro: "sem execucao" }; } },

    { name: "goworker_agente_fila",
      description: "Pedidos com a acao que o AGENTE tomou. Filtre por acao (ENCERRAR, DEVOLVER, CORRIGIR_E_ENCAMINHAR, RECOMENDAR_ESTORNO, ENCAMINHAR), por dono da bola (agente, solicitante, aprovador, contas a pagar) ou por artigo da Politica de Pagamentos (ex: 'Art. 11', 'Art. 7', 'Anexo I').",
      inputSchema: { type: "object", properties: {
        acao: { type: "string" }, dono: { type: "string" }, artigo: { type: "string" }, limite: { type: "number" } } },
      handler: async (a: any, ctx: any) => filaAgente(ctx.env, { acao: a.acao, dono: a.dono, artigo: a.artigo, limite: a.limite }) },

    { name: "goworker_agente_parecer",
      description: "Parecer completo do agente sobre um pedido: decisao e por que, violacoes de politica com o artigo citado, correcoes que ele aplicou sozinho, roteamento de alcada, a mensagem que ele redigiu ao solicitante, a notificacao de penalidade quando cabe, e o plano de contas a pagar. Mostra tambem o limite: o agente nao aprova nem recusa.",
      inputSchema: { type: "object", properties: { id: { type: "number" } }, required: ["id"] },
      handler: async (a: any, ctx: any) => (await parecerAgente(ctx.env, Number(a.id))) ?? { erro: "nao encontrado" } },

    { name: "goworker_outbox",
      description: "As acoes concretas que o agente emitiu: devolucoes ao solicitante, notificacoes de penalidade, recomendacoes de estorno, correcoes de cadastro, reroteamentos de alcada, encerramentos e lotes de CAP. Cada uma com destinatario, assunto, corpo e base legal. A lista de tipos e FECHADA e nao inclui aprovar nem recusar.",
      inputSchema: { type: "object", properties: {
        tipo: { type: "string" }, status: { type: "string", description: "pronta | entregue | recusada_pela_trava" }, limite: { type: "number" } } },
      handler: async (a: any, ctx: any) => ({ tiposPermitidos: TIPOS_PERMITIDOS,
        acoes: await lerOutbox(ctx.env, { tipo: a.tipo, status: a.status, limite: a.limite }) }) },

    { name: "goworker_despachar",
      description: "Manda o agente entregar as acoes que estao prontas na outbox. Sem OUTBOX_WEBHOOK_URL configurado elas ficam prontas e o resultado explica isso. A trava recusa qualquer tipo fora da lista fechada ANTES de qualquer chamada de rede: nao existe caminho para aprovar ou recusar um pagamento.",
      inputSchema: { type: "object", properties: {
        tipo: { type: "string", description: "restringe a um tipo de acao" },
        max: { type: "number", description: "maximo de acoes por chamada, ate 100" } } },
      handler: async (a: any, ctx: any) => despacharPendentes(ctx.env, ctx.userEmail, a.tipo, Number(a.max ?? 25)) },

    { name: "goworker_lotes_cap",
      description: "Lotes de contas a pagar ja montados pelo agente para os pedidos que passarem na aprovacao: data de pagamento pelo calendario do Art. 9 (dias 10, 20 e 30), prazo do Art. 8 (2 dias uteis de lancamento fiscal + 3 de programacao) e forma PIX do Art. 10. Cada lote traz os itens e os minutos de digitacao no ERP que deixam de existir.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => { const sm: any = await lastSummary(ctx.env); return sm?.agente?.lotesCAP ?? { erro: "sem execucao" }; } },

    { name: "goworker_premissas_hh",
      description: "Le ou ajusta os minutos de trabalho humano que cada acao do agente substitui. Sao PREMISSAS declaradas, nao medicoes: passe novos valores para calibrar com o time de Contas a Pagar e o calculo de horas economizadas muda na proxima execucao.",
      inputSchema: { type: "object", properties: {
        triagem_documental: { type: "number" }, correcao_cadastro: { type: "number" },
        devolucao_ao_solicitante: { type: "number" }, roteamento_alcada: { type: "number" },
        montagem_dossie: { type: "number" }, cobranca_de_fila: { type: "number" },
        programacao_cap: { type: "number" }, encerramento: { type: "number" } } },
      handler: async (a: any, ctx: any) => Object.keys(a).length
        ? { premissas: await gravarHH(ctx.env, a), aviso: "Vale a partir da proxima execucao." }
        : { premissas: await lerHH(ctx.env), padrao: HH_PADRAO } },

    { name: "goworker_executar",
      description: "Manda o agente AGIR no GoService/GLPI: adiciona o acompanhamento de devolucao no chamado, registra a solucao para encerrar o que nao deveria existir, e troca o aprovador quando a alcada esta errada. Sem os secrets GLPI_APP_TOKEN e GLPI_USER_TOKEN nao faz nada; com eles e sem GLPI_MODO=executar roda em ENSAIO, mostrando a chamada exata que faria. O escopo de piloto limita a acao a um aprovador so.",
      inputSchema: { type: "object", properties: {
        tipo: { type: "string", description: "restringe a um tipo de acao da outbox" },
        max: { type: "number", description: "maximo de ordens nesta chamada, ate 100" },
        piloto: { type: "string", description: "id GLPI do aprovador do piloto; sem isso usa env.GLPI_PILOTO_APROVADOR" } } },
      handler: async (a: any, ctx: any) => executarNoGlpi(ctx.env, ctx.userEmail, { tipo: a.tipo, max: a.max, piloto: a.piloto }) },

    { name: "goworker_lixeira",
      description: "Consulta a lixeira do agente: pedidos tirados da base de trabalho por estarem parados sem movimento (regra 1 do handoff). Nada e apagado e nada expira. Busque por id do pedido, numero do chamado, fornecedor, CNPJ, aprovador ou solicitante. Cada item traz o snapshot completo de como o pedido estava quando saiu.",
      inputSchema: { type: "object", properties: {
        busca: { type: "string", description: "id, chamado, fornecedor, CNPJ, aprovador ou solicitante" },
        restaurados: { type: "boolean", description: "true so os ja restaurados, false so os que continuam na lixeira" },
        limite: { type: "number" } } },
      handler: async (a: any, ctx: any) => lerLixeira(ctx.env, { busca: a.busca, restaurados: a.restaurados, limite: a.limite }) },

    { name: "goworker_restaurar_da_lixeira",
      description: "Tira um ou mais pedidos da lixeira e devolve a base de trabalho, registrando quem restaurou. Depois disso o agente NUNCA arquiva esses pedidos sozinho de novo: a decisao humana prevalece sobre a regra.",
      inputSchema: { type: "object", properties: {
        ids: { type: "array", items: { type: "number" }, description: "ids de pedido (validationId)" } },
        required: ["ids"] },
      handler: async (a: any, ctx: any) => restaurarDaLixeira(ctx.env, (a.ids ?? []).map(Number), ctx.userEmail) },

    { name: "goworker_regras",
      description: "O registro de regras por sinal, como decidido na revisao de 18/09/2026: quais sinais estao ligados, a severidade de cada um (TRAVA, RESSALVA, ARQUIVAR), a janela de dias quando existe, a base na Politica de Pagamentos e o texto literal de quem revisou.",
      inputSchema: { type: "object", properties: { sinal: { type: "string" } } },
      handler: async (a: any) => a.sinal ? (REGRAS as any)[String(a.sinal).toUpperCase()] ?? { erro: "sinal desconhecido" }
        : { total: Object.keys(REGRAS).length,
            ativos: Object.values(REGRAS).filter((r: any) => r.ativo).length,
            regras: Object.values(REGRAS) } },

    { name: "goworker_diagnostico_de_perfil",
      description: "Abre uma sessao no GoService e diz em que perfil do GLPI o agente esta, qual o bitmask do direito de chamado, e se ele enxerga TODOS os chamados (bit READALL = 1024) ou so os dos grupos do usuario. E a checagem para saber se o agente consegue trabalhar a fila inteira ou so uma fatia.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => diagnosticoDePerfil(ctx.env) },

    { name: "goworker_status_execucao",
      description: "Diz se o agente tem credencial de escrita no GoService, em que modo esta (ensaio ou executar), qual o escopo de piloto, e qual o limite estrutural: nenhum caminho do app consegue aprovar ou recusar um pagamento.",
      inputSchema: { type: "object", properties: {} },
      handler: async (_a, ctx: any) => ({
        credenciais: credenciaisOk(ctx.env) ? "configuradas" : "FALTANDO",
        modo: modoGlpi(ctx.env), piloto: ctx.env.GLPI_PILOTO_APROVADOR ?? null }) },

    { name: "goworker_registrar_decisao",
      description: "Registra na trilha de auditoria o que um humano decidiu sobre um pedido. NAO aprova nem recusa no GoService: este agente nao tem permissao de escrita no GLPI, por desenho. Serve para o agente saber o que ja foi tratado.",
      inputSchema: { type: "object", properties: {
        id: { type: "number" },
        decisao: { type: "string", description: "acatado | rejeitado | adiado" },
        observacao: { type: "string" } }, required: ["id", "decisao"] },
      handler: async (a: any, ctx: any) => {
        await logAudit(ctx.env, ctx.userEmail, Number(a.id), "decisao_humana", { decisao: a.decisao, observacao: a.observacao ?? null });
        return { registrado: true, id: Number(a.id), decisao: a.decisao, por: ctx.userEmail ?? "anonimo",
          aviso: "Registro apenas na trilha do Goworker. A ação no GoService continua sendo manual." };
      } },
  ],
});

// ---------------------------------------------------------------- roteador

export default {
  async fetch(request: Request, env: any): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;
    const actor = request.headers.get("X-Godeploy-User-Email");

    try {
      await init(env);

      if (path === "/_mcp") return handleMcp(request, env, mcp);

      if (path === "/api/health") {
        const c = await env.DB.query("SELECT COUNT(*) n FROM approvals", []);
        const tr = await env.DB.query("SELECT COUNT(*) n FROM triage", []);
        const rn = await env.DB.query("SELECT COUNT(*) n FROM runs", []);
        return json({ ok: true, schemaVersion: SCHEMA_VERSION, execucoes: rn.rows[0].n, ingeridos: c.rows[0].n, triados: tr.rows[0].n, fonte: c.rows[0].n > 0 ? "ingerido" : "snapshot embutido", regras: { ZOMBIE_DAYS, APPROVER_IDLE_DAYS }, acoes: Object.keys(ACOES) });
      }

      if (path === "/api/ingest" && request.method === "POST") {
        const body: any = await request.json();
        const rows = Array.isArray(body) ? body : body.approvals;
        if (!Array.isArray(rows)) return json({ erro: "esperado { approvals: [...] }" }, 400);
        const n = await ingest(env, rows, actor);
        return json({ ok: true, gravados: n });
      }

      // POST /api/run: alvo do cron e do botao "rodar agente"
      if (path === "/api/run" && request.method === "POST") {
        const cron = request.headers.get("X-Godeploy-Cron");
        const cap = Number(url.searchParams.get("cap") ?? 0);
        const out = await runAgent(env, actor, cron ? "cron" : "manual", cap);
        return json({ ok: true, ...out });
      }

      // Diagnostico: roda cada estagio isolado e devolve tempos. Nao grava nada.
      if (path === "/api/diag") {
        const cap = Number(url.searchParams.get("cap") ?? 0);
        const t: Record<string, number> = {}; const t0 = Date.now(); let last = t0;
        const lap = (k: string) => { const n = Date.now(); t[k] = n - last; last = n; };
        let src = await getSource(env); lap("getSource");
        let raw = cap > 0 ? src.raw.slice(-cap) : src.raw;
        const all = enrich(raw); lap("enrich");
        const a = analyze(all); lap("analyze");
        const sm = summarize(a); lap("summarize");
        const ctx = buildContext(all, a.pending); lap("buildContext");
        return json({ ok: true, registros: raw.length, pendentes: a.pending.length,
          dossies: ctx.size, totalMs: Date.now() - t0, etapas: t, origem: src.origem });
      }

      // ---------------- agente ----------------
      if (path === "/api/agente/resumo") {
        const sm: any = await lastSummary(env);
        return sm?.agente ? json({ runId: sm.runId, ranAt: sm.ranAt, ...sm.agente }) : json({ erro: "sem execucao" }, 404);
      }
      if (path === "/api/agente/fila") {
        return json(await filaAgente(env, {
          acao: url.searchParams.get("acao") ?? undefined,
          dono: url.searchParams.get("dono") ?? undefined,
          artigo: url.searchParams.get("artigo") ?? undefined,
          incluirLixeira: url.searchParams.get("lixeira") === "1",
          limite: Number(url.searchParams.get("limite") ?? 50) }));
      }
      if (path === "/api/agente/parecer") {
        const d = await parecerAgente(env, Number(url.searchParams.get("id")));
        return d ? json(d) : json({ erro: "pedido nao esta na fila do agente" }, 404);
      }
      if (path === "/api/agente/outbox") {
        return json({ tiposPermitidos: TIPOS_PERMITIDOS, acoes: await lerOutbox(env, {
          tipo: url.searchParams.get("tipo") ?? undefined,
          status: url.searchParams.get("status") ?? undefined,
          limite: Number(url.searchParams.get("limite") ?? 50) }) });
      }
      if (path === "/api/agente/despachar" && request.method === "POST") {
        const b: any = await request.json().catch(() => ({}));
        return json(await despacharPendentes(env, actor, b.tipo, Number(b.max ?? 25)));
      }
      if (path === "/api/agente/executar" && request.method === "POST") {
        const b: any = await request.json().catch(() => ({}));
        return json(await executarNoGlpi(env, actor, { tipo: b.tipo, max: b.max, piloto: b.piloto }));
      }
      if (path === "/api/agente/perfil") {
        try { return json(await diagnosticoDePerfil(env)); }
        catch (e: any) { return json({ erro: e?.message ?? String(e) }, 500); }
      }
      if (path === "/api/agente/execucao") {
        return json({
          credenciais: credenciaisOk(env) ? "configuradas" : "FALTANDO (GLPI_APP_TOKEN e GLPI_USER_TOKEN)",
          modo: modoGlpi(env),
          piloto: env.GLPI_PILOTO_APROVADOR ?? null,
          explicacao: modoGlpi(env) === "ensaio"
            ? "Em ensaio o agente monta a chamada, valida a trava e nao envia. Setar GLPI_MODO=executar para agir."
            : "O agente esta escrevendo no GoService.",
          limite: "Nenhum caminho deste app escreve status, is_approved ou comment_validation em TicketValidation. Aprovar e recusar sao do aprovador com alcada (Art. 7).",
        });
      }
      if (path === "/api/lixeira") {
        const rp = url.searchParams.get("restaurados");
        return json(await lerLixeira(env, {
          busca: url.searchParams.get("busca") ?? undefined,
          restaurados: rp === "1" ? true : rp === "0" ? false : undefined,
          limite: Number(url.searchParams.get("limite") ?? 50) }));
      }
      if (path === "/api/lixeira/restaurar" && request.method === "POST") {
        const b: any = await request.json().catch(() => ({}));
        const ids = (Array.isArray(b.ids) ? b.ids : [b.id]).map(Number).filter(Boolean);
        return json(await restaurarDaLixeira(env, ids, actor));
      }
      if (path === "/api/agente/lotes") {
        const sm: any = await lastSummary(env);
        return sm?.agente?.lotesCAP ? json(sm.agente.lotesCAP) : json({ erro: "sem execucao" }, 404);
      }
      if (path === "/api/agente/hh" && request.method === "POST") {
        const b: any = await request.json().catch(() => ({}));
        const novo = await gravarHH(env, b);
        return json({ ok: true, premissas: novo, aviso: "Vale a partir da proxima execucao do agente." });
      }
      if (path === "/api/agente/hh") return json({ premissas: await lerHH(env), padrao: HH_PADRAO,
        aviso: "Minutos de trabalho humano que cada acao substitui. Sao PREMISSAS, nao medicoes: calibrar com o time de CAP." });

      if (path === "/api/summary") {
        const s = await lastSummary(env);
        return s ? json(s) : json({ erro: "sem execucao" }, 404);
      }

      if (path === "/api/queue") {
        return json(await queue(env, {
          action: url.searchParams.get("acao") ?? undefined,
          approver: url.searchParams.get("aprovador") ?? undefined,
          code: url.searchParams.get("sinal") ?? undefined,
          kind: url.searchParams.get("tipo") ?? undefined,
          incluirLixeira: url.searchParams.get("lixeira") === "1",
          limit: Number(url.searchParams.get("limite") ?? 50),
        }));
      }

      if (path === "/api/item") {
        const d = await dossier(env, Number(url.searchParams.get("id")));
        return d ? json(d) : json({ erro: "nao encontrado" }, 404);
      }

      if (path === "/api/audit" && request.method === "POST") {
        const b: any = await request.json();
        await logAudit(env, actor, b.id ? Number(b.id) : null, b.evento ?? "decisao_humana", b);
        return json({ ok: true, aviso: "Registrado apenas no Goworker. Não escreve no GoService." });
      }

      if (path === "/api/audit") {
        const r = await env.DB.query("SELECT at, actor, approval_id, event, detail FROM audit ORDER BY id DESC LIMIT 100", []);
        return json(r.rows ?? []);
      }

      return json({ erro: "rota nao encontrada", rotas: ["/api/health", "/api/ingest", "/api/run", "/api/summary", "/api/queue", "/api/item", "/api/audit", "/_mcp"] }, 404);
    } catch (e: any) {
      console.log("ERRO", path, e?.message, e?.stack);
      return json({ erro: e?.message ?? String(e) }, 500);
    }
  },
};
