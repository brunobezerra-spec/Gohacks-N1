// Diagnostico de cobertura de anexo. Responde a pergunta que decide se o
// caminho retroativo existe: dos pedidos parados, quantos tem anexo, de que
// tipo, e em quantos da para conferir o valor contra a nota.
//
// Uso:
//   GLPI_APP_TOKEN=... GLPI_USER_TOKEN=... GLPI_PERFIL_ID=24 \
//   node --experimental-strip-types src/diag-anexos.ts ../data/glpi_full.json [limite]
//
// So le. Nao escreve nada no GoService.

import fs from "node:fs";
import { enrich, analyze } from "./engine";
import { listarAnexos, baixarDocumento, lerNFe, conferir, type Anexo } from "./anexos";

const GLPI_BASE = "https://goservice.gocase.com.br/apirest.php";

const env = {
  GLPI_APP_TOKEN: process.env.GLPI_APP_TOKEN,
  GLPI_USER_TOKEN: process.env.GLPI_USER_TOKEN,
  GLPI_PERFIL_ID: process.env.GLPI_PERFIL_ID,
};

async function abrirSessao() {
  if (!env.GLPI_APP_TOKEN || !env.GLPI_USER_TOKEN) {
    throw new Error("Faltam GLPI_APP_TOKEN e GLPI_USER_TOKEN no ambiente.");
  }
  const r = await fetch(`${GLPI_BASE}/initSession`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN, Authorization: `user_token ${env.GLPI_USER_TOKEN}` },
  });
  const d: any = await r.json().catch(() => ({}));
  if (!d?.session_token) throw new Error(`initSession HTTP ${r.status}: ${JSON.stringify(d).slice(0, 200)}`);
  const s = d.session_token as string;
  const perfil = Number(env.GLPI_PERFIL_ID ?? 0);
  if (perfil > 0) {
    const rp = await fetch(`${GLPI_BASE}/changeActiveProfile`, {
      method: "POST",
      headers: { "App-Token": env.GLPI_APP_TOKEN, "Session-Token": s, "Content-Type": "application/json" },
      body: JSON.stringify({ profiles_id: perfil }),
    });
    console.log(`[perfil ${perfil}] troca: HTTP ${rp.status}`);
  }
  return s;
}

async function fecharSessao(s: string) {
  await fetch(`${GLPI_BASE}/killSession`, {
    headers: { "App-Token": env.GLPI_APP_TOKEN!, "Session-Token": s },
  }).catch(() => {});
}

const arquivo = process.argv[2] ?? "../data/glpi_full.json";
const limite = Number(process.argv[3] ?? 60);

const raw = JSON.parse(fs.readFileSync(arquivo, "utf8"));
const todos = enrich(raw);
const a = analyze(todos, { now: Date.now() });

// Prioriza os de maior valor: se anexo existir, e ali que ele vale mais.
const alvo = a.pending
  .filter((p: any) => p.valor && p.valor < 1e9)
  .sort((x: any, y: any) => y.valor - x.valor)
  .slice(0, limite);

const conta = { comAnexo: 0, semAnexo: 0, erro: 0 };
const porTipo: Record<string, number> = {};
const conferencias: any[] = [];

const s = await abrirSessao();
try {
  for (const p of alvo) {
    let anexos: Anexo[] = [];
    try { anexos = await listarAnexos(env as any, s, Number(p.ticketId)); }
    catch { conta.erro++; continue; }

    if (!anexos.length) { conta.semAnexo++; continue; }
    conta.comAnexo++;
    for (const x of anexos) porTipo[x.tipo] = (porTipo[x.tipo] ?? 0) + 1;

    for (const x of anexos.filter(v => v.tipo === "xml_nfe")) {
      const bin = await baixarDocumento(env as any, s, x.documentId);
      if (!bin.ok) continue;
      const nf = lerNFe(bin.texto);
      if (nf?.valorNota == null) continue;
      const c = conferir(p, nf, Number(p.ticketId));
      conferencias.push({
        ticket: p.ticketId,
        pedido: Number(p.valor).toFixed(2),
        nota: nf.valorNota.toFixed(2),
        numeroNota: nf.numero,
        divergencias: c.divergencias.map(d => `${d.campo}:${d.gravidade}`),
      });
      break;
    }
  }
} finally {
  await fecharSessao(s);
}

console.log("\n=== COBERTURA DE ANEXO ===");
console.log(`pedidos testados: ${alvo.length}`);
console.log(`  com anexo: ${conta.comAnexo}  (${(100 * conta.comAnexo / alvo.length).toFixed(0)}%)`);
console.log(`  sem anexo: ${conta.semAnexo}`);
console.log(`  erro de leitura: ${conta.erro}`);
console.log("anexos por tipo:", JSON.stringify(porTipo));
console.log(`\n=== CONFERENCIA CONTRA A NOTA (${conferencias.length}) ===`);
for (const c of conferencias) console.log(" ", JSON.stringify(c));
const comDiv = conferencias.filter(c => c.divergencias.length);
console.log(`\ncom divergencia: ${comDiv.length} de ${conferencias.length}`);
