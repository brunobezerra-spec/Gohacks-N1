// ============================================================================
// OUTBOX: onde a decisao do agente vira acao no mundo.
//
// Garantia estrutural: o agente so consegue emitir acoes desta lista fechada.
// Nenhuma delas aprova ou recusa um pagamento. Aprovar e recusar sao atos do
// aprovador com alcada (Politica de Pagamentos, Art. 7) e a segregacao de
// funcoes e regra inviolavel (Art. 4). Nao existe caminho de codigo, nem com
// webhook configurado, que emita uma acao de aprovacao.
// ============================================================================

export const TIPOS_PERMITIDOS = [
  "DEVOLVER_AO_SOLICITANTE",   // mensagem pedindo ajuste
  "NOTIFICAR_PENALIDADE",      // Art. 12: area justifica juros/multa
  "RECOMENDAR_ESTORNO",        // Art. 11: parado ha mais de 120 dias
  "CORRIGIR_CADASTRO",         // patch de campo, com origem e confianca
  "ROTEAR_PARA_ALCADA",        // Art. 7: mandar para quem tem alcada
  "ENCERRAR_PEDIDO",           // teste, despesa pre-aprovada
  "PROGRAMAR_CAP",             // Art. 8 e 9: lote de contas a pagar
  // --- entraram com a revisao do handoff de 18/09/2026
  "MOVER_PARA_LIXEIRA",        // regra 1: fila zumbi sai da base, restauravel
  "ABRIR_CHAMADO_DE_HIGIENE",  // regra 4: UM chamado com a lista, nao um por pedido
  "ABRIR_DEMANDA_DE_PRODUTO",  // regra 15: o campo de valor precisa existir
] as const;
export type TipoAcao = typeof TIPOS_PERMITIDOS[number];

// Lista negra explicita. Serve de documentacao e de trava: qualquer tentativa
// de emitir algo com essa cara e recusada antes de sair.
// Verbos de ato decisorio. "ROTEAR_PARA_ALCADA" fala de PARA QUEM mandar, nao
// de decidir, por isso o padrao olha forma verbal e nao o substantivo aprovador.
const PROIBIDOS = /\b(aprovar|aprovado|aprova_|approve|recusar|reject|reprovar|liberar_pagamento|validar_pagamento|pagar|liquidar|efetivar)\b|^APROV|^RECUS|^REPROV/i;

export function validarAcao(tipo: string) {
  if (!TIPOS_PERMITIDOS.includes(tipo as TipoAcao)) {
    return { ok: false, motivo: `Tipo "${tipo}" nao esta na lista fechada de acoes do agente.` };
  }
  if (PROIBIDOS.test(tipo) && tipo !== "RECOMENDAR_ESTORNO") {
    return { ok: false, motivo: `Tipo "${tipo}" tem forma de ato de aprovacao. O agente nao aprova nem recusa (Art. 4 e 7).` };
  }
  return { ok: true as const };
}

export type AcaoOutbox = {
  tipo: TipoAcao;
  pedidoId: number | null;
  destinatario: string | null;
  assunto: string | null;
  payload: unknown;
  baseLegal: string | null;
};

// Despacho. Sem OUTBOX_WEBHOOK_URL configurado, a acao fica enfileirada com
// status "pronta" e o agente segue: a decisao ja foi tomada e registrada.
// Com webhook, ele entrega. Em nenhum dos dois casos ele pede permissao item a item.
export async function despachar(env: any, acao: AcaoOutbox) {
  const v = validarAcao(acao.tipo);
  if (!v.ok) return { entregue: false, status: "recusada_pela_trava", motivo: v.motivo };

  const url = env.OUTBOX_WEBHOOK_URL;
  if (!url) return { entregue: false, status: "pronta", motivo: "OUTBOX_WEBHOOK_URL nao configurado" };
  if (!/^https:\/\//.test(String(url))) {
    return { entregue: false, status: "recusada_pela_trava", motivo: "webhook precisa ser https" };
  }
  try {
    const r = await fetch(String(url), {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Goworker-Acao": acao.tipo },
      body: JSON.stringify({ ...acao, emitidoEm: new Date().toISOString(), agente: "goworker-financeiro" }),
    });
    return { entregue: r.ok, status: r.ok ? "entregue" : `erro_${r.status}`, motivo: null };
  } catch (e: any) {
    return { entregue: false, status: "falha_de_rede", motivo: e?.message ?? String(e) };
  }
}
