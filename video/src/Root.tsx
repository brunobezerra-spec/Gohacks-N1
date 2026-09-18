import React from "react";
import { AbsoluteFill, Composition } from "remotion";
import "./index.css";
import "./fonts";
import { Deck } from "./Deck";
import { C, DUR, FPS, TOTAL } from "./theme";
import { S1Hook } from "./slides/S1Hook";
import { S2Status } from "./slides/S2Status";
import { S3Fluxo } from "./slides/S3Fluxo";
import { S4AntesDepois } from "./slides/S4AntesDepois";
import { S5Proximos } from "./slides/S5Proximos";

const SLIDES = [S1Hook, S2Status, S3Fluxo, S4AntesDepois, S5Proximos];

export const RemotionRoot: React.FC = () => (
  <>
    <Composition id="Deck" component={Deck} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} />
    {/* Uma composicao por slide: ensaiar um slide so, ou exportar PNG dele. */}
    {SLIDES.map((S, i) => (
      <Composition
        key={i}
        id={`Slide-${i + 1}`}
        component={() => (
          <AbsoluteFill style={{ backgroundColor: C.blue }}>
            <S />
          </AbsoluteFill>
        )}
        durationInFrames={DUR[i]}
        fps={FPS}
        width={1920}
        height={1080}
      />
    ))}
  </>
);
