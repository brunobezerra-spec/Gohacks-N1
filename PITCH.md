# Goworker do Financeiro

**"Ele não decide pelo financeiro. Ele faz o financeiro decidir."**

App no ar: https://goworker-financeiro.devgogroup.com

Base: GoService/GLPI real, snapshot de 18/09/2026. 18.926 registros de aprovação de
pagamento, de 01/10/2025 a 18/09/2026. Todos os números foram reconferidos por uma
auditoria independente que consultou o GoService direto, sem passar pelos meus arquivos.

---

## 1. Abertura

- **1.058 solicitações de pagamento paradas** aguardando aprovação.
- Mediana parada há **91 dias**. A mais antiga, há **352 dias**.
- Quem decide, decide rápido: mediana de **16,5 horas**, p90 de **121 horas**
  (17.590 decisões com data).
- **A fila mediana está parada 18× o p90.** Isso não é lentidão, é abandono.

## 2. Por que ninguém decide

**99,15% de tudo que foi decidido virou "aprovado"** (17.709 contra 152 recusas).
Não é avaliação, é carimbo. E há uma razão material para isso.

**O aprovador decide sem saber quanto é.**

O registro de aprovação não carrega valor, vencimento, nota fiscal nem centro de custo.
A auditoria independente testou 7 tickets diferentes: todos voltam
`found: false`. `list_payment_requests` reporta 4 tickets e devolve array vazio.
**Zero tickets financeiros legíveis.**

O que o aprovador vê é uma linha de texto:

> `Solicitação de pagamento : Freedom Cosmeticos Ltda 53.402.541/0001-02`

Esse texto, byte a byte idêntico, aparece **1.106 vezes**. TOTUS TUUS MARIAE: **579 vezes**.
Não há como distinguir um pedido do outro por nenhum campo legível.

Com essa informação, carimbar é a jogada racional. O problema não é a pessoa.

## 3. O que achamos que ninguém estava vendo

| Achado | Quantidade | Por que importa |
|---|---|---|
| **Pagamentos já aprovados com documento inválido** | **162** | Dinheiro que já saiu contra CNPJ/CPF que reprova no dígito verificador (149 CNPJ + 14 CPF, 1 único recusado) |
| Fila zumbi (parada > 45 dias) | 695 | 66% da fila perdeu validade |
| Filas órfãs | 15 aprovadores, 44 pedidos | `fernanda.alves` não decide há **225 dias** e segura 13 |
| Registros de teste em produção | 106 | "Teste de Automação (Não é um chamado real)" na fila real |
| Autoaprovação | 7 | Mesma pessoa pede e aprova. `antonio.mendes` em 3 pedidos da Unixlog |
| Nome não bate com o CNPJ | 11 | Ex.: `ONFLY TECNOLOGIA` num CNPJ cujo histórico inteiro é de uma pessoa física |

### O caso que fecha o argumento: SEFAZ de São Paulo

O mesmo órgão aparece na base com **três grafias de CNPJ**:

| CNPJ | Dígito verificador | Usos | Já aprovados |
|---|---|---|---|
| `46.377.222/0001-29` | **válido** | 9 | 9 |
| `46.377.222/0001-57` | **INVÁLIDO** | 60 | 59 |
| `46.377.222/0001-55` | **INVÁLIDO** | 31 | 29 |

A grafia certa foi usada 9 vezes. As duas erradas, 91 vezes. **88 pagamentos já foram
aprovados contra um CNPJ que não passa no módulo 11.** Qualquer um pode refazer a conta
no palco.

## 4. O que o Goworker é

Um funcionário de IA que assume a **fila**, nunca a **assinatura**.
Roda todo dia, lê os 18.926 registros e devolve uma ação por pedido parado:

| Ação | Hoje | O que significa |
|---|---|---|
| **CONFIRMAR** | 534 | Velho demais; reconfirmar com o solicitante ou encerrar |
| **LIBERAR** | 319 | Limpo: pronto para um clique humano |
| **ARQUIVAR** | 106 | Registro de teste, não é pedido real |
| **REVISAR** | 36 | Pendência de cadastro a resolver antes de decidir |
| **REDIRECIONAR** | 35 | O aprovador sumiu; trocar o dono da fila |
| **BLOQUEAR** | 28 | Documento inválido, autoaprovação ou beneficiário trocado |

**739 dos 1.058 (70%) não podem ser decididos do jeito que estão.** O Goworker diz
exatamente por quê, um a um, e monta o dossiê que o aprovador teria que juntar na mão.

## 5. O que ele não faz, de propósito

**Não tem credencial de escrita no GLPI.** Não aprova, não recusa, não paga.
Isso é desenho, não falta de tempo: segregação de função é o controle que o financeiro
não pode perder, e um agente que assina cheque destrói esse controle.

Três testes automatizados provam que não existe caminho de escrita no bundle publicado.

## 6. A pergunta difícil, respondida antes de ser feita

*"Rodando suas regras para trás, contra os 17.590 pedidos já decididos, quantas das 150
recusas elas teriam antecipado?"*

**5 de 150. Recall de 3,3%, precisão de 2,07%.** Como preditor de recusa, o motor é ruim.

Isso não é um defeito escondido, é a tese. **"Recusado" não é gabarito.** Em uma base onde
99,15% das decisões são "aprovar", o rótulo mede o que o carimbo deixou passar, não o que
deveria ter sido questionado. A prova está no item 3: **163 pedidos com documento inválido chegaram a ser decididos e
exatamente 1 foi recusado.** Taxa de recusa nesse grupo: **0,61%**, *abaixo* da média da
empresa de 0,85%. Um CNPJ que não fecha no módulo 11 tinha menos chance de ser barrado do
que um pedido qualquer. O controle não falhou por pouco; ele não existia.

O Goworker não prevê a opinião de ninguém. Ele mede o que é verdade independente de opinião:
o dígito verificador não fecha, a mesma pessoa pediu e aprovou, o aprovador não age há 225
dias, isto é um ticket de teste. Dois sinais batem o acaso mesmo contra esse rótulo ruim:
fila zumbi (**5,3× a taxa-base**) e registro de teste (**12,3×**).

## 7. O que destrava o nível 2

Uma coisa só: **liberar a leitura de valor, vencimento, nota fiscal e centro de custo**
no perfil do GoService.

Com esses quatro campos o Goworker separa lote legítimo de nota duplicada, compara valor
contra o histórico do fornecedor e prioriza por dinheiro em risco em vez de por idade.
Sem eles, ninguém consegue — nem pessoa, nem máquina. Com eles, o agente consegue no mesmo dia.

---

## Roteiro de demo (4 minutos)

1. Abrir o dashboard: 1.058 parados, mediana 91 dias, e os 162 já aprovados com documento inválido.
2. Abrir a tabela da SEFAZ: três grafias, duas inválidas, 88 pagamentos aprovados.
3. Filtrar BLOQUEAR e abrir o dossiê da autoaprovação do `antonio.mendes`.
4. Mostrar o `/_mcp`: perguntar ao Claude "como está a fila do financeiro" e ele responde pelo agente.
5. Fechar no item 6: por que a métrica certa não é prever recusa.

## O que está rodando

- Motor de 13 regras, calibrado contra 18.926 registros reais
- Auditoria retroativa de documentos inválidos já aprovados
- 7 ferramentas MCP em `/_mcp`
- Execução automática diária via cron
- 57 testes de integração, incluindo 3 de segregação de função e 5 de regressão do red team
