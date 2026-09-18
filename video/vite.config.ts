import { defineConfig } from "vite";

// Sem plugin de React: o esbuild do proprio Vite compila o TSX com o runtime
// automatico. Menos dependencia e nenhum conflito de peer com o Remotion.
export default defineConfig({
  esbuild: { jsx: "automatic" },
  server: { port: 5188, open: "/" },
  build: { outDir: "dist-deck" },
});
