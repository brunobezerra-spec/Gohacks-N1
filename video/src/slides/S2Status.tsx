import React from "react";
import { T, TNum, useC } from "../conteudo";
import { C } from "../theme";
import { Card, Eyebrow, Frame, useCount, useRise } from "../ui/kit";

const Metrica: React.FC<{ i: number; delay: number }> = ({ i, delay }) => {
  const m = useC().s2.metricas[i];
  const r = useRise(delay);
  const contado = useCount(m.valor, Math.max(0, delay - 4), 26, m.decimais);
  const cor = m.alerta ? C.red : C.blue;
  return (
    <Card bg={C.white} style={{ flex: 1, ...r }}>
      <div style={{ color: cor, fontSize: 64, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}>
        <T p={`s2.metricas.${i}.prefixo`} />
        <TNum p={`s2.metricas.${i}.valor`} render={() => contado} />
        <T p={`s2.metricas.${i}.sufixo`} />
      </div>
      <T
        p={`s2.metricas.${i}.label`}
        bloco
        style={{ color: "#3c4a5e", fontSize: 19, fontWeight: 500, marginTop: 10, lineHeight: 1.3 }}
      />
    </Card>
  );
};

export const S2Status: React.FC = () => {
  const c = useC().s2;
  const head = useRise(2);
  const quote = useRise(50);
  const why = useRise(62);
  const prova = useRise(74);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div
        style={{
          position: "absolute", inset: 0, padding: "72px 92px 64px",
          display: "flex", flexDirection: "column", justifyContent: "space-between",
        }}
      >
        <div style={head}>
          <Eyebrow color={C.blue}>
            <T p="s2.eyebrow" />
          </Eyebrow>
          <div style={{ color: C.blue, fontSize: 64, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.02em", marginTop: 16 }}>
            <T p="s2.titulo" /> <T p="s2.tituloDestaque" style={{ color: C.red }} />
          </div>
        </div>

        <div style={{ display: "flex", gap: 20 }}>
          {c.metricas.map((_, i) => (
            <Metrica key={i} i={i} delay={14 + i * 8} />
          ))}
        </div>

        <Card bg={C.blue} style={{ padding: "32px 36px", ...quote }}>
          <Eyebrow>
            <T p="s2.citacaoLabel" />
          </Eyebrow>
          <T
            p="s2.citacao"
            bloco
            style={{
              color: C.white, fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 25, marginTop: 14, opacity: 0.95,
            }}
          />
          <T p="s2.citacaoNota" bloco style={{ color: C.lima, fontSize: 21, fontWeight: 600, marginTop: 14 }} />
        </Card>

        <div style={{ display: "flex", gap: 20, ...why }}>
          {c.mini.map((_, i) => (
            <Card key={i} bg={C.white} style={{ flex: 1, padding: 22 }}>
              <T p={`s2.mini.${i}.valor`} bloco style={{ color: C.blue, fontSize: 40, fontWeight: 800, lineHeight: 1 }} />
              <T
                p={`s2.mini.${i}.label`}
                bloco
                style={{ color: "#3c4a5e", fontSize: 19, fontWeight: 500, marginTop: 10, lineHeight: 1.3 }}
              />
            </Card>
          ))}
        </div>

        <div style={{ display: "flex", gap: 20, ...prova }}>
          {c.provas.map((_, i) => (
            <Card key={i} bg={i === 0 ? C.red : C.blue} style={{ flex: 1, padding: "24px 28px" }}>
              <Eyebrow color={i === 0 ? C.white : C.lima} style={{ fontSize: 15 }}>
                <T p={`s2.provas.${i}.label`} />
              </Eyebrow>
              <T
                p={`s2.provas.${i}.texto`}
                bloco
                style={{ color: C.white, fontSize: 25, fontWeight: 700, marginTop: 10, lineHeight: 1.25 }}
              />
            </Card>
          ))}
        </div>
      </div>
    </Frame>
  );
};
