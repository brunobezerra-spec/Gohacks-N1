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

// LISTA BRANCA DE ENDPOINTS DE ESCRITA. Tudo que nao esta aqui e recusado antes
// de virar requisicao. Em 18/09/2026 um teste manual meu usou PUT /Ticket/{id}
// para mudar o status de um chamado real (23119) e funcionou. O agente nao pode
// ter esse poder: mudar status de chamado nao e ato dele.
const ESCRITA_PERMITIDA: { metodo: string; re: RegExp; oque: string }[] = [
  { metodo: "POST", re: /^\/ITILFollowup\/$/,          oque: "comentar no chamado (devolver ao solicitante)" },
  { metodo: "POST", re: /^\/ITILSolution\/$/,           oque: "registrar solucao (encerrar o que nao deveria existir)" },
  { metodo: "PUT",  re: /^\/TicketValidation\/\d+$/,    oque: "trocar QUEM valida, campo users_id_validate" },
  { metodo: "POST", re: /^\/Ticket\/$/,                  oque: "abrir UM chamado de higiene com a lista (regra 4)" },
];

export function assertEndpointPermitido(metodo: string, caminho: string) {
  const ok = ESCRITA_PERMITIDA.some(e => e.metodo === metodo.toUpperCase() && e.re.test(caminho));
  if (!ok) throw new Error(
    `TRAVA: ${metodo} ${caminho} nao esta na lista branca de escrita do agente. ` +
    `Permitidos: ${ESCRITA_PERMITIDA.map(e => e.metodo + " " + e.re.source).join(", ")}.`);
  return true;
}

// Toda escrita passa por aqui. Nao existe outro caminho para o GLPI no modulo.
async function escrever(env: GlpiEnv, session: string, metodo: "POST" | "PUT", caminho: string, body: unknown) {
  assertEndpointPermitido(metodo, caminho);
  const r = await fetch(`${GLPI_BASE}${caminho}`, { method: metodo, headers: H(env, session), body: JSON.stringify(body) });
  const txt = await r.text();
  return { ok: r.status === 200 || r.status === 201, status: r.status, resposta: txt.slice(0, 300) };
}

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

export type GlpiEnv = { GLPI_APP_TOKEN?: string; GLPI_USER_TOKEN?: string; GLPI_MODO?: string;
  GLPI_PILOTO_APROVADOR?: string; GLPI_PERFIL_ID?: string };

export function credenciaisOk(env: GlpiEnv) {
  return Boolean(env.GLPI_APP_TOKEN && env.GLPI_USER_TOKEN);
}
// Modo de execucao. Sem GLPI_MODO=executar, tudo roda em ensaio: monta a
// chamada inteira, valida a trava, e NAO envia. Ligar e uma decisao explicita.
// O valor do secret aparece censurado nos logs da plataforma. Com GLPI_MODO
// valendo a palavra "executar", toda mensagem do GLPI que continha essa palavra
// virava [REDACTED] e o log ficava ilegivel. Por isso o valor esperado e "on".
export function modo(env: GlpiEnv) {
  const v = String(env.GLPI_MODO ?? "").toLowerCase();
  return (v === "on" || v === "executar" || v === "ligado") ? "executar" : "ensaio";
}

// O GLPI abre a sessao no perfil PADRAO do usuario. Como o agente precisa de um
// perfil proprio (o unico com "Ver: todos os chamados"), ele troca o perfil
// ativo explicitamente. Assim ninguem precisa mexer no perfil padrao da pessoa,
// e o perfil do agente fica visivel na trilha do GLPI.
async function initSession(env: GlpiEnv) {
  const res = await fetch(`${GLPI_BASE}/initSession`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, Authorization: `user_token ${env.GLPI_USER_TOKEN}` },
  });
  const data: any = await res.json().catch(() => ({}));
  if (!data?.session_token) throw new Error(`initSession falhou: HTTP ${res.status} ${JSON.stringify(data).slice(0, 200)}`);
  const session = data.session_token as string;

  const perfil = Number(env.GLPI_PERFIL_ID ?? 0);
  if (perfil > 0) {
    const r = await fetch(`${GLPI_BASE}/changeActiveProfile`, {
      method: "POST",
      headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session, "Content-Type": "application/json" },
      body: JSON.stringify({ profiles_id: perfil }),
    });
    if (!r.ok) console.log(`[glpi] nao consegui trocar para o perfil ${perfil}: HTTP ${r.status}`);
  }
  return session;
}

// Diz em que perfil o agente esta e se ele enxerga todos os chamados.
// READALL = bit 1024 do direito "ticket". Sem ele, o agente so ve os chamados
// dos grupos a que o usuario pertence, que hoje sao ~7% da fila.
export const READALL = 1024;
export async function diagnosticoDePerfil(env: GlpiEnv) {
  if (!credenciaisOk(env)) return { erro: "sem credencial" };
  const session = await initSession(env);
  try {
    const r = await fetch(`${GLPI_BASE}/getActiveProfile`, {
      headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session } });
    const d: any = await r.json().catch(() => ({}));
    const p = d?.active_profile ?? {};
    const t = Number(p.ticket ?? 0);
    return {
      perfilAtivo: { id: p.id, nome: p.name },
      direitoTicket: t,
      veTodosOsChamados: Boolean(t & READALL),
      direitoFollowup: p.followup ?? null,
      alcance: (t & READALL)
        ? "O agente enxerga todos os chamados."
        : "O agente so enxerga chamados dos grupos do usuario. Falta marcar 'Ver: todos' no perfil.",
    };
  } finally { await killSession(env, session); }
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
// ATENCAO: GET /TicketValidation/{id} devolve 403 com este perfil, mas a COLECAO
// filtrada por searchText[id] devolve o registro. O perfil enxerga por listagem,
// nao por item. Mesma coisa em Ticket: /Ticket/{id} pode dar 403 mesmo quando a
// escrita no chamado e aceita.
export async function lerAprovacao(env: GlpiEnv, session: string, validationId: number) {
  const r = await fetch(`${GLPI_BASE}/TicketValidation/?range=0-1&searchText%5Bid%5D=${validationId}`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": session } });
  if (!r.ok) return { ok: false, status: r.status, erro: (await r.text()).slice(0, 200) };
  const arr: any = await r.json().catch(() => null);
  const d = Array.isArray(arr) ? arr.find((x: any) => Number(x?.id) === validationId) : null;
  if (!d) return { ok: false, status: r.status, erro: "validacao nao encontrada na colecao" };
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
  return escrever(env, session, "POST", "/ITILFollowup/",
    { input: { itemtype: "Ticket", items_id: ticketId, content: html, is_private: 0 } });
}

// 2. ENCERRAR: registra a solucao, o que no GLPI leva o chamado a Solucionado.
//    Mesmo endpoint que o app de estornos ja usa em producao.
export async function encerrarChamado(env: GlpiEnv, session: string, ticketId: number, html: string) {
  return escrever(env, session, "POST", "/ITILSolution/",
    { input: { itemtype: "Ticket", items_id: ticketId, solutiontypes_id: 2, content: html } });
}

// 3. TROCAR APROVADOR: muda QUEM valida, nunca o veredito. O input e montado
//    campo a campo e passa pela trava antes de virar requisicao.
export async function trocarAprovador(env: GlpiEnv, session: string, validationId: number, novoUsuarioId: number) {
  const input: Record<string, unknown> = { id: validationId, users_id_validate: novoUsuarioId };
  assertNaoEhAprovacao(input);
  return escrever(env, session, "PUT", `/TicketValidation/${validationId}`, { input });
}

// Regra 4 do handoff: os registros de teste sao encerrados sem notificar
// ninguem, e UM chamado de higiene carrega a lista inteira. Um, nao 106.
export async function abrirChamadoDeHigiene(env: GlpiEnv, session: string, titulo: string, html: string) {
  return escrever(env, session, "POST", "/Ticket/",
    { input: { name: titulo, content: html, type: 2, urgency: 2, impact: 2, priority: 2 } });
}

// ---------------------------------------------------------------- orquestracao

export type Ordem = {
  tipo: "DEVOLVER_AO_SOLICITANTE" | "RECOMENDAR_ESTORNO" | "NOTIFICAR_PENALIDADE"
      | "ENCERRAR_PEDIDO" | "ROTEAR_PARA_ALCADA" | "ABRIR_CHAMADO_DE_HIGIENE" | "ABRIR_DEMANDA_DE_PRODUTO";
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

      // Chamado de higiene e demanda de produto nao pendem de validacao nenhuma:
      // sao chamados novos. A demanda de produto so vale se virar item numa fila
      // que alguem olha; parada na outbox do agente nao muda nada.
      if (o.tipo === "ABRIR_CHAMADO_DE_HIGIENE" || o.tipo === "ABRIR_DEMANDA_DE_PRODUTO") {
        const envio = m === "executar"
          ? await abrirChamadoDeHigiene(env, session, o.titulo ?? "Higiene de base do Goworker", (o.html ?? "") + ASSINATURA)
          : null;
        resultados.push({ ...o, chamada: { metodo: "POST", url: "/Ticket/", input: { name: o.titulo } },
          status: m === "ensaio" ? "ensaio" : (envio?.ok ? "executada" : "falhou"),
          resposta: envio?.resposta ?? null, httpStatus: envio?.status ?? null });
        continue;
      }
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
        // Sem destino resolvivel, o agente NAO fica calado: escreve no chamado
        // qual e a alcada correta e por que, e deixa a reatribuicao para gente.
        if (!destino) {
          const envioF = m === "executar" ? await adicionarAcompanhamento(env, session, alvo.ticketId!, html) : null;
          resultados.push({ ...o, ticketId: alvo.ticketId,
            chamada: { metodo: "POST", url: "/ITILFollowup/", nota: "fallback: sem id do aprovador de destino" },
            status: m === "ensaio" ? "ensaio" : (envioF?.ok ? "executada" : "falhou"),
            resposta: envioF?.resposta ?? null, httpStatus: envioF?.status ?? null,
            motivo: "alcada sinalizada no chamado; troca de aprovador continua humana" });
          continue;
        }
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
