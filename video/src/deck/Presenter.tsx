import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Player, type PlayerRef } from "@remotion/player";
import { AbsoluteFill } from "remotion";
import "../fonts";
import { ConteudoProvider } from "../conteudo";
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
// No arquivo .html não há servidor para gravar: editar é coisa do npm run deck.
const EDITAVEL = import.meta.env.DEV;

const CHAVE = "deck.slide";
const CHAVE_EDIT = "deck.editando";

// Aberto direto do arquivo (file://) o sessionStorage pode simplesmente lançar.
const lerSessao = (k: string) => {
  // Só em dev: o .html é para apresentar e sempre abre no slide 1.
  if (!EDITAVEL) return null;
  try {
    return sessionStorage.getItem(k);
  } catch {
    return null;
  }
};
const gravarSessao = (k: string, v: string) => {
  if (!EDITAVEL) return;
  try {
    sessionStorage.setItem(k, v);
  } catch {
    /* sem persistência: o deck funciona igual */
  }
};

const Stage: React.FC<{ index: number }> = ({ index }) => {
  const S = SLIDES[index] ?? SLIDES[0];
  return (
    <AbsoluteFill style={{ backgroundColor: C.blue }}>
      <S />
    </AbsoluteFill>
  );
};

export const Presenter: React.FC = () => {
  // O slide atual sobrevive ao reload que o Vite faz quando o texto é salvo.
  const [i, setI] = useState(() => Number(lerSessao(CHAVE) ?? 0));
  const [nonce, setNonce] = useState(0);
  // Salvar o texto faz o Vite recarregar a página: o modo edição precisa voltar junto.
  const [editando, setEditando] = useState(() => lerSessao(CHAVE_EDIT) === "1");
  const [ui, setUi] = useState(true);
  const player = useRef<PlayerRef>(null);

  useEffect(() => {
    gravarSessao(CHAVE, String(i));
  }, [i]);

  useEffect(() => {
    gravarSessao(CHAVE_EDIT, editando ? "1" : "0");
  }, [editando]);

  const ir = useCallback((n: number) => {
    setI((cur) => {
      const alvo = Math.min(SLIDES.length - 1, Math.max(0, n));
      if (alvo !== cur) setNonce((x) => x + 1);
      return alvo;
    });
  }, []);

  // Editar exige o slide montado: o player pausa no último frame.
  useEffect(() => {
    const p = player.current;
    if (!p) return;
    if (editando) {
      p.pause();
      p.seekTo(DUR[i] - 1);
    } else {
      p.seekTo(0);
      p.play();
    }
  }, [editando, i, nonce]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const alvo = e.target as HTMLElement | null;
      const digitando = alvo?.isContentEditable;
      if (e.key === "Escape") {
        (alvo as HTMLElement)?.blur?.();
        setEditando(false);
        return;
      }
      if (digitando) return; // no campo, o teclado é do texto
      const k = e.key;
      if ((k === "e" || k === "E") && EDITAVEL) {
        e.preventDefault();
        setEditando((v) => !v);
      } else if (k === "ArrowRight" || k === "PageDown" || k === " " || k === "Enter") {
        e.preventDefault();
        ir(i + 1);
      } else if (k === "ArrowLeft" || k === "PageUp" || k === "Backspace") {
        e.preventDefault();
        ir(i - 1);
      } else if (k === "r" || k === "R") {
        setNonce((x) => x + 1);
      } else if (k === "f" || k === "F") {
        player.current?.requestFullscreen();
      } else if (/^[1-9]$/.test(k)) {
        ir(Number(k) - 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, ir]);

  // A barra de navegação some sozinha: não pode cobrir o slide.
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
  const mostrarUi = ui || editando;

  return (
    <ConteudoProvider editando={editando}>
      <div
        style={{
          position: "fixed", inset: 0, backgroundColor: C.blue, fontFamily: FONT,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
        onClick={(e) => {
          // Em edição o clique é para escolher o texto, nunca para avançar.
          if (editando) return;
          if ((e.target as HTMLElement).closest("[data-nav]")) return;
          ir(i + 1);
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
          autoPlay={!editando}
          controls={false}
          clickToPlay={false}
          doubleClickToFullscreen={!editando}
          style={{ width: "100vw", height: "100vh" }}
        />

        {editando ? (
          <div
            data-nav
            style={{
              position: "fixed", top: 14, left: "50%", transform: "translateX(-50%)",
              backgroundColor: C.pink, color: C.white, borderRadius: 999,
              padding: "9px 22px", fontSize: 14, fontWeight: 700, zIndex: 40,
            }}
          >
            Modo edição · clique no texto, digite, clique fora para salvar · ESC sai
          </div>
        ) : null}

        <div
          data-nav
          style={{
            position: "fixed", bottom: 16, right: 22, display: "flex",
            alignItems: "center", gap: 12, pointerEvents: "none",
            opacity: mostrarUi ? 1 : 0, transition: "opacity 400ms",
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

        <div
          data-nav
          style={{
            position: "fixed", bottom: 16, left: 22, color: "rgba(255,255,255,0.6)",
            fontSize: 13, fontWeight: 500, pointerEvents: "none",
            opacity: mostrarUi ? 1 : 0, transition: "opacity 400ms",
          }}
        >
          → avança · ← volta{EDITAVEL ? " · E edita o texto" : ""} · R repete a entrada · F tela cheia · 1-5 pula
        </div>
      </div>
    </ConteudoProvider>
  );
};
