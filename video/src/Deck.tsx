import React from "react";
import { AbsoluteFill, interpolate, Sequence, useCurrentFrame } from "remotion";
import "./fonts";
import { C, DUR, START } from "./theme";
import { S1Hook } from "./slides/S1Hook";
import { S2Status } from "./slides/S2Status";
import { S3Fluxo } from "./slides/S3Fluxo";
import { S4AntesDepois } from "./slides/S4AntesDepois";
import { S5Proximos } from "./slides/S5Proximos";

const SLIDES = [S1Hook, S2Status, S3Fluxo, S4AntesDepois, S5Proximos];
const CROSS = 12; // frames de transicao entre slides

/** Corte curto no fim de cada slide. Sem efeito, so opacidade: a marca nao usa transicao decorada. */
const Cut: React.FC<{ dur: number; children: React.ReactNode }> = ({ dur, children }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, CROSS, dur - CROSS, dur], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  return <AbsoluteFill style={{ opacity }}>{children}</AbsoluteFill>;
};

export const Deck: React.FC = () => (
  <AbsoluteFill style={{ backgroundColor: C.blue }}>
    {SLIDES.map((S, i) => (
      <Sequence key={i} from={START[i]} durationInFrames={DUR[i]}>
        <Cut dur={DUR[i]}>
          <S />
        </Cut>
      </Sequence>
    ))}
  </AbsoluteFill>
);
