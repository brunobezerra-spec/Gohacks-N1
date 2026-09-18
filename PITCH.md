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

Assume a **fila**, nunca a **assinatura**. Roda todo dia e devolve uma ação por pedido parado:

| Ação | Hoje | O que significa |
|---|---|---|
| **CONFIRMAR** | 534 | Velho demais; reconfirmar ou encerrar |
| **LIBERAR** | 319 | Limpo, com dossiê pronto para um clique |
| **ARQUIVAR** | 106 | Ticket de teste, não é pedido real |
| **REVISAR** | 36 | Pendência de cadastro antes de decidir |
| **REDIRECIONAR** | 35 | O aprovador sumiu; trocar o dono da fila |
| **BLOQUEAR** | 28 | Documento inválido, autoaprovação ou beneficiário trocado |

**425 pedidos (40%) saem da fila sem consumir julgamento humano.**
**99 mudam de destino em vez de virar carimbo.**
**739 (70%) não podem ser decididos como estão** — e o agente diz por quê, um a um.

### Como ele ordena, já que não existe valor em reais

A classe do pedido é o único proxy de materialidade que sobrevive à correção de Bonferroni
para 13 comparações:

| Classe | Decididos | Recusados | Lift bruto | Lift encolhido | p ajustado |
|---|---|---|---|---|---|
| `novo_servico` | 18 | 4 | 26,1× | **7,6×** | 1,9e-4 |
| `compra` | 286 | 11 | 4,5× | **4,0×** | 5,6e-4 |
| `estorno` | 974 | 21 | 2,5× | **2,5×** | 1,8e-3 |

O lift encolhido usa prior bayesiano de 50 observações: 26× vindo de 18 casos não é 26×.
A prioridade (0 a 100) combina gravidade do achado, esse lift e, por último, idade.
**Ordenar só por idade, como estava antes do red team, era pior.**

## 6. O que ele não faz, de propósito

**Não tem credencial de escrita no GLPI. Não chama `fetch()` em lugar nenhum.**
Não aprova, não recusa, não paga. Isso é desenho, não falta de tempo: segregação de função é
o controle que o financeiro não pode perder, e um agente que assina cheque destrói esse
controle. Seis testes automatizados provam que não há caminho de escrita no bundle publicado.

## 7. A pergunta difícil, respondida antes de ser feita

> *"Rodando suas regras para trás contra os 17.590 pedidos já decididos, quantas das 152
> recusas elas teriam antecipado?"*

**5. Recall de 3,3%, precisão de 2,06%.** Como preditor de recusa, o motor é ruim.
E eu vou além: **nenhum sinal de fila sobrevive à correção de Bonferroni** (fila zumbi tem
2 recusas em 38, ticket de teste 2 em 25 — p ajustado 0,55 e 0,26). Os únicos que sobrevivem
são os três da seção 5, que são justamente os que ordenam a fila.

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

1. Dashboard: 1.058 parados, mediana 91 dias, 37 cadastros inválidos pagos 162 vezes.
2. Tabela da SEFAZ: três grafias, duas inválidas, 88 aprovados. Refazer o módulo 11 ao vivo.
3. Tabela dos 152 motivos de recusa: 54 dependem de campos que o agente não pode ler.
4. Filtrar BLOQUEAR e abrir o dossiê da autoaprovação do `antonio.mendes`.
5. `/_mcp`: perguntar ao Claude "como está a fila do financeiro" e ele responde pelo agente.

## O que está rodando

- Motor de 14 regras + priorização com encolhimento bayesiano, calibrado contra 18.926 registros
- Auditoria retroativa de documentos inválidos já aprovados e taxonomia dos 152 motivos de recusa
- 9 ferramentas MCP em `/_mcp`, execução automática diária via cron
- **94 testes** (67 de integração + 27 de dashboard em DOM real), incluindo 6 de segregação de
  função e 11 de regressão dos achados do red team

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
