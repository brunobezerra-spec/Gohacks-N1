import fs from "node:fs";
import path from "node:path";
import { defineConfig, type Plugin } from "vite";

const ARQUIVO = path.resolve(import.meta.dirname, "src/conteudo.json");

/** Grava o texto editado no deck de volta em src/conteudo.json. Só em dev. */
function apiConteudo(): Plugin {
  return {
    name: "api-conteudo",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use("/api/conteudo", (req, res) => {
        if (req.method !== "POST") {
          res.statusCode = 405;
          return res.end();
        }
        let corpo = "";
        req.on("data", (c) => (corpo += c));
        req.on("end", () => {
          try {
            const doc = JSON.parse(corpo);
            fs.writeFileSync(ARQUIVO, JSON.stringify(doc, null, 2) + "\n");
            res.setHeader("content-type", "application/json");
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(String(e));
          }
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [apiConteudo()],
  // Sem plugin de React: o esbuild do proprio Vite compila o TSX com o runtime
  // automatico. Menos dependencia e nenhum conflito de peer com o Remotion.
  esbuild: { jsx: "automatic" },
  server: { port: 5188 },
  build: { outDir: "dist-deck" },
});
