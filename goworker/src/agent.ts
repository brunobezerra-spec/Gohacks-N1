// ============================================================================
// O AGENTE.
// engine.ts     = higiene de dado (o que o historico mostra)
// policy.ts     = norma (o que a Politica de Pagamentos manda)
// agent.ts      = DECISAO E EXECUCAO (o que o agente faz, sozinho)
//
// Ele fica entre o solicitante e o diretor aprovador. Para cada pedido decide
// uma acao e a executa no seu proprio livro-razao, emitindo na outbox o payload
// exato para o sistema de destino. Ele NAO aprova e NAO recusa: a Politica
// reserva isso ao aprovador com alcada (Art. 7) e trata segregacao de funcoes
// como regra inviolavel (Art. 4).
// ============================================================================

import { avaliarPolitica, construirGrafiasCorretas, alcadaExigida, temAlcada,
         proximoCiclo, somaDiasUteis, PRAZO_TOTAL_DU, DIAS_DE_PAGAMENTO,
         ESTORNO_RECOMENDADO_DIAS, ANEXO_I, type Nivel } from "./policy";
import { DAY } from "./engine";

// ---------------------------------------------------------------- acoes

export const ACOES_AGENTE = {
  ENCERRAR:              { ordem: 1, dono: "agente",     label: "Encerrar sem pagamento" },
  DEVOLVER:              { ordem: 2, dono: "solicitante", label: "Devolver ao solicitante" },
  CORRIGIR_E_ENCAMINHAR: { ordem: 3, dono: "agente",     label: "Corrigir e encaminhar" },
  RECOMENDAR_ESTORNO:    { ordem: 4, dono: "contas a pagar", label: "Recomendar estorno (Art. 11)" },
  ENCAMINHAR:            { ordem: 5, dono: "aprovador",  label: "Encaminhar ao aprovador" },
} as const;
export type AcaoAgente = keyof typeof ACOES_AGENTE;

// ---------------------------------------------------------------- HH

// PREMISSAS, nao medicoes. Minutos de trabalho humano que cada acao substitui.
// Calibrar com o time de CAP antes de usar como numero oficial: sao a unica
// parte deste sistema que nao sai do dado.
export const HH_PADRAO: Record<string, number> = {
  triagem_documental: 6,      // conferir fornecedor, CNPJ, valor e vencimento (Art. 6)
  correcao_cadastro: 15,      // achar a grafia certa e corrigir
  devolucao_ao_solicitante: 12, // redigir, enviar, acompanhar retorno
  roteamento_alcada: 8,       // descobrir quem tem alcada e reencaminhar (Art. 7)
  montagem_dossie: 10,        // juntar historico do fornecedor e contexto
  cobranca_de_fila: 4,        // perseguir aprovador parado, por ciclo
  programacao_cap: 5,         // lancar no ERP, definir data e forma (Art. 8 e 9)
  encerramento: 3,            // fechar pedido que nao deveria existir
};

function hhDaAcao(acao: AcaoAgente, temCorrecao: boolean, reroteou: boolean, tab: Record<string, number>) {
  let m = tab.triagem_documental;
  if (temCorrecao) m += tab.correcao_cadastro;
  if (reroteou) m += tab.roteamento_alcada;
  if (acao === "DEVOLVER") m += tab.devolucao_ao_solicitante;
  if (acao === "ENCERRAR") m += tab.encerramento;
  if (acao === "RECOMENDAR_ESTORNO") m += tab.devolucao_ao_solicitante;
  if (acao === "ENCAMINHAR" || acao === "CORRIGIR_E_ENCAMINHAR") m += tab.montagem_dossie + tab.cobranca_de_fila;
  return m;
}

// ---------------------------------------------------------------- contexto

export function montarContexto(all: any[], opts: any = {}) {
  const agora = opts.agora ?? Date.now();
  const nomesPorCnpj = new Map<string, Set<string>>();
  for (const r of all) {
    if (r.status === "Aguardando" || !r.cnpj || !r.supplierNorm) continue;
    if (!nomesPorCnpj.has(r.cnpj)) nomesPorCnpj.set(r.cnpj, new Set());
    nomesPorCnpj.get(r.cnpj)!.add(r.supplierNorm);
  }
  return {
    agora,
    grafiaCorreta: construirGrafiasCorretas(all),
    nomesPorCnpj,
    nivelPorAprovador: new Map<string, Nivel>(Object.entries(opts.niveis ?? {}) as any),
    hh: { ...HH_PADRAO, ...(opts.hh ?? {}) },
  };
}

// ---------------------------------------------------------------- decisao

const fmtCnpj = (c: string) => c && c.length === 14
  ? `${c.slice(0,2)}.${c.slice(2,5)}.${c.slice(5,8)}/${c.slice(8,12)}-${c.slice(12)}` : c;
const fmtData = (ts: number) => new Date(ts).toISOString().slice(0, 10).split("-").reverse().join("/");

export function processar(r: any, ctx: any) {
  const pol = avaliarPolitica(r, ctx);
  const graves = pol.violacoes.filter(v => v.gravidade === 3);
  const medias = pol.violacoes.filter(v => v.gravidade === 2);
  const regras = new Set(pol.violacoes.map(v => v.regra));

  let acao: AcaoAgente;
  let porque: string;

  // 1. O que nunca deveria virar pagamento sai da fila, sem consumir aprovador.
  if (regras.has("REGISTRO_DE_TESTE")) {
    acao = "ENCERRAR"; porque = "Registro de teste. Nao ha obrigacao financeira a liquidar.";
  } else if (regras.has("DESPESA_PRE_APROVADA")) {
    acao = "ENCERRAR"; porque = "Anexo II: despesa ja pre-aprovada por contrato ou orcamento, nao passa por este fluxo.";
  } else if (regras.has("INTERCOMPANY")) {
    acao = "ENCERRAR"; porque = "Operacao entre empresas do grupo. O playbook fiscal trata intercompany por tipo 51 / codigo 010, sem gerar titulo a pagar.";

  // 2. Art. 11: parado alem de 120 dias, a politica manda recomendar estorno.
  } else if (regras.has("ESTORNO_RECOMENDADO")) {
    acao = "RECOMENDAR_ESTORNO"; porque = `Art. 11: parado ha ${Math.round(pol.idadeDias ?? 0)} dias, acima dos ${ESTORNO_RECOMENDADO_DIAS} previstos.`;

  // 3. Violacao grave que o agente NAO consegue resolver: volta ao solicitante.
  //    Playbook fiscal, POP 02: "recusa so quando nao ha solucao possivel";
  //    havendo ajuste possivel, devolve para ajuste em vez de reprovar.
  } else if (graves.some(v => !v.corrigivel)) {
    acao = "DEVOLVER"; porque = graves.find(v => !v.corrigivel)!.texto;

  // 4. So falta cadastro que o agente corrige, ou alcada que ele reroteia.
  } else if (pol.correcoes.length || graves.some(v => v.corrigivel)) {
    acao = "CORRIGIR_E_ENCAMINHAR"; porque = "Pendencias resolvidas pelo agente; o pedido segue instruido.";

  // 5. Pendencia media: nao trava, mas o aprovador precisa ver.
  } else {
    acao = "ENCAMINHAR";
    porque = medias.length ? medias[0].texto : "Sem violacao de politica. Pronto para decisao da alcada.";
  }

  // ---- roteamento por alcada (Art. 7)
  const exigido = alcadaExigida(r.valor ?? null, pol.ehPenalidade);
  const nivelAtual = (ctx.nivelPorAprovador.get(r.approver) ?? "DESCONHECIDO") as Nivel;
  const precisaRerotear = !!(exigido && nivelAtual !== "DESCONHECIDO" && !temAlcada(nivelAtual, exigido.nivel))
    || nivelAtual === "ANALISTA" || nivelAtual === "COORDENADOR";
  const roteamento = {
    aprovadorAtual: r.approver ?? null,
    nivelAtual,
    nivelExigido: exigido?.nivel ?? null,
    baseLegal: exigido?.texto ?? (pol.ehPenalidade
      ? "Art. 12: penalidade ate R$ 2.000 Diretoria Financeira, acima Socios"
      : "Art. 7: alcada depende do valor do documento, que nao esta legivel no registro"),
    precisaRerotear,
    motivo: precisaRerotear
      ? `Aprovador atual e ${nivelAtual}; a politica exige ${exigido?.nivel ?? "GERENTE"} para este pedido.`
      : null,
  };

  // ---- plano de contas a pagar (Art. 8 e 9), valido se e quando for aprovado
  const planoCAP = montarPlanoCAP(r, ctx, pol);

  // ---- artefatos que o agente produz
  const mensagem = acao === "DEVOLVER" || acao === "RECOMENDAR_ESTORNO"
    ? redigirDevolucao(r, pol, acao) : null;
  const notificacaoPenalidade = pol.ehPenalidade ? redigirNotificacaoPenalidade(r, pol) : null;

  const hh = hhDaAcao(acao, pol.correcoes.length > 0, precisaRerotear, ctx.hh);

  return {
    id: r.id,
    acao, porque,
    dono: ACOES_AGENTE[acao].dono,
    violacoes: pol.violacoes,
    correcoes: pol.correcoes,
    roteamento,
    planoCAP,
    mensagemAoSolicitante: mensagem,
    notificacaoPenalidade,
    minutosEconomizados: hh,
    idadeDias: pol.idadeDias === null ? null : Math.round(pol.idadeDias),
    artigosCitados: [...new Set(pol.violacoes.map(v => v.artigo))],
  };
}

// ---------------------------------------------------------------- CAP (objetivo 3)

// Art. 8: 5 dias uteis da aprovacao (2 lancamento + 3 programacao).
// Art. 9: pagamento nos dias 10, 20 e 30; fora do prazo, proximo ciclo.
// CONFLITO CONHECIDO: o playbook fiscal do gobeaute descreve janela de pagamento
// as quartas e sextas. A Politica Corporativa e norma de hierarquia superior
// (emitida pela Diretoria Financeira, aprovada por Diretor e Socio), entao ela
// manda. A janela fica parametrizada para quando o conflito for resolvido.
export function montarPlanoCAP(r: any, ctx: any, pol: any) {
  const baseAprovacao = ctx.agora;  // simula aprovacao agora, para dimensionar o ciclo
  const ciclo = proximoCiclo(baseAprovacao);
  if (!ciclo) return null;
  return {
    referencia: "Art. 8 (prazo) e Art. 9 (calendario)",
    aprovadoEm: baseAprovacao,
    lancamentoFiscalAte: somaDiasUteis(baseAprovacao, 2),
    programacaoAte: somaDiasUteis(baseAprovacao, PRAZO_TOTAL_DU),
    dataPagamento: ciclo.dataPagamento,
    diaDoCiclo: ciclo.diaDoCiclo,
    formaDePagamento: "PIX",
    baseFormaPagamento: "Art. 5 e 10: PIX e a forma preferencial; dinheiro e vedado fora do Fundo Fixo",
    contaDeTerceiroVedada: "Art. 5: pagamento so na conta do proprio fornecedor cadastrado",
    beneficiario: r.supplier ?? null,
    documento: r.cnpj ? fmtCnpj(r.cnpj) : (r.cpf ?? null),
    janelaAlternativaConhecida: "Playbook fiscal gobeaute descreve quartas e sextas; conflito registrado, prevalece a Politica Corporativa",
    bloqueadoPor: pol.violacoes.filter((v: any) => v.gravidade === 3).map((v: any) => v.regra),
  };
}

// ---------------------------------------------------------------- redacao

function redigirDevolucao(r: any, pol: any, acao: AcaoAgente) {
  const problemas = pol.violacoes.filter((v: any) => v.gravidade >= 2 && !v.corrigivel);
  const prazoResposta = somaDiasUteis(pol.agora ?? Date.now(), 3);
  const corpo = [
    `Ola,`,
    ``,
    acao === "RECOMENDAR_ESTORNO"
      ? `A solicitacao de pagamento #${r.id} esta parada ha ${Math.round(pol.idadeDias ?? 0)} dias. A Politica Corporativa de Pagamentos (Art. 11) recomenda estorno de titulos parados ha mais de ${ESTORNO_RECOMENDADO_DIAS} dias sem comprovacao fiscal.`
      : `A solicitacao de pagamento #${r.id} nao pode seguir para aprovacao ainda. Encontrei ${problemas.length === 1 ? "um ponto" : `${problemas.length} pontos`} que preciso que voce ajuste:`,
    ``,
    ...problemas.map((p: any, i: number) => `${i + 1}. ${p.aoSolicitante}\n   Base: Politica Corporativa de Pagamentos, ${p.artigo}.`),
    ``,
    `Pedido: ${r.title ?? "(sem titulo)"}`,
    r.cnpj ? `Documento informado: ${fmtCnpj(r.cnpj)}` : "",
    ``,
    acao === "RECOMENDAR_ESTORNO"
      ? `Responda confirmando se o pagamento ainda e devido. Sem retorno ate ${fmtData(prazoResposta)}, encaminho para estorno.`
      : `Assim que ajustar, o pedido volta automaticamente para a fila de aprovacao. Se precisar de ajuda com o cadastro, chame a area de Compras/Supply.`,
    ``,
    `Goworker do Financeiro`,
    `Esta mensagem foi gerada e enviada por um agente. A decisao de aprovar ou recusar continua sendo humana.`,
  ].filter(Boolean).join("\n");

  return {
    para: r.requester ?? "(solicitante nao identificado no registro)",
    assunto: acao === "RECOMENDAR_ESTORNO"
      ? `[Goworker] Pedido #${r.id} parado ha ${Math.round(pol.idadeDias ?? 0)} dias: confirmar ou encerrar`
      : `[Goworker] Pedido #${r.id} devolvido para ajuste`,
    corpo,
    prazoResposta,
    problemas: problemas.length,
  };
}

function redigirNotificacaoPenalidade(r: any, pol: any) {
  return {
    para: r.requester ?? "(area solicitante)",
    copia: "Diretoria Financeira",
    assunto: `[Goworker] Juros ou multa no pedido #${r.id}: justificativa obrigatoria`,
    corpo: [
      `Este pedido inclui juros ou multa por atraso.`,
      ``,
      `A Politica Corporativa de Pagamentos, Art. 12, determina que a area solicitante seja notificada para justificar a ocorrencia e que a responsabilidade pelo custo seja atribuida a origem do atraso.`,
      ``,
      `Pedido: ${r.title ?? ""}`,
      ``,
      `Responda com: (1) o motivo do atraso, (2) a area responsavel pela origem, (3) a acao tomada para nao repetir.`,
      `A alcada tambem e diferente: ate R$ 2.000 aprova a Diretoria Financeira; acima disso, os Socios.`,
      ``,
      `Goworker do Financeiro`,
    ].join("\n"),
    baseLegal: "Art. 12",
  };
}

// ---------------------------------------------------------------- lote

export function processarFila(pendentes: any[], ctx: any) {
  const res = pendentes.map(r => processar(r, ctx));
  const porAcao: Record<string, number> = {};
  const porArtigo: Record<string, number> = {};
  const porRegra: Record<string, number> = {};
  let minutos = 0, correcoes = 0, reroteados = 0, devolucoes = 0, notificacoes = 0;
  for (const x of res) {
    porAcao[x.acao] = (porAcao[x.acao] ?? 0) + 1;
    minutos += x.minutosEconomizados;
    correcoes += x.correcoes.length;
    if (x.roteamento.precisaRerotear) reroteados++;
    if (x.mensagemAoSolicitante) devolucoes++;
    if (x.notificacaoPenalidade) notificacoes++;
    for (const a of x.artigosCitados) porArtigo[a] = (porArtigo[a] ?? 0) + 1;
    for (const v of x.violacoes) porRegra[v.regra] = (porRegra[v.regra] ?? 0) + 1;
  }
  const semAprovador = res.filter(x => x.acao === "ENCERRAR" || x.acao === "DEVOLVER" || x.acao === "RECOMENDAR_ESTORNO").length;
  return {
    itens: res,
    total: res.length,
    porAcao, porArtigo, porRegra,
    correcoesAutomaticas: correcoes,
    reroteadosPorAlcada: reroteados,
    devolucoesRedigidas: devolucoes,
    notificacoesDePenalidade: notificacoes,
    naoConsomemAprovador: semAprovador,
    pctNaoConsomemAprovador: res.length ? Math.round(100 * semAprovador / res.length) : 0,
    minutosEconomizados: minutos,
    horasEconomizadas: Math.round(minutos / 60),
    premissasHH: ctx.hh,
  };
}

// ---------------------------------------------------------------- lotes de CAP

// Objetivo 3: depois que o aprovador assina, a programacao de contas a pagar
// e trabalho mecanico. O agente monta os lotes prontos, pelo calendario do
// Art. 9 e pelo prazo do Art. 8, com a forma preferencial do Art. 10 (PIX).
export function montarLotesCAP(itens: any[], ctx: any) {
  const elegiveis = itens.filter(x =>
    (x.acao === "ENCAMINHAR" || x.acao === "CORRIGIR_E_ENCAMINHAR") &&
    x.planoCAP && !x.planoCAP.bloqueadoPor.length);

  const porData = new Map<number, any[]>();
  for (const x of elegiveis) {
    const d = x.planoCAP.dataPagamento;
    if (!porData.has(d)) porData.set(d, []);
    porData.get(d)!.push(x);
  }

  const lotes = [...porData.entries()].sort((a, b) => a[0] - b[0]).map(([data, xs]) => ({
    dataPagamento: new Date(data).toISOString().slice(0, 10),
    diaDoCiclo: xs[0].planoCAP.diaDoCiclo,
    formaDePagamento: "PIX",
    quantidade: xs.length,
    // Sem o campo de valor legivel no GoService, o lote sai sem somatorio.
    // Isso e limite de dado declarado, nao arredondamento.
    valorTotal: null,
    baseLegal: "Art. 8 (5 dias uteis: 2 lancamento + 3 programacao) e Art. 9 (ciclos dia 10, 20 e 30)",
    itens: xs.map(x => ({
      pedidoId: x.id,
      beneficiario: x.planoCAP.beneficiario,
      documento: x.planoCAP.documento,
      lancamentoFiscalAte: new Date(x.planoCAP.lancamentoFiscalAte).toISOString().slice(0, 10),
      correcoesAplicadas: x.correcoes.length,
    })),
    minutosEconomizados: xs.length * ctx.hh.programacao_cap,
  }));

  return {
    lotes,
    pedidosProgramaveis: elegiveis.length,
    pedidosBloqueados: itens.length - elegiveis.length,
    minutosEconomizados: lotes.reduce((s, l) => s + l.minutosEconomizados, 0),
    observacao: "Lotes prontos condicionados a aprovacao humana de cada pedido. O agente nao aprova.",
  };
}

// ---------------------------------------------------------------- outbox

// Traduz a decisao do agente nas acoes concretas que ele emite.
export function acoesDoItem(x: any) {
  const out: any[] = [];
  if (x.acao === "DEVOLVER" && x.mensagemAoSolicitante) {
    out.push({ tipo: "DEVOLVER_AO_SOLICITANTE", pedidoId: x.id,
      destinatario: x.mensagemAoSolicitante.para, assunto: x.mensagemAoSolicitante.assunto,
      payload: x.mensagemAoSolicitante, baseLegal: x.artigosCitados.join(", ") });
  }
  if (x.acao === "RECOMENDAR_ESTORNO" && x.mensagemAoSolicitante) {
    out.push({ tipo: "RECOMENDAR_ESTORNO", pedidoId: x.id,
      destinatario: x.mensagemAoSolicitante.para, assunto: x.mensagemAoSolicitante.assunto,
      payload: x.mensagemAoSolicitante, baseLegal: "Art. 11" });
  }
  if (x.acao === "ENCERRAR") {
    out.push({ tipo: "ENCERRAR_PEDIDO", pedidoId: x.id, destinatario: "GoService",
      assunto: `Encerrar pedido #${x.id}`, payload: { motivo: x.porque }, baseLegal: x.artigosCitados.join(", ") });
  }
  for (const c of x.correcoes) {
    out.push({ tipo: "CORRIGIR_CADASTRO", pedidoId: x.id, destinatario: "GoService/ERP",
      assunto: `Corrigir ${c.campo} do pedido #${x.id}`, payload: c, baseLegal: c.artigo });
  }
  if (x.roteamento.precisaRerotear) {
    out.push({ tipo: "ROTEAR_PARA_ALCADA", pedidoId: x.id, destinatario: "GoService",
      assunto: `Rerotear #${x.id} para alcada ${x.roteamento.nivelExigido ?? "GERENTE"}`,
      payload: x.roteamento, baseLegal: "Art. 7" });
  }
  if (x.notificacaoPenalidade) {
    out.push({ tipo: "NOTIFICAR_PENALIDADE", pedidoId: x.id,
      destinatario: x.notificacaoPenalidade.para, assunto: x.notificacaoPenalidade.assunto,
      payload: x.notificacaoPenalidade, baseLegal: "Art. 12" });
  }
  return out;
}
