import React from "react";
import { C } from "../theme";
import { Card, Eyebrow, Frame, Title, useRise } from "../ui/kit";

const LINHAS = [
  ["Pedidos na mesa do diretor", "1.071 sem triagem", "222 já instruídos"],
  ["Ações do agente no GoService", "0", "748 gravadas em 1 execução"],
  ["Alçada conferida por valor (Art. 7)", "nenhuma", "234 roteamentos corrigidos"],
  ["Tickets de teste na fila", "106 — 23 já aprovados", "106 encerrados"],
  ["O que sustenta a decisão", "1 linha de texto", "dossiê + artigo da política"],
  ["Causa raiz do roteamento errado", "invisível", "2 chamados abertos"],
];

const Linha: React.FC<{ l: string[]; i: number }> = ({ l, i }) => {
  const r = useRise(20 + i * 9, 18);
  return (
    <div style={{ display: "flex", alignItems: "stretch", gap: 18, ...r }}>
      <div style={{ flex: 1.15, color: C.blue, fontSize: 23, fontWeight: 600, display: "flex", alignItems: "center" }}>
        {l[0]}
      </div>
      <div
        style={{
          flex: 1, backgroundColor: "#e6dcc9", borderRadius: 14, padding: "16px 22px",
          color: "#7a6a52", fontSize: 24, fontWeight: 600, display: "flex", alignItems: "center",
        }}
      >
        {l[1]}
      </div>
      <div
        style={{
          flex: 1, backgroundColor: C.blue, borderRadius: 14, padding: "16px 22px",
          color: C.lima, fontSize: 24, fontWeight: 700, display: "flex", alignItems: "center",
        }}
      >
        {l[2]}
      </div>
    </div>
  );
};

export const S4AntesDepois: React.FC = () => {
  const head = useRise(2);
  const cab = useRise(14);
  const foot = useRise(88);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div style={{ position: "absolute", inset: 0, padding: "70px 92px 60px", display: "flex", flexDirection: "column" }}>
        <div style={head}>
          <Eyebrow color={C.blue}>Antes x depois · mesma fila, mesmo dia</Eyebrow>
          <Title color={C.blue} size={58} style={{ marginTop: 14 }}>
            O que mudou no GoService
          </Title>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 38, marginBottom: 14, ...cab }}>
          <div style={{ flex: 1.15 }} />
          <Eyebrow color="#7a6a52" style={{ flex: 1, paddingLeft: 22 }}>Antes</Eyebrow>
          <Eyebrow color={C.blue} style={{ flex: 1, paddingLeft: 22 }}>Depois do Goworker</Eyebrow>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {LINHAS.map((l, i) => (
            <Linha key={l[0]} l={l} i={i} />
          ))}
        </div>

        <Card bg={C.lima} style={{ marginTop: "auto", padding: "22px 30px", ...foot }}>
          <div style={{ color: C.blue, fontSize: 27, fontWeight: 700 }}>
            849 dos 1.071 pedidos (79%) saíram da fila sem consumir um minuto de diretor.
            <span style={{ fontWeight: 500 }}> Os 222 que sobraram chegam prontos para decidir.</span>
          </div>
        </Card>
      </div>
    </Frame>
  );
};
