import React from "react";
import { Img, interpolate, useCurrentFrame } from "remotion";
import { asset } from "../assets";
import { T, useC } from "../conteudo";
import { C } from "../theme";
import { Eyebrow, Frame, useRise } from "../ui/kit";

export const S1Hook: React.FC = () => {
  const c = useC().s1;
  const frame = useCurrentFrame();
  const logo = useRise(4);
  const eyebrow = useRise(14);
  const titulo = useRise(22);
  const regua = interpolate(frame, [30, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const claim = useRise(46);
  const foot = useRise(60);

  return (
    <Frame>
      <div style={{ position: "absolute", inset: 0, padding: "0 110px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Img src={asset("gogroup-wordmark-lima.png")} style={{ width: 268, marginBottom: 46, ...logo }} />
        <Eyebrow style={eyebrow}>
          <T p="s1.eyebrow" />
        </Eyebrow>
        <div
          style={{
            color: C.white, fontSize: 92, fontWeight: 800, lineHeight: 1.06,
            letterSpacing: "-0.02em", marginTop: 22, maxWidth: 1400, ...titulo,
          }}
        >
          <T p="s1.titulo" bloco />
          <T p="s1.tituloDestaque" bloco style={{ color: C.lima }} />
        </div>

        <div style={{ width: 1400 * regua, height: 5, backgroundColor: C.lima, borderRadius: 999, margin: "46px 0 38px" }} />

        <T
          p="s1.claim"
          bloco
          style={{ color: C.white, fontSize: 34, fontWeight: 500, lineHeight: 1.35, maxWidth: 1380, ...claim }}
        />

        <div style={{ display: "flex", gap: 14, marginTop: 54, ...foot }}>
          {c.selos.map((t, i) => (
            <T
              key={i}
              p={`s1.selos.${i}`}
              style={{
                border: `2px solid ${C.lima}`, color: C.lima, borderRadius: 999,
                padding: "11px 26px", fontSize: 19, fontWeight: 600,
              }}
            />
          ))}
        </div>
      </div>
    </Frame>
  );
};
