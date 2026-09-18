import React from "react";
import { interpolate, useCurrentFrame } from "remotion";
import { C } from "../theme";
import { Arrow, Card, Eyebrow, Frame, Title, useRise } from "../ui/kit";

const SPINE_X = 1062;
const CARD_X = 1132;
const CARD_W = 700;
const CARD_H = 152;
const CARD_GAP = 16;
const CARD_TOP = 306;
const centerY = (i: number) => CARD_TOP + i * (CARD_H + CARD_GAP) + CARD_H / 2;

const DESTINOS = [
  {
    n: "1", titulo: "Encaminhar ao aprovador", qtd: "222 pedidos", valor: "R$ 7,6 mi",
    desc: "Instruído: valor, CNPJ validado, alçada conferida e o artigo que sustenta",
    bg: C.lima, fg: C.blue, sub: "#4a5a1f",
  },
  {
    n: "2", titulo: "Rotear para o aprovador certo", qtd: "125 pedidos", valor: "R$ 9,0 mi",
    desc: "Art. 7: quem está na fila não tem alçada para esse valor",
    bg: C.cyan, fg: C.blue, sub: "#14425e",
  },
  {
    n: "3", titulo: "Devolver ao solicitante", qtd: "18 pedidos", valor: "R$ 0,6 mi",
    desc: "Com a mensagem já escrita, o que corrigir e a base legal",
    bg: C.orange, fg: C.blue, sub: "#6b4708",
  },
  {
    n: "4", titulo: "Descartar sem pagamento", qtd: "706 pedidos", valor: "R$ 47,6 mi",
    desc: "Teste, fila zumbi, despesa pré-aprovada, estorno do Art. 11",
    bg: C.red, fg: C.white, sub: "#ffd9d1",
  },
];

const PASSOS = [
  ["Lê o pedido", "título, fornecedor, CNPJ, valor, vencimento"],
  ["Compara com a política", "Art. 4 ao 12, Anexos I e II"],
  ["Checa consistência", "23 regras: dígito verificador, duplicidade, autoaprovação, fila zumbi"],
];

const Passo: React.FC<{ i: number; t: string; d: string }> = ({ i, t, d }) => {
  const r = useRise(70 + i * 16, 14);
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
        <div style={{ color: C.white, fontSize: 25, fontWeight: 700, lineHeight: 1.15 }}>{t}</div>
        <div style={{ color: "#c4d5ef", fontSize: 17, fontWeight: 400, marginTop: 5, lineHeight: 1.3 }}>{d}</div>
      </div>
    </div>
  );
};

const Destino: React.FC<{ d: (typeof DESTINOS)[number]; i: number }> = ({ d, i }) => {
  const delay = 156 + i * 14;
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
        <div style={{ color: d.fg, fontSize: 30, fontWeight: 800, letterSpacing: "-0.01em" }}>{d.titulo}</div>
        <div style={{ display: "flex", gap: 18, alignItems: "baseline", marginTop: 8 }}>
          <div style={{ color: d.fg, fontSize: 27, fontWeight: 700 }}>{d.qtd}</div>
          <div style={{ color: d.fg, fontSize: 24, fontWeight: 600, opacity: 0.8 }}>{d.valor}</div>
        </div>
        <div style={{ color: d.sub, fontSize: 17, fontWeight: 500, marginTop: 8, lineHeight: 1.25 }}>{d.desc}</div>
      </div>
    </>
  );
};

export const S3Fluxo: React.FC = () => {
  const frame = useCurrentFrame();
  const head = useRise(2);
  const badge = useRise(10);
  const origem = useRise(26);
  const motor = useRise(44);
  const spine = interpolate(frame, [138, 158], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const spineTop = centerY(0);
  const spineH = centerY(3) - spineTop;

  return (
    <Frame inner={C.off} border={C.blue} dots={C.blue} pill={null}>
      {/* cabecalho */}
      <div style={{ position: "absolute", top: 72, left: 92, ...head }}>
        <Eyebrow color={C.blue}>O que entregamos</Eyebrow>
        <Title color={C.blue} size={56} style={{ marginTop: 14 }}>
          Uma peneira entre quem pede e quem assina
        </Title>
      </div>
      <Card bg={C.blue} style={{ position: "absolute", top: 66, right: 92, width: 330, padding: "20px 24px", ...badge }}>
        <div style={{ color: C.lima, fontSize: 52, fontWeight: 800, lineHeight: 1 }}>79%</div>
        <div style={{ color: C.white, fontSize: 17, fontWeight: 500, marginTop: 6, lineHeight: 1.3 }}>
          da fila nunca chega à mesa do diretor
        </div>
      </Card>

      {/* origem */}
      <Card
        bg={C.white}
        style={{
          position: "absolute", left: 92, top: 540, width: 250, padding: 24,
          border: `3px solid ${C.blue}`, ...origem,
        }}
      >
        <Eyebrow color={C.blue} style={{ fontSize: 15 }}>Solicitante</Eyebrow>
        <div style={{ color: C.blue, fontSize: 44, fontWeight: 800, marginTop: 10, lineHeight: 1 }}>1.071</div>
        <div style={{ color: "#3c4a5e", fontSize: 16, fontWeight: 500, marginTop: 6 }}>pedidos parados</div>
        <div style={{ color: C.red, fontSize: 22, fontWeight: 700, marginTop: 12 }}>R$ 64,8 mi</div>
      </Card>
      <Arrow x={356} y={630} w={78} color={C.blue} delay={38} />

      {/* motor */}
      <div
        style={{
          position: "absolute", left: 450, top: 300, width: 560, bottom: 120,
          backgroundColor: C.blue, borderRadius: 36, padding: 34,
          border: `4px solid ${C.lima}`, display: "flex", flexDirection: "column", ...motor,
        }}
      >
        <Eyebrow>Funcionário de IA</Eyebrow>
        <div style={{ color: C.white, fontSize: 46, fontWeight: 800, marginTop: 8, letterSpacing: "-0.02em" }}>
          Goworker
        </div>
        <div style={{ height: 3, backgroundColor: C.lima, borderRadius: 999, margin: "22px 0 26px", opacity: 0.5 }} />
        <div style={{ display: "flex", flexDirection: "column", gap: 24, flex: 1 }}>
          {PASSOS.map(([t, d], i) => (
            <Passo key={t} i={i} t={t} d={d} />
          ))}
        </div>
        <div
          style={{
            backgroundColor: C.lima, color: C.blue, borderRadius: 999, padding: "12px 22px",
            fontSize: 17, fontWeight: 700, textAlign: "center", marginTop: 20,
          }}
        >
          Uma decisão por pedido, todo dia, às 09h15
        </div>
      </div>

      {/* divisor */}
      <Arrow x={1016} y={630} w={40} color={C.blue} delay={128} thickness={5} />
      <div
        style={{
          position: "absolute", left: SPINE_X, top: spineTop + (spineH / 2) * (1 - spine),
          width: 5, height: spineH * spine, backgroundColor: C.blue, borderRadius: 999,
        }}
      />

      {/* destinos */}
      {DESTINOS.map((d, i) => (
        <Destino key={d.n} d={d} i={i} />
      ))}

      {/* rodape */}
      <div
        style={{
          position: "absolute", left: 92, bottom: 62, width: 310,
          color: C.blue, fontSize: 17, fontWeight: 500, lineHeight: 1.35,
        }}
      >
        Ele não aprova e não paga. O Art. 4 chama segregação de funções de regra inviolável.
      </div>
    </Frame>
  );
};
