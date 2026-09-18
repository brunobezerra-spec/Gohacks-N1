// ============================================================================
// Executor GLPI. E aqui que a decisao do agente vira ato no GoService.
//
// Padrao de chamada copiado de um app que ja roda em producao no Gogroup
// (fila-estornos, 5c2f10f8): sessao por App-Token + user_token, killSession
// no finally, FormData sem Content-Type manual.
//
// TRAVA DE COMPETENCIA: existe UMA funcao que toca TicketValidation, e ela so
// pode alterar QUEM valida. Qualquer payload que carregue status, is_approved,
// comment_validation ou users_id_approval e recusado antes de sair. Aprovar e
// recusar sao atos do aprovador com alcada (Politica, Art. 7) e a segregacao de
// funcoes e regra inviolavel (Art. 4).
// ============================================================================

const GLPI_BASE = "https://goservice.gocase.com.br/apirest.php";

export const STATUS_GLPI = { NOVO: 1, ATRIBUIDO: 2, PLANEJADO: 3, PENDENTE: 4, SOLUCIONADO: 5, FECHADO: 6 };

// Campos que, se presentes num PUT de TicketValidation, mudariam o VEREDITO.
const CAMPOS_DE_VEREDITO = ["status", "is_approved", "comment_validation", "validation_date", "users_id_approval"];

export function assertNaoEhAprovacao(input: Record<string, unknown>) {
  const proibidos = Object.keys(input).filter(k => CAMPOS_DE_VEREDITO.includes(k));
  if (proibidos.length) {
    throw new Error(
      `TRAVA: o agente tentou escrever ${proibidos.join(", ")} em TicketValidation. ` +
      `Esses campos decidem o pagamento e sao do aprovador com alcada (Art. 7). ` +
      `A segregacao de funcoes e regra inviolavel (Art. 4).`);
  }
}

export type GlpiEnv = { GLPI_APP_TOKEN?: string; GLPI_USER_TOKEN?: string; GLPI_MODO?: string; GLPI_PILOTO_APROVADOR?: string };

export function credenciaisOk(env: GlpiEnv) {
  return Boolean(env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN);
}
// Modo de execucao. Sem GLPI_MODO=executar, tudo roda em ensaio: monta a
// chamada inteira, valida a trava, e NAO envia. Ligar e uma decisao explicita.
export function modo(env: GlpiEnv) {
  return env.GLPI_MODO === "executar" ? "executar" : "ensaio";
}

async function initSession(env: GlpiEnv) {
  const res = await fetch(`${GLPI_BASE}/initSession`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, Authorization: `user_token ${env.GLPI_USER_TOKEN}` },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data?.session_token) throw new Error(`initSession falhou: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  return data.session_token as string;
}
async function killSession(env: GlpiEnv, session: string) {
  await fetch(`${GLPI_BASE}/killSession`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session },
  }).catch(() => {});
}

const H = (env: GlpiEnv, session: string) => ({
  "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session, "Content-Type": "application/json",
});

// ---------------------------------------------------------------- leitura

// A aprovacao (TicketValidation) e o chamado (Ticket) sao objetos diferentes.
// Precisamos do tickets_id para comentar e encerrar.
export async function lerAprovacao(env: GlpiEnv, session: string, validationId: number) {
  const r = await fetch(`${GLPI_BASE}/TicketValidation/${validationId}`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session } });
  if (!r.ok) return { ok: false, status: r.status, erro: (await r.text()).slice(0, 200) };
  const d: any = await r.json();
  return { ok: true, ticketId: Number(d.tickets_id), aprovadorAtual: Number(d.users_id_validate),
    statusValidacao: Number(d.status), solicitante: Number(d.users_id) };
}

// Resolve o login do GLPI para o id numerico, necessario para trocar o aprovador.
export async function resolverUsuario(env: GlpiEnv, session: string, login: string) {
  const qs = new URLSearchParams();
  qs.set("criteria[0][field]", "1");          // 1 = login (name) em User
  qs.set("criteria[0][searchtype]", "equals");
  qs.set("criteria[0][value]", login);
  qs.set("forcedisplay[0]", "2");             // 2 = id
  qs.set("range", "0-4");
  const r = await fetch(`${GLPI_BASE}/search/User?${qs}`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session } });
  if (!r.ok) return null;
  const d: any = await r.json().catch(() => null);
  const row = d?.data?.[0];
  return row ? Number(row["2"]) : null;
}

// ---------------------------------------------------------------- escrita

// 1. DEVOLVER: acompanhamento publico no chamado. O solicitante recebe a
//    notificacao do proprio GLPI e responde no chamado, que e a trilha formal.
export async function adicionarAcompanhamento(env: GlpiEnv, session: string, ticketId: number, html: string) {
  const body = { input: { itemtype: "Ticket", items_id: ticketId, content: html, is_private: 0 } };
  const r = await fetch(`${GLPI_BASE}/ITILFollowup/`, { method: "POST", headers: H(env, session), body: JSON.stringify(body) });
  const txt = await r.text();
  return { ok: r.status === 200 || r.status === 201, status: r.status, resposta: txt.slice(0, 300) };
}

// 2. ENCERRAR: registra a solucao, o que no GLPI leva o chamado a Solucionado.
//    Mesmo endpoint que o app de estornos ja usa em producao.
export async function encerrarChamado(env: GlpiEnv, session: string, ticketId: number, html: string) {
  const body = { input: { itemtype: "Ticket", items_id: ticketId, solutiontypes_id: 2, content: html } };
  const r = await fetch(`${GLPI_BASE}/ITILSolution/`, { method: "POST", headers: H(env, session), body: JSON.stringify(body) });
  const txt = await r.text();
  return { ok: r.status === 200 || r.status === 201, status: r.status, resposta: txt.slice(0, 300) };
}

// 3. TROCAR APROVADOR: muda QUEM valida, nunca o veredito. O input e montado
//    campo a campo e passa pela trava antes de virar requisicao.
export async function trocarAprovador(env: GlpiEnv, session: string, validationId: number, novoUsuarioId: number) {
  const input: Record<string, unknown> = { id: validationId, users_id_validate: novoUsuarioId };
  assertNaoEhAprovacao(input);
  const r = await fetch(`${GLPI_BASE}/TicketValidation/${validationId}`, {
    method: "PUT", headers: H(env, session), body: JSON.stringify({ input }) });
  const txt = await r.text();
  return { ok: r.status === 200 || r.status === 201, status: r.status, resposta: txt.slice(0, 300) };
}

// ---------------------------------------------------------------- orquestracao

export type Ordem = {
  tipo: "DEVOLVER_AO_SOLICITANTE" | "RECOMENDAR_ESTORNO" | "NOTIFICAR_PENALIDADE"
      | "ENCERRAR_PEDIDO" | "ROTEAR_PARA_ALCADA";
  validationId: number;
  html?: string;
  novoUsuarioId?: number;
  novoLogin?: string;
};

const ASSINATURA = `<hr><p style="font-size:12px;color:#666">Mensagem gerada pelo <b>Goworker do Financeiro</b>, agente de contas a pagar.
Base: Politica Corporativa de Pagamentos do Gogroup. A decisao de aprovar ou recusar continua sendo humana.</p>`;

// Executa um lote de ordens. Sempre em uma sessao so, sempre com killSession.
// Em modo ensaio devolve exatamente o que enviaria, sem enviar.
export async function executar(env: GlpiEnv, ordens: Ordem[], opts: { piloto?: string | null } = {}) {
  const m = modo(env);
  const resultados: any[] = [];

  if (!credenciaisOk(env)) {
    return { modo: m, executadas: 0, erro: "GLPI_APP_TOKEN e GLPI_USER_TOKEN nao configurados",
      resultados: ordens.map(o => ({ ...o, status: "sem_credencial" })) };
  }

  let session: string;
  try { session = await initSession(env); }
  catch (e: any) { return { modo: m, executadas: 0, erro: e?.message ?? String(e), resultados: [] }; }

  try {
    for (const ordem of ordens) {
      let o: any = ordem;
      const alvo = await lerAprovacao(env, session, o.validationId);
      if (!alvo.ok) { resultados.push({ ...o, status: "aprovacao_ilegivel", detalhe: alvo }); continue; }

      // Piloto: o agente so age na fila de um aprovador. Trava de escopo.
      if (opts.piloto && String(alvo.aprovadorAtual) !== String(opts.piloto)) {
        resultados.push({ ...o, status: "fora_do_piloto", aprovadorAtual: alvo.aprovadorAtual }); continue;
      }
      // Nao mexe em aprovacao ja decidida (status 2 = Aguardando no GLPI).
      if (alvo.statusValidacao !== 2) {
        resultados.push({ ...o, status: "ja_decidida", statusValidacao: alvo.statusValidacao }); continue;
      }

      const html = (o.html ?? "") + ASSINATURA;
      let chamada: any, envio: any;

      if (o.tipo === "ROTEAR_PARA_ALCADA") {
        let destino = o.novoUsuarioId ?? null;
        if (!destino && o.novoLogin) destino = await resolverUsuario(env, session, o.novoLogin);
        if (!destino) { resultados.push({ ...o, status: "sem_destino",
          motivo: "nao consegui resolver o id do aprovador de destino no GLPI" }); continue; }
        o = { ...o, novoUsuarioId: destino };
        const input = { id: o.validationId, users_id_validate: o.novoUsuarioId };
        try { assertNaoEhAprovacao(input); }
        catch (e: any) { resultados.push({ ...o, status: "recusada_pela_trava", motivo: e.message }); continue; }
        chamada = { metodo: "PUT", url: `/TicketValidation/${o.validationId}`, input };
        envio = m === "executar" ? await trocarAprovador(env, session, o.validationId, o.novoUsuarioId) : null;

      } else if (o.tipo === "ENCERRAR_PEDIDO") {
        chamada = { metodo: "POST", url: "/ITILSolution/", input: { itemtype: "Ticket", items_id: alvo.ticketId, solutiontypes_id: 2, content: html } };
        envio = m === "executar" ? await encerrarChamado(env, session, alvo.ticketId!, html) : null;

      } else {
        chamada = { metodo: "POST", url: "/ITILFollowup/", input: { itemtype: "Ticket", items_id: alvo.ticketId, content: html, is_private: 0 } };
        envio = m === "executar" ? await adicionarAcompanhamento(env, session, alvo.ticketId!, html) : null;
      }

      resultados.push({ ...o, ticketId: alvo.ticketId, chamada,
        status: m === "ensaio" ? "ensaio" : (envio?.ok ? "executada" : "falhou"),
        resposta: envio?.resposta ?? null, httpStatus: envio?.status ?? null });
    }
  } finally {
    await killSession(env, session);
  }

  return { modo: m, executadas: resultados.filter(r => r.status === "executada").length,
    total: resultados.length, resultados };
}
