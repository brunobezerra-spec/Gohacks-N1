# Goworker do Financeiro

Funcionário de IA que é **dono do fluxo de pagamento** do Gogroup, entre o solicitante e o
diretor aprovador. Filtra o que não deve passar, corrige o que é corrigível, devolve o que
não é, e entrega ao aprovador só o que já está instruído. Depois de aprovado, monta o lote
de contas a pagar.

Ele **age sozinho** no GoService (GLPI): comenta, encerra, troca quem valida, abre chamado.
E **abre o documento anexado ao chamado** para conferir o valor contra a fonte, em vez de
contra o histórico. O que ele nunca faz é **assinar**. O Art. 4 da Política Corporativa de
Pagamentos chama segregação de funções de regra inviolável, e a trava que impede aprovar ou
recusar é estrutural, não uma escolha de runtime.

App: https://goworker-financeiro.devgogroup.com

| Documento | O que tem |
|---|---|
| [docs/ARQUITETURA.md](docs/ARQUITETURA.md) | módulo por módulo, camadas, fluxo de uma execução |
| [docs/OPERACAO.md](docs/OPERACAO.md) | rodar local, secrets, modos, rotas, ferramentas MCP |
| [CONFORMIDADE.md](CONFORMIDADE.md) | mapa artigo por artigo da Política e do Playbook Fiscal |
| [docs/HANDOFF-BRUNO-regras-sinais.md](docs/HANDOFF-BRUNO-regras-sinais.md) | revisão do CFO, sinal por sinal, com a decisão literal |
| [PITCH.md](PITCH.md) | a narrativa do projeto |

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

## O que o agente já executou

Execução de 18/09/2026, com credencial real e `GLPI_MODO=on`: **748 ações gravadas no
GoService**.

| Ato no GoService | Qtd | Base |
|---|---|---|
| Acompanhamento de recomendação de estorno | 427 | Art. 11 |
| Acompanhamento de alçada incorreta | 158 | Art. 7 |
| Notificação de juros e multa | 29 | Art. 12 |
| Devolução ao solicitante | 18 | Art. 5 e 6 |
| Solução registrada (encerra teste e Anexo II) | 109 | Anexo II |

Mais 593 pedidos movidos para a **lixeira interna**, que é restaurável e não toca o
GoService. 28 validações já tinham sido decididas por humanos depois do snapshot: o agente
detecta e pula, sem escrever.

## Conferência contra o documento

Até 18/09/2026 o agente validava o valor contra si mesmo e contra o histórico do fornecedor.
Isso responde "esse número é plausível?", nunca "esse número está certo?". A única fonte que
responde a segunda pergunta é o documento anexado ao chamado.

O agente abre o anexo, extrai valor, CNPJ do emitente e do destinatário, número e data, e
compara com o pedido. XML da NFe é lido direto; PDF passa por pdf.js. Dos 232 anexos medidos
em 18/09/2026, 210 são PDF.

Isso criou a única regra do motor que confere contra a **fonte**:
`VALOR_DIVERGE_DO_ANEXO`, severidade `TRAVA`, base Art. 6, ação `DEVOLVER`. Medido ao vivo:
**dos 8 chamados testados, 6 tinham o valor do pedido 100x o do anexo**. O caso extremo é o
pedido mais antigo da fila (chamado 6548): pede R$ 18.730.946,00 e o anexo diz R$ 187.309,46.

Três decisões de desenho que sustentam a regra:

1. **Anexo ilegível não levanta sinal.** O agente registra que não soube ler e segue.
   Devolver pedido bom por defeito de leitura é pior do que não conferir. PDF que é imagem
   (NFS-e de prefeitura escaneada) cai aqui, classificado como `sem_camada_de_texto`, nunca
   como divergência.
2. **Razão próxima de 10, 100 ou 1000 é casa decimal deslocada**, não divergência comercial,
   e a mensagem ao solicitante diz isso. Tolerância de 1 centavo para o resto.
3. **Perfil separado para ler.** O direito sobre `Document` não está no perfil com que o
   agente escreve (24): está no 16. A leitura abre sessão própria, troca de perfil e volta.
   Misturar os dois numa sessão só daria ao executor mais direito do que ele precisa.

Há uma **lista branca de leitura** com duas entradas, na mesma disciplina da lista de
escrita: `GET /Ticket/{id}/Document_Item/` e `GET /Document/{id}`. O agente lê, extrai campos
e compara. Não executa nada que venha do anexo e não escreve no documento.

## As sete ações do agente

Lista fechada. Nenhuma delas aprova ou recusa.

| Ação | Dono | O que vira no GoService |
|---|---|---|
| `ENCERRAR` | agente | `POST /ITILSolution/` |
| `ARQUIVAR_NA_LIXEIRA` | agente | nada, é interno e restaurável |
| `DEVOLVER` | solicitante | `POST /ITILFollowup/` |
| `ROTEAR` | aprovador certo | `PUT /TicketValidation/{id}`, só o campo `users_id_validate` |
| `CORRIGIR_E_ENCAMINHAR` | agente | patch de cadastro + acompanhamento |
| `RECOMENDAR_ESTORNO` | contas a pagar | `POST /ITILFollowup/` |
| `ENCAMINHAR` | aprovador | segue limpo para o clique humano |

## Segregação de função, por desenho

O agente tem credencial de escrita. As travas não dependem disso:

1. **Lista branca de endpoints** (`src/glpi.ts`). Quatro entradas: `POST /ITILFollowup/`,
   `POST /ITILSolution/`, `PUT /TicketValidation/{id}`, `POST /Ticket/`. Qualquer outro
   método ou caminho é recusado antes de virar requisição. `PUT /Ticket/{id}` funciona com
   essa credencial e está **fora** da lista de propósito: mudar status de chamado não é ato
   do agente.
2. **Trava de veredito** (`assertNaoEhAprovacao`). Um `PUT` em `TicketValidation` que
   carregue `status`, `is_approved`, `comment_validation`, `validation_date` ou
   `users_id_approval` é recusado. Só passa `users_id_validate`, que muda **quem** valida,
   nunca o veredito.
3. **Lista fechada de ações** (`src/outbox.ts`). Não existe caminho de código, nem com
   webhook configurado, que emita um ato de aprovação.
4. **Modo ensaio é o padrão.** Sem `GLPI_MODO`, tudo roda em ensaio: monta a chamada
   inteira, valida a trava, e não envia. Ligar é decisão explícita.
5. **Escopo de piloto.** `GLPI_PILOTO_APROVADOR` limita a ação à fila de um aprovador só.

A leitura de anexo tem lista branca própria (duas entradas, só `GET`) e sessão separada, com
o perfil de documento em vez do perfil de escrita.

## Camadas

```
src/engine.ts     higiene de dado: o que o histórico mostra (sem dependências)
src/regras.ts     registro de sinais: quais existem, severidade, ação disparada
src/policy.ts     norma: o que a Política de Pagamentos manda, artigo citado
src/agent.ts      decisão e execução: o que o agente faz, sozinho
src/glpi.ts       executor: a decisão vira ato no GoService, com as travas
src/anexos.ts     lê o anexo do chamado e confere valor, CNPJ e data contra o pedido
src/pdf.ts        PDF para texto via pdf.js, e classifica o que não deu para ler
src/outbox.ts     lista fechada de tipos de ação
src/server.ts     worker: rotas HTTP + env.DB + 22 ferramentas MCP
public/index.html dashboard operacional
```

Dados de referência, todos com data e evidência: `aprovadores.ts` (nível por login),
`hierarquia.ts` (a quem cada um reporta), `teamguide.ts` (situação de emprego),
`snapshot.ts` (18.926 registros dicionário-codificados, 5,66 MB → 0,99 MB).

## Testes

```bash
cd goworker
npm install
npx esbuild src/server.ts --bundle --format=esm --platform=neutral --outfile=/tmp/bundle.js
node test/harness.mjs      # 79  motor, política, travas do bundle publicado
node test/agente.mjs       # 99  decisão, execução, GLPI mockado
node test/dashboard.mjs    # 47  DOM real, acentuação, sem "undefined" na tela
node test/anexos.test.mjs  # 23  extração de campos, conferência, anexo ilegível
node test/pdf.test.mjs     #  5  classificação do PDF: lido x sem camada de texto
```

**251 testes, 249 passando.** As duas falhas estão em `harness.mjs`, na seção 8, e **nenhuma
delas é regressão de segurança**: as onze asserções que provam as travas continuam passando.

| Teste falhando | Por quê |
|---|---|
| `snapshot isolado antes da checagem` | asserta que remover o snapshot corta mais de 50% do bundle. Com o pdf.js dentro, o snapshot deixou de ser metade do bundle |
| `um unico host externo, o proprio GoService` | o pdf.js carrega URLs de namespace XML como string (`w3.org`, `ns.adobe.com`, `xfa.org`). São constantes, não chamadas |

As duas asseguram propriedades do **bundle**, não do agente, e as duas premissas quebraram
ao embutir o pdf.js. Corrigir é ajustar a lista de exceções do harness.

## Limites declarados

1. **Roteamento de alçada para quem.** O agente calcula o **nível** exigido pelo Art. 7,
   mas o perfil dele não lê usuários no GLPI e não existe mapa área → gestor. Então ele
   escreve no chamado qual é a alçada correta e por quê, e a reatribuição continua humana.
2. **Duplicidade não é detectável hoje.** Dos 112 grupos históricos submetidos no mesmo
   segundo e já decididos, 108 tiveram todos os irmãos aprovados: são lotes de notas, não
   duplicatas. `LOTE_AMBIGUO` é informativa e nunca bloqueia.
3. **Campos financeiros parciais.** `get_payment_request` devolve nulo/403 sob o perfil de
   serviço. O valor vem do título e do anexo, quando existe anexo legível.
4. **A fila não é conferida numa execução só.** O Worker corta em cerca de 50 subrequests
   por invocação, e um chamado com 4 anexos custa 5. O lote para sozinho em 45 e varre a
   fila ao longo de vários ticks, **o mais caro primeiro**.
5. **PDF que é imagem não é lido.** NFS-e de prefeitura escaneada volta como
   `sem_camada_de_texto` e o pedido segue sem conferência. Resolver exige OCR, que não está
   no escopo.
6. **Ingestão manual.** O worker não alcança o MCP do GoService. `POST /api/ingest` aceita
   lotes frescos e sobrepõe o snapshot embutido.
7. **Premissas de HH não são medição.** Os minutos por ação em `HH_PADRAO` são estimativa,
   a única parte do sistema que não sai do dado. Calibrar com o time de CAP antes de usar
   como número oficial.

## Conteúdo do repositório

```
goworker/   o agente: motor, executor, worker, dashboard, testes
data/       snapshots do GoService, Teamguide e tabelas mestre (Anexo I e II)
docs/       handoff do CFO, arquitetura, operação
video/      deck de 5 slides para apresentar ao vivo, e o render em vídeo
```

O deploy sobe um **bundle pré-montado** (`goworker/dist/server.js`), não o código-fonte
solto: o bundler do GoDeploy não conclui com o pdf.js na árvore de dependência. O comando
está em [docs/OPERACAO.md](docs/OPERACAO.md). O `dist/` fica fora do versionamento porque o
build é reprodutível byte a byte.

**`data/` contém dado interno real** (nomes, estrutura organizacional, alçadas, valores e
tickets do GoService). O repositório é privado por causa disso. Não tornar público sem
anonimizar.
