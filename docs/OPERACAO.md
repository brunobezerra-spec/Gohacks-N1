# Operação

## Rodar local

```bash
cd goworker
npm install
npx esbuild src/server.ts --bundle --format=esm --platform=neutral --outfile=/tmp/bundle.js

node test/harness.mjs        # 79 testes, 2 falhando (ver README)
node test/agente.mjs         # 99 testes
node test/dashboard.mjs      # 47 testes
node test/anexos.test.mjs    # 23 testes
node test/pdf.test.mjs       #  5 testes
```

`npm install` passou a ser necessário quando o `unpdf` entrou. Antes disso o worker não
tinha dependência de runtime.

Varredura de anexos fora do worker, contra o GLPI real:

```bash
GLPI_APP_TOKEN=... GLPI_USER_TOKEN=... node src/varrer-anexos.mjs [limite]
```

**`node src/run.js` não funciona hoje.** O Node só remove tipos, não resolve import sem
extensão, e `engine.ts` importa `./regras`. Para rodar o motor sobre um dataset inteiro,
empacotar `test/lib-entry.ts` com o esbuild e importar o bundle.

## Build e deploy

O deploy sobe um bundle pré-montado, não o código-fonte solto:

```bash
cd goworker
npx esbuild src/server.ts --bundle --format=esm --platform=neutral --minify \
  --outfile=dist/server.js
```

O motivo é o pdf.js: medido em 18/09/2026, o bundler do GoDeploy não conclui com ele na
árvore de dependência (morre sem resposta; o mesmo conjunto sem ele publica em segundos).
Pré-bundlar resolve sem abrir mão da cobertura de leitura de PDF.

`dist/` fica fora do versionamento: o build é reprodutível byte a byte a partir do fonte.

## Secrets

| Secret | Efeito se ausente |
|---|---|
| `GLPI_APP_TOKEN` | sem credencial: nenhuma chamada ao GoService |
| `GLPI_USER_TOKEN` | idem |
| `GLPI_MODO` | **modo ensaio**, que é o padrão seguro |
| `GLPI_PERFIL_ID` | sessão abre no perfil padrão do usuário, que não tem `READALL` |
| `GLPI_PILOTO_APROVADOR` | sem escopo de piloto: o agente age na fila inteira |
| `GLPI_CONFERIR_ANEXO` | conferência de anexo **ligada** (padrão `on`); `off` desliga sem deploy |
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

### Perfis: dois, não um

| Perfil | Para que | Quem usa |
|---|---|---|
| 24 | escrever no chamado, com `READALL` | o executor (`glpi.ts`) |
| 16 | ler `Document`, o anexo | a conferência (`anexos.ts`) |

O direito sobre `Document` não está no perfil 24 nem no Financeiro_tech (9). A conferência
abre **sessão própria**, troca para o 16 e encerra no fim. Misturar os dois numa sessão só
daria ao executor mais direito do que ele precisa.

Se a troca de perfil falhar, a conferência devolve `sem_perfil_16` e o agente segue sem
conferir, em vez de tratar o pedido como divergente.

### Conferência de anexo

Roda dentro de `POST /api/run`, antes da decisão. Varre a fila **do mais caro para o mais
barato** e para em 45 subrequests, porque o Worker corta em cerca de 50 por invocação e um
chamado com 4 anexos custa 5. A fila inteira é varrida ao longo de vários ticks do cron.

O resumo por execução traz `conferidos`, `divergentes`, `ilegiveis`, `semAnexo`,
`naoLocalizado` e `parou`. **`ilegiveis` não é erro**: é o agente dizendo que não soube ler,
e nesse caso ele não levanta sinal nenhum.

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
| `pulado: sem_perfil_16` | credencial sem direito sobre `Document` | liberar o perfil 16 para o usuário do agente |
| `pulado: desligado` | `GLPI_CONFERIR_ANEXO=off` | tirar o secret |
| `ilegivel (...:sem_camada_de_texto)` | PDF é imagem escaneada | esperado, exigiria OCR. O agente não levanta sinal |
| `ilegivel (...:pdf_invalido)` | download falhou ou buffer reusado | conferir se o WAF devolveu 403 por User-Agent |
| `parou: true` no resumo | teto de 45 subrequests | esperado, o resto entra no próximo tick |
| conferência 403 em tudo | WAF do GoService | o cliente precisa mandar User-Agent de cliente conhecido |
