# Goworker do Financeiro

**"Ele não decide pelo financeiro. Ele faz o financeiro decidir."**

Todos os números abaixo vêm da base real do GoService, snapshot de 18/09/2026:
18.926 registros de aprovação de pagamento, de 01/10/2025 a 18/09/2026.

---

## 1. Abertura: o número que dói

- **1.058 solicitações de pagamento estão paradas** aguardando aprovação.
- A mediana delas está parada há **91 dias**. A mais antiga, há **352 dias**.
- Quando alguém decide, decide rápido: mediana de **16,5 horas**, p90 de **121 horas**
  (base de 17.590 decisões com data).
- **A fila mediana está parada 18 vezes o p90.** Não é lentidão. É abandono.

## 2. O diagnóstico: por que ninguém decide

Entre tudo que já foi decidido, **99,15% foi "aprovado"** (17.709 contra 152 recusas).
A aprovação não é uma avaliação, é um carimbo. E existe uma razão material para isso.

**O aprovador decide sem saber quanto é.**

O registro de aprovação não carrega valor, vencimento, nota fiscal nem centro de custo.
Testamos: `get_payment_request` devolve nulo ou 403 para praticamente todo ticket sob o
perfil de leitura atual. O que o aprovador vê é uma linha de texto:

> `Solicitação de pagamento : Freedom Cosmeticos Ltda 53.402.541/0001-02`

Esse mesmo texto, byte a byte idêntico, aparece **480 vezes em 221 dias**.
O fornecedor TOTUS TUUS MARIAE: **579 vezes em 188 dias**.

Não dá para distinguir uma nota nova de uma repetida. Não dá para auditar.
Com essa informação, carimbar é a única jogada racional.

## 3. O que encontramos que ninguém estava vendo

| Achado | Quantidade | Por que importa |
|---|---|---|
| Fila zumbi (parada há mais de 45 dias) | **695 pedidos** | 66% da fila perdeu validade |
| Filas órfãs | **12 aprovadores, 41 pedidos** | Quem decide parou. `fernanda.alves` não decide nada há **225 dias** e segura 13 pedidos |
| Registros de teste em produção | **107** | "Teste de Automação (Não é um chamado real)" na fila real |
| Cadastro com documento inválido | **11** | Inclui `20.000.000/0000-00` (3x) e um CNPJ da SEFAZ digitado errado |
| Concentração | **joao.conde 184, edivar 131, joaquim 104** | 40% da fila em 3 pessoas |

Nenhuma dessas filas anda sozinha. Órfã não anda **nunca**: não adianta cobrar,
o dono da fila saiu do jogo.

## 4. O que o Goworker é

Um funcionário de IA que assume a **fila**, nunca a **assinatura**.

Ele roda todo dia, lê os 18.926 registros, e para cada pedido parado devolve uma ação:

| Ação | Hoje | O que significa |
|---|---|---|
| **CONFIRMAR** | 560 | Velho demais; reconfirmar com o solicitante ou encerrar |
| **LIBERAR** | 328 | Limpo, beneficiário recorrente: pronto para um clique humano |
| **ARQUIVAR** | 107 | Registro de teste, não é pedido real |
| **REDIRECIONAR** | 35 | O aprovador sumiu; precisa trocar o dono |
| **REVISAR** | 17 | Cadastro incompleto ou beneficiário sem histórico |
| **BLOQUEAR** | 11 | Documento inválido; corrigir antes de qualquer decisão |

**730 dos 1.058 pedidos (69%) não podem ser decididos do jeito que estão.**
O Goworker diz exatamente por quê, um a um, e monta o dossiê que o aprovador teria
que juntar na mão: histórico do beneficiário, pedidos com título idêntico, carga do
aprovador, trilha de auditoria.

## 5. O que ele não faz, de propósito

Este agente **não tem credencial de escrita no GLPI**. Não aprova, não recusa, não paga.
Isso não é limitação de tempo de hackathon: é desenho. Segregação de função é o controle
que o financeiro não pode perder, e um agente que assina cheque destrói esse controle.

O que ele faz é tirar do humano tudo que **não é** a decisão: achar, instruir, priorizar,
cobrar, rotear e registrar. O clique continua sendo de gente.

## 6. A métrica

Duas, ambas já mensuráveis nos dados que existem hoje:

1. **Tempo até a decisão**, antes e depois. Baseline medido: mediana 16,5h de quem decide,
   contra 91 dias de mediana na fila parada.
2. **Itens que chegam ao humano prontos para decidir**: 328 hoje, de 1.058.
   A meta é subir esse número sem baixar a qualidade da decisão.

## 7. O que destrava o próximo nível

Uma coisa só: **liberar a leitura dos campos financeiros no perfil do GoService**
(valor, vencimento, nota fiscal, centro de custo).

Com esses quatro campos, o Goworker passa a fazer o que hoje é impossível para qualquer
um, humano ou máquina: separar lote legítimo de nota duplicada, comparar valor contra o
histórico do fornecedor, e priorizar por dinheiro em risco em vez de por idade.

Sem eles, ninguém consegue. Com eles, o agente consegue no mesmo dia.

---

## O que está rodando

- App: https://goworker-financeiro.devgogroup.com
- Motor de regras: 9 regras calibradas contra 18.926 registros reais
- 6 ferramentas MCP em `/_mcp` (resumo, fila, dossiê, filas órfãs, gargalos, registrar decisão)
- Execução automática diária via cron
- 44 testes de integração, incluindo 3 que provam que não existe caminho de escrita no GoService
