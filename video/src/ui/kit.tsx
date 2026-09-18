import React from "react";
import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from "remotion";
import { C, FONT } from "../theme";

/** Entrada padrao: sobe e aparece. delay em frames. */
export const useRise = (delay = 0, distance = 28) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const s = spring({ frame: frame - delay, fps, config: { damping: 200 }, durationInFrames: 18 });
  return { opacity: s, transform: `translateY(${(1 - s) * distance}px)` };
};

/** Numero que conta ate o valor, com formatacao pt-BR. */
export const useCount = (to: number, delay = 0, frames = 30, decimals = 0) => {
  const frame = useCurrentFrame();
  const v = interpolate(frame, [delay, delay + frames], [0, to], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return v.toLocaleString("pt-BR", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
};

/** Moldura de janela do brandbook: borda lima por fora, slab por dentro. */
export const Frame: React.FC<{
  children: React.ReactNode;
  inner?: string;
  border?: string;
  pill?: string | null;
  dots?: string;
}> = ({ children, inner = C.blue, border = C.lima, pill = "CONSTRUINDO O FUTURO", dots = C.lima }) => (
  <AbsoluteFill style={{ backgroundColor: border, fontFamily: FONT, padding: 18 }}>
    <AbsoluteFill
      style={{
        top: 18, left: 18, right: 18, bottom: 18,
        backgroundColor: inner,
        borderRadius: 60,
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", top: 46, left: 56, display: "flex", gap: 14 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ width: 16, height: 16, borderRadius: 999, backgroundColor: dots }} />
        ))}
      </div>
      {pill ? (
        <div
          style={{
            position: "absolute", top: 38, right: 56,
            backgroundColor: C.lima, color: C.blue,
            borderRadius: 999, padding: "10px 26px",
            fontSize: 16, fontWeight: 600, letterSpacing: "0.16em",
          }}
        >
          {pill}
        </div>
      ) : null}
      {children}
    </AbsoluteFill>
  </AbsoluteFill>
);

export const Eyebrow: React.FC<{ children: React.ReactNode; color?: string; style?: React.CSSProperties }> = ({
  children, color = C.lima, style,
}) => (
  <div style={{ color, fontSize: 18, fontWeight: 600, letterSpacing: "0.16em", textTransform: "uppercase", ...style }}>
    {children}
  </div>
);

export const Title: React.FC<{ children: React.ReactNode; color?: string; size?: number; style?: React.CSSProperties }> = ({
  children, color = C.white, size = 62, style,
}) => (
  <div style={{ color, fontSize: size, fontWeight: 800, lineHeight: 1.06, letterSpacing: "-0.02em", ...style }}>
    {children}
  </div>
);

/** Card de conteudo. Raio 22 pelo DNA de layout. */
export const Card: React.FC<{
  children: React.ReactNode;
  bg?: string;
  style?: React.CSSProperties;
}> = ({ children, bg = C.white, style }) => (
  <div style={{ backgroundColor: bg, borderRadius: 22, padding: 26, ...style }}>{children}</div>
);

/** Numero grande + rotulo. O bloco que o CEO le primeiro. */
export const Stat: React.FC<{
  value: React.ReactNode;
  label: React.ReactNode;
  color?: string;
  labelColor?: string;
  size?: number;
}> = ({ value, label, color = C.lima, labelColor = C.white, size = 78 }) => (
  <div>
    <div style={{ color, fontSize: size, fontWeight: 800, lineHeight: 1, letterSpacing: "-0.03em" }}>{value}</div>
    <div style={{ color: labelColor, fontSize: 19, fontWeight: 500, marginTop: 10, lineHeight: 1.3 }}>{label}</div>
  </div>
);

/** Seta de fluxo com traco que anda: a direcao precisa ser obvia sem legenda. */
export const Arrow: React.FC<{
  x: number; y: number; w: number; color?: string; delay?: number; thickness?: number;
}> = ({ x, y, w, color = C.lima, delay = 0, thickness = 5 }) => {
  const frame = useCurrentFrame();
  const grow = interpolate(frame, [delay, delay + 14], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  const dash = -((frame - delay) * 1.6);
  return (
    <svg style={{ position: "absolute", left: x, top: y - 20, width: w, height: 40, overflow: "visible" }}>
      <line
        x1={0} y1={20} x2={w * grow - 14} y2={20}
        stroke={color} strokeWidth={thickness} strokeLinecap="round"
        strokeDasharray="14 12" strokeDashoffset={dash}
        opacity={grow}
      />
      <polygon
        points={`${w * grow},20 ${w * grow - 18},10 ${w * grow - 18},30`}
        fill={color} opacity={grow}
      />
    </svg>
  );
};
