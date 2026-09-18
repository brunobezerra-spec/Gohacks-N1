# Arquitetura

Um Cloudflare Worker, sem framework, sem dependência de runtime. O motor é JS puro e roda
igual em Node e no Worker, o que permite testar o comportamento real contra o bundle
publicado em vez de contra o código-fonte.

## A separação que sustenta tudo

Quatro camadas, e cada uma responde uma pergunta diferente. A regra é não misturar:

| Camada | Arquivo | Pergunta que responde |
|---|---|---|
| Dado | `engine.ts` | o que o histórico mostra sobre este pedido? |
| Registro de sinais | `regras.ts` | este sinal existe, está ligado, e que severidade tem? |
| Norma | `policy.ts` | o que a Política de Pagamentos manda, citando o artigo? |
| Decisão e execução | `agent.ts` | o que o agente faz, sozinho? |
| Ato | `glpi.ts` | como isso vira escrita no GoService, sem furar a trava? |

`engine.ts` só **detecta**. Quem diz o que fazer com o achado é `regras.ts`. Quem diz o que
a norma exige é `policy.ts`. Quem decide a ação é `agent.ts`. Quem escreve é `glpi.ts`, e só
ele fala com a rede.

## Módulos

### `engine.ts` (872 linhas)
Higiene de dado. Normalização de fornecedor (remove acentos, sufixos societários e ruído),
dígito verificador de CNPJ e CPF, parser do título do pedido, baselines por fornecedor e
por tipo, detecção de registro de teste, agrupamento de lote. Sem dependências: importa
apenas `regras.ts` e `teamguide.ts`.

### `regras.ts` (167 linhas)
Fonte única de quais sinais existem. Cada entrada tem `ativo`, `severidade`
(`TRAVA` | `RESSALVA` | `ARQUIVAR`), a base normativa e o **texto literal de quem revisou**,
sem paráfrase. Origem: handoff do CFO de 18/09/2026 sobre a execução #22.

Sinais desligados na revisão continuam no arquivo, com o motivo escrito. `BENEFICIARIO_NOVO`,
`BENEFICIARIO_ALTA_RECUSA`, `SEGREGACAO_DE_FUNCOES` e `SEM_DOCUMENTACAO_DE_SUPORTE` estão
`ativo: false`. `DUPLICIDADE_JA_APROVADA` foi rebaixada de trava para ressalva porque não
prova duplicidade.

`janelaDias` é o prazo em que um sinal vira devolução ao solicitante em vez de continuar
sinalizado.

### `policy.ts` (302 linhas)
Só entra o que a Política manda, com o artigo citado na linha. Contém o `ANEXO_I` (40 CNPJs
das empresas do grupo), a tabela de alçadas do Art. 7 (≤20k Gerente, 20-50k Diretor, >50k
Sócio), o cálculo de dias úteis com feriados nacionais do Art. 8, os ciclos de pagamento do
Art. 9 e o prazo de estorno do Art. 11.

### `agent.ts` (527 linhas)
Decide uma das sete ações por pedido e redige a mensagem. `montarContexto` agrega o
histórico; `processar` decide um pedido; `processarFila` roda o lote; `montarPlanoCAP` e
`montarLotesCAP` montam o lote de contas a pagar no ciclo certo; `redigirDevolucao` e
`redigirNotificacaoPenalidade` escrevem o texto que vai ao chamado, com a base legal.

`HH_PADRAO` estima os minutos de trabalho humano que cada ação substitui. É premissa, não
medição, e está marcado como tal no código.

### `glpi.ts` (299 linhas)
O executor. Sessão por `App-Token` + `user_token`, `changeActiveProfile` para o perfil do
agente (o único com `READALL`, bit 1024 do direito `ticket`), `killSession` no `finally`.

Duas travas:

- `ESCRITA_PERMITIDA`: lista branca de quatro pares método + caminho. Tudo fora é recusado
  antes de virar requisição.
- `assertNaoEhAprovacao`: recusa qualquer `PUT` em `TicketValidation` que carregue campo de
  veredito.

Detalhe do GLPI que custou tempo e está documentado no código: `GET /TicketValidation/{id}`
devolve 403 com este perfil, mas a **coleção** filtrada por `searchText[id]` devolve o
registro. O perfil enxerga por listagem, não por item.

O encerramento é idempotente: "o item já está solucionado" conta como entregue, porque o
objetivo foi alcançado. Sem isso, ids já fechados voltavam em todo lote e travavam a fila
atrás deles.

### `anexos.ts` (416 linhas)
Abre o documento anexado ao chamado e confere contra o pedido. O XML da NFe carrega `vNF`,
CNPJ do emitente e do destinatário, número e data: é a única fonte que responde "esse número
está certo?", em vez de só "esse número é plausível?".

Mesma disciplina de `glpi.ts`, virada para leitura: lista branca de leitura, o agente extrai
campos e compara, não executa nada que venha do anexo e não escreve no documento.

### `outbox.ts` (73 linhas)
A lista fechada de tipos de ação. Garantia estrutural: o agente só consegue emitir o que
está aqui, e nada aqui aprova ou recusa.

### `server.ts` (1024 linhas)
Roteador HTTP, persistência em `env.DB` e as 22 ferramentas MCP. `runAgent` é o pipeline de
uma execução. `executarNoGlpi` é o único ponto que chama o executor.

### Dados de referência
Arquivos gerados, com data e evidência por linha, nunca chute:

- `aprovadores.ts`: nível hierárquico por login. Quem não foi encontrado fica
  `DESCONHECIDO`, e o agente não acusa alçada insuficiente sem evidência.
- `hierarquia.ts`: a quem cada aprovador reporta. Serve só para a mensagem sugerir um
  caminho. Não resolve alçada sozinho: o Art. 7 fala da alçada da **área demandante**, que
  pode ser outra.
- `teamguide.ts`: situação de emprego. `list_employees` devolve só ativos, então "não achei"
  nunca virou desligado. Todo `ativo: false` tem data de desligamento explícita.
- `snapshot.ts`: 18.926 registros dicionário-codificados, 5,66 MB → 0,99 MB.

## Fluxo de uma execução

```
POST /api/run
  1. loadAll        lê o snapshot embutido ou o lote ingerido por /api/ingest
  2. buildContext   agrega histórico por fornecedor, tipo e aprovador
  3. processarFila  para cada pendente:
       engine       detecta sinais
       regras       filtra os desligados, aplica severidade e janela
       policy       avalia artigo por artigo
       agent        unifica achados, decide UMA ação, redige a mensagem
  4. lixeira        regra 1: fila zumbi sai da base. Quem um humano já restaurou
                    nunca volta sozinho
  5. outbox         a ação vira ordem, na lista fechada de tipos
  6. auditoria      grava em env.DB
```

A execução para aqui. Escrever no GoService é uma chamada separada e explícita
(`POST /api/agente/executar`), que por padrão roda em ensaio.

## Por que testar contra o bundle

`test/harness.mjs` roda `esbuild` e verifica o **bundle publicado**, não o código-fonte:
que endpoints aparecem, que URLs externas existem, onde há `fetch()`. O snapshot é isolado
antes da checagem, porque é dado e pode conter qualquer palavra que um usuário escreveu no
GLPI. Uma trava que existe só no fonte não prova nada sobre o que foi publicado.
