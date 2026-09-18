// PDF -> texto usando unpdf (pdf.js). Ver docs/OPERACAO.md: este modulo e o
// motivo de o deploy subir um bundle pre-montado em vez do codigo-fonte solto.
// O bundler do GoDeploy nao conclui com pdf.js na arvore de dependencia
// (medido em 18/09/2026: morre sem resposta; o mesmo conjunto sem ele publica
// em segundos). Pre-bundlar aqui resolve sem abrir mao da cobertura: um
// extrator caseiro leu 1 de 6 PDFs reais, o pdf.js leu 6 de 6.
//
// A classificacao do resultado e o que importa para o agente: texto curto
// demais ou sem numero com centavos significa "nao consegui ler", nunca "o
// valor nao bate". Confundir os dois devolveria pedido bom por defeito de
// leitura.
import { extractText, getDocumentProxy } from "unpdf";

export type ResultadoTexto =
  | { ok: true; texto: string; paginas: number }
  | { ok: false; motivo: "pdf_invalido" | "sem_camada_de_texto"; paginas: number };

const MINIMO_DE_TEXTO = 120;
const RE_DINHEIRO = /\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2}/;

export async function pdfParaTexto(bin: Uint8Array | ArrayBuffer): Promise<ResultadoTexto> {
  // CÓPIA, sempre. O pdf.js assume posse do buffer e o deixa inutilizavel: uma
  // segunda leitura do MESMO anexo voltava "pdf_invalido", que parece defeito
  // do arquivo e nao do chamador.
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
  if (texto.trim().length < MINIMO_DE_TEXTO || !RE_DINHEIRO.test(texto)) {
    return { ok: false, motivo: "sem_camada_de_texto", paginas };
  }
  return { ok: true, texto, paginas };
}

export const extratorPadrao = async (bin: Uint8Array | ArrayBuffer) => {
  const r = await pdfParaTexto(bin);
  if (!r.ok) throw new Error(r.motivo);
  return r.texto;
};
