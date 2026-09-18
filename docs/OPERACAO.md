# Operação

## Rodar local

```bash
cd goworker
npx esbuild src/server.ts --bundle --format=esm --platform=neutral --outfile=/tmp/bundle.js

node test/harness.mjs                        # 79 testes
node test/agente.mjs                         # 99 testes
node test/dashboard.mjs                      # 47 testes
node test/anexos.test.mjs                    # 22 testes

node src/run.js ../data/approvals_full.json  # motor no dataset completo
```

Não há `npm install`: o worker não tem dependência de runtime. O `esbuild` vem via `npx`.

Varredura de anexos fora do worker, contra o GLPI real:

```bash
GLPI_APP_TOKEN=... GLPI_USER_TOKEN=... node src/varrer-anexos.mjs [limite]
```

## Secrets

| Secret | Efeito se ausente |
|---|---|
| `GLPI_APP_TOKEN` | sem credencial: nenhuma chamada ao GoService |
| `GLPI_USER_TOKEN` | idem |
| `GLPI_MODO` | **modo ensaio**, que é o padrão seguro |
| `GLPI_PERFIL_ID` | sessão abre no perfil padrão do usuário, que não tem `READALL` |
| `GLPI_PILOTO_APROVADOR` | sem escopo de piloto: o agente age na fila inteira |
| `GLPI_TIPO` / `GLPI_MAX` | parâmetros do lote disparado pelo cron, que vem sem corpo |
| `OUTBOX_WEBHOOK_URL` | as ações ficam prontas na outbox e não são despachadas |

### Ensaio x executar

`GLPI_MODO` aceita `on`, `executar` ou `ligado`. Qualquer outro valor, inclusive ausente,
é **ensaio**: o agente monta a chamada inteira, valida a trava e não envia. O resultado
mostra o payload exato que sairia.

O valor esperado é `on`, e a razão é operacional: o secret aparece censurado nos logs da
plataforma, então com `GLPI_MODO=executar` toda mensagem do GLPI que contivesse a palavra
"executar" virava `[REDACTED]` e o log ficava ilegível.

### Perfil do GLPI

O agente precisa de um perfil próprio com **Ver: todos os chamados** (`READALL`, bit 1024 do
direito `ticket`). Sem ele o agente enxerga só os chamados dos grupos do usuário, que são
cerca de 7% da fila. `changeActiveProfile` troca o perfil ativo na sessão, então ninguém
precisa mexer no perfil padrão da pessoa e o perfil do agente fica visível na trilha.

Conferir com `goworker_diagnostico_de_perfil` ou `GET /api/diag`.

## Rotas

| Rota | Método | O que faz |
|---|---|---|
| `/api/health` | GET | vivo |
| `/api/ingest` | POST | recebe lote fresco e sobrepõe o snapshot embutido |
| `/api/run` | POST | roda a execução do agente sobre a fila |
| `/api/diag` | GET | perfil do GLPI, alcance, modo |
| `/api/summary` | GET | panorama da última execução |
| `/api/queue` `/api/item` | GET | fila triada e dossiê de um pedido |
| `/api/agente/resumo` `/fila` `/parecer` | GET | o que o agente decidiu |
| `/api/agente/outbox` | GET | ações emitidas |
| `/api/agente/despachar` | POST | entrega as ações prontas via webhook |
| `/api/agente/executar` | POST | **age no GoService** (ensaio por padrão) |
| `/api/agente/execucao` `/perfil` | GET | status da credencial e do modo |
| `/api/agente/lotes` | GET | lotes de contas a pagar montados |
| `/api/agente/hh` | GET/POST | lê ou ajusta as premissas de HH |
| `/api/lixeira` `/api/lixeira/restaurar` | GET/POST | lixeira restaurável |
| `/api/audit` | GET/POST | trilha de auditoria |
| `/_mcp` | POST | as 22 ferramentas MCP |

Cron diário às 09:15 UTC dispara `POST /api/run`. O cron chega sem corpo, então os
parâmetros do lote vêm dos secrets `GLPI_TIPO` e `GLPI_MAX`.

## Ferramentas MCP

22 ferramentas em `/_mcp`, agrupadas por uso:

**Diagnóstico da fila.** `goworker_resumo`, `goworker_fila`, `goworker_dossie`,
`goworker_gargalos`, `goworker_filas_orfas`.

**Análise histórica.** `goworker_auditoria_retroativa` (o que já foi aprovado com CNPJ que
reprova no dígito verificador), `goworker_motivos_de_recusa` (classifica o texto livre das
152 recusas), `goworker_tipos_de_alto_risco` (lift encolhido com prior bayesiano e p
ajustado por Bonferroni).

**O agente.** `goworker_agente_resumo`, `goworker_agente_fila`, `goworker_agente_parecer`,
`goworker_outbox`, `goworker_lotes_cap`, `goworker_regras`, `goworker_premissas_hh`.

**Ação.** `goworker_executar` (age no GoService), `goworker_despachar`,
`goworker_lixeira`, `goworker_restaurar_da_lixeira`, `goworker_registrar_decisao`.

**Estado.** `goworker_status_execucao`, `goworker_diagnostico_de_perfil`.

`goworker_registrar_decisao` grava apenas na trilha de auditoria interna, e o retorno diz
explicitamente que aprovar ou recusar no GoService continua manual.

## Ligar a execução com segurança

Ordem recomendada, uma etapa por vez:

1. `goworker_diagnostico_de_perfil`: confirmar que o agente enxerga todos os chamados.
2. `POST /api/run`: rodar a decisão e ler `goworker_agente_resumo`.
3. `goworker_executar` sem `GLPI_MODO`: ler o payload exato de cada chamada, em ensaio.
4. Setar `GLPI_PILOTO_APROVADOR` para um aprovador só, e `GLPI_MODO=on`.
5. Conferir o resultado no GoService, e só então tirar o piloto.

## Quando algo falha

| Sintoma | Causa | O que fazer |
|---|---|---|
| `sem_credencial` | falta `GLPI_APP_TOKEN` ou `GLPI_USER_TOKEN` | setar os secrets |
| tudo sai como `ensaio` | `GLPI_MODO` ausente ou com outro valor | `GLPI_MODO=on` |
| `fora_do_piloto` | `GLPI_PILOTO_APROVADOR` está setado | é esperado, tirar o piloto quando for a hora |
| `ja_decidida` | um humano decidiu depois do snapshot | é esperado, o agente pula sem escrever |
| `aprovacao_ilegivel` | perfil sem `READALL` ou validação apagada | `goworker_diagnostico_de_perfil` |
| `recusada_pela_trava` | payload com campo de veredito | é a trava funcionando, não corrigir por fora |
| agente vê ~7% da fila | perfil sem `READALL` | setar `GLPI_PERFIL_ID` para o perfil do agente |
