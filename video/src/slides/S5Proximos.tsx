import React from "react";
import { Img } from "remotion";
import { asset } from "../assets";
import { T, useC } from "../conteudo";
import { C } from "../theme";
import { Card, Eyebrow, Frame, useRise } from "../ui/kit";

const Passo: React.FC<{ i: number }> = ({ i }) => {
  const r = useRise(30 + i * 10);
  return (
    <Card bg={C.white} style={{ display: "flex", gap: 24, padding: "34px 32px", alignItems: "flex-start", ...r }}>
      <T
        p={`s5.passos.${i}.n`}
        style={{ color: C.lima, fontSize: 50, fontWeight: 800, lineHeight: 1, WebkitTextStroke: `2px ${C.blue}` }}
      />
      <div>
        <T p={`s5.passos.${i}.titulo`} bloco style={{ color: C.blue, fontSize: 33, fontWeight: 700, lineHeight: 1.15 }} />
        <T p={`s5.passos.${i}.desc`} bloco style={{ color: "#3c4a5e", fontSize: 21, fontWeight: 500, marginTop: 8, lineHeight: 1.3 }} />
      </div>
    </Card>
  );
};

export const S5Proximos: React.FC = () => {
  const c = useC().s5;
  const head = useRise(2);
  const ent = useRise(16);
  const fecho = useRise(66);
  const logo = useRise(74);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div
        style={{
          position: "absolute", inset: 0, padding: "66px 92px 56px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}
      >
        <div style={head}>
          <Eyebrow color={C.blue}>
            <T p="s5.eyebrow" />
          </Eyebrow>
          <T
            p="s5.titulo"
            bloco
            style={{ color: C.blue, fontSize: 58, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.02em", marginTop: 14 }}
          />
        </div>

        <Card bg={C.blue} style={{ padding: "30px 34px", ...ent }}>
          <Eyebrow>
            <T p="s5.entregueLabel" />
          </Eyebrow>
          <div style={{ display: "flex", gap: 40, marginTop: 16 }}>
            {c.entregues.map((_, i) => (
              <div key={i} style={{ display: "flex", gap: 12, alignItems: "center", flex: 1 }}>
                <div
                  style={{
                    width: 26, height: 26, borderRadius: 999, backgroundColor: C.lima, color: C.blue,
                    fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0,
                  }}
                >
                  ✓
                </div>
                <T p={`s5.entregues.${i}`} bloco style={{ color: C.white, fontSize: 21, fontWeight: 600, lineHeight: 1.2 }} />
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {c.passos.map((_, i) => (
            <Passo key={i} i={i} />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between" }}>
          <div style={{ color: C.blue, fontSize: 30, fontWeight: 700, maxWidth: 1260, lineHeight: 1.25, ...fecho }}>
            <T p="s5.fecho" /> <T p="s5.fechoDestaque" style={{ color: C.red }} />
          </div>
          <Img src={asset("gogroup-wordmark-azul.png")} style={{ width: 230, ...logo }} />
        </div>
      </div>
    </Frame>
  );
};
