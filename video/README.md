# Deck: Goworker do Financeiro

Deck de 5 slides em Remotion, para apresentar ao vivo em ~3 minutos.
1920x1080, padrão de marca Gogroup.

```bash
npm run deck          # abre o deck em http://localhost:5188 — é isso que você apresenta
npm run deck:build    # deck estático em dist-deck/ (pode abrir em qualquer máquina)
```

**Teclas:** `→` avança · `←` volta · `R` repete a animação de entrada ·
`F` tela cheia · `1`-`5` pula para o slide. Clicar na tela também avança.
A barra de navegação some sozinha depois de 2,5 s.

Cada slide monta seus elementos em ~2 a 4 s ao chegar nele, e depois fica parado.

## Slides

| # | conteúdo |
|---|---|
| 1 | Hook: transformar o financeiro em IA First |
| 2 | Status: a aprovação de pagamento virou carimbo |
| 3 | O que o Goworker faz — fluxo e os 4 destinos |
| 4 | Antes x depois no GoService |
| 5 | Resultados e próximos passos |

## Outros formatos (opcional)

```bash
npm run studio                                  # editor do Remotion
npm run render                                  # MP4 de 3 min (out/)
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
src/theme.ts        cores da marca, fonte, duração de cada slide
src/fonts.ts        Poppins via delayRender (sem isso o fallback Arial passa calado)
src/ui/kit.tsx      moldura de janela, cards, stats, setas de fluxo
src/slides/         um arquivo por slide
src/deck/           o apresentador (Remotion Player + teclado)
src/Root.tsx        composições para render de vídeo e PNG
```
