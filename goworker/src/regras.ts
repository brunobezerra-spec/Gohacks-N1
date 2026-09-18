// ============================================================================
// REGISTRO DE REGRAS POR SINAL.
// Fonte: "Handoff - regras por sinal do Goworker do Financeiro", revisao do CFO
// em 18/09/2026, sobre a execucao #22. Uma linha por sinal, com a decisao
// literal de quem revisou.
//
// Este arquivo e a fonte unica de: quais sinais existem, se estao ligados, que
// severidade tem e que acao disparam. O motor (engine.ts) so DETECTA; quem diz
// o que fazer com o achado e este registro.
// ============================================================================

export type Severidade = "TRAVA" | "RESSALVA" | "ARQUIVAR";

export type Regra = {
  sinal: string;
  ativo: boolean;
  severidade?: Severidade;
  /** o que o revisor escreveu, sem parafrase */
  textoRevisor?: string;
  /** artigos da Politica Corporativa de Pagamentos */
  base?: string;
  /** janela em dias: passou disso, devolve ao solicitante em vez de sinalizar */
  janelaDias?: number;
  acoes?: string[];
  nota?: string;
};

export const REGRAS: Record<string, Regra> = {
  FILA_ZUMBI: {
    sinal: "FILA_ZUMBI", ativo: true, severidade: "ARQUIVAR",
    textoRevisor: "eliminar tudo, enviar para um espaco de lixeira onde fica armazenado",
    acoes: ["MOVER_PARA_LIXEIRA"],
    nota: "Sem corte de dias: todos saem da base de trabalho. Nada e apagado, e restauravel. " +
          "Por ser reversivel nao exige aprovacao humana em lote. Aditivo: acima de 120 dias sem " +
          "comprovacao fiscal, tambem RECOMENDAR_ESTORNO, porque a lixeira resolve a fila mas nao " +
          "resolve o titulo no ERP (CAP Art. 11).",
  },
  SLA_ESTOURADO: {
    sinal: "SLA_ESTOURADO", ativo: true, severidade: "RESSALVA",
    acoes: ["ROTEAR_PARA_ALCADA", "NOTIFICAR_PENALIDADE"], base: "CAP Art. 8 e 12",
  },
  LOTE_AMBIGUO: {
    sinal: "LOTE_AMBIGUO", ativo: true, severidade: "RESSALVA",
    acoes: ["PROGRAMAR_CAP"], base: "CAP Art. 9",
    nota: "Divergencia registrada: CAP Art. 9 manda dias 10/20/30; o Playbook Fiscal (POP 01) " +
          "descreve quarta e sexta para nota de mercadoria. Vale a CAP; a janela fica parametrizada.",
  },
  REGISTRO_DE_TESTE: {
    sinal: "REGISTRO_DE_TESTE", ativo: true, severidade: "ARQUIVAR",
    acoes: ["ENCERRAR_PEDIDO", "ABRIR_CHAMADO_DE_HIGIENE"],
    nota: "Encerra sem notificar ninguem e sem consumir alcada. Abre UM chamado de higiene com a " +
          "lista inteira, nao um por pedido.",
  },
  TIPO_DE_ALTO_RISCO: {
    sinal: "TIPO_DE_ALTO_RISCO", ativo: true, severidade: "RESSALVA",
    textoRevisor: "deve seguir a alcada conforme a politica de CAP",
    acoes: ["ROTEAR_PARA_ALCADA"], base: "CAP Art. 7",
    nota: "A proposta de subir um nivel de alcada por causa do tipo foi REJEITADA. Vale a tabela " +
          "por valor, sem agravante. O sinal fica so como leitura.",
  },
  VOLUME_ACIMA_DO_PADRAO: {
    sinal: "VOLUME_ACIMA_DO_PADRAO", ativo: true, severidade: "RESSALVA",
    textoRevisor: "exceto tributos",
    nota: "Nao sinaliza quando o favorecido e orgao arrecadador. Sozinho nao trava.",
  },
  APROVADOR_INATIVO: {
    sinal: "APROVADOR_INATIVO", ativo: true, severidade: "TRAVA", janelaDias: 15,
    textoRevisor: "deve confirmar no teamguide se o aprovador ainda trabalha na empresa e tambem " +
                  "deve servir apenas para chamados abertos a menos de 15 dias, caso contrario volta ao solicitante",
    acoes: ["ROTEAR_PARA_ALCADA"], base: "CAP Art. 7",
  },
  SEM_BENEFICIARIO: {
    sinal: "SEM_BENEFICIARIO", ativo: true, severidade: "TRAVA", janelaDias: 15,
    textoRevisor: "deve servir apenas para chamados abertos a menos de 15 dias, caso contrario volta ao solicitante",
    acoes: ["DEVOLVER_AO_SOLICITANTE"], base: "CAP Art. 5",
  },
  NOME_DIVERGE_DO_CNPJ: {
    sinal: "NOME_DIVERGE_DO_CNPJ", ativo: true, severidade: "TRAVA",
    textoRevisor: "se for apenas diferenca de matriz e filial CNPJ manter",
    acoes: ["DEVOLVER_AO_SOLICITANTE"], base: "CAP Art. 6 e Anexo I",
    nota: "Mesma raiz de CNPJ nao e divergencia. Raiz do Anexo I vira INTERCOMPANY. " +
          "Diferenca so de grafia vira CORRIGIR_CADASTRO.",
  },
  CNPJ_INVALIDO: {
    sinal: "CNPJ_INVALIDO", ativo: true, severidade: "TRAVA",
    acoes: ["CORRIGIR_CADASTRO"], base: "CAP Art. 6",
    nota: "Digito verificador quebrado TRAVA SEMPRE. A excecao de matriz/filial vale para o sinal " +
          "de nome divergente e para CNPJ valido de outra filial, nunca para CNPJ malformado.",
  },
  CPF_INVALIDO: {
    sinal: "CPF_INVALIDO", ativo: true, severidade: "TRAVA",
    acoes: ["CORRIGIR_CADASTRO"], base: "CAP Art. 6",
  },
  AUTOAPROVACAO: {
    sinal: "AUTOAPROVACAO", ativo: true, severidade: "TRAVA",
    acoes: ["ROTEAR_PARA_ALCADA"], base: "CAP Art. 4 e 7",
    nota: "Sem excecao. O proprio aprovador nao pode derrubar esta trava.",
  },
  VALOR_NO_TITULO: {
    sinal: "VALOR_NO_TITULO", ativo: true, severidade: "TRAVA",
    acoes: ["DEVOLVER_AO_SOLICITANTE", "ABRIR_DEMANDA_DE_PRODUTO"],
    nota: "Acusa o sistema, nao quem preencheu: as pessoas escrevem o valor no titulo porque o " +
          "campo nao era legivel. A demanda de produto e parte da regra.",
  },
  VALOR_DIVERGE_DO_ANEXO: {
    sinal: "VALOR_DIVERGE_DO_ANEXO", ativo: true, severidade: "TRAVA",
    acoes: ["DEVOLVER_AO_SOLICITANTE"], base: "CAP Art. 6",
    nota: "A unica regra do motor que confere o valor contra a FONTE, e nao contra o historico. " +
          "So dispara quando o documento anexado foi lido de verdade: anexo ilegivel devolve " +
          "'nao sei' e nao levanta o sinal, porque devolver pedido bom por defeito de leitura " +
          "e pior do que nao conferir. Medido em 18/09/2026: dos 8 chamados testados ao vivo, " +
          "6 tinham o valor do pedido 100x o do anexo.",
  },

  // ---- desligados em 18/09/2026 ("remover da lista")
  BENEFICIARIO_NOVO:        { sinal: "BENEFICIARIO_NOVO", ativo: false, textoRevisor: "remover da lista" },
  BENEFICIARIO_ALTA_RECUSA: { sinal: "BENEFICIARIO_ALTA_RECUSA", ativo: false, textoRevisor: "remover da lista" },
  BENEFICIARIO_SO_RECUSADO: { sinal: "BENEFICIARIO_SO_RECUSADO", ativo: false, textoRevisor: "remover da lista" },
  ESTABELECIMENTO_NOVO:     { sinal: "ESTABELECIMENTO_NOVO", ativo: false,
    nota: "Desligado junto com os tres sinais de beneficiario: tambem e checagem de historico, nao de cadastro." },

  // ---- sinais que o motor emite e o handoff nao lista; ficam como leitura
  // REBAIXADO de TRAVA para RESSALVA em 18/09/2026, por teste contra o historico.
  // Eu tinha colocado como TRAVA assumindo que "mesmo beneficiario, mesmo centavo,
  // mesmo vencimento" fosse duplicata. O back-test derrubou:
  //   641 grupos historicos ja decididos com esse padrao
  //   613 (96%) tiveram TODOS os irmaos APROVADOS
  //    28 (4%) tiveram alguma recusa, e o motivo escrito era "aprovador incorreto"
  //           ou "solicitante de aprovacao incorreto" -- NUNCA duplicidade
  // Nenhuma variante calibrada salvou a regra: filtrar por fornecedor pouco
  // recorrente, por valor acima de R$ 50 mil, por distancia entre submissoes ou
  // por mesmo dia deu 95% a 100% de "todos aprovados" em todas.
  // Leitura: cobranca recorrente de valor fixo e o caso NORMAL aqui
  // (JT SERVICOS 11x R$ 350, STATIX 8x R$ 194,14, MPR 6x R$ 500).
  // Fica como leitura para o aprovador. Nao trava, nao devolve, nao encerra.
  DUPLICIDADE_JA_APROVADA: { sinal: "DUPLICIDADE_JA_APROVADA", ativo: true, severidade: "RESSALVA",
    nota: "Rebaixado por back-test: 96% dos grupos historicos com esse padrao tiveram todos os irmaos aprovados. " +
          "Sem numero da nota fiscal nao da para separar cobranca recorrente de duplicata." },
  DUPLICIDADE_NA_FILA:     { sinal: "DUPLICIDADE_NA_FILA", ativo: true, severidade: "RESSALVA" },
  DOCUMENTO_VENCIDO:       { sinal: "DOCUMENTO_VENCIDO", ativo: true, severidade: "RESSALVA", base: "CAP Art. 8" },
  INTERCOMPANY:            { sinal: "INTERCOMPANY", ativo: true, severidade: "RESSALVA", base: "CAP Anexo I" },
  CNPJ_DO_GRUPO_NO_FORNECEDOR: { sinal: "CNPJ_DO_GRUPO_NO_FORNECEDOR", ativo: true, severidade: "TRAVA", base: "CAP Anexo I" },
  DESPESA_PRE_APROVADA:    { sinal: "DESPESA_PRE_APROVADA", ativo: true, severidade: "ARQUIVAR", base: "CAP Anexo II" },
  ESTORNO_RECOMENDADO:     { sinal: "ESTORNO_RECOMENDADO", ativo: true, severidade: "RESSALVA", base: "CAP Art. 11" },
  TITULO_EM_CONTROLE:      { sinal: "TITULO_EM_CONTROLE", ativo: true, severidade: "RESSALVA", base: "CAP Art. 11" },
  // Tres pares apontavam o MESMO achado com nomes diferentes: o motor emitia um
  // e a politica emitia outro, e a contagem dobrava. Fica o nome do handoff.
  SEGREGACAO_DE_FUNCOES:   { sinal: "SEGREGACAO_DE_FUNCOES", ativo: false,
    nota: "Mesmo achado de AUTOAPROVACAO, que e o nome do handoff." },
  BENEFICIARIO_DIVERGENTE: { sinal: "BENEFICIARIO_DIVERGENTE", ativo: false,
    nota: "Mesmo achado de NOME_DIVERGE_DO_CNPJ, que e o nome do handoff." },
  SEM_DOCUMENTACAO_DE_SUPORTE: { sinal: "SEM_DOCUMENTACAO_DE_SUPORTE", ativo: false,
    nota: "Mesmo achado de SEM_BENEFICIARIO, que e o nome do handoff." },
  PENALIDADE_EXIGE_JUSTIFICATIVA: { sinal: "PENALIDADE_EXIGE_JUSTIFICATIVA", ativo: true, severidade: "RESSALVA", base: "CAP Art. 12" },
  ALCADA_INSUFICIENTE:     { sinal: "ALCADA_INSUFICIENTE", ativo: true, severidade: "TRAVA", base: "CAP Art. 7" },
  APROVADOR_SEM_ALCADA:    { sinal: "APROVADOR_SEM_ALCADA", ativo: true, severidade: "TRAVA", base: "CAP Art. 7" },
};

export const ativo = (sinal: string) => REGRAS[sinal]?.ativo !== false;
export const severidadeDe = (sinal: string): Severidade =>
  REGRAS[sinal]?.severidade ?? "RESSALVA";
export const janelaDe = (sinal: string) => REGRAS[sinal]?.janelaDias ?? null;

// Severidade em numero, para ordenar e pontuar. TRAVA e o unico que impede
// o pedido de seguir; ARQUIVAR tira da fila; RESSALVA so registra.
export const PESO: Record<Severidade, number> = { TRAVA: 3, ARQUIVAR: 2, RESSALVA: 1 };

// ---------------------------------------------------------------- tributos

// Regra 6: volume acima do padrao nao sinaliza para tributo. O handoff deixa a
// escolha do criterio em aberto e manda comecar pelo nome do favorecido.
export const RE_TRIBUTO =
  /\b(sefaz|secretaria da fazenda|receita federal|rfb\b|prefeitura|municip|estado d[eo]|inss\b|fgts\b|caixa economica|darf|das\b|gps\b|gare|dae\b|icms|iss\b|ipi\b|pis\b|cofins|csll|irrf|irpj|difal|simples nacional|tribunal|justi[cç]a|procuradoria|detran|ipva|iptu)\b/i;

export const ehTributo = (r: any) =>
  RE_TRIBUTO.test(String(r?.supplier ?? "")) || RE_TRIBUTO.test(String(r?.title ?? ""));
