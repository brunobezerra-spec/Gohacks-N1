import React from "react";
import { C } from "../theme";
import { Card, Eyebrow, Frame, Stat, Title, useCount, useRise } from "../ui/kit";

const Metric: React.FC<{ value: React.ReactNode; label: string; delay: number; color?: string }> = ({
  value, label, delay, color = C.blue,
}) => {
  const r = useRise(delay);
  return (
    <Card bg={C.white} style={{ flex: 1, ...r }}>
      <Stat value={value} label={label} color={color} labelColor="#3c4a5e" size={64} />
    </Card>
  );
};

export const S2Status: React.FC = () => {
  const head = useRise(2);
  const parados = useCount(1071, 16, 34);
  const valor = useCount(64.8, 16, 34, 1);
  const dias = useCount(91, 26, 30);
  const taxa = useCount(99.15, 36, 30, 2);
  const quote = useRise(96);
  const why = useRise(112);

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      <div style={{ position: "absolute", inset: 0, padding: "78px 92px 72px", display: "flex", flexDirection: "column" }}>
        <div style={head}>
          <Eyebrow color={C.blue}>Status hoje · GoService / GLPI · 18.966 registros</Eyebrow>
          <Title color={C.blue} size={64} style={{ marginTop: 16 }}>
            A aprovação de pagamento virou <span style={{ color: C.red }}>carimbo</span>
          </Title>
        </div>

        <div style={{ display: "flex", gap: 20, marginTop: 44 }}>
          <Metric delay={14} value={parados} label="pedidos parados na fila" />
          <Metric delay={22} value={<>R$ {valor} mi</>} label="de dinheiro parado" color={C.red} />
          <Metric delay={30} value={<>{dias} d</>} label="mediana parada (mais antigo: 352)" />
          <Metric delay={38} value={<>{taxa}%</>} label="de aprovação entre os decididos" color={C.red} />
        </div>

        <Card bg={C.blue} style={{ marginTop: 26, padding: "30px 34px", ...quote }}>
          <Eyebrow>O que o aprovador vê antes de assinar</Eyebrow>
          <div
            style={{
              color: C.white, fontFamily: "ui-monospace, Menlo, monospace",
              fontSize: 25, marginTop: 14, opacity: 0.95,
            }}
          >
            Solicitação de pagamento : Freedom Cosmeticos Ltda 53.402.541/0001-02
          </div>
          <div style={{ color: C.lima, fontSize: 21, fontWeight: 600, marginTop: 14 }}>
            Esse texto se repete 1.106 vezes byte a byte idêntico. Sem valor, sem vencimento, sem nota fiscal.
          </div>
        </Card>

        <div style={{ display: "flex", gap: 20, marginTop: 22, ...why }}>
          {[
            ["16,5 h", "é a mediana para decidir quando alguém decide"],
            ["106", "tickets de teste na fila — 23 já foram aprovados"],
            ["206", "pedidos aguardando quem não tem alçada (Art. 7)"],
          ].map(([v, l]) => (
            <Card key={v} bg={C.white} style={{ flex: 1, padding: 22 }}>
              <Stat value={v} label={l} color={C.blue} labelColor="#3c4a5e" size={40} />
            </Card>
          ))}
        </div>
      </div>
    </Frame>
  );
};
