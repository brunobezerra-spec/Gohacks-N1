# Deck em vídeo do Goworker do Financeiro

Apresentação de 3 minutos do projeto, em [Remotion](https://remotion.dev). 1920x1080 a 30fps,
no padrão visual do Brandbook Gogroup 2026.

## Rodar

```bash
npm install
npm run dev      # abre o Remotion Studio
npm run build    # bundle
npm run lint     # eslint + tsc
```

Renderizar o deck inteiro ou um slide isolado:

```bash
npx remotion render Deck out/goworker.mp4
npx remotion render Slide-3 out/slide3.png --frame=200
```

## Estrutura

| Arquivo | O que é |
|---|---|
| `src/theme.ts` | tokens da marca e a duração de cada slide. Não inventar cor nem fonte fora daqui |
| `src/Deck.tsx` | monta os 5 slides em sequência, com corte de 12 frames só em opacidade |
| `src/Root.tsx` | registra a composição `Deck` e uma por slide, para ensaiar isolado |
| `src/ui/kit.tsx` | componentes compartilhados |
| `src/slides/` | um arquivo por slide |

## Os cinco slides

| # | Slide | Duração |
|---|---|---|
| 1 | `S1Hook` | 25s |
| 2 | `S2Status` | 36s |
| 3 | `S3Fluxo` | 51s |
| 4 | `S4AntesDepois` | 36s |
| 5 | `S5Proximos` | 32s |

Cada slide também é uma composição própria (`Slide-1` a `Slide-5`), para ensaiar um só ou
exportar PNG dele sem renderizar o deck inteiro.

A transição entre slides é só opacidade, de propósito: a marca não usa transição decorada.
