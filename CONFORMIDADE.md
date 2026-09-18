# Conformidade: o agente x as normas

Fontes conferidas:
1. **Política Corporativa de Pagamentos — GO GROUP**, rev. 01, emissão 01/07/2025,
   Diretoria Financeira, aprovada por Diretor Financeiro e Sócio. 13 folhas.
2. **Playbook Fiscal gobeaute** (`playbook-fiscal-gobeaute.devgogroup.com`), 5 POPs,
   última atualização 08/09/2026.

## Política de Pagamentos, artigo por artigo

| Artigo | O que manda | O agente | Achado na fila real |
|---|---|---|---|
| **Art. 4** | Segregação de funções é **regra inviolável**: ninguém acumula solicitar, aprovar e executar | Bloqueia e devolve. E **por isso o próprio agente não aprova nem recusa** | **7 pedidos** onde solicitante = aprovador |
| **Art. 5** | Nenhum pagamento sem documentação; vedado pagar em conta de terceiro que não seja o fornecedor cadastrado | Devolve ao solicitante com o motivo | **11** com nome divergente do CNPJ; **14** sem favorecido identificável |
| **Art. 6** | CAP confere fornecedor, CNPJ, valor e vencimento; divergência volta ao requisitante | Confere CNPJ/CPF por dígito verificador, **corrige sozinho** quando a base tem a grafia certa, e desde 18/09/2026 **abre o anexo e confere o valor contra o documento** | **4** corrigidos automaticamente, **4** devolvidos. Na conferência ao vivo, **6 de 8** chamados tinham o valor do pedido 100x o do anexo |
| **Art. 7** | Alçadas: ≤20k Gerente, 20-50k Diretor, >50k Sócio. Solicitante nunca é aprovador | Roteia para o nível certo usando o cargo real de 36 aprovadores (Teamguide) | **32 reroteados**. **6 aprovadores são analista ou coordenador** e não têm alçada nenhuma |
| **Art. 8** | 5 dias úteis da aprovação: 2 de lançamento fiscal + 3 de programação | Calcula em dias úteis, com feriados nacionais | Entra no plano de CAP de cada pedido |
| **Art. 9** | Pagamento nos dias 10, 20 e 30; fora do prazo vai para o próximo ciclo | Monta o lote no ciclo correto | 491 pedidos programáveis |
| **Art. 10** | PIX é a forma preferencial; dinheiro é vedado fora do Fundo Fixo | Todo lote sai como PIX | — |
| **Art. 11** | Controle acima de 30 dias; **estorno recomendado após 120 dias** sem comprovação fiscal | Emite a recomendação de estorno com a mensagem pronta | **421 pedidos passaram de 120 dias**. 347 estão na faixa de controle de 30 |
| **Art. 12** | Juros e multas: a área é **notificada para justificar**; alçada própria (≤2k Diretoria, >2k Sócios) | Redige a notificação formal com a base legal | **26 na fila**, **422 no histórico** — nenhuma notificação havia sido emitida |
| **Anexo I** | 40 CNPJs das empresas do grupo | Detecta e separa intercompany de erro de digitação | **38 pedidos** usam o CNPJ de uma empresa do próprio grupo no campo do fornecedor |
| **Anexo II** | Despesas pré-aprovadas **não seguem o fluxo de aprovação** | Encerra, tira da fila do aprovador | **8** detectados pelo título |

## Playbook Fiscal: o que foi incorporado

- **POP 02, "recusa de chamado"**: *"recusa só quando não há solução possível; havendo ajuste, o chamado segue aberto e o ajuste é alinhado com o solicitante."* É exatamente o comportamento do agente: corrige o corrigível, devolve o que não é, e nunca reprova por conta própria.
- **POP 01, intercompany**: operação entre empresas do grupo usa tipo 51 / código 010 e **não gera título a pagar**. O agente encerra esses pedidos em vez de mandar ao aprovador.
- **POP 01, transferência**: mesma raiz de CNPJ é transferência entre filiais, não compra.

## Conflito normativo registrado

**Calendário de pagamento.** A Política (Art. 9) manda pagar nos **dias 10, 20 e 30**.
O Playbook Fiscal descreve janela às **quartas e sextas**.

Decisão tomada: prevalece a **Política Corporativa**, que é norma de hierarquia superior
(emitida pela Diretoria Financeira, aprovada por Diretor Financeiro e Sócio), enquanto o
playbook é um POP de área. A janela ficou **parametrizada** no código, então trocar é uma
linha quando o financeiro decidir qual vale. **Isso precisa ser resolvido por gente, não por código.**

## O que a norma exige e o agente ainda não consegue verificar

Todos por falta de dado, não de lógica:

1. **Alçada por valor (Art. 7)** depende do valor certo. O anexo passou a dar essa leitura quando existe e é legível, então a checagem já não é cega; onde não há anexo legível o agente continua só pegando o caso em que o aprovador não tem alçada *nenhuma*.
2. **Documento vencido (Art. 8)** exige a data de vencimento. O agente já compara a data de emissão da nota anexada com o vencimento informado e sinaliza quando a nota é posterior, mas só nos pedidos com anexo legível.
3. **Conta bancária do favorecido (Art. 5)** não está no registro de aprovação.
4. **Anexo II** só é detectável pelo título, que é pobre: 8 achados contra os 17 que uma varredura mais solta sugere. Com o campo de categoria ou centro de custo, vira exato.
5. **Playbook fiscal**: 31 das 38 regras dependem de XML da NF, CFOP, pedido de compra ou saldo. O XML da NFe anexada passou a ser lido (valor, CNPJ do emitente e do destinatário, número e data), o que destrava parte disso; CFOP, pedido de compra e saldo continuam fora do GoService.

## Onde o agente para, de propósito

Ele não aprova, não recusa e não paga. A lista de ações que ele consegue emitir é
**fechada em 7 tipos** e a trava recusa qualquer ato de aprovação antes de qualquer
chamada de rede. Isso não é limitação de tempo: o Art. 4 chama segregação de funções de
regra inviolável, e um agente que assina destrói o controle que ele existe para proteger.
