// ============================================================================
// Motor de POLITICA do Goworker.
// Fonte normativa: "Politica Corporativa de Pagamentos - GO GROUP", rev. 01,
// emissao 01/07/2025, Diretoria Financeira. 13 folhas.
// Cada regra aqui cita o artigo. Heuristica de dado vive em engine.ts; aqui so
// entra o que a politica manda.
// ============================================================================

import { isValidCNPJ, isValidCPF, normalizeSupplier, nomesCompativeis, RE_TESTE, DAY, HOUR } from "./engine";

// ---------------------------------------------------------------- Anexo I

// 40 CNPJs das empresas do grupo. Pagamento cujo "fornecedor" e uma delas e
// transferencia intercompany ou, muito mais comum na base, erro de cadastro:
// alguem colocou o CNPJ da propria empresa pagadora no campo do fornecedor.
export const ANEXO_I: Record<string, string> = {
  "48290289": "AP COSMETICS LTDA", "26301600": "APICE COSMETICS AS",
  "10256416": "AZBUY COMERCIO LTDA", "54595758": "BARBOUR HOLDING S.A.",
  "54190174": "BB ATACADO LTDA", "36838707": "BB INDUSTRIA E COMERCIO LTDA",
  "54137817": "BB VAREJO LTDA", "57168111": "BEAUTE PARTICIPACOES LTDA",
  "60453002": "BEAUTY HUB ATACADO LTDA", "60453162": "BEAUTY HUB VAREJO LTDA",
  "36703992": "COMPRERAMA COMERCIAL LTDA", "22165464": "GO COMERCIO DE ARTIGOS ELETRONICOS LTDA",
  "46551987": "GO GROUP INVESTIMENTOS LTDA", "53182517": "GO INTER COMERCIAL LTDA",
  "54321345": "GO INV PARTICIPACOES LTDA", "23860650": "GOB COMERCIO LTDA",
  "46743270": "GP COMERCIO LTDA", "46537034": "GR COMERCIO LTDA",
  "36202300": "GRA MARKETING DIGITAL LTDA", "53717946": "ITAREMA HOLDING LTDA",
  "54047425": "KOKE PARTNERS LTDA", "58319197": "KOKESHI HOLDING S.A.",
  "58181480": "KOKESHI VAREJO LTDA", "57443771": "LESCENT ATACADO LTDA",
  "57344563": "LESCENT VAREJO LTDA", "38246589": "MAGA COMERCIO LTDA",
  "58323315": "RITU PARTNERS LTDA",
};

// ---------------------------------------------------------------- Anexo II

// Despesas pre-aprovadas em outra esfera (orcamento/contrato). Pela politica
// elas NAO seguem o fluxo de aprovacao. Se estao na fila, estao no lugar errado.
export const ANEXO_II: { categoria: string; re: RegExp }[] = [
  { categoria: "Contas de consumo", re: /\b(energia|el[eé]tric\w*|enel|cemig|copel|light|cpfl|equatorial|neoenergia|sabesp|cagece|embasa|\b[aá]gua\b|internet|telefon\w*|vivo|claro\b|\btim\b|algar|net virtua|vigil[aâ]nci\w*|seguran[cç]a patrimonial)\b/i },
  { categoria: "Locacao de imovel ou equipamento", re: /\b(alugu\w*|loca[cç][aã]o de im[oó]ve|loca[cç][aã]o de equipament|arrendament\w*|condom[ií]nio|iptu)\b/i },
  { categoria: "Licenciamento contratual", re: /\b(licenciament\w*|licen[cç]a de (uso|software)|saas|microsoft|google workspace|adobe|aws|amazon web|azure|salesforce|totvs|protheus)\b/i },
  { categoria: "Pessoas (DP)", re: /\b(folha de pagament\w*|rescis[aã]o|f[eé]rias|13[oº] sal[aá]rio|vale (alimenta[cç][aã]o|transporte|refei[cç][aã]o)|assist[eê]ncia (m[eé]dica|odontol[oó]gica)|plano de sa[uú]de|unimed|amil|sulam[eé]rica|odontoprev|ifood benef|flash benef|caju benef|sodexo|alelo|ticket log)\b/i },
];

// ---------------------------------------------------------------- Art. 7 alcadas

export type Nivel = "SOCIO" | "DIRETOR" | "GERENTE" | "COORDENADOR" | "ANALISTA" | "DESCONHECIDO";

// Art. 7: alcada de aprovacao da DESPESA por valor do documento.
export const ALCADA_DESPESA = [
  { ate: 20000, nivel: "GERENTE" as Nivel, texto: "Ate R$ 20.000,00: Gerente da area demandante" },
  { ate: 50000, nivel: "DIRETOR" as Nivel, texto: "Acima de R$ 20.000,00 ate R$ 50.000,00: Diretor da area" },
  { ate: Infinity, nivel: "SOCIO" as Nivel, texto: "Acima de R$ 50.000,00: Socio (sozinho)" },
];
// Art. 12: penalidades (juros e multas) tem alcada propria, muito mais apertada.
export const ALCADA_PENALIDADE = [
  { ate: 2000, nivel: "DIRETOR" as Nivel, texto: "Penalidade ate R$ 2.000,00: Diretoria Financeira" },
  { ate: Infinity, nivel: "SOCIO" as Nivel, texto: "Penalidade acima de R$ 2.000,00: Socios" },
];

const ORDEM: Nivel[] = ["ANALISTA", "COORDENADOR", "GERENTE", "DIRETOR", "SOCIO"];
export const temAlcada = (nivel: Nivel, exigido: Nivel) =>
  ORDEM.indexOf(nivel) >= 0 && ORDEM.indexOf(nivel) >= ORDEM.indexOf(exigido);

export function alcadaExigida(valor: number | null, ehPenalidade: boolean) {
  if (valor === null || !isFinite(valor)) return null;
  const tabela = ehPenalidade ? ALCADA_PENALIDADE : ALCADA_DESPESA;
  return tabela.find(f => valor <= f.ate) ?? tabela[tabela.length - 1];
}

// ---------------------------------------------------------------- Art. 8 e 9 prazos

// Feriados nacionais fixos. Feriado movel nao entra: o erro maximo e de 1 dia
// util e a politica ja preve flexibilizacao pela Diretoria Financeira.
const FERIADOS_FIXOS = ["01-01", "04-21", "05-01", "09-07", "10-12", "11-02", "11-15", "11-20", "12-25"];
export function ehDiaUtil(ts: number) {
  const d = new Date(ts);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  const md = String(d.getUTCMonth() + 1).padStart(2, "0") + "-" + String(d.getUTCDate()).padStart(2, "0");
  return !FERIADOS_FIXOS.includes(md);
}
export function somaDiasUteis(ts: number, n: number) {
  let t = ts, restam = n;
  while (restam > 0) { t += DAY; if (ehDiaUtil(t)) restam--; }
  return t;
}
export function diasUteisEntre(a: number, b: number) {
  let n = 0, t = a;
  while (t < b) { t += DAY; if (ehDiaUtil(t)) n++; }
  return n;
}

// Art. 9: pagamentos rodam nos dias 10, 20 e 30. Art. 8: 5 dias uteis entre a
// aprovacao e o pagamento (2 para lancamento fiscal + 3 para programacao).
export const DIAS_DE_PAGAMENTO = [10, 20, 30];
export const PRAZO_LANCAMENTO_DU = 2;
export const PRAZO_PROGRAMACAO_DU = 3;
export const PRAZO_TOTAL_DU = PRAZO_LANCAMENTO_DU + PRAZO_PROGRAMACAO_DU;

// Dada a data de aprovacao, devolve o ciclo de pagamento em que o titulo cabe.
export function proximoCiclo(aprovadoEm: number) {
  const elegivelEm = somaDiasUteis(aprovadoEm, PRAZO_TOTAL_DU);
  for (let mesAdiante = 0; mesAdiante < 4; mesAdiante++) {
    const base = new Date(elegivelEm);
    const ano = base.getUTCFullYear(), mes = base.getUTCMonth() + mesAdiante;
    for (const dia of DIAS_DE_PAGAMENTO) {
      const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
      const cand = Date.UTC(ano, mes, Math.min(dia, ultimoDia));
      if (cand >= elegivelEm) return { dataPagamento: cand, diaDoCiclo: Math.min(dia, ultimoDia), elegivelEm };
    }
  }
  return null;
}

// Art. 11: titulo vencido ha mais de 30 dias entra em controle; sem comprovacao
// fiscal, apos 120 dias a recomendacao e estorno.
export const CONTROLE_VENCIDO_DIAS = 30;
export const ESTORNO_RECOMENDADO_DIAS = 120;

// ---------------------------------------------------------------- avaliacao

export type Violacao = {
  artigo: string; regra: string; texto: string;
  gravidade: 1 | 2 | 3;         // 3 = regra inviolavel ou vedacao expressa
  corrigivel: boolean;          // o agente consegue resolver sozinho?
  aoSolicitante: string;        // o que ele precisa fazer
};
export type Correcao = {
  campo: string; de: string | null; para: string;
  fonte: string; confianca: "alta" | "media"; artigo: string;
};

export type ContextoPolitica = {
  agora: number;
  /** CNPJ (14 digitos) -> grafia correta conhecida, derivada do historico */
  grafiaCorreta: Map<string, { correto: string; nome: string; usos: number }>;
  /** CNPJ -> nomes que ja apareceram nele em pedidos decididos */
  nomesPorCnpj: Map<string, Set<string>>;
  /** login -> nivel hierarquico, para checar alcada */
  nivelPorAprovador: Map<string, Nivel>;
};

export function avaliarPolitica(r: any, ctx: ContextoPolitica) {
  const v: Violacao[] = [];
  const c: Correcao[] = [];
  const isTest = RE_TESTE.test(r.title || "");
  const idadeDias = r.submittedAt ? (ctx.agora - r.submittedAt) / DAY : null;

  // ---- Art. 4 e 7: segregacao de funcoes. Regra declarada INVIOLAVEL.
  if (r.requester && r.approver && r.requester === r.approver) {
    v.push({ artigo: "Art. 4 e 7", regra: "SEGREGACAO_DE_FUNCOES",
      texto: `"A segregacao de funcoes e regra inviolavel. Nenhuma area ou colaborador podera acumular, no mesmo processo, as funcoes de solicitacao, aprovacao e execucao do pagamento." Aqui ${r.approver} e solicitante e aprovador.`,
      gravidade: 3, corrigivel: false,
      aoSolicitante: "Este pedido precisa de um aprovador diferente de voce. Indique o gestor da sua area." });
  }

  // ---- Art. 5: vedado pagar a quem nao e o fornecedor cadastrado.
  if (r.cnpj && !isTest) {
    const nomes = ctx.nomesPorCnpj.get(r.cnpj);
    if (nomes && nomes.size && r.supplierNorm && ![...nomes].some(n => nomesCompativeis(r.supplierNorm, n))) {
      v.push({ artigo: "Art. 5", regra: "BENEFICIARIO_DIVERGENTE",
        texto: `"E vedado o pagamento em contas bancarias de terceiros que nao sejam o proprio fornecedor cadastrado e contratado." O CNPJ ${r.cnpj} so tem historico sob outro nome: ${[...nomes].slice(0, 2).join(" / ")}.`,
        gravidade: 3, corrigivel: false,
        aoSolicitante: "O nome do favorecido nao bate com o CNPJ informado. Confirme o cadastro do fornecedor com Compras/Supply antes de reenviar." });
    }
  }

  // ---- Art. 5 e 6: dados cadastrais precisam conferir. DV quebrado nao confere.
  if (!isTest && r.cnpj && !isValidCNPJ(r.cnpj)) {
    const fix = ctx.grafiaCorreta.get(r.cnpj);
    if (fix) {
      // Corrigivel: a base tem a grafia valida do MESMO orgao/fornecedor.
      c.push({ campo: "cnpj", de: r.cnpj, para: fix.correto,
        fonte: `grafia valida do mesmo beneficiario, usada ${fix.usos}x na base (${fix.nome})`,
        confianca: "alta", artigo: "Art. 6" });
    } else {
      v.push({ artigo: "Art. 6", regra: "CNPJ_INVALIDO",
        texto: `"E de responsabilidade da area de Contas a Pagar verificar a conformidade dos dados do documento (fornecedor, CNPJ, valor, vencimento)." O CNPJ ${r.cnpj} reprova no digito verificador.`,
        gravidade: 3, corrigivel: false,
        aoSolicitante: `O CNPJ ${r.cnpj} nao existe: reprova no digito verificador. Confira na nota fiscal e reenvie.` });
    }
  }
  if (!isTest && r.cpf && !isValidCPF(r.cpf)) {
    v.push({ artigo: "Art. 6", regra: "CPF_INVALIDO",
      texto: `O CPF ${r.cpf} reprova no digito verificador.`,
      gravidade: 3, corrigivel: false,
      aoSolicitante: `O CPF ${r.cpf} nao e valido. Confira o documento do favorecido.` });
  }

  // ---- Anexo I: fornecedor e uma empresa do proprio grupo.
  if (r.cnpj && ANEXO_I[r.cnpj.slice(0, 8)]) {
    const empresa = ANEXO_I[r.cnpj.slice(0, 8)];
    const ehMesmoNome = r.supplierNorm && nomesCompativeis(r.supplierNorm, normalizeSupplier(empresa));
    v.push({ artigo: "Anexo I", regra: ehMesmoNome ? "INTERCOMPANY" : "CNPJ_DO_GRUPO_NO_FORNECEDOR",
      texto: ehMesmoNome
        ? `Favorecido e ${empresa}, empresa do proprio grupo (Anexo I). Transferencia intercompany tem tratamento proprio.`
        : `O CNPJ informado pertence a ${empresa}, empresa do proprio grupo (Anexo I), mas o favorecido foi digitado como "${r.supplier}". Provavel troca do CNPJ do fornecedor pelo da empresa pagadora.`,
      gravidade: ehMesmoNome ? 1 : 3, corrigivel: false,
      aoSolicitante: ehMesmoNome
        ? "Pagamento entre empresas do grupo: confirme com a Controladoria se segue por intercompany."
        : `Voce informou o CNPJ de ${empresa}, que e uma empresa do nosso grupo, no campo do fornecedor. Corrija para o CNPJ real de "${r.supplier}".` });
  }

  // ---- Anexo II: despesa pre-aprovada nao deveria estar no fluxo de aprovacao.
  for (const a of ANEXO_II) {
    if (a.re.test(r.title || "")) {
      v.push({ artigo: "Anexo II", regra: "DESPESA_PRE_APROVADA",
        texto: `"As despesas listadas no Anexo II sao consideradas pre-aprovadas em outra esfera (orcamento, contrato) e nao seguem o fluxo de aprovacao." Este pedido parece ser: ${a.categoria}.`,
        gravidade: 2, corrigivel: false,
        aoSolicitante: `${a.categoria} e despesa pre-aprovada por contrato ou orcamento e nao precisa passar por aprovacao. Encaminhe direto ao Fiscal para lancamento.` });
      break;
    }
  }

  // ---- Art. 5 e 6: sem documentacao nao ha pagamento. O registro de aprovacao
  // nao carrega a NF, mas quando nem o favorecido esta identificavel, o pedido
  // nao instrui nada.
  if (r.money && !isTest && !r.cnpj && !r.cpf && !r.supplierNorm) {
    v.push({ artigo: "Art. 5", regra: "SEM_DOCUMENTACAO_DE_SUPORTE",
      texto: `"Nenhum pagamento sera realizado sem que haja documentacao comprobatoria adequada." O pedido nao identifica favorecido nem documento.`,
      gravidade: 3, corrigivel: false,
      aoSolicitante: "O pedido nao diz quem recebe. Informe fornecedor, CNPJ/CPF e anexe a nota fiscal ou o contrato." });
  }

  // ---- Art. 11: controle de titulos vencidos e recomendacao de estorno.
  if (idadeDias !== null && idadeDias > ESTORNO_RECOMENDADO_DIAS) {
    v.push({ artigo: "Art. 11", regra: "ESTORNO_RECOMENDADO",
      texto: `"Controle de titulos vencidos ha mais de 30 dias e recomendacao de estorno apos 120 dias, para titulos sem comprovacao fiscal." Este esta parado ha ${Math.round(idadeDias)} dias.`,
      gravidade: 2, corrigivel: false,
      aoSolicitante: `Este pedido esta parado ha ${Math.round(idadeDias)} dias, acima dos 120 previstos na politica. Confirme se ainda e devido ou autorize o encerramento.` });
  } else if (idadeDias !== null && idadeDias > CONTROLE_VENCIDO_DIAS) {
    v.push({ artigo: "Art. 11", regra: "TITULO_EM_CONTROLE",
      texto: `Parado ha ${Math.round(idadeDias)} dias, acima dos 30 dias que a politica manda controlar.`,
      gravidade: 1, corrigivel: false,
      aoSolicitante: `Parado ha ${Math.round(idadeDias)} dias. Confirme se segue valido.` });
  }

  // ---- Art. 12: juros e multas exigem notificacao formal da area de origem.
  const ehPenalidade = r.kind === "juros" || /\bjuros\b|\bmulta\b|\bmora\b/i.test(r.title || "");
  if (ehPenalidade) {
    v.push({ artigo: "Art. 12", regra: "PENALIDADE_EXIGE_JUSTIFICATIVA",
      texto: `"Em caso de incidencia de juros, multas ou penalidades decorrentes de atraso: a area solicitante sera notificada para justificar a ocorrencia e a responsabilidade pelo custo sera atribuida a origem do atraso." Alem disso a alcada e propria: ate R$ 2.000 Diretoria Financeira, acima Socios.`,
      gravidade: 2, corrigivel: false,
      aoSolicitante: "Este pagamento tem juros ou multa. Registre a justificativa do atraso e a area responsavel antes de seguir." });
  }

  // ---- Art. 5 e 10: registro de teste nunca deveria virar pagamento.
  if (isTest) {
    v.push({ artigo: "Art. 5", regra: "REGISTRO_DE_TESTE",
      texto: `O titulo identifica registro de teste. Nao ha obrigacao financeira a liquidar.`,
      gravidade: 2, corrigivel: false,
      aoSolicitante: "Pedido de teste identificado. Sera encerrado sem pagamento." });
  }

  // ---- Art. 7: o aprovador atribuido tem alcada?
  const nivel = r.approver ? (ctx.nivelPorAprovador.get(r.approver) ?? "DESCONHECIDO") : "DESCONHECIDO";
  const exigido = alcadaExigida(r.valor ?? null, ehPenalidade);
  let alcada: any = { nivelDoAprovador: nivel, valorConhecido: r.valor ?? null, exigido: exigido?.nivel ?? null, texto: exigido?.texto ?? null, ok: null };
  if (exigido && nivel !== "DESCONHECIDO") {
    alcada.ok = temAlcada(nivel, exigido.nivel);
    if (!alcada.ok) {
      v.push({ artigo: "Art. 7", regra: "ALCADA_INSUFICIENTE",
        texto: `${exigido.texto}. O aprovador atribuido (${r.approver}) e ${nivel}.`,
        gravidade: 3, corrigivel: true,
        aoSolicitante: `Pelo valor, este pedido precisa de aprovacao de ${exigido.nivel}. Vamos rotear para a alcada correta.` });
    }
  } else if (nivel === "ANALISTA" || nivel === "COORDENADOR") {
    v.push({ artigo: "Art. 7", regra: "APROVADOR_SEM_ALCADA",
      texto: `Art. 7 define alcada minima de Gerente para aprovar despesa. O aprovador atribuido (${r.approver}) e ${nivel}.`,
      gravidade: 3, corrigivel: true,
      aoSolicitante: "O aprovador atribuido nao tem alcada. Vamos rotear para o gestor da area." });
  }

  return { violacoes: v, correcoes: c, alcada, ehPenalidade, idadeDias, isTest };
}

// ---------------------------------------------------------------- grafias

// Constroi o mapa "CNPJ errado -> CNPJ certo" a partir do proprio historico:
// mesma raiz+filial (12 digitos), uma grafia valida e outras invalidas.
export function construirGrafiasCorretas(all: any[]) {
  const porBase = new Map<string, Map<string, { n: number; nome: string | null }>>();
  for (const r of all) {
    if (!r.cnpj) continue;
    const base = r.cnpj.slice(0, 12);
    if (!porBase.has(base)) porBase.set(base, new Map());
    const g = porBase.get(base)!;
    if (!g.has(r.cnpj)) g.set(r.cnpj, { n: 0, nome: r.supplier ?? null });
    const e = g.get(r.cnpj)!;
    e.n++;
    if (!e.nome && r.supplier) e.nome = r.supplier;
  }
  const mapa = new Map<string, { correto: string; nome: string; usos: number }>();
  for (const [, g] of porBase) {
    const validos = [...g.entries()].filter(([c]) => isValidCNPJ(c)).sort((a, b) => b[1].n - a[1].n);
    const invalidos = [...g.entries()].filter(([c]) => !isValidCNPJ(c));
    if (validos.length !== 1 || !invalidos.length) continue;  // ambiguo: nao corrige
    const [certo, info] = validos[0];
    for (const [errado] of invalidos) mapa.set(errado, { correto: certo, nome: info.nome ?? "", usos: info.n });
  }
  return mapa;
}
