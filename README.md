# Goworker do Financeiro

Funcionário de IA que é **dono do fluxo de pagamento** do Gogroup, entre o solicitante e o
diretor aprovador. Filtra o que não deve passar, corrige o que é corrigível, devolve o que
não é, e entrega ao aprovador só o que já está instruído. Depois de aprovado, monta o lote
de contas a pagar.

Nunca assume a **assinatura**: o Art. 4 da Política Corporativa de Pagamentos chama
segregação de funções de regra inviolável.

Mapa de conformidade artigo por artigo: [CONFORMIDADE.md](CONFORMIDADE.md).

App: https://goworker-financeiro.devgogroup.com

## O problema, medido

Snapshot de 18/09/2026, 18.926 registros de aprovação (01/10/2025 → 18/09/2026):

| | |
|---|---|
| Pedidos parados | **1.058** |
| Mediana de tempo parado | **91 dias** (mais antigo: 352) |
| Mediana histórica para decidir | **16,5 h** (p90: 121 h) |
| Taxa de aprovação entre decididos | **99,15%** (17.709 × 152 recusas) |
| Decisões que levaram mais de 91 dias | **28 de 17.590 (0,16%)** |

A aprovação virou carimbo porque o registro é cego: o aprovador não vê valor,
vencimento, nota fiscal nem centro de custo. Vê uma linha de texto que se repete
idêntica centenas de vezes (Freedom Cosméticos: 1.106 pedidos com título byte-a-byte
igual). Prova de que o carimbo é real: 131 tickets de teste na base, 23 já aprovados.

## O que o agente entrega

Uma ação por pedido parado, com o dossiê que sustenta a recomendação:

| Ação | Qtd | Regra |
|---|---|---|
| CONFIRMAR | 534 | parado > 45d, reconfirmar ou encerrar |
| LIBERAR | 319 | limpo, pronto para o clique humano |
| ARQUIVAR | 106 | registro de teste em produção |
| REDIRECIONAR | 35 | aprovador inativo > 90d segurando fila |
| REVISAR | 36 | pendência de cadastro (beneficiário novo, sem identificação, nome divergente) |
| BLOQUEAR | 28 | documento inválido, autoaprovação ou beneficiário trocado |

## Arquitetura

```
src/engine.ts    motor puro, sem dependências (13 regras + baselines + parser de título)
src/snapshot.ts  18.926 registros dicionário-codificados (5,66 MB → 0,99 MB)
src/server.ts    worker: rotas HTTP + env.DB + 7 ferramentas MCP
src/mcp/         shim do GoDeploy, byte-exato
public/index.html dashboard operacional
test/harness.mjs 57 testes de integração contra SQLite real
```

Rotas: `/api/health` `/api/ingest` `/api/run` `/api/diag` `/api/summary`
`/api/queue` `/api/item` `/api/audit` `/_mcp`

Cron diário às 09:15 UTC dispara `POST /api/run`.

## Segregação de função (por desenho, não por falta de tempo)

O app **não tem credencial de escrita no GLPI**. Seis testes do harness provam
que não existe caminho de escrita no bundle publicado: nenhuma referência a
`review_approval`, nenhum endpoint GLPI no código executável, nenhuma URL externa, e
**nenhuma chamada a `fetch()` em lugar nenhum** (a única ocorrência é a declaração do
handler do Worker). O snapshot é isolado antes da checagem, porque é dado e pode conter
qualquer palavra escrita por um usuário no GLPI.

`goworker_registrar_decisao` grava apenas na trilha de auditoria interna, e o retorno
diz explicitamente que a ação no GoService continua manual.

## Limites declarados

1. **Campos financeiros indisponíveis.** `get_payment_request` devolve nulo/403 sob o
   perfil de serviço atual. Nenhuma regra fala de dinheiro. Liberar valor, vencimento,
   nota fiscal e centro de custo é o único destravamento necessário para o nível 2.
2. **Duplicidade não é detectável hoje.** Testamos: dos 112 grupos históricos submetidos
   no mesmo segundo e já decididos, 108 tiveram todos os irmãos aprovados. São lotes de
   notas, não duplicatas. Sem valor e número de nota, ninguém separa os dois — por isso
   a regra `LOTE_AMBIGUO` é informativa e nunca bloqueia.
3. **Ingestão manual.** O worker não alcança o MCP do GoService (sem credencial).
   `POST /api/ingest` aceita lotes frescos e sobrepõe o snapshot embutido.

## Rodar local

```bash
cd goworker
npx esbuild src/server.ts --bundle --format=esm --platform=neutral --outfile=/tmp/bundle.js
node test/harness.mjs                                    # 57 testes
node src/run.js ../data/approvals_full.json              # motor no dataset completo
```
