# Deck: Goworker do Financeiro

Deck de 5 slides em Remotion, para apresentar ao vivo em ~3 minutos.
1920x1080, padrão de marca Gogroup.

```bash
npm run deck          # abre o deck em http://localhost:5188 — é isso que você apresenta e edita
```

**Teclas:** `→` avança · `←` volta · `E` edita · `R` repete a animação de entrada ·
`F` tela cheia · `1`-`5` pula · `ESC` sai da edição. Clicar na tela também avança.
A barra de navegação some sozinha depois de 2,5 s.

## Editar o texto

Duas formas, e as duas mexem no mesmo lugar (`src/conteudo.json`):

1. **No próprio deck.** Aperte `E`. Cada texto ganha contorno rosa: clique, digite,
   clique fora. Salva em disco na hora. `ESC` volta a apresentar.
2. **No arquivo.** Edite `src/conteudo.json` no editor com o deck aberto ao lado:
   ele recarrega sozinho e mantém o slide em que você estava.

O que **não** é editável pelo texto, de propósito: cores, tipografia, posição dos
blocos e o tempo de cada slide. Cor de card e fonte vêm da marca (`src/theme.ts`),
não do conteúdo — assim ninguém sai do brandbook editando um slide às pressas.
Layout novo é código, em `src/slides/`.

## Slides

| # | conteúdo | chave no JSON |
|---|---|---|
| 1 | Hook: transformar o financeiro em IA First | `s1` |
| 2 | Status: a aprovação de pagamento virou carimbo | `s2` |
| 3 | O que o Goworker faz — fluxo e os 4 destinos | `s3` |
| 4 | Antes x depois no GoService | `s4` |
| 5 | Resultados e próximos passos | `s5` |

## Outros formatos (opcional)

```bash
npm run deck:build                                       # deck estático em dist-deck/ (sem edição)
npm run studio                                           # editor do Remotion
npm run render                                           # MP4 de 3 min (out/)
npx remotion still Slide-3 out/slide-3.png --frame=400   # PNG de um slide
```

## De onde vem cada número

Rodando `enrich → analyze → processarFila` do `goworker/` sobre o snapshot de
18/09/2026 (18.966 registros), mais os commits de execução real:

- 1.071 pendentes · R$ 64,8 mi parados (946 pedidos com valor legível)
- Destinos: encaminhar 222 · rotear 125 · devolver 18 · descartar 706 (593 lixeira + 113 encerrar)
- 849 pedidos (79%) não consomem aprovador
- 748 ações gravadas no GoService (commit `3929290`); 234 roteamentos por alçada

## Estrutura

```
src/conteudo.json   TODO o texto e os números do deck
src/conteudo.tsx    provider de edição: <T> (texto) e <TNum> (número que conta)
src/theme.ts        cores da marca, fonte, duração de cada slide
src/fonts.ts        Poppins via delayRender (sem isso o fallback Arial passa calado)
src/ui/kit.tsx      moldura de janela, cards, stats, setas de fluxo
src/slides/         um arquivo por slide, só layout
src/deck/           o apresentador (Remotion Player + teclado + modo edição)
src/Root.tsx        composições para render de vídeo e PNG
vite.config.ts      grava /api/conteudo de volta em src/conteudo.json (só em dev)
```
