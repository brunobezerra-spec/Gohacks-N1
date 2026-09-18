import { staticFile } from "remotion";

/**
 * Caminho de um arquivo de public/.
 *
 * No deck de arquivo único não existe pasta public: o build injeta
 * window.__DECK_ASSETS com cada arquivo em data URI. Fora dele (studio,
 * render de vídeo, dev) cai no staticFile de sempre.
 */
export const asset = (caminho: string): string => {
  const mapa = (globalThis as { __DECK_ASSETS?: Record<string, string> }).__DECK_ASSETS;
  return mapa?.[caminho] ?? staticFile(caminho);
};
