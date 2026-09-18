import React from "react";
import { Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { Eyebrow, Frame, Title, useRise } from "../ui/kit";

export const S1Hook: React.FC = () => {
  const frame = useCurrentFrame();
  const logo = useRise(4);
  const eyebrow = useRise(14);
  const title = useRise(22);
  const rule = interpolate(frame, [30, 46], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const claim = useRise(46);
  const foot = useRise(60);

  return (
    <Frame>
      <div style={{ position: "absolute", inset: 0, padding: "0 110px", display: "flex", flexDirection: "column", justifyContent: "center" }}>
        <Img src={staticFile("gogroup-wordmark-lima.png")} style={{ width: 268, marginBottom: 46, ...logo }} />
        <Eyebrow style={eyebrow}>Goworker do financeiro</Eyebrow>
        <Title size={92} style={{ marginTop: 22, maxWidth: 1400, ...title }}>
          Transformar o financeiro
          <br />
          em <span style={{ color: C.lima }}>IA First</span>
        </Title>

        <div style={{ width: 1400 * rule, height: 5, backgroundColor: C.lima, borderRadius: 999, margin: "46px 0 38px" }} />

        <div style={{ color: C.white, fontSize: 34, fontWeight: 500, lineHeight: 1.35, maxWidth: 1380, ...claim }}>
          Nenhum real sai do Gogroup sem passar por uma checagem de máquina
          <br />
          antes de passar por uma assinatura humana.
        </div>

        <div style={{ display: "flex", gap: 14, marginTop: 54, ...foot }}>
          {["Em produção no GoService", "748 ações gravadas", "1 vaga congelada"].map((t) => (
            <div
              key={t}
              style={{
                border: `2px solid ${C.lima}`, color: C.lima, borderRadius: 999,
                padding: "11px 26px", fontSize: 19, fontWeight: 600,
              }}
            >
              {t}
            </div>
          ))}
        </div>
      </div>
    </Frame>
  );
};
