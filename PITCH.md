# Goworker do Financeiro

**"Ele não decide pelo financeiro. Ele faz o financeiro decidir."**

App no ar: https://goworker-financeiro.devgogroup.com

Base: GoService/GLPI real. Snapshot de 18/09/2026 com **18.926 registros** de aprovação de
pagamento, de 01/10/2025 a 18/09/2026. Todo número deste documento foi verificado duas vezes:
pelo motor e por um auditor independente que reconsultou o GoService sem passar pelos meus
arquivos.

---

## 1. O gancho

- **1.058 solicitações de pagamento paradas.** Descontando 106 tickets de teste e 24 que não
  são pedido de dinheiro, a fila real é de **929**.
- Mediana parada há **91 dias**. A mais antiga, há **352**.
- Quem decide, decide em **16,5 horas** (mediana).
- **Apenas 28 de 17.590 decisões (0,16%) levaram mais de 91 dias.** A mediana da fila parada
  é mais lenta que 99,84% de tudo que a empresa já decidiu. Isso não é lentidão, é abandono.

E o resultado de quem decide: **99,15% virou "aprovado"** (17.709 contra 152 recusas).
Não é avaliação, é carimbo.

## 2. Por que o carimbo existe

**O aprovador decide sem saber quanto é.**

O registro de aprovação não carrega valor, vencimento, nota fiscal nem centro de custo.
O auditor testou 7 tickets: todos voltam `found: false`. `list_payment_requests` reporta 4
e devolve array vazio. **Zero tickets financeiros legíveis.**

O que o aprovador vê é uma linha de texto:

> `Solicitação de pagamento : Freedom Cosmeticos Ltda 53.402.541/0001-02`

Esse texto aparece **1.106 vezes byte a byte idêntico**. TOTUS TUUS MARIAE: 584 pedidos em 7
grafias, **304 deles byte a byte idênticos**. Não há campo legível que distinga um do outro.

Com essa informação, carimbar é a jogada racional. O problema não é a pessoa.

A prova de que o carimbo é real: **131 tickets de teste existem na base e 23 já foram
aprovados** — incluindo títulos que dizem literalmente "Não é um chamado real".

## 3. A ambição

**Nenhum real sai do Gogroup sem passar por uma checagem de máquina antes de passar por uma
assinatura humana.**

Aprovação hoje é lenta *e* permissiva ao mesmo tempo, o pior dos dois mundos. A ambição não é
acelerar o carimbo: é inverter o ônus da prova. A máquina carrega a conferência; o humano só
olha o que exige julgamento.

*Honestidade:* só a fila do financeiro está medida. Estender às outras filas de aprovação do
Gogroup é tese, não dado.

**Conformidade:** o agente foi construído contra a Política Corporativa de Pagamentos
(rev. 01, 01/07/2025) e o Playbook Fiscal gobeaute, artigo por artigo. O mapa completo está
em `CONFORMIDADE.md`, incluindo um conflito normativo que precisa de decisão humana: a
Política manda pagar nos dias 10/20/30, o playbook fiscal descreve quartas e sextas.

## 4. O que a PoC achou

| Achado | Quantidade | Por que importa |
|---|---|---|
| **Cadastros inválidos já pagos** | **37 cadastros, 162 pagamentos** | CNPJ/CPF que reprova no dígito verificador. 7 cadastros concentram 132 dos 162 |
| Fila zumbi (parada > 45 dias) | 695 | 66% da fila perdeu validade |
| Filas órfãs | 15 aprovadores, 44 pedidos | `fernanda.alves` não decide há **225 dias** e segura 13 |
| Autoaprovação | 7 na fila, 27 no total | Mesma pessoa pede e aprova. `antonio.mendes` em 3 pedidos da Unixlog |
| Nome não bate com o CNPJ | 11 | `ONFLY TECNOLOGIA` num CNPJ cujo histórico inteiro é de uma pessoa física |
| Tickets de teste | 106 na fila, **23 já aprovados** | Aprovaram ticket que diz não ser um chamado real |

### O caso que fecha o argumento: SEFAZ de São Paulo

O mesmo órgão aparece na base com **três grafias de CNPJ**:

| CNPJ | Dígito verificador | Usos | Já aprovados |
|---|---|---|---|
| `46.377.222/0001-29` | **válido** | 9 | 9 |
| `46.377.222/0001-57` | **INVÁLIDO** | 60 | 59 |
| `46.377.222/0001-55` | **INVÁLIDO** | 31 | 29 |

A grafia certa foi usada 9 vezes; as erradas, 91. **88 pagamentos aprovados contra um CNPJ
que não passa no módulo 11.** Refaça a conta no palco.

**Ressalva que eu levanto antes do júri:** SEFAZ, Corpo de Bombeiros e afins somam **122 dos
162** e se pagam por guia com código de barras, não por TED para o CNPJ. Ali o risco é fiscal
e de conciliação, não de desvio. Nos outros **~40**, o CNPJ é destino de dinheiro. A correção
custa **37 edições de cadastro**, não 162.

## 5. O que o Goworker faz

Ele é o **dono do fluxo de pagamento**, entre o solicitante e o diretor aprovador.
Todo dia lê a base inteira e toma **uma decisão por pedido**. Não sugere: decide e executa.

| Ação do agente | Hoje | Quem fica com a bola |
|---|---|---|
| **ENCAMINHAR** | 491 | aprovador — instruído, com dossiê e alçada conferida |
| **RECOMENDAR_ESTORNO** | 383 | contas a pagar — Art. 11, parado há mais de 120 dias |
| **ENCERRAR** | 119 | ninguém — teste, despesa pré-aprovada ou intercompany |
| **DEVOLVER** | 57 | solicitante — com a mensagem já escrita |
| **CORRIGIR_E_ENCAMINHAR** | 8 | agente — ele conserta e o pedido segue |

**559 pedidos (53%) nunca chegam a consumir tempo de diretor.**
E ele emitiu **621 ações concretas** nesta execução: 440 mensagens redigidas,
32 reroteamentos por alçada, 26 notificações de penalidade, 4 correções de cadastro
aplicadas sozinho, 119 encerramentos.

### Ele escreve, com nome e artigo

Devolução real gerada pelo agente, para um solicitante nominal:

> **Para:** rogerio.azbuy
> **Assunto:** [Goworker] Pedido #12634 devolvido para ajuste
>
> A solicitação de pagamento #12634 não pode seguir para aprovação ainda. Encontrei 2 pontos que preciso que você ajuste:
>
> 1. Você informou o CNPJ de AZBUY COMERCIO LTDA, que é uma empresa do nosso grupo, no campo do fornecedor. Corrija para o CNPJ real de "Receita Federal".
>    Base: Política Corporativa de Pagamentos, Anexo I.
> 2. Este pagamento tem juros ou multa. Registre a justificativa do atraso e a área responsável antes de seguir.
>    Base: Política Corporativa de Pagamentos, Art. 12.
>
> *Esta mensagem foi gerada e enviada por um agente. A decisão de aprovar ou recusar continua sendo humana.*

### Ele conhece a alçada

Cruzando o Art. 7 com o cargo real de 36 aprovadores no Teamguide:
**6 aprovadores são analista ou coordenador e não têm alçada nenhuma pela política.**
Um deles é o mesmo `antonio.mendes` que aparece se autoaprovando — e é estagiário de FP&A.

### Ele já entrega contas a pagar pronto

Para os 491 que passarem na aprovação, o agente já montou o lote:
data de pagamento pelo ciclo do Art. 9 (dias 10, 20 e 30), respeitando os 5 dias úteis
do Art. 8 (2 de lançamento fiscal + 3 de programação), forma PIX do Art. 10.
O CAP não digita: confere e libera.

**Horas de trabalho humano substituídas nesta execução: 321h.** Esse é o único número
do projeto que não sai do dado — são premissas de minutos por atividade, declaradas e
editáveis via API e MCP. Calibrar com o time de CAP antes de virar número oficial.

## 6. O que ele não faz, de propósito

**Não aprova, não recusa, não paga.** A lista de ações que ele consegue emitir é **fechada
em 7 tipos**, e a trava recusa qualquer ato de aprovação *antes* de qualquer chamada de rede.
O despacho só sai para o webhook configurado em runtime, nunca para uma URL fixa.

Isso é desenho, não falta de tempo. O **Art. 4 da Política chama segregação de funções de
regra inviolável**. Um agente que assina destrói exatamente o controle que ele existe para
proteger. Ele tira do humano tudo que não é a decisão; a decisão continua humana.

## 7. A pergunta difícil, respondida antes de ser feita

> *"Rodando suas regras para trás contra os 17.590 pedidos já decididos, quantas das 152
> recusas elas teriam antecipado?"*

**5. Recall de 3,3%, precisão de 2,06%.** Como preditor de recusa, o motor é ruim.
E eu vou além: **nenhum sinal de fila sobrevive à correção de Bonferroni** (fila zumbi tem
2 recusas em 38, ticket de teste 2 em 25 — p ajustado 0,55 e 0,26). Os únicos que sobrevivem
são os três da seção 5, que são justamente os que ordenam a fila.
E não é escolha de teste severo: Holm e Benjamini-Hochberg reprovam os dois sinais
igualmente (0,26 no melhor caso).

Isso não é defeito escondido, é a tese: **"recusado" não é gabarito.** Numa base onde 99,15%
das decisões são "aprovar", o rótulo mede o que o carimbo deixou passar, não o que deveria ter
sido questionado. A prova: **163 pedidos com documento inválido foram decididos e exatamente
1 foi recusado** — 0,61%, *abaixo* da média da empresa de 0,85%. Um CNPJ que não fecha no
módulo 11 tinha menos chance de ser barrado que um pedido qualquer.

O Goworker não prevê a opinião de ninguém. Ele mede o que é verdade independente de opinião.

### O que os aprovadores escreveram ao recusar

As 152 recusas têm **100% de motivo registrado em texto livre**. Lendo todas:

| Motivo | Recusas | Detectável hoje? |
|---|---|---|
| valor errado | 17 | **não** — precisa do valor |
| nota fiscal ou documento | 14 | **não** — precisa da NF |
| centro de custo errado | 13 | **não** — precisa do centro de custo |
| duplicidade | 10 | **não** — precisa de valor e nota |
| refazer o pedido | 12 | sim |
| aprovador errado | 7 | sim |
| cadastro do fornecedor | 5 | sim |
| é ticket de teste | 4 | sim |

**54 das 152 recusas só aconteceram porque um humano enxergou um campo que o agente não pode
ler.** Essa tabela é a prova da seção 8.

## 8. O plano

Tudo depende de **um destravamento, e ele não é técnico**.

**Fase 1 (semanas 1-2): liberar os quatro campos.** Leitura de valor, vencimento, nota fiscal
e centro de custo no perfil de serviço, mais credencial de leitura para ingestão automática
(hoje `POST /api/ingest` é manual). Dono: TI + Financeiro. Custo: permissão, não código.
*Gate:* o agente prioriza por dinheiro em risco e separa lote de duplicata — hoje impossível,
porque dos 112 grupos históricos submetidos no mesmo segundo, **108 tiveram todos os irmãos
aprovados**. São lotes de notas, não duplicatas, e sem valor ninguém separa os dois.

**Fase 2 (semanas 3-6): fechar o loop sem cruzar a linha.** Deep link do dossiê para a tela de
decisão do GLPI. O clique continua humano; a credencial de escrita continua não existindo.
*Gate:* mediana da fila abaixo de 15 dias e taxa de recusa que pareça avaliação, não carimbo.

**Fase 3 (semanas 7-10): controle preventivo.** Validar documento na entrada do formulário, não
auditar na saída. *Gate:* zero pedidos novos com documento inválido; as 9 grafias conflitantes
consolidadas.

**Fase 4: a segunda fila.** O motor é puro e sem dependências; o que muda é o parser de título
e o conjunto de regras. A tese da seção 3 vira dado ou morre aqui.

**Como julgar:** mediana de dias parados, taxa de recusa entre decididos, pagamentos aprovados
com documento inválido por mês, e pedidos que chegam à mesa humana já com dossiê. Nenhum deles
é "quantidade de pedidos processados".

---

## Roteiro de demo (4 minutos)

1. Console do agente: 621 ações emitidas, 53% da fila resolvida sem consumir diretor.
2. Tabela da SEFAZ: três grafias, duas inválidas, 88 aprovados. Refazer o módulo 11 ao vivo.
3. Tabela dos 152 motivos de recusa: 54 dependem de campos que o agente não pode ler.
4. Abrir o parecer do agente na autoaprovação do `antonio.mendes`: violação do Art. 4, a
   mensagem que ele escreveu, e o fato de que quem aprovava não tinha alçada.
5. `/_mcp`: perguntar ao Claude "como está a fila do financeiro" e ele responde pelo agente.

## O que está rodando

- Motor de política com os artigos da Política de Pagamentos codificados, mais 14 regras de
  higiene de dado calibradas contra 18.926 registros
- Auditoria retroativa de documentos inválidos já aprovados e taxonomia dos 152 motivos de recusa
- 16 ferramentas MCP em `/_mcp`, execução automática diária via cron
- **172 testes** (69 de integração + 62 do agente + 41 de dashboard em DOM real), incluindo
  a trava que prova que nenhum ato de aprovação atravessa a outbox

## Como este pitch foi checado

Três agentes adversariais rodaram contra o trabalho e mudaram o resultado:

1. **Auditor independente** reconsultou o GoService direto, corrigiu a contagem de pendentes e
   achou a terceira grafia do CNPJ da SEFAZ.
2. **Red team do motor** derrubou a regra que liberava `ONFLY TECNOLOGIA` num CNPJ cujo
   histórico era de outra pessoa, e a que marcava um fornecedor real como ticket de teste por
   ter "automação" no nome.
3. **Red team do pitch** pegou três erros que teriam custado a apresentação: o "579 byte a byte"
   que eram 304, os dois sinais estatisticamente mortos que eu defendia, e o campo
   `commentValidation` com 3.323 registros preenchidos que o motor carregava e ignorava.

Duas hipóteses minhas foram **refutadas pelos próprios dados e removidas**: detecção de
duplicata por título idêntico e por submissão no mesmo segundo. As duas pareciam ótimas no
slide e eram falsas.
