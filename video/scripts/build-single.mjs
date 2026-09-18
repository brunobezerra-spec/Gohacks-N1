// Gera dist-deck/deck.html: um arquivo só, sem servidor, que abre com duplo clique.
// Fontes e logos viram data URI; o bundle do Vite entra inline.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const raiz = path.resolve(import.meta.dirname, "..");
const saida = path.join(raiz, "dist-deck");

const ARQUIVOS = [
  "fonts/Poppins-400.woff2",
  "fonts/Poppins-500.woff2",
  "fonts/Poppins-600.woff2",
  "fonts/Poppins-700.woff2",
  "fonts/Poppins-800.woff2",
  "gogroup-wordmark-azul.png",
  "gogroup-wordmark-lima.png",
];

const TIPO = { ".woff2": "font/woff2", ".png": "image/png" };

console.log("1/3 vite build");
execFileSync("npx", ["vite", "build"], { cwd: raiz, stdio: "inherit" });

console.log("2/3 embutindo fontes e logos");
const assets = Object.fromEntries(
  ARQUIVOS.map((rel) => {
    const b = fs.readFileSync(path.join(raiz, "public", rel));
    const tipo = TIPO[path.extname(rel)];
    if (!tipo) throw new Error(`tipo desconhecido: ${rel}`);
    return [rel, `data:${tipo};base64,${b.toString("base64")}`];
  }),
);

const html = fs.readFileSync(path.join(saida, "index.html"), "utf8");
const src = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
if (!src) throw new Error("não achei o script do bundle no index.html");
const js = fs.readFileSync(path.join(saida, src.replace(/^\//, "")), "utf8");

// Uma string do bundle com </script> fecharia a tag cedo demais.
const seguro = (s) => s.replace(/<\/script/gi, "<\\/script");

console.log("3/3 escrevendo deck.html");
// Replacer em FUNÇÃO, não em string: num replacement string o $& e o $' do
// bundle seriam interpretados como referência de captura e corromperiam o JS.
const injecao =
  `  <script>window.__DECK_ASSETS=${seguro(JSON.stringify(assets))};</script>\n` +
  `  <script type="module">${seguro(js)}</script>\n</body>`;

const único = html
  .replace(/<script[^>]+src="[^"]+"[^>]*><\/script>/, () => "")
  .replace("</body>", () => injecao);

const destino = path.join(saida, "deck.html");
fs.writeFileSync(destino, único);
const mb = (fs.statSync(destino).size / 1024 / 1024).toFixed(2);
console.log(`\npronto (${mb} MB), abre com duplo clique e sem servidor:\n${destino}\n`);
