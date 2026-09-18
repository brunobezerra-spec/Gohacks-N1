import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AbsoluteFill } from "remotion";
import "../fonts";
import { C, DUR, FONT, FPS } from "../theme";
import { S1Hook } from "../slides/S1Hook";
import { S2Status } from "../slides/S2Status";
import { S3Fluxo } from "../slides/S3Fluxo";
import { S4AntesDepois } from "../slides/S4AntesDepois";
import { S5Proximos } from "../slides/S5Proximos";

const SLIDES = [S1Hook, S2Status, S3Fluxo, S4AntesDepois, S5Proximos];
const TITULOS = [
  "Financeiro IA First",
  "A aprovação virou carimbo",
  "O que o Goworker faz",
  "Antes x depois",
  "Resultados e próximos passos",
];

/** Um slide inteiro como composicao. As animacoes de entrada tocam ao chegar nele. */
const Stage: React.FC<{ index: number }> = ({ index }) => {
  const S = SLIDES[index] ?? SLIDES[0];
  return (
    <AbsoluteFill style={{ backgroundColor: C.blue }}>
      <S />
    </AbsoluteFill>
  );
};

export const Presenter: React.FC = () => {
  const [i, setI] = useState(0);
  const [nonce, setNonce] = useState(0); // remonta o Player para repetir a entrada
  const [dica, setDica] = useState(true);
  const [ui, setUi] = useState(true); // navegacao some sozinha: nao pode cobrir o slide
  const player = useRef<PlayerRef>(null);

  const ir = useCallback((n: number) => {
    setI((cur) => {
      const alvo = Math.min(SLIDES.length - 1, Math.max(0, n));
      if (alvo !== cur) setNonce((x) => x + 1);
      return alvo;
    });
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const k = e.key;
      if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") {
        e.preventDefault();
        setDica(false);
        setI((c) => {
          const n = Math.min(SLIDES.length - 1, c + 1);
          if (n !== c) setNonce((x) => x + 1);
          return n;
        });
      } else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") {
        e.preventDefault();
        setDica(false);
        setI((c) => {
          const n = Math.max(0, c - 1);
          if (n !== c) setNonce((x) => x + 1);
          return n;
        });
      } else if (k === "r" || k === "R") {
        setNonce((x) => x + 1);
      } else if (k === "f" || k === "F") {
        player.current?.requestFullscreen();
      } else if (/^[1-9]$/.test(k)) {
        setDica(false);
        ir(Number(k) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ir]);

  // A barra de navegacao reaparece ao mexer o mouse ou teclar, e some em 2,5 s.
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const acorda = () => {
      setUi(true);
      clearTimeout(t);
      t = setTimeout(() => setUi(false), 2500);
    };
    acorda();
    window.addEventListener("mousemove", acorda);
    window.addEventListener("keydown", acorda);
    return () => {
      clearTimeout(t);
      window.removeEventListener("mousemove", acorda);
      window.removeEventListener("keydown", acorda);
    };
  }, [i]);

  const inputProps = useMemo(() => ({ index: i }), [i]);

  return (
    <div
      style={{
        position: "fixed", inset: 0, backgroundColor: C.blue, fontFamily: FONT,
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={() => {
        setDica(false);
        setI((c) => {
          const n = Math.min(SLIDES.length - 1, c + 1);
          if (n !== c) setNonce((x) => x + 1);
          return n;
        });
      }}
    >
      <Player
        key={`${i}-${nonce}`}
        ref={player}
        component={Stage}
        inputProps={inputProps}
        durationInFrames={DUR[i]}
        compositionWidth={1920}
        compositionHeight={1080}
        fps={FPS}
        autoPlay
        controls={false}
        clickToPlay={false}
        doubleClickToFullscreen
        style={{ width: "100vw", height: "100vh" }}
      />

      {/* navegacao discreta, fora do slide */}
      <div
        style={{
          position: "fixed", bottom: 16, right: 22, display: "flex",
          alignItems: "center", gap: 12, pointerEvents: "none",
          opacity: ui ? 1 : 0, transition: "opacity 400ms",
        }}
      >
        <div style={{ display: "flex", gap: 7 }}>
          {SLIDES.map((_, n) => (
            <div
              key={n}
              style={{
                width: 9, height: 9, borderRadius: 999,
                backgroundColor: n === i ? C.lima : "rgba(255,255,255,0.35)",
              }}
            />
          ))}
        </div>
        <div style={{ color: "rgba(255,255,255,0.6)", fontSize: 13, fontWeight: 600 }}>
          {i + 1}/{SLIDES.length} · {TITULOS[i]}
        </div>
      </div>

      {dica ? (
        <div
          style={{
            position: "fixed", bottom: 16, left: 22, color: "rgba(255,255,255,0.6)",
            fontSize: 13, fontWeight: 500, pointerEvents: "none",
            opacity: ui ? 1 : 0, transition: "opacity 400ms",
          }}
        >
          → avança · ← volta · R repete a entrada · F tela cheia · 1-5 pula
        </div>
      ) : null}
    </div>
  );
};
