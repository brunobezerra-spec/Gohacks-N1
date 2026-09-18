import React from "react";
import { Img, staticFile } from "remotion";
import { C } from "../theme";
import { Card, Eyebrow, Frame, Title, useRise } from "../ui/kit";

const ENTREGUE = [
  "PoC pronta e testada em produção",
  "Agente operando: 748 ações no GoService",
  "1 vaga congelada",
];

const PROXIMOS = [
  ["01", "Melhoria contínua do agente", "Calibrar regras com o time, fechar o loop de alçada e medir recusa de verdade"],
  ["02", "Goworkers nas demais atividades do financeiro", "Mesmo motor, outro parser e outro conjunto de regras"],
  ["03", "O financeiro IA First", "Máquina carrega a conferência; o humano só decide o que exige julgamento"],
];

const Passo: React.FC<{ p: string[]; i: number }> = ({ p, i }) => {
  const r = useRise(48 + i * 14);
  return (
    <Card bg={C.white} style={{ display: "flex", gap: 22, padding: "24px 28px", alignItems: "flex-start", ...r }}>
      <div style={{ color: C.lima, fontSize: 40, fontWeight: 800, lineHeight: 1, WebkitTextStroke: `2px ${C.blue}` }}>
        {p[0]}
      </div>
      <div>
        <div style={{ color: C.blue, fontSize: 28, fontWeight: 700, lineHeight: 1.15 }}>{p[1]}</div>
        <div style={{ color: "#3c4a5e", fontSize: 19, fontWeight: 500, marginTop: 7, lineHeight: 1.3 }}>{p[2]}</div>
      </div>
    </Card>
  );
};

export const S5Proximos: React.FC = () => {
  const head = useRise(2);
  const ent = useRise(16);
  const fecho = useRise(104);
  const logo = useRise(116);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div style={{ position: "absolute", inset: 0, padding: "70px 92px 58px", display: "flex", flexDirection: "column" }}>
        <div style={head}>
          <Eyebrow color={C.blue}>Resultados e próximos passos</Eyebrow>
          <Title color={C.blue} size={58} style={{ marginTop: 14 }}>
            Está entregue. Agora escala
          </Title>
        </div>

        <Card bg={C.blue} style={{ marginTop: 34, padding: "26px 30px", ...ent }}>
          <Eyebrow>O que já está no ar</Eyebrow>
          <div style={{ display: "flex", gap: 40, marginTop: 16 }}>
            {ENTREGUE.map((t) => (
              <div key={t} style={{ display: "flex", gap: 12, alignItems: "center", flex: 1 }}>
                <div
                  style={{
                    width: 26, height: 26, borderRadius: 999, backgroundColor: C.lima, color: C.blue,
                    fontSize: 16, fontWeight: 800, display: "flex", alignItems: "center",
                    justifyContent: "center", flexShrink: 0,
                  }}
                >
                  ✓
                </div>
                <div style={{ color: C.white, fontSize: 21, fontWeight: 600, lineHeight: 1.2 }}>{t}</div>
              </div>
            ))}
          </div>
        </Card>

        <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 26 }}>
          {PROXIMOS.map((p, i) => (
            <Passo key={p[0]} p={p} i={i} />
          ))}
        </div>

        <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ color: C.blue, fontSize: 30, fontWeight: 700, maxWidth: 1260, lineHeight: 1.25, ...fecho }}>
            Ele não decide pelo financeiro. <span style={{ color: C.red }}>Ele faz o financeiro decidir.</span>
          </div>
          <Img src={staticFile("gogroup-wordmark-azul.png")} style={{ width: 230, ...logo }} />
        </div>
      </div>
    </Frame>
  );
};
