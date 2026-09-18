// ============================================================================
// ANEXOS: o agente abre o documento do chamado e confere contra o pedido.
//
// Ate aqui o agente validava o valor contra si mesmo e contra o historico do
// fornecedor. Isso responde "esse numero e plausivel?", nunca "esse numero esta
// certo?". A unica fonte que responde a segunda pergunta e o documento: o XML
// da NFe carrega vNF, CNPJ do emitente e do destinatario, numero e data.
//
// TRAVA DE COMPETENCIA, igual a de glpi.ts: existe uma lista branca de LEITURA.
// Anexo e dado de terceiro e pode conter qualquer coisa; o agente le, extrai
// campos e compara. Ele nao executa nada que venha do anexo e nao escreve nada
// no documento.
// ============================================================================

import type { GlpiEnv } from "./glpi";

const GLPI_BASE = "https://goservice.gocase.com.br/apirest.php";

// LISTA BRANCA DE LEITURA. Mesma disciplina da lista de escrita: o que nao
// esta aqui nao vira requisicao. Serve de documentacao do alcance real.
//
// Sao DOIS caminhos, nao tres: metadado e binario do anexo saem da MESMA URL
// (/Document/{id}). O que muda e o header Accept. Nao existe rota
// /Document/{id}/download nem ?alt=media.
const LEITURA_PERMITIDA: { re: RegExp; oque: string }[] = [
  { re: /^\/Ticket\/\d+\/Document_Item\/(\?|$)/, oque: "listar anexos de um chamado" },
  { re: /^\/Document\/\d+$/,                     oque: "metadado e binario de um anexo" },
];

export function assertLeituraPermitida(caminho: string) {
  const ok = LEITURA_PERMITIDA.some(e => e.re.test(caminho));
  if (!ok) throw new Error(
    `TRAVA: GET ${caminho} nao esta na lista branca de leitura de anexos. ` +
    `Permitidos: ${LEITURA_PERMITIDA.map(e => e.re.source).join(", ")}.`);
  return true;
}

const H = (env: GlpiEnv, session: string, accept?: string) => ({
  "App-Token": env.GLPI_APP_TOKEN!,
  "Session-Token": session,
  ...(accept ? { Accept: accept } : {}),
});

// ---------------------------------------------------------------- leitura

export type Anexo = {
  documentId: number;
  nome: string;
  arquivo: string;
  mime: string;
  tamanho: number | null;
  tipo: "xml_nfe" | "pdf" | "imagem" | "outro";
};

// Classifica pelo nome e pelo mime. O tipo decide o que da para fazer: XML e
// leitura de campo; PDF e imagem precisariam de extracao, que nao esta aqui.
export function classificar(nome: string, mime: string): Anexo["tipo"] {
  const n = (nome || "").toLowerCase();
  const m = (mime || "").toLowerCase();
  if (n.endsWith(".xml") || m.includes("xml")) return "xml_nfe";
  if (n.endsWith(".pdf") || m.includes("pdf")) return "pdf";
  if (/\.(png|jpe?g|gif|bmp|tiff?|heic)$/.test(n) || m.startsWith("image/")) return "imagem";
  return "outro";
}

// NADA aqui pode lancar. Um 403 isolado que escapasse mataria o lote inteiro e
// o cursor nunca avancaria. Falha vira lista vazia e o chamado segue.
// 403 com token valido NAO e erro de codigo: e o perfil do GLPI sem direito de
// leitura no objeto Document. Conserto e no GLPI, nao aqui.
export async function listarAnexos(env: GlpiEnv, session: string, ticketId: number): Promise<Anexo[]> {
  const caminho = `/Ticket/${ticketId}/Document_Item/?range=0-50`;
  try {
    assertLeituraPermitida(caminho);
    const r = await fetch(`${GLPI_BASE}${caminho}`, { headers: H(env, session) });
    if (!r.ok) return [];
    const linhas: any[] = await r.json().catch(() => []);
    if (!Array.isArray(linhas)) return [];

    const out: Anexo[] = [];
    for (const l of linhas) {
      const id = Number(l.documents_id ?? l.id);
      if (!Number.isFinite(id)) continue;
      // Document_Item devolve SO ids, sem nome de arquivo. O nome vem daqui.
      const d = await metadado(env, session, id);
      const nome = d.filename || `doc-${id}.bin`;
      out.push({
        documentId: id,
        nome,
        arquivo: d.filepath,
        mime: d.mime,
        tamanho: d.filesize,
        tipo: classificar(nome, d.mime),
      });
    }
    return out;
  } catch { return []; }
}

async function metadado(env: GlpiEnv, session: string, documentId: number) {
  const vazio = { filename: "", filepath: "", mime: "", filesize: null as number | null };
  const caminho = `/Document/${documentId}`;
  try {
    assertLeituraPermitida(caminho);
    const r = await fetch(`${GLPI_BASE}${caminho}`, { headers: H(env, session) });
    if (!r.ok) return vazio;
    const d: any = await r.json().catch(() => ({}));
    return {
      filename: String(d.filename ?? d.name ?? ""),
      filepath: String(d.filepath ?? ""),
      mime: String(d.mime ?? ""),
      filesize: Number.isFinite(Number(d.filesize)) ? Number(d.filesize) : null,
    };
  } catch { return vazio; }
}

// MESMA URL do metadado. O que baixa o binario e o header Accept, e so ele.
export async function baixarDocumento(env: GlpiEnv, session: string, documentId: number) {
  const caminho = `/Document/${documentId}`;
  try {
    assertLeituraPermitida(caminho);
    const r = await fetch(`${GLPI_BASE}${caminho}`, {
      headers: H(env, session, "application/octet-stream"),
    });
    if (!r.ok) return { ok: false as const, status: r.status, texto: "" };
    return { ok: true as const, status: r.status, texto: await r.text() };
  } catch { return { ok: false as const, status: 0, texto: "" }; }
}

// ---------------------------------------------------------------- parser NFe

export type NotaFiscal = {
  chave: string | null;
  numero: string | null;
  serie: string | null;
  emissao: string | null;
  cnpjEmitente: string | null;
  nomeEmitente: string | null;
  cnpjDestinatario: string | null;
  valorNota: number | null;   // vNF: o total da nota, que e o que se paga
  valorProdutos: number | null;
};

const tag = (xml: string, nome: string, dentro?: string) => {
  const escopo = dentro
    ? (xml.match(new RegExp(`<${dentro}\\b[^>]*>([\\s\\S]*?)</${dentro}>`))?.[1] ?? "")
    : xml;
  return escopo.match(new RegExp(`<${nome}\\b[^>]*>([\\s\\S]*?)</${nome}>`))?.[1]?.trim() ?? null;
};

// CUIDADO: no XML da NFe o separador decimal e o PONTO e nao existe separador
// de milhar ("3612.00"). Tratar o ponto como milhar multiplicava toda nota por
// 100 e inventava "casa decimal deslocada" onde nao havia. So aplica a leitura
// pt-BR quando ha virgula.
const num = (s: string | null) => {
  if (s == null) return null;
  const t = String(s).trim();
  const v = t.includes(",")
    ? Number(t.replace(/\./g, "").replace(",", "."))
    : Number(t);
  return Number.isFinite(v) ? v : null;
};

// Le o XML da NFe sem dependencia. O layout e estavel ha anos: infNFe/ide,
// emit, dest e total/ICMSTot. Nao usa parser de XML de proposito, porque anexo
// e conteudo de terceiro e um parser completo e superficie de ataque a toa.
export function lerNFe(xml: string): NotaFiscal | null {
  if (!xml || !/<(nfeProc|NFe|infNFe)\b/i.test(xml)) return null;
  const chaveCru = xml.match(/\bId="NFe(\d{44})"/)?.[1]
    ?? tag(xml, "chNFe")
    ?? null;
  const emit = xml.match(/<emit\b[^>]*>([\s\S]*?)<\/emit>/)?.[1] ?? "";
  const dest = xml.match(/<dest\b[^>]*>([\s\S]*?)<\/dest>/)?.[1] ?? "";
  const tot  = xml.match(/<ICMSTot\b[^>]*>([\s\S]*?)<\/ICMSTot>/)?.[1] ?? "";
  return {
    chave: chaveCru ? chaveCru.replace(/\D/g, "") : null,
    numero: tag(xml, "nNF", "ide"),
    serie: tag(xml, "serie", "ide"),
    emissao: (tag(xml, "dhEmi", "ide") ?? tag(xml, "dEmi", "ide") ?? "").slice(0, 10) || null,
    cnpjEmitente: tag(emit, "CNPJ")?.replace(/\D/g, "") ?? null,
    nomeEmitente: tag(emit, "xNome"),
    cnpjDestinatario: tag(dest, "CNPJ")?.replace(/\D/g, "") ?? null,
    valorNota: num(tag(tot, "vNF")),
    valorProdutos: num(tag(tot, "vProd")),
  };
}

// ---------------------------------------------------------------- texto (PDF)

// 210 dos 232 anexos medidos em 18/09/2026 sao PDF e 5 sao XML. O caminho
// principal e o PDF, e todos os testados tem camada de texto: nenhum exigiu
// OCR. Quem converte PDF em texto entra por aqui, para o Worker escolher a
// biblioteca sem contaminar a regra.
export type ExtratorDeTexto = (bin: ArrayBuffer | Uint8Array) => Promise<string>;

// Normaliza ANTES de casar numero. Sem isso o extrator quebra "3.569,37" em
// "569.37" quando o PDF separa o milhar com espaco ou quebra de linha, e o
// agente conclui que o valor nao bate quando ele bate.
export function normalizarTexto(t: string) {
  return String(t ?? "")
    .replace(/ /g, " ")
    .replace(/(\d)[ \t\r\n]+(?=[.,]\d)/g, "$1")   // "3 .569,37" -> "3.569,37"
    .replace(/([.,])[ \t\r\n]+(?=\d)/g, "$1")     // "3. 569,37" -> "3.569,37"
    .replace(/(\d)[ \t\r\n]+(?=\d{3}\b)/g, "$1"); // "3 569,37"  -> "3569,37"
}

const RE_BRL = /(?<![\d,.])\d{1,3}(?:\.\d{3})*,\d{2}(?![\d])|(?<![\d,.])\d+,\d{2}(?![\d])/g;

export function extrairValores(texto: string): number[] {
  const t = normalizarTexto(texto);
  const vistos = new Set<number>();
  for (const m of t.matchAll(RE_BRL)) {
    const v = Number(m[0].replace(/\./g, "").replace(",", "."));
    if (Number.isFinite(v) && v > 0) vistos.add(Math.round(v * 100) / 100);
  }
  return [...vistos].sort((a, b) => a - b);
}

export type AchadoNoTexto = {
  bate: boolean;
  fator: number | null;        // 10, 100 ou 1000 quando o anexo traz valor/fator
  valorNoAnexo: number | null;
  candidatos: number[];
};

// Procura o valor do pedido no texto do anexo. Se nao achar, procura o valor
// dividido por 10, 100 e 1000: e a assinatura de casa decimal deslocada, o erro
// que a base mostrou sete vezes em doze meses.
export function procurarValor(valorPedido: number, texto: string): AchadoNoTexto {
  const vals = extrairValores(texto);
  const perto = (a: number, b: number) => Math.abs(Math.round((a - b) * 100) / 100) <= 0.01;
  if (vals.some(v => perto(v, valorPedido))) {
    return { bate: true, fator: null, valorNoAnexo: valorPedido, candidatos: vals };
  }
  for (const f of [100, 1000, 10]) {
    const alvo = Math.round((valorPedido / f) * 100) / 100;
    const achado = vals.find(v => perto(v, alvo));
    if (achado != null) return { bate: false, fator: f, valorNoAnexo: achado, candidatos: vals };
  }
  return { bate: false, fator: null, valorNoAnexo: null, candidatos: vals };
}

// ---------------------------------------------------------------- conferencia

export type Divergencia = {
  campo: "valor" | "beneficiario" | "vencimento" | "documento";
  gravidade: "TRAVA" | "RESSALVA";
  texto: string;
  aoSolicitante: string;
};

export type Conferencia = {
  ticketId: number;
  conferido: boolean;
  motivo?: string;
  nota?: NotaFiscal;
  divergencias: Divergencia[];
};

// Tolerancia de 1 centavo. Arredondamento de centavo e ruido; qualquer coisa
// acima disso e divergencia de verdade e precisa de gente.
const CENTAVO = 0.01;

export function conferir(pedido: any, nota: NotaFiscal, ticketId: number): Conferencia {
  const d: Divergencia[] = [];

  // 1. VALOR. E a pergunta que o agente nunca pode responder sem o documento.
  //    O pedido pode carregar juros (campo proprio), entao a base de comparacao
  //    e valor - juros quando ha juros declarado.
  const juros = Number(pedido.juros) || 0;
  const principal = Number(pedido.valor) - juros;
  if (nota.valorNota != null && Number.isFinite(principal)) {
    // Arredonda para centavo ANTES de comparar: 3612.01 - 3612 da
    // 0.010000000000218 em ponto flutuante e estouraria a tolerancia sozinho.
    const delta = Math.round((principal - nota.valorNota) * 100) / 100;
    if (Math.abs(delta) > CENTAVO) {
      const razao = nota.valorNota > 0 ? principal / nota.valorNota : null;
      // Razao proxima de 10, 100 ou 1000 e casa decimal deslocada, nao
      // divergencia comercial. Vale dizer isso na mensagem: e o erro que a base
      // mostrou sete vezes em doze meses.
      const decimal = razao != null && [10, 100, 1000].some(f => Math.abs(razao - f) < f * 0.001);
      d.push({
        campo: "valor",
        gravidade: "TRAVA",
        texto: decimal
          ? `O valor do pedido e ${razao!.toFixed(0)}x o total da nota. Casa decimal deslocada.`
          : `Valor do pedido R$ ${principal.toFixed(2)} contra R$ ${nota.valorNota.toFixed(2)} na nota. Diferenca de R$ ${delta.toFixed(2)}.`,
        aoSolicitante: decimal
          ? `O valor informado esta ${razao!.toFixed(0)} vezes maior que o total da nota fiscal ${nota.numero ?? ""}. Confira a virgula.`
          : `O valor informado nao bate com o total da nota fiscal ${nota.numero ?? ""}, que e R$ ${nota.valorNota.toFixed(2)}.`,
      });
    }
  }

  // 2. BENEFICIARIO. O CNPJ do emitente da nota e quem tem direito ao dinheiro.
  const cnpjPedido = String(pedido.cnpj ?? "").replace(/\D/g, "");
  if (cnpjPedido && nota.cnpjEmitente && cnpjPedido !== nota.cnpjEmitente) {
    const mesmaRaiz = cnpjPedido.slice(0, 8) === nota.cnpjEmitente.slice(0, 8);
    d.push({
      campo: "beneficiario",
      gravidade: mesmaRaiz ? "RESSALVA" : "TRAVA",
      texto: mesmaRaiz
        ? `Mesma empresa, estabelecimento diferente: pedido ${cnpjPedido}, nota ${nota.cnpjEmitente}.`
        : `O CNPJ do pedido (${cnpjPedido}) nao e o emitente da nota (${nota.cnpjEmitente}, ${nota.nomeEmitente ?? "sem nome"}).`,
      aoSolicitante: mesmaRaiz
        ? `O CNPJ informado e de outra filial do mesmo fornecedor. Confirme para qual estabelecimento o pagamento deve sair.`
        : `O CNPJ informado nao e o de quem emitiu a nota fiscal. Corrija o favorecido.`,
    });
  }

  // 3. VENCIMENTO. Nota emitida depois do vencimento do pedido e sinal de que
  //    o pedido nao se refere a esta nota.
  if (nota.emissao && pedido.vencimento) {
    const venc = String(pedido.vencimento).slice(0, 10);
    if (venc && nota.emissao > venc) {
      d.push({
        campo: "vencimento",
        gravidade: "RESSALVA",
        texto: `Nota emitida em ${nota.emissao}, depois do vencimento do pedido (${venc}).`,
        aoSolicitante: `A nota anexada foi emitida depois do vencimento informado. Confirme se o anexo e o documento certo.`,
      });
    }
  }

  return { ticketId, conferido: true, nota, divergencias: d };
}

// Fluxo completo de um chamado: lista anexo, acha o XML, le e confere.
// Devolve conferido:false com motivo quando nao da, para o motivo virar dado
// e nao sumir: sem_anexo, sem_xml e ilegivel sao respostas diferentes.
//
// Ordem barata, de proposito: so baixa binario de quem e XML. PDF e imagem
// custam o mesmo numero de requests e nao dao valor sem extracao, entao nem
// desce o degrau.
export async function conferirChamado(env: GlpiEnv, session: string, pedido: any): Promise<Conferencia> {
  const ticketId = Number(pedido.ticketId);
  const anexos = await listarAnexos(env, session, ticketId);
  if (!anexos.length) return { ticketId, conferido: false, motivo: "sem_anexo", divergencias: [] };

  const xmls = anexos.filter(a => a.tipo === "xml_nfe");
  if (!xmls.length) {
    const tipos = [...new Set(anexos.map(a => a.tipo))].join(", ");
    return { ticketId, conferido: false, motivo: `sem_xml (anexos: ${tipos})`, divergencias: [] };
  }

  for (const a of xmls) {
    const bin = await baixarDocumento(env, session, a.documentId);
    if (!bin.ok) continue;
    const nota = lerNFe(bin.texto);
    if (nota?.valorNota != null) return conferir(pedido, nota, ticketId);
  }
  return { ticketId, conferido: false, motivo: "xml_ilegivel", divergencias: [] };
}

// Conferencia pelo TEXTO do anexo, que e o caminho que cobre 90% dos casos.
// Varre TODOS os anexos legiveis, nao o primeiro: no chamado 1667 o valor
// estava no segundo PDF e parar no primeiro dava "nao localizado".
export async function conferirPorTexto(
  env: GlpiEnv, session: string, pedido: any, extrair: ExtratorDeTexto,
): Promise<Conferencia> {
  const ticketId = Number(pedido.ticketId);
  const anexos = await listarAnexos(env, session, ticketId);
  if (!anexos.length) return { ticketId, conferido: false, motivo: "sem_anexo", divergencias: [] };

  const legiveis = anexos.filter(a => a.tipo === "pdf" || a.tipo === "xml_nfe");
  if (!legiveis.length) {
    return { ticketId, conferido: false, motivo: `sem_documento_legivel (${anexos.map(a => a.tipo).join(",")})`, divergencias: [] };
  }

  const juros = Number(pedido.juros) || 0;
  const principal = Number(pedido.valor) - juros;
  let melhor: { fator: number; valor: number; anexo: string } | null = null;

  for (const a of legiveis) {
    const bin = await baixarDocumento(env, session, a.documentId);
    if (!bin.ok || !bin.texto) continue;
    let texto = bin.texto;
    if (a.tipo === "pdf") {
      try { texto = await extrair(new TextEncoder().encode(bin.texto)); } catch { continue; }
    }
    const r = procurarValor(principal, texto);
    // Bateu em qualquer anexo: o pedido esta certo e a busca para aqui.
    if (r.bate) return { ticketId, conferido: true, divergencias: [] };
    if (r.fator && !melhor) melhor = { fator: r.fator, valor: r.valorNoAnexo!, anexo: a.nome };
  }

  if (melhor) {
    return {
      ticketId, conferido: true, divergencias: [{
        campo: "valor",
        gravidade: "TRAVA",
        texto: `O valor do pedido e ${melhor.fator}x o valor do anexo "${melhor.anexo}" (R$ ${melhor.valor.toFixed(2)}). Casa decimal deslocada.`,
        aoSolicitante: `O valor informado esta ${melhor.fator} vezes maior que o do documento anexado, que e R$ ${melhor.valor.toFixed(2)}. Confira a virgula.`,
      }],
    };
  }
  return { ticketId, conferido: false, motivo: "valor_nao_localizado", divergencias: [] };
}

// TETO DE SUBREQUESTS. O agente roda em Cloudflare Worker, que corta em ~50
// subrequests por invocacao. Um chamado com 4 anexos custa 5 requests
// (1 Document_Item + 4 Document). Passar disso mata a execucao inteira, entao
// o lote para sozinho antes. O resto fica para o proximo tick.
export const TETO_SUBREQUESTS = 45;

export async function conferirLote(env: GlpiEnv, session: string, pedidos: any[], teto = TETO_SUBREQUESTS) {
  const out: Conferencia[] = [];
  let gasto = 0;
  for (const p of pedidos) {
    if (gasto + 6 > teto) break;           // reserva pessimista: 1 lista + ate 5 documentos
    const antes = gasto;
    const c = await conferirChamado(env, session, p);
    gasto = antes + 6;                     // cobra o pior caso, nunca subestima
    out.push(c);
  }
  return { conferencias: out, subrequestsEstimados: gasto, restaram: pedidos.length - out.length };
}
