import { handleMcp } from "./mcp/shim";
import { defineMcp } from "./mcp/define";
import { enrich, analyze, summarize, auditRetroativo, motivosDeRecusa, ACOES, ZOMBIE_DAYS, APPROVER_IDLE_DAYS } from "./engine";
import { expandSnapshot } from "./snapshot";

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
  `CREATE TABLE IF NOT EXISTS triage (
     approval_id INTEGER PRIMARY KEY, run_id INTEGER, action TEXT, risk INTEGER,
     age_days REAL, approver TEXT, codes TEXT, doc TEXT, prioridade INTEGER, kind TEXT)`,
  `CREATE INDEX IF NOT EXISTS ix_tri_action ON triage(action)`,
  `CREATE INDEX IF NOT EXISTS ix_tri_approver ON triage(approver)`,
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
export const SCHEMA_VERSION = 4;

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
  const COLS = 10, CHUNK = chunkFor(COLS);
  for (let i = 0; i < a.pending.length; i += CHUNK) {
    const slice = a.pending.slice(i, i + CHUNK);
    const ph = slice.map(() => "(?,?,?,?,?,?,?,?,?,?)").join(",");
    const p: any[] = [];
    for (const r of slice) {
      const doc = {
        action_label: r.actionLabel, why: r.why, kind: r.kind, supplier: r.supplier,
        cnpj: r.cnpj, title: r.title, liftTipo: r.liftTipo,
        submitted_at: r.submittedAt ? new Date(r.submittedAt).toISOString().slice(0, 19).replace("T", " ") : null,
        findings: r.findings, contexto: ctx.get(r.id) ?? {},
      };
      p.push(r.id, rid, r.action, r.risk,
        r.ageDays === null ? null : Math.round(r.ageDays * 10) / 10,
        r.approver, r.findings.map((f: any) => f.code).join(","), JSON.stringify(doc), r.prioridade, r.kind);
    }
    await env.DB.exec(`INSERT INTO triage (approval_id,run_id,action,risk,age_days,approver,codes,doc,prioridade,kind) VALUES ${ph}`, p);
  }
  mark("triagem gravada");
  await logAudit(env, actor, null, "run", { runId: rid, origem, pendentes: s.totalPending, acoes: s.byAction });
  mark("fim");
  return { runId: rid, origem, ms: Date.now() - t0, ...s };
}

async function lastSummary(env: any) {
  const r = await env.DB.query("SELECT id, ran_at, total_records, total_pending, summary FROM runs ORDER BY id DESC LIMIT 1", []);
  if (!r.rows?.length) return null;
  const row = r.rows[0];
  return { runId: row.id, ranAt: row.ran_at, totalRecords: row.total_records, ...JSON.parse(row.summary) };
}

async function queue(env: any, f: { action?: string; approver?: string; code?: string; kind?: string; limit?: number }) {
  const w: string[] = [], p: any[] = [];
  if (f.action) { w.push("action = ?"); p.push(f.action.toUpperCase()); }
  if (f.approver) { w.push("approver LIKE ?"); p.push("%" + f.approver.toLowerCase() + "%"); }
  if (f.code) { w.push("codes LIKE ?"); p.push("%" + f.code.toUpperCase() + "%"); }
  if (f.kind) { w.push("kind = ?"); p.push(f.kind); }
  p.push(Math.min(f.limit ?? 50, 500));
  const r = await env.DB.query(
    `SELECT approval_id,action,risk,age_days,approver,doc,prioridade,kind
     FROM triage ${w.length ? "WHERE " + w.join(" AND ") : ""}
     ORDER BY prioridade DESC, risk DESC, age_days DESC LIMIT ?`, p);
  return (r.rows ?? []).map((x: any) => {
    const d = JSON.parse(x.doc || "{}");
    return { approval_id: x.approval_id, action: x.action, action_label: d.action_label,
      risk: x.risk, prioridade: x.prioridade, why: d.why, age_days: x.age_days, approver: x.approver,
      kind: d.kind, supplier: d.supplier, cnpj: d.cnpj, title: d.title,
      submitted_at: d.submitted_at, findings: d.findings ?? [] };
  });
}

// O dossie: tudo que o aprovador precisaria juntar na mao para decidir.
// O contexto pesado ja foi calculado na execucao do agente; aqui e leitura de 1 linha.
async function dossier(env: any, id: number) {
  const t = await env.DB.query("SELECT * FROM triage WHERE approval_id = ?", [id]);
  if (!t.rows?.length) return null;
  const row: any = t.rows[0];
  const d = JSON.parse(row.doc || "{}");
  const ctx = d.contexto ?? {};
  const trilha = await env.DB.query(
    "SELECT at, actor, event, detail FROM audit WHERE approval_id = ? ORDER BY id DESC LIMIT 20", [id]);

  return {
    pedido: { id: row.approval_id, titulo: d.title, tipo: d.kind, beneficiario: d.supplier,
      cnpj: d.cnpj, aprovador: row.approver, submetidoEm: d.submitted_at, paradoHaDias: row.age_days },
    recomendacao: { acao: row.action, rotulo: d.action_label, porque: d.why, risco: row.risk,
      prioridade: row.prioridade, liftDoTipo: d.liftTipo },
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
