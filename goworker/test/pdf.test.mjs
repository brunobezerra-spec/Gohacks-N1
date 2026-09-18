// Testes do extrator de PDF. O ponto nao e "extrair texto": e CLASSIFICAR o
// resultado, porque confundir "nao consegui ler" com "o valor nao bate"
// devolveria pedido bom por defeito de leitura.
//   node --experimental-strip-types test/pdf.test.mjs

import assert from "node:assert/strict";
import { pdfParaTexto, extratorPadrao } from "../src/pdf.ts";

let ok = 0;
const t = async (nome, fn) => { await fn(); ok++; console.log("  ok", nome); };

// PDF valido de uma pagina, sem nenhum texto: e o que um scan produz.
const PDF_VAZIO = new TextEncoder().encode(
`%PDF-1.4
1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj
2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj
3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj
trailer<</Root 1 0 R>>
%%EOF`);

await t("bytes que nao sao PDF viram pdf_invalido, nao excecao solta", async () => {
  const r = await pdfParaTexto(new TextEncoder().encode("isto nao e um pdf"));
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "pdf_invalido");
});

await t("PDF sem camada de texto e reconhecido como imagem", async () => {
  const r = await pdfParaTexto(PDF_VAZIO);
  assert.equal(r.ok, false);
  assert.equal(r.motivo, "sem_camada_de_texto");
});

await t("extratorPadrao lanca com o motivo, para o chamador registrar", async () => {
  await assert.rejects(() => extratorPadrao(PDF_VAZIO), /sem_camada_de_texto/);
  await assert.rejects(() => extratorPadrao(new TextEncoder().encode("xx")), /pdf_invalido/);
});

await t("nao destroi o buffer de quem chama: le o mesmo anexo duas vezes", async () => {
  // O pdf.js assume posse do buffer. Sem copia, a segunda leitura do mesmo
  // anexo voltava "pdf_invalido" e parecia defeito do arquivo.
  const um = await pdfParaTexto(PDF_VAZIO);
  const dois = await pdfParaTexto(PDF_VAZIO);
  assert.equal(um.motivo, "sem_camada_de_texto");
  assert.equal(dois.motivo, "sem_camada_de_texto", "segunda leitura tem de dar o mesmo resultado");
});

await t("aceita ArrayBuffer alem de Uint8Array", async () => {
  const ab = PDF_VAZIO.buffer.slice(PDF_VAZIO.byteOffset, PDF_VAZIO.byteOffset + PDF_VAZIO.byteLength);
  const r = await pdfParaTexto(ab);
  assert.equal(r.ok, false);
});

console.log(`\n${ok} testes ok`);
