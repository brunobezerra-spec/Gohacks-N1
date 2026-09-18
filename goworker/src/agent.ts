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
import { severidadeDe, janelaDe, REGRAS } from "./regras";

// ---------------------------------------------------------------- acoes

export const ACOES_AGENTE = {
  ENCERRAR:              { ordem: 1, dono: "agente",          label: "Encerrar sem pagamento" },
  ARQUIVAR_NA_LIXEIRA:   { ordem: 2, dono: "agente",          label: "Arquivar na lixeira (restauravel)" },
  DEVOLVER:              { ordem: 3, dono: "solicitante",     label: "Devolver ao solicitante" },
  ROTEAR:                { ordem: 4, dono: "aprovador certo", label: "Rotear para a alcada correta" },
  CORRIGIR_E_ENCAMINHAR: { ordem: 5, dono: "agente",          label: "Corrigir e encaminhar" },
  RECOMENDAR_ESTORNO:    { ordem: 6, dono: "contas a pagar",  label: "Recomendar estorno (Art. 11)" },
  ENCAMINHAR:            { ordem: 7, dono: "aprovador",       label: "Encaminhar ao aprovador" },
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

// Texto ao solicitante para os sinais que nascem no motor. Sem isso a devolucao
// sai sem dizer o que a pessoa precisa fazer.
const AO_SOLICITANTE: Record<string, string> = {
  APROVADOR_INATIVO: "O aprovador deste pedido nao age ha muito tempo. Indique o gestor atual da sua area.",
  SEM_BENEFICIARIO: "O pedido nao identifica quem recebe. Informe fornecedor, CNPJ ou CPF, e anexe a nota fiscal.",
  VALOR_NO_TITULO: "O valor foi digitado no lugar do nome do fornecedor. Corrija o campo do favorecido; o valor tem campo proprio.",
  DOCUMENTO_VENCIDO: "O documento esta vencido. Atualize o boleto ou renegocie o vencimento com o fornecedor (Art. 8).",
  DUPLICIDADE_JA_APROVADA: "Existe um pedido ja aprovado com o mesmo beneficiario, valor e vencimento. Confirme se nao e pagamento em duplicidade.",
  DUPLICIDADE_NA_FILA: "Ha outro pedido identico parado ao mesmo tempo. Confirme qual vale.",
  CNPJ_INVALIDO: "O CNPJ informado reprova no digito verificador. Confira na nota fiscal.",
  CPF_INVALIDO: "O CPF informado reprova no digito verificador.",
  NOME_DIVERGE_DO_CNPJ: "O nome do favorecido nao bate com o historico deste CNPJ. Confirme o cadastro com Compras/Supply.",
  FILA_ZUMBI: "Este pedido esta parado ha muito tempo. Confirme se ainda e devido.",
};

// O agente le DUAS fontes: as violacoes de politica (policy.ts) e os sinais do
// motor (engine.ts). Antes so lia a primeira, entao regras como FILA_ZUMBI e
// APROVADOR_INATIVO nunca chegavam na decisao. O registro (regras.ts) governa
// as duas: sinal desligado nao entra, e a severidade vem de la.
function unificarAchados(r: any, pol: any) {
  const jaTem = new Set(pol.violacoes.map((v: any) => v.regra));
  const doMotor = (r.findings ?? [])
    .filter((f: any) => !jaTem.has(f.code))
    .map((f: any) => ({
      artigo: REGRAS[f.code]?.base ?? "higiene de base",
      regra: f.code,
      texto: f.msg,
      gravidade: f.severity ?? 1,
      severidade: f.severidade ?? severidadeDe(f.code),
      foraDaJanela: Boolean(f.foraDaJanela),
      janelaDias: f.janelaDias ?? janelaDe(f.code),
      corrigivel: false,
      aoSolicitante: AO_SOLICITANTE[f.code] ?? f.msg,
    }));
  // As violacoes de politica tambem passam pelo registro.
  const daPolitica = pol.violacoes.map((v: any) => ({
    ...v,
    severidade: v.severidade ?? severidadeDe(v.regra),
    foraDaJanela: Boolean(v.foraDaJanela),
  }));
  return [...daPolitica, ...doMotor];
}

export function processar(r: any, ctx: any) {
  const pol = avaliarPolitica(r, ctx);
  pol.violacoes = unificarAchados(r, pol).filter((v: any) => REGRAS[v.regra]?.ativo !== false);
  const graves = pol.violacoes.filter(v => v.gravidade === 3);
  const medias = pol.violacoes.filter(v => v.gravidade === 2);
  const regras = new Set(pol.violacoes.map(v => v.regra));

  let acao: AcaoAgente;
  let porque: string;

  const sev = (c: string) => pol.violacoes.find((v: any) => v.regra === c);
  const temTrava = pol.violacoes.some((v: any) => severidadeDe(v.regra) === "TRAVA" && !v.foraDaJanela);
  // Sinais cuja janela estourou: pelo handoff eles deixam de travar e viram
  // devolucao. Guardamos separado porque a mensagem ao solicitante muda.
  const foraDaJanela = pol.violacoes.filter((v: any) => v.foraDaJanela);

  // 1. O que nunca deveria virar pagamento sai da fila sem consumir aprovador.
  if (regras.has("REGISTRO_DE_TESTE")) {
    acao = "ENCERRAR"; porque = "Registro de teste. Nao ha obrigacao financeira a liquidar.";
  } else if (regras.has("DESPESA_PRE_APROVADA")) {
    acao = "ENCERRAR"; porque = "Anexo II: despesa ja pre-aprovada por contrato ou orcamento, nao passa por este fluxo.";

  // 2. COLISAO ENTRE DUAS REGRAS DO HANDOFF, resolvida a favor do compliance.
  //    A regra 1 manda TODA fila zumbi para a lixeira, sem corte. A regra 14 diz
  //    que autoaprovacao e TRAVA "sem excecao" e que nem o proprio aprovador
  //    derruba. Os 7 casos de autoaprovacao sao todos antigos: pela regra 1 eles
  //    sumiriam na lixeira e ninguem veria a quebra de segregacao de funcao.
  //    Aqui o compliance ganha. Se o financeiro preferir o contrario, e trocar
  //    a ordem destes dois blocos.
  } else if (regras.has("AUTOAPROVACAO")) {
    acao = "ROTEAR";
    porque = "Solicitante e aprovador sao a mesma pessoa. O Art. 4 chama segregacao de funcoes de regra inviolavel e o Art. 7 diz que em nenhuma hipotese o solicitante pode ser o proprio aprovador. Nao vai para a lixeira mesmo estando parado: a quebra tem que ser vista.";

  // 3. Regra 1: fila zumbi sai inteira da base de trabalho, para uma lixeira
  //    restauravel. Sem corte de dias, sem aprovacao em lote, porque e
  //    reversivel. O GoService nao e tocado nesta acao.
  } else if (regras.has("FILA_ZUMBI")) {
    acao = "ARQUIVAR_NA_LIXEIRA";
    porque = `Parado ha ${Math.round(pol.idadeDias ?? 0)} dias. Sai da base de trabalho para a lixeira, de onde pode ser restaurado a qualquer momento.`;

  // 3. Intercompany nao e encerrado pelo agente: quem confirma e a Controladoria.
  } else if (regras.has("INTERCOMPANY")) {
    acao = "ENCAMINHAR";
    porque = "Operacao entre empresas do grupo (Anexo I). Nao encerro sozinho: a Controladoria confirma se segue por intercompany, que pelo playbook fiscal nao gera titulo a pagar.";

  // 4. Segregacao de funcao e alcada: o agente troca QUEM decide (regras 5, 7 e 14).
  } else if (regras.has("ALCADA_INSUFICIENTE") || regras.has("APROVADOR_SEM_ALCADA")) {
    acao = "ROTEAR";
    porque = sev("ALCADA_INSUFICIENTE")?.texto ?? sev("APROVADOR_SEM_ALCADA")?.texto ?? "Aprovador sem alcada para o valor.";

  // 5. Trava que o agente nao resolve: volta ao solicitante.
  } else if (temTrava && graves.some((v: any) => !v.corrigivel)) {
    acao = "DEVOLVER"; porque = graves.find((v: any) => !v.corrigivel)!.texto;

  // 6. Sinal cuja janela estourou: nao trava, devolve (regras 7 e 8).
  } else if (foraDaJanela.length) {
    acao = "DEVOLVER";
    porque = `${foraDaJanela[0].texto} Passou da janela de ${foraDaJanela[0].janelaDias ?? 15} dias, entao volta ao solicitante em vez de travar.`;

  // 7. So falta cadastro que o agente corrige.
  } else if (pol.correcoes.length) {
    acao = "CORRIGIR_E_ENCAMINHAR"; porque = "Pendencias de cadastro resolvidas pelo agente; o pedido segue instruido.";

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
  // "Nao consome aprovador" = tudo que sai da fila ou volta para outra pessoa
  // antes de chegar na mesa de quem assina. A lixeira e o roteamento por alcada
  // entraram depois da revisao de 18/09 e faltavam nesta conta.
  const SEM_APROVADOR = new Set(["ENCERRAR", "ARQUIVAR_NA_LIXEIRA", "DEVOLVER", "ROTEAR", "RECOMENDAR_ESTORNO"]);
  const semAprovador = res.filter(x => SEM_APROVADOR.has(x.acao)).length;
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
  // Regra 1: a lixeira e do proprio agente, nao toca o GoService. Por isso a
  // acao existe mas nao vira chamada ao GLPI: quem a consome e o livro-razao.
  if (x.acao === "ARQUIVAR_NA_LIXEIRA") {
    out.push({ tipo: "MOVER_PARA_LIXEIRA", pedidoId: x.id, destinatario: "lixeira do Goworker",
      assunto: `Arquivar #${x.id} na lixeira`,
      payload: { motivo: x.porque, diasSemMovimento: x.idadeDias, restauravel: true },
      baseLegal: "Handoff 18/09/2026, regra 1" });
  }
  // Aditivo da regra 1: a lixeira resolve a fila, nao o titulo no ERP.
  if (x.violacoes.some((v: any) => v.regra === "ESTORNO_RECOMENDADO") && x.acao !== "RECOMENDAR_ESTORNO") {
    out.push({ tipo: "RECOMENDAR_ESTORNO", pedidoId: x.id, destinatario: "contas a pagar",
      assunto: `Recomendar estorno do titulo do pedido #${x.id}`,
      payload: { corpo: x.mensagemAoSolicitante?.corpo ?? null,
        motivo: `Parado ha ${x.idadeDias} dias, acima dos 120 do Art. 11.` },
      baseLegal: "CAP Art. 11" });
  }
  // Regra 15: o sinal acusa o sistema, nao quem preencheu. A demanda de produto
  // e parte da regra, nao um extra.
  if (x.violacoes.some((v: any) => v.regra === "VALOR_NO_TITULO")) {
    out.push({ tipo: "ABRIR_DEMANDA_DE_PRODUTO", pedidoId: x.id, destinatario: "produto / TI",
      assunto: "Expor valor, vencimento, NF e centro de custo em get_payment_request",
      payload: { origem: `pedido #${x.id}`,
        justificativa: "As pessoas escrevem o valor no titulo porque o campo nao era legivel pela API." },
      baseLegal: "Handoff 18/09/2026, regra 15" });
  }

  if (x.acao === "ENCERRAR") {
    // O corpo precisa dizer POR QUE, com a base normativa. Um encerramento sem
    // motivo registrado nao serve de trilha de auditoria para ninguem.
    const corpo = [
      `Encerrado pelo Goworker do Financeiro, sem pagamento.`,
      ``,
      `Motivo: ${x.porque}`,
      ...(x.violacoes.length
        ? [``, `Base normativa:`, ...x.violacoes.map((v: any) => `- ${v.artigo}: ${v.texto}`)]
        : []),
      ``,
      `Este encerramento nao aprova nem recusa pagamento: a validacao do pedido segue intocada e a decisao continua sendo do aprovador com alcada (Art. 7).`,
    ].join("\n");
    out.push({ tipo: "ENCERRAR_PEDIDO", pedidoId: x.id, destinatario: "GoService",
      assunto: `Encerrar pedido #${x.id}`,
      payload: { corpo, motivo: x.porque }, baseLegal: x.artigosCitados.join(", ") });
  }
  for (const c of x.correcoes) {
    out.push({ tipo: "CORRIGIR_CADASTRO", pedidoId: x.id, destinatario: "GoService/ERP",
      assunto: `Corrigir ${c.campo} do pedido #${x.id}`, payload: c, baseLegal: c.artigo });
  }
  // Regra 14: "registrar_em_compliance()". A quebra de segregacao nao pode ficar
  // so na decisao do agente; ela e um evento de compliance por si.
  if (x.violacoes.some((v: any) => v.regra === "AUTOAPROVACAO")) {
    out.push({ tipo: "NOTIFICAR_PENALIDADE", pedidoId: x.id, destinatario: "Compliance e Diretoria Financeira",
      assunto: `Quebra de segregacao de funcao no pedido #${x.id}`,
      payload: { corpo: [
        `O pedido #${x.id} tem a mesma pessoa como solicitante e como aprovador.`,
        ``,
        `A Politica Corporativa de Pagamentos, Art. 4, trata segregacao de funcoes como regra inviolavel, e o Art. 7 diz que em nenhuma hipotese o solicitante da despesa podera ser o proprio aprovador.`,
        ``,
        `O pedido foi roteado para outro aprovador e este registro fica na trilha de compliance.`,
      ].join("\n") },
      baseLegal: "CAP Art. 4 e 7" });
  }
  if (x.roteamento.precisaRerotear) {
    // O agente sabe o NIVEL exigido pela tabela do Art. 7, mas nao consegue
    // resolver QUEM ocupa esse nivel na area demandante: o perfil dele nao le
    // usuarios no GLPI, e nao existe mapa area -> gestor. Entao ele escreve no
    // chamado dizendo qual e a alcada correta e por que, e a troca fica humana.
    // Escolher aprovador e julgamento sobre estrutura, nao sobre dado.
    const corpo = [
      `Este pedido esta com a alcada errada.`,
      ``,
      x.roteamento.motivo ?? "O aprovador atual nao tem competencia para este valor.",
      ``,
      `Base: Politica Corporativa de Pagamentos, ${x.roteamento.baseLegal}`,
      ``,
      `Aprovador atual: ${x.roteamento.aprovadorAtual ?? "nao identificado"} (${x.roteamento.nivelAtual})`,
      `Nivel exigido:   ${x.roteamento.nivelExigido ?? "GERENTE"}`,
      ``,
      `Nao troquei o aprovador automaticamente porque nao consigo saber quem ocupa esse nivel na area demandante. Reatribua a validacao para a alcada correta.`,
    ].join("\n");
    out.push({ tipo: "ROTEAR_PARA_ALCADA", pedidoId: x.id, destinatario: "GoService",
      assunto: `Alcada incorreta no pedido #${x.id}: exige ${x.roteamento.nivelExigido ?? "GERENTE"}`,
      payload: { ...x.roteamento, corpo }, baseLegal: "CAP Art. 7" });
  }
  if (x.notificacaoPenalidade) {
    out.push({ tipo: "NOTIFICAR_PENALIDADE", pedidoId: x.id,
      destinatario: x.notificacaoPenalidade.para, assunto: x.notificacaoPenalidade.assunto,
      payload: x.notificacaoPenalidade, baseLegal: "Art. 12" });
  }
  return out;
}
