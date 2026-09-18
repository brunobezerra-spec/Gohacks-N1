// ============================================================================
// PDF -> texto. 210 dos 232 anexos medidos em 18/09/2026 sao PDF, entao e por
// aqui que o agente enxerga o documento.
//
// DUAS FAMILIAS DE PDF, e confundir as duas custa tempo:
//
//   a) PDF com camada de texto (boleto, guia, fatura, DANFE gerado). Todos os
//      6 que testamos em 18/09/2026 caem aqui: 895 a 3.507 caracteres. Extrair
//      e ler campo, sem OCR.
//   b) PDF que e imagem (NFS-e de prefeitura escaneada). Extrator devolve nada
//      ou lixo. O handoff de contratos bateu nesta familia e concluiu, com
//      razao para o caso dele, que "nota e imagem".
//
// A conclusao correta nao e "PDF nao da para ler": e que o resultado da
// extracao precisa ser CLASSIFICADO. Texto curto demais ou sem numero em
// formato de dinheiro significa "nao consegui ler", nunca "o valor nao bate".
// Um agente que confunde as duas coisas devolve pedido bom.
// ============================================================================

import { extractText, getDocumentProxy } from "unpdf";

export type ResultadoTexto =
  | { ok: true; texto: string; paginas: number }
  | { ok: false; motivo: "pdf_invalido" | "sem_camada_de_texto"; paginas: number };

// Abaixo disso nao ha o que interpretar. Os PDFs reais mais pobres que medimos
// tinham 895 caracteres; um PDF-imagem devolve tipicamente menos de 50.
const MINIMO_DE_TEXTO = 120;
const RE_DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/;

export async function pdfParaTexto(bin: Uint8Array | ArrayBuffer): Promise<ResultadoTexto> {
  // CÓPIA, sempre. O pdf.js assume posse do buffer e o deixa inutilizavel: uma
  // segunda leitura do MESMO anexo voltava "pdf_invalido", que parece defeito
  // do arquivo e nao do chamador. Copiar custa alguns KB e evita um bug que so
  // aparece em retry.
  const origem = bin instanceof Uint8Array ? bin : new Uint8Array(bin);
  const buf = new Uint8Array(origem);
  let texto = "", paginas = 0;
  try {
    const pdf = await getDocumentProxy(buf);
    const r = await extractText(pdf, { mergePages: true });
    texto = String(r.text ?? "");
    paginas = Number(r.totalPages ?? 0);
  } catch {
    return { ok: false, motivo: "pdf_invalido", paginas: 0 };
  }
  // Sem texto suficiente OU sem nenhum numero com centavos: e imagem.
  if (texto.trim().length < MINIMO_DE_TEXTO || !RE_DINHEIRO.test(texto)) {
    return { ok: false, motivo: "sem_camada_de_texto", paginas };
  }
  return { ok: true, texto, paginas };
}

// Assinatura que o modulo de anexo espera. Lanca quando nao consegue ler, para
// o chamador registrar o motivo em vez de tratar como divergencia de valor.
export const extratorPadrao = async (bin: Uint8Array | ArrayBuffer) => {
  const r = await pdfParaTexto(bin);
  if (!r.ok) throw new Error(r.motivo);
  return r.texto;
};
