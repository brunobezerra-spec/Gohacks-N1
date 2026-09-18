import { continueRender, delayRender, staticFile } from "remotion";

const WEIGHTS = [400, 500, 600, 700, 800];

const css = WEIGHTS.map(
  (w) => `@font-face{font-family:'Poppins';font-style:normal;font-weight:${w};
  font-display:block;src:url('${staticFile(`fonts/Poppins-${w}.woff2`)}') format('woff2');}`,
).join("\n");

// A regra nº 1 da marca quebra em silencio quando a fonte nao carrega: o
// fallback Arial renderiza sem erro. Por isso o render espera de fato.
const handle = delayRender("Poppins");
const style = document.createElement("style");
style.innerHTML = css;
document.head.appendChild(style);

Promise.all(WEIGHTS.map((w) => document.fonts.load(`${w} 48px Poppins`)))
  .then(() => continueRender(handle))
  .catch(() => continueRender(handle));

export {};
