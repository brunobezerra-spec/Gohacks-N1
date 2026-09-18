import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { T, useC } from "../conteudo";
import { C } from "../theme";
import { Arrow, Card, Eyebrow, Frame, useRise } from "../ui/kit";

const SPINE_X = 1062;
const CARD_X = 1132;
const CARD_W = 700;
const CARD_H = 152;
const CARD_GAP = 16;
const CARD_TOP = 306;
const centerY = (i: number) => CARD_TOP + i * (CARD_H + CARD_GAP) + CARD_H / 2;

// A cor de cada destino é da marca, não do conteúdo: fica no código de propósito.
const CORES = [
  { bg: C.lima, fg: C.blue, sub: "#4a5a1f" },
  { bg: C.cyan, fg: C.blue, sub: "#14425e" },
  { bg: C.orange, fg: C.blue, sub: "#6b4708" },
  { bg: C.red, fg: C.white, sub: "#ffd9d1" },
];

const Passo: React.FC<{ i: number }> = ({ i }) => {
  const r = useRise(38 + i * 11, 14);
  return (
    <div style={{ display: "flex", gap: 16, alignItems: "flex-start", ...r }}>
      <div
        style={{
          width: 34, height: 34, borderRadius: 999, backgroundColor: C.lima, color: C.blue,
          fontSize: 18, fontWeight: 800, display: "flex", alignItems: "center",
          justifyContent: "center", flexShrink: 0, marginTop: 2,
        }}
      >
        {i + 1}
      </div>
      <div>
        <T p={`s3.passos.${i}.titulo`} bloco style={{ color: C.white, fontSize: 25, fontWeight: 700, lineHeight: 1.15 }} />
        <T
          p={`s3.passos.${i}.desc`}
          bloco
          style={{ color: "#c4d5ef", fontSize: 17, fontWeight: 400, marginTop: 5, lineHeight: 1.3 }}
        />
      </div>
    </div>
  );
};

const Destino: React.FC<{ i: number }> = ({ i }) => {
  const d = CORES[i];
  const delay = 82 + i * 11;
  const r = useRise(delay + 4, 0);
  return (
    <>
      <Arrow x={SPINE_X + 5} y={centerY(i)} w={62} color={C.blue} delay={delay} thickness={4} />
      <div
        style={{
          position: "absolute", left: CARD_X, top: CARD_TOP + i * (CARD_H + CARD_GAP),
          width: CARD_W, height: CARD_H, backgroundColor: d.bg, borderRadius: 22,
          padding: "20px 26px", display: "flex", flexDirection: "column",
          justifyContent: "center", opacity: r.opacity,
          transform: `translateX(${(1 - r.opacity) * 26}px)`,
        }}
      >
        <T p={`s3.destinos.${i}.titulo`} bloco style={{ color: d.fg, fontSize: 30, fontWeight: 800, letterSpacing: "-0.01em" }} />
        <div style={{ display: "flex", gap: 18, alignItems: "baseline", marginTop: 8 }}>
          <T p={`s3.destinos.${i}.qtd`} style={{ color: d.fg, fontSize: 27, fontWeight: 700 }} />
          <T p={`s3.destinos.${i}.valor`} style={{ color: d.fg, fontSize: 24, fontWeight: 600, opacity: 0.8 }} />
        </div>
        <T p={`s3.destinos.${i}.desc`} bloco style={{ color: d.sub, fontSize: 17, fontWeight: 500, marginTop: 8, lineHeight: 1.25 }} />
      </div>
    </>
  );
};

export const S3Fluxo: React.FC = () => {
  const c = useC().s3;
  const frame = useCurrentFrame();
  const head = useRise(2);
  const origem = useRise(16);
  const motor = useRise(28);
  const spine = interpolate(frame, [72, 88], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const spineTop = centerY(0);
  const spineH = centerY(3) - spineTop;

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div style={{ position: "absolute", top: 72, left: 92, ...head }}>
        <Eyebrow color={C.blue}>
          <T p="s3.eyebrow" />
        </Eyebrow>
        <T
          p="s3.titulo"
          bloco
          style={{ color: C.blue, fontSize: 56, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.02em", marginTop: 14 }}
        />
        <T
          p="s3.subtitulo"
          bloco
          style={{ color: C.blue, fontSize: 32, fontWeight: 600, lineHeight: 1.2, letterSpacing: "-0.01em", marginTop: 10 }}
        />
      </div>
      <Card
        bg={C.white}
        style={{ position: "absolute", left: 92, top: 540, width: 250, padding: 24, border: `3px solid ${C.blue}`, ...origem }}
      >
        <Eyebrow color={C.blue} style={{ fontSize: 15 }}>
          <T p="s3.origemLabel" />
        </Eyebrow>
        <T p="s3.origemValor" bloco style={{ color: C.blue, fontSize: 44, fontWeight: 800, marginTop: 10, lineHeight: 1 }} />
        <T p="s3.origemNota" bloco style={{ color: "#3c4a5e", fontSize: 16, fontWeight: 500, marginTop: 6 }} />
        <T p="s3.origemValorRs" bloco style={{ color: C.red, fontSize: 22, fontWeight: 700, marginTop: 12 }} />
      </Card>
      <Arrow x={356} y={630} w={78} color={C.blue} delay={24} />

      <div
        style={{
          position: "absolute", left: 450, top: 300, width: 560, bottom: 120,
          backgroundColor: C.blue, borderRadius: 36, padding: 34,
          border: `4px solid ${C.lima}`, display: "flex", flexDirection: "column", ...motor,
        }}
      >
        <Eyebrow>
          <T p="s3.motorEyebrow" />
        </Eyebrow>
        <T p="s3.motorNome" bloco style={{ color: C.white, fontSize: 46, fontWeight: 800, marginTop: 8, letterSpacing: "-0.02em" }} />
        <div style={{ height: 3, backgroundColor: C.lima, borderRadius: 999, margin: "22px 0 26px", opacity: 0.5 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
          {c.passos.map((_, i) => (
            <Passo key={i} i={i} />
          ))}
        </div>
        <T
          p="s3.motorRodape"
          bloco
          style={{
            backgroundColor: C.lima, color: C.blue, borderRadius: 999, padding: "12px 22px",
            fontSize: 17, fontWeight: 700, textAlign: "center", marginTop: 20,
          }}
        />
      </div>

      <Arrow x={1016} y={630} w={40} color={C.blue} delay={68} thickness={5} />
      <div
        style={{
          position: "absolute", left: SPINE_X, top: spineTop + (spineH / 2) * (1 - spine),
          width: 5, height: spineH * spine, backgroundColor: C.blue, borderRadius: 999,
        }}
      />

      {c.destinos.map((_, i) => (
        <Destino key={i} i={i} />
      ))}

      <T
        p="s3.rodape"
        bloco
        style={{ position: "absolute", left: 92, bottom: 62, width: 310, color: C.blue, fontSize: 17, fontWeight: 500, lineHeight: 1.35 }}
      />
    </Frame>
  );
};
