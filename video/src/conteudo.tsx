import React, { createContext, useCallback, useContext, useMemo, useState } from "react";
import bruto from "./conteudo.json";
import { C } from "./theme";

export type Doc = typeof bruto;

/** Lê "s3.destinos.0.titulo" dentro do documento. */
export const ler = (doc: any, caminho: string) =>
  caminho.split(".").reduce((o: any, k) => (o == null ? o : o[k]), doc);

const gravar = (doc: any, caminho: string, valor: unknown) => {
  const partes = caminho.split(".");
  const copia = structuredClone(doc);
  let no = copia;
  for (const k of partes.slice(0, -1)) no = no[k];
  no[partes[partes.length - 1]] = valor;
  return copia;
};

type Estado = { doc: Doc; editando: boolean; set: (caminho: string, valor: unknown) => void };

// Sem provider (render de vídeo e PNG) o deck usa o JSON do disco e nada é editável.
const Ctx = createContext<Estado>({ doc: bruto, editando: false, set: () => {} });

export const useC = () => useContext(Ctx).doc;
export const useEdicao = () => useContext(Ctx);

export const ConteudoProvider: React.FC<{ editando: boolean; children: React.ReactNode }> = ({
  editando,
  children,
}) => {
  const [doc, setDoc] = useState<Doc>(bruto);
  const [erro, setErro] = useState<string | null>(null);

  const set = useCallback((caminho: string, valor: unknown) => {
    setDoc((atual) => {
      const novo = gravar(atual, caminho, valor);
      // Só o servidor de desenvolvimento grava em disco. No build estático,
      // a edição vive na sessão e some no reload — melhor dizer isso na cara.
      if (import.meta.env.DEV) {
        fetch("/api/conteudo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(novo),
        }).catch((e) => setErro(String(e)));
      } else {
        setErro("Build estático: a edição não é salva. Use npm run deck.");
      }
      return novo;
    });
  }, []);

  const v = useMemo(() => ({ doc, editando, set }), [doc, editando, set]);
  return (
    <Ctx.Provider value={v}>
      {children}
      {erro ? (
        <div
          style={{
            position: "fixed", bottom: 52, left: 22, backgroundColor: C.red, color: C.white,
            padding: "8px 14px", borderRadius: 999, fontSize: 13, fontWeight: 600, zIndex: 50,
          }}
        >
          {erro}
        </div>
      ) : null}
    </Ctx.Provider>
  );
};

const editavel = (editando: boolean): React.CSSProperties =>
  editando
    ? {
        // Fundo claro por baixo: o tracejado rosa some sobre o card vermelho.
        outline: `2px dashed ${C.pink}`,
        outlineOffset: 3,
        backgroundColor: "rgba(255,255,255,0.3)",
        borderRadius: 4,
        cursor: "text",
        minWidth: 24,
      }
    : {};

/** Texto do slide. Em modo de edição vira campo; ao sair do campo, grava. */
export const T: React.FC<{
  p: string;
  style?: React.CSSProperties;
  bloco?: boolean;
}> = ({ p, style, bloco }) => {
  const { doc, editando, set } = useEdicao();
  const texto = String(ler(doc, p) ?? "");
  const Tag = (bloco ? "div" : "span") as "div";
  return (
    <Tag
      style={{ ...style, ...editavel(editando) }}
      contentEditable={editando}
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => {
        const novo = e.currentTarget.textContent ?? "";
        if (novo !== texto) set(p, novo);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
    >
      {texto}
    </Tag>
  );
};

/** Número que conta na apresentação e vira campo na edição. */
export const TNum: React.FC<{
  p: string;
  render: (n: number) => React.ReactNode;
  style?: React.CSSProperties;
}> = ({ p, render, style }) => {
  const { doc, editando, set } = useEdicao();
  const n = Number(ler(doc, p) ?? 0);
  if (!editando) return <span style={style}>{render(n)}</span>;
  return (
    <span
      style={{ ...style, ...editavel(true) }}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onBlur={(e) => {
        const bruto2 = (e.currentTarget.textContent ?? "").replace(",", ".").replace(/[^\d.-]/g, "");
        const v = Number(bruto2);
        if (Number.isFinite(v) && v !== n) set(p, v);
        else e.currentTarget.textContent = String(n);
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          (e.currentTarget as HTMLElement).blur();
        }
      }}
    >
      {n}
    </span>
  );
};
