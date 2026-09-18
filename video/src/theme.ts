// Tokens do Brandbook Gogroup 2026. Nao inventar cor nem fonte fora daqui.
export const C = {
  blue: "#2659a5",
  lima: "#d7d900",
  off: "#f5f0e8",
  white: "#ffffff",
  red: "#e5381a",
  pink: "#e61782",
  orange: "#f8ae13",
  cyan: "#3dbfef",
} as const;

export const FONT = "Poppins, Arial, sans-serif";

// 1920x1080 @ 30fps. Duracao em segundos por slide; total = 180s (3 min).
export const SLIDES_S = [25, 36, 51, 36, 32] as const;
export const FPS = 30;
export const DUR = SLIDES_S.map((s) => s * FPS);
export const TOTAL = DUR.reduce((a, b) => a + b, 0);
export const START = DUR.reduce<number[]>(
  (acc, d, i) => [...acc, (acc[i - 1] ?? 0) + (DUR[i - 1] ?? 0)],
  [],
);
