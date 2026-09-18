// Varredura retroativa dos anexos da fila parada. SOMENTE LEITURA no GoService.
//
// Roda FORA do Worker de proposito: o Cloudflare corta em ~50 subrequests por
// invocacao, o que daria 7 chamados por execucao e 150 dias para varrer a fila.
// Aqui nao tem teto e a fila inteira sai em ~20 minutos.
//
// Uso:
//   GLPI_APP_TOKEN=... GLPI_USER_TOKEN=... node src/varrer-anexos.mjs [limite]
//
// Gera ./varredura/manifesto.json e os anexos em ./varredura/arquivos/.
// Os PDFs baixados sao documento fiscal: apague a pasta quando terminar.

import fs from "node:fs";
import path from "node:path";

const B = "https://goservice.gocase.com.br/apirest.php";
const A = process.env.GLPI_APP_TOKEN, U = process.env.GLPI_USER_TOKEN;
if (!A || !U) { console.error("faltam GLPI_APP_TOKEN e GLPI_USER_TOKEN"); process.exit(1); }

const RAIZ = path.resolve("varredura");
const DIR = path.join(RAIZ, "arquivos");
fs.mkdirSync(DIR, { recursive: true });

const limite = Number(process.argv[2] ?? 0) || Infinity;

const s = (await (await fetch(B + "/initSession", {
  headers: { "App-Token": A, Authorization: `user_token ${U}` },
})).json()).session_token;
const H = { "App-Token": A, "Session-Token": s };

// Perfil 4 = Super-Admin da conta. Troque para 24 (Goworker_agente) depois que
// o direito de leitura em document estiver concedido: o agente nao deve rodar
// como superadmin.
const perfil = Number(process.env.GLPI_PERFIL_ID ?? 4);
await fetch(B + "/changeActiveProfile", {
  method: "POST", headers: { ...H, "Content-Type": "application/json" },
  body: JSON.stringify({ profiles_id: perfil }),
});
console.log(`perfil ativo: ${perfil}`);

const base = JSON.parse(fs.readFileSync("../data/glpi_full.json", "utf8"));
const pend = base
  .filter(x => x.statusLabel === "Aguardando" && x.valor > 0 && x.valor < 1e9)
  .sort((a, b) => b.valor - a.valor)
  .slice(0, limite);
console.log("pedidos a varrer:", pend.length);

const manifesto = [];
let i = 0, comAnexo = 0;
for (const p of pend) {
  i++;
  if (i % 50 === 0) {
    console.log(`  ${i}/${pend.length} (com anexo: ${comAnexo})`);
    fs.writeFileSync(path.join(RAIZ, "manifesto.json"), JSON.stringify(manifesto));
  }

  let itens = [];
  try {
    const r = await fetch(`${B}/Ticket/${p.ticketId}/Document_Item/?range=0-50`, { headers: H });
    if (r.ok) itens = await r.json().catch(() => []);
  } catch { /* 403 isolado nao pode matar o lote */ }
  if (!Array.isArray(itens)) itens = [];

  const anexos = [];
  let baixados = 0;
  for (const it of itens) {
    const id = it.documents_id; if (!id) continue;
    let m = {};
    try { m = await (await fetch(`${B}/Document/${id}`, { headers: H })).json(); } catch { }
    const nome = String(m.filename ?? "");
    const reg = { documentId: id, nome, mime: String(m.mime ?? ""), arquivo: null };
    // Ordem barata: so desce para o binario em PDF e XML, no maximo 3 por chamado.
    if (/\.(pdf|xml)$/i.test(nome) && baixados < 3) {
      try {
        const rb = await fetch(`${B}/Document/${id}`, { headers: { ...H, Accept: "application/octet-stream" } });
        if (rb.ok) {
          const buf = Buffer.from(await rb.arrayBuffer());
          if (buf.length < 8 * 1024 * 1024) {
            const ext = /\.xml$/i.test(nome) ? "xml" : "pdf";
            const arq = path.join(DIR, `${p.ticketId}_${id}.${ext}`);
            fs.writeFileSync(arq, buf);
            reg.arquivo = arq; baixados++;
          }
        }
      } catch { }
    }
    anexos.push(reg);
  }
  if (anexos.length) comAnexo++;
  manifesto.push({
    ticket: p.ticketId, valor: p.valor, juros: p.juros ?? 0,
    vencimento: p.vencimento, fornecedor: p.fornecedor, anexos,
  });
}

fs.writeFileSync(path.join(RAIZ, "manifesto.json"), JSON.stringify(manifesto, null, 1));
await fetch(B + "/killSession", { headers: H }).catch(() => {});

const tipos = {};
for (const m of manifesto) for (const a of m.anexos) {
  const e = (a.nome.match(/\.([a-z0-9]+)$/i) ?? [, "(sem)"])[1].toLowerCase();
  tipos[e] = (tipos[e] ?? 0) + 1;
}
console.log("\n=== FIM ===");
console.log("chamados:", manifesto.length, "| com anexo:", comAnexo,
            `(${(100 * comAnexo / manifesto.length).toFixed(0)}%)`);
console.log("anexos por extensao:", JSON.stringify(tipos));
console.log("manifesto:", path.join(RAIZ, "manifesto.json"));
