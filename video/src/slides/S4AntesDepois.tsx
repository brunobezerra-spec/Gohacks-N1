import React from "react";
import { T, useC } from "../conteudo";
import { C } from "../theme";
import { Card, Eyebrow, Frame, useRise } from "../ui/kit";

const Linha: React.FC<{ i: number }> = ({ i }) => {
  const r = useRise(14 + i * 7, 18);
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 18, ...r }}>
      <T
        p={`s4.linhas.${i}.rotulo`}
        bloco
        style={{ flex: 1.15, color: C.blue, fontSize: 23, fontWeight: 600, display: "flex", alignItems: "center" }}
      />
      <T
        p={`s4.linhas.${i}.antes`}
        bloco
        style={{
          flex: 1, backgroundColor: "#e6dcc9", borderRadius: 16, padding: "24px 26px",
          color: "#7a6a52", fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center",
        }}
      />
      <T
        p={`s4.linhas.${i}.depois`}
        bloco
        style={{
          flex: 1, backgroundColor: C.blue, borderRadius: 16, padding: "24px 26px",
          color: C.lima, fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center",
        }}
      />
    </div>
  );
};

export const S4AntesDepois: React.FC = () => {
  const c = useC().s4;
  const head = useRise(2);
  const cab = useRise(14);
  const foot = useRise(62);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div
        style={{
          position: "absolute", inset: 0, padding: "66px 92px 58px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}
      >
        <div style={head}>
          <Eyebrow color={C.blue}>
            <T p="s4.eyebrow" />
          </Eyebrow>
          <T
            p="s4.titulo"
            bloco
            style={{ color: C.blue, fontSize: 58, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.02em", marginTop: 14 }}
          />
        </div>

        <div>
          <div style={{ display: "flex", gap: 18, marginBottom: 14, ...cab }}>
            <div style={{ flex: 1.15 }} />
            <Eyebrow color="#7a6a52" style={{ flex: 1, paddingLeft: 26 }}>
              <T p="s4.colAntes" />
            </Eyebrow>
            <Eyebrow color={C.blue} style={{ flex: 1, paddingLeft: 26 }}>
              <T p="s4.colDepois" />
            </Eyebrow>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 13 }}>
            {c.linhas.map((_, i) => (
              <Linha key={i} i={i} />
            ))}
          </div>
        </div>

        <Card bg={C.lima} style={{ padding: "26px 32px", ...foot }}>
          <div style={{ color: C.blue, fontSize: 27, fontWeight: 700 }}>
            <T p="s4.rodapeForte" /> <T p="s4.rodapeResto" style={{ fontWeight: 500 }} />
          </div>
        </Card>
      </div>
    </Frame>
  );
};
