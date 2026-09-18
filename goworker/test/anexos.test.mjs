// Testes do leitor de anexo e da conferencia contra a nota.
// Rodam sem credencial: o que depende de rede e a listagem, e ela nao esta aqui.
//   node --experimental-strip-types test/anexos.test.mjs

import assert from "node:assert/strict";
import { lerNFe, conferir, classificar, assertLeituraPermitida } from "../src/anexos.ts";

let ok = 0;
const t = (nome, fn) => { fn(); ok++; console.log("  ok", nome); };

// XML minimo, com a estrutura real da NFe: infNFe/ide, emit, dest, ICMSTot.
const nfe = (vNF, cnpjEmit = "51301699000160", nNF = "12345", dhEmi = "2025-12-01T10:00:00-03:00") => `<?xml version="1.0"?>
<nfeProc versao="4.00"><NFe><infNFe Id="NFe35251251301699000160550010000123451123456789" versao="4.00">
<ide><nNF>${nNF}</nNF><serie>1</serie><dhEmi>${dhEmi}</dhEmi></ide>
<emit><CNPJ>${cnpjEmit}</CNPJ><xNome>CRIS TRANSPORTES LTDA</xNome></emit>
<dest><CNPJ>11222333000181</CNPJ><xNome>GO COMERCIO</xNome></dest>
<total><ICMSTot><vProd>${vNF}</vProd><vNF>${vNF}</vNF></ICMSTot></total>
</infNFe></NFe></nfeProc>`;

console.log("parser");
t("le chave, numero, emitente e vNF", () => {
  const n = lerNFe(nfe("3612.00"));
  assert.equal(n.chave.length, 44);
  assert.ok(n.chave.includes("51301699000160"), "a chave carrega o CNPJ do emitente");
  assert.equal(n.numero, "12345");
  assert.equal(n.cnpjEmitente, "51301699000160");
  assert.equal(n.nomeEmitente, "CRIS TRANSPORTES LTDA");
  assert.equal(n.valorNota, 3612);
  assert.equal(n.emissao, "2025-12-01");
});

t("devolve null para conteudo que nao e NFe", () => {
  assert.equal(lerNFe("<html><body>boleto</body></html>"), null);
  assert.equal(lerNFe(""), null);
});

console.log("classificacao de anexo");
t("separa xml, pdf e imagem", () => {
  assert.equal(classificar("nota.xml", ""), "xml_nfe");
  assert.equal(classificar("danfe.PDF", ""), "pdf");
  assert.equal(classificar("foto.jpeg", ""), "imagem");
  assert.equal(classificar("planilha.xlsx", ""), "outro");
  assert.equal(classificar("sem-extensao", "text/xml"), "xml_nfe");
});

console.log("conferencia");
t("valor igual nao gera divergencia", () => {
  const c = conferir({ valor: 3612, cnpj: "51301699000160" }, lerNFe(nfe("3612.00")), 1);
  assert.equal(c.divergencias.length, 0);
});

t("tolera um centavo", () => {
  const c = conferir({ valor: 3612.01, cnpj: "51301699000160" }, lerNFe(nfe("3612.00")), 1);
  assert.equal(c.divergencias.length, 0);
});

t("desconta juros declarado antes de comparar", () => {
  const c = conferir({ valor: 3712, juros: 100, cnpj: "51301699000160" }, lerNFe(nfe("3612.00")), 1);
  assert.equal(c.divergencias.length, 0);
});

t("pega casa decimal deslocada e diz quantas vezes", () => {
  const c = conferir({ valor: 361200, cnpj: "51301699000160" }, lerNFe(nfe("3612.00")), 1);
  const v = c.divergencias.find(d => d.campo === "valor");
  assert.equal(v.gravidade, "TRAVA");
  assert.match(v.texto, /100x/);
  assert.match(v.aoSolicitante, /virgula/);
});

t("pega divergencia comum de valor sem chamar de virgula", () => {
  const c = conferir({ valor: 4000, cnpj: "51301699000160" }, lerNFe(nfe("3612.00")), 1);
  const v = c.divergencias.find(d => d.campo === "valor");
  assert.equal(v.gravidade, "TRAVA");
  assert.match(v.texto, /388\.00/);
});

t("CNPJ diferente do emitente trava", () => {
  const c = conferir({ valor: 3612, cnpj: "11222333000181" }, lerNFe(nfe("3612.00")), 1);
  const b = c.divergencias.find(d => d.campo === "beneficiario");
  assert.equal(b.gravidade, "TRAVA");
});

t("mesma raiz e filial diferente e ressalva, nao trava", () => {
  const c = conferir({ valor: 3612, cnpj: "51301699000299" }, lerNFe(nfe("3612.00")), 1);
  const b = c.divergencias.find(d => d.campo === "beneficiario");
  assert.equal(b.gravidade, "RESSALVA");
});

t("nota emitida depois do vencimento vira ressalva", () => {
  const n = lerNFe(nfe("3612.00", "51301699000160", "1", "2026-02-01T10:00:00-03:00"));
  const c = conferir({ valor: 3612, cnpj: "51301699000160", vencimento: "2026-01-15" }, n, 1);
  assert.ok(c.divergencias.some(d => d.campo === "vencimento" && d.gravidade === "RESSALVA"));
});

console.log("trava de leitura");
t("aceita so os dois caminhos da lista branca", () => {
  assertLeituraPermitida("/Ticket/4921/Document_Item/?range=0-50");
  assertLeituraPermitida("/Document/17");
});

t("recusa ?alt=media: nao existe essa rota no GLPI", () => {
  assert.throws(() => assertLeituraPermitida("/Document/17?alt=media"), /TRAVA/);
  assert.throws(() => assertLeituraPermitida("/Document/17/download"), /TRAVA/);
});

t("recusa qualquer caminho fora da lista, inclusive escrita", () => {
  for (const c of ["/Ticket/4921", "/TicketValidation/3349", "/Document/17/delete", "/User/1", "/Config", "/Ticket/4921/Document_Item"]) {
    assert.throws(() => assertLeituraPermitida(c), /TRAVA/);
  }
});

t("o unico POST do modulo e a troca de perfil da sessao", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/anexos.ts", import.meta.url), "utf8");
  const escritas = [...src.matchAll(/method:\s*["'](POST|PUT|DELETE|PATCH)["']/g)];
  assert.equal(escritas.length, 1, "so changeActiveProfile pode escrever");
  // e ele nao toca em dado: muda o perfil ativo da propria sessao
  assert.match(src, /changeActiveProfile/);
  assert.equal(/\/(Document|Ticket|TicketValidation|ITILFollowup|ITILSolution)\/[^"']*["']\s*,\s*\{[^}]*method/.test(src), false);
});

t("nenhuma escrita aponta para objeto de dado", async () => {
  const src = (await import("node:fs")).readFileSync(new URL("../src/anexos.ts", import.meta.url), "utf8");
  for (const obj of ["Document", "Ticket", "TicketValidation", "ITILFollowup", "ITILSolution"]) {
    const re = new RegExp(`method:\\s*["'](POST|PUT|DELETE|PATCH)[^]{0,200}${obj}`);
    assert.equal(re.test(src), false, `escrita em ${obj} nao pode existir aqui`);
  }
});


// ---- extracao de valor de PDF (adicionado depois da medicao de 18/09/2026) ----
const { normalizarTexto, extrairValores, procurarValor } = await import("../src/anexos.ts");

console.log("\nvalor no texto do anexo");
t("junta milhar quebrado por espaco ou quebra de linha", () => {
  assert.deepEqual(extrairValores("total 3.\n569,37 reais"), [3569.37]);
  assert.deepEqual(extrairValores("total 3 .569,37"), [3569.37]);
  assert.deepEqual(extrairValores("total 3. 569,37"), [3569.37]);
});

t("nao inventa numero onde nao ha", () => {
  assert.deepEqual(extrairValores("nota fiscal serie 001 numero 12345"), []);
  assert.deepEqual(extrairValores(""), []);
});

t("acha o valor do pedido quando ele esta no anexo", () => {
  const r = procurarValor(237610.13, "Valor total da nota: 237.610,13");
  assert.equal(r.bate, true);
  assert.equal(r.fator, null);
});

t("acusa casa decimal deslocada de 100x, o caso da Prefeitura de Eusebio", () => {
  const r = procurarValor(2080752.00, "GRA ISS  Valor: 20.807,52  multa 0,15");
  assert.equal(r.bate, false);
  assert.equal(r.fator, 100);
  assert.equal(r.valorNoAnexo, 20807.52);
});

t("acusa 100x tambem no caso da FSL e da Receita", () => {
  assert.equal(procurarValor(538913.00, "fatura 5.389,13 juros 0,14").fator, 100);
  assert.equal(procurarValor(312091.00, "Guia  3.120,91  total 2.022,42").fator, 100);
});

t("pega o Serasa, que so falhava por milhar quebrado", () => {
  const r = procurarValor(356937.00, "Fatura\nTotal a pagar R$ 3.\n569,37");
  assert.equal(r.fator, 100);
  assert.equal(r.valorNoAnexo, 3569.37);
});

t("quando nao acha nada, diz que nao achou em vez de chutar", () => {
  const r = procurarValor(999999.00, "boleto sem valor legivel");
  assert.equal(r.bate, false);
  assert.equal(r.fator, null);
  assert.equal(r.valorNoAnexo, null);
});

console.log(`\n${ok} testes ok`);
