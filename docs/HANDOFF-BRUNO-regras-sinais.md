# Handoff — regras por sinal do Goworker do Financeiro

**De:** Vinicius (CFO) · **Para:** Bruno
**Data da revisão:** 18/09/2026
**Base:** execução #22 do Goworker (18/09/2026, 18.926 registros, 1.058 pedidos parados)

---

## O que é isto

O Goworker do Financeiro detecta **15 sinais** nos pedidos de pagamento do GoService
e hoje os soma no rodapé, sem regra explícita de tratamento. Este documento fixa
**o que fazer com cada sinal**.

As 15 decisões abaixo foram revisadas uma a uma. O texto em **> citação** é a
decisão literal de quem revisou — não parafraseei. O que vem depois é a minha
leitura para implementação, e onde ela pode estar errada eu marquei
`⚠️ CONFIRMAR`.

**Limite que não muda:** o Goworker não tem credencial de escrita no GoService.
Nenhuma regra aqui aprova ou recusa pagamento. A CAP §7 reserva isso à alçada e a
§4 trata segregação de funções como regra inviolável.

**Ações disponíveis (lista fechada):**
`DEVOLVER_AO_SOLICITANTE` · `NOTIFICAR_PENALIDADE` · `RECOMENDAR_ESTORNO` ·
`CORRIGIR_CADASTRO` · `ROTEAR_PARA_ALCADA` · `ENCERRAR_PEDIDO` · `PROGRAMAR_CAP`

---

## Resumo

| # | sinal | n | decisão | severidade |
|---|---|---|---|---|
| 1 | `FILA_ZUMBI` | 695 | **alterada** | ARQUIVAR → lixeira |
| 2 | `SLA_ESTOURADO` | 192 | mantida | RESSALVA |
| 3 | `LOTE_AMBIGUO` | 165 | mantida | RESSALVA |
| 4 | `REGISTRO_DE_TESTE` | 106 | mantida | ARQUIVAR |
| 5 | `TIPO_DE_ALTO_RISCO` | 68 | **alterada** | RESSALVA |
| 6 | `VOLUME_ACIMA_DO_PADRAO` | 60 | **alterada** | RESSALVA |
| 7 | `APROVADOR_INATIVO` | 44 | **alterada** | TRAVA |
| 8 | `SEM_BENEFICIARIO` | 14 | **alterada** | TRAVA |
| 9 | `NOME_DIVERGE_DO_CNPJ` | 11 | **alterada** | TRAVA |
| 10 | `CNPJ_INVALIDO` | 8 | **alterada** | TRAVA |
| 11 | `BENEFICIARIO_NOVO` | 9 | **removido** | — |
| 12 | `BENEFICIARIO_ALTA_RECUSA` | 8 | **removido** | — |
| 13 | `BENEFICIARIO_SO_RECUSADO` | 3 | **removido** | — |
| 14 | `AUTOAPROVACAO` | 7 | mantida | TRAVA |
| 15 | `VALOR_NO_TITULO` | 7 | mantida | TRAVA |

**Saldo:** 12 sinais ativos, 3 desligados. **Nenhuma pendência bloqueia o início.**
Dois conceitos novos aparecem e valem para mais de uma regra — leia antes de implementar:

- **Janela de 15 dias** (regras 7 e 8): sinal só vale para chamado aberto há menos
  de 15 dias. Passou disso, devolve ao solicitante.
- **Mesma raiz de CNPJ** (regras 9 e 10): divergência que é só matriz × filial do
  mesmo CNPJ raiz não é divergência.
- **Lixeira** (regra 1): área de retenção restaurável, fora da base de trabalho.
  É o que torna a higienização de 695 pedidos segura — e é a maior peça nova a construir.

---

## 1. `FILA_ZUMBI` — 695 · ALTERADA · ARQUIVAR

> **"eliminar da base para higienizaçao"**
> **Decidido em 18/09/2026:** *"eliminar tudo, enviar para um espaço de lixeira
> onde fica armazenado"*

**Sem corte de dias. Todos os 695 saem da base de trabalho.** Nada é apagado: vão
para uma **lixeira** onde ficam armazenados e restauráveis.

Como é reversível, **não precisa de aprovação humana em lote** — esse era o único
motivo do portão. O agente higieniza sozinho, na execução, e a lixeira é a garantia.

```
para cada pedido com FILA_ZUMBI:
    mover_para_lixeira(pedido, motivo="FILA_ZUMBI", execucao=<n>)
    remover da base de trabalho do Goworker
    # GoService NÃO é tocado — o agente não tem credencial de escrita
```

### A lixeira

| | |
|---|---|
| o que guarda | snapshot completo do pedido no momento da remoção |
| campos mínimos | `pedido_id`, `motivo`, `dias_sem_movimento`, `snapshot`, `movido_em`, `execucao`, `restaurado_em`, `restaurado_por` |
| retenção | ⚠️ definir — sugiro **não expirar** enquanto não houver política de descarte |
| restauração | um clique devolve o pedido à base de trabalho, com registro de quem restaurou |
| visibilidade | precisa ser navegável e buscável por `pedido_id` e por solicitante |
| trilha | um evento por pedido movido, mais um evento de lote por execução |

A lixeira é o que separa higienização de perda. Se ela não for consultável, a regra
vira exclusão com outro nome — **esse é o ponto que não pode ser cortado na implementação.**

### Uma coisa que a lixeira não resolve

Sair da fila do Goworker **não resolve o lado contábil**. A CAP §11 manda recomendar
estorno após 120 dias para títulos sem comprovação fiscal — isso é ação sobre o
**título no ERP**, não sobre o chamado.

Então, em cima da higienização, e sem contrariá-la:

```
se sem_movimento_dias > 120 e sem_comprovacao_fiscal:
    RECOMENDAR_ESTORNO          # CAP §11 — para contas a pagar, sobre o título
```

O pedido vai para a lixeira de qualquer jeito. Esta linha só garante que o título
correspondente não fique pendurado no ERP. **Se não quiser essa parte, é só remover
— ela é aditiva.**

---

## 2. `SLA_ESTOURADO` — 192 · MANTIDA · RESSALVA

Passou do prazo de decisão. Mediana histórica 16h, p90 121h, sobre 17.590 decisões.

```
ROTEAR_PARA_ALCADA(superior_imediato)
se houve juros ou multa:
    NOTIFICAR_PENALIDADE(area_de_origem)
```

**Base:** CAP §8 (prazo padrão de 5 dias úteis) · CAP §12 (o custo do atraso é
atribuído à origem).

---

## 3. `LOTE_AMBIGUO` — 165 · MANTIDA · RESSALVA

Não dá para dizer a que ciclo de pagamento o pedido pertence.

```
ciclo = primeiro dia em [10, 20, 30] cujo corte de 5 dias úteis ainda não passou
PROGRAMAR_CAP(ciclo)
gravar ciclo_atribuido no pedido
```

**Base:** CAP §9.

**⚠️ Divergência conhecida entre as fontes:** a CAP §9 diz dias 10/20/30; o
Playbook Fiscal (POP 01, Fluxo de pagamento) diz **toda quarta e sexta** para nota
de mercadoria. Implemente CAP §9 e registre a divergência na evidência. Está em
aberto qual vale para NF de fornecedor.

---

## 4. `REGISTRO_DE_TESTE` — 106 · MANTIDA · ARQUIVAR

```
ENCERRAR_PEDIDO sem notificar ninguém
não consumir alçada
abrir UM chamado de higiene com a lista inteira   # um, não 106
```

Sem base na política — é higiene de base.

---

## 5. `TIPO_DE_ALTO_RISCO` — 68 · ALTERADA · RESSALVA

> **"deve seguir a alçada conforme a politica de CAP"**

A proposta original subia um nível de alçada por causa do tipo. **Foi rejeitada.**
Aplica-se a tabela da CAP §7 pelo valor, sem agravante:

| valor do documento | aprovador |
|---|---|
| até R$ 20.000,00 | Gerente da área demandante |
| > R$ 20.000,00 até R$ 50.000,00 | Diretor da área |
| > R$ 50.000,00 | Sócio (sozinho) |

```
nivel_exigido = alcada_por_valor(valor)          # tabela acima
se nivel_do_aprovador < nivel_exigido:
    ROTEAR_PARA_ALCADA(nivel_exigido)
```

O sinal continua sendo registrado como RESSALVA para leitura, mas **não altera o
roteamento**. Some a necessidade de definir a lista de "tipos de alto risco", que
era a maior pendência da versão anterior.

---

## 6. `VOLUME_ACIMA_DO_PADRAO` — 60 · ALTERADA · RESSALVA

> **"exceto tributos"**

```
se natureza == TRIBUTO:
    não sinaliza
senão:
    REVISAR com comparativo histórico do solicitante e do fornecedor anexado
    sozinho não trava
```

**Como identificar tributo — `⚠️ CONFIRMAR` qual critério usar:**
- favorecido é órgão arrecadador (SEFAZ, RFB, prefeitura, INSS, FGTS)
- ou natureza financeira / conta contábil marcada como tributo
- ou categoria em (`ICMS`, `ICMS-ST`, `PIS`, `COFINS`, `IPI`, `DIFAL`, `IRRF`, `ISS`)

Na fila há vários `SEFAZ DE SÃO PAULO`, `SEFAZ CEARÁ`, `SEFAZ PE`, `BB - COFINS`,
`BB - IPI` — usar só o nome do favorecido pega a maioria, mas é frágil. Se o
Webgex expuser natureza financeira, prefira o campo. Endpoint disponível:
`erp-naturezas-financeiras`.

---

## 7. `APROVADOR_INATIVO` — 44 · ALTERADA · TRAVA

> **"deve confirmar no teamguide se o aprovador ainda trabalha na empresa e também
> deve servir apenas para chamados abertos a menos de 15 dias, caso contrario volta
> para o solicitante"**

Duas mudanças: **checagem no Teamguide** e **janela de 15 dias**.

```
se dias_desde_abertura > 15:
    DEVOLVER_AO_SOLICITANTE
    fim                                  # não roteia, não trava

ativo = teamguide.get_employee(aprovador)
se ativo:
    não sinaliza                         # cadastro do GoService estava defasado
senão:
    ROTEAR_PARA_ALCADA(substituto_formal)
```

**Integração:** conector **Teamguide MCP**. Ferramentas disponíveis:
`get_employee`, `get_employee_tenure`, `list_employees`, `list_departments`.
`⚠️ CONFIRMAR` a chave de casamento: o GoService traz login (`antonelle.gomes`,
`joao.conde`) e às vezes e-mail (`carmem.bianca@gobeaute.com.br`). Precisa de um
de-para login → pessoa no Teamguide.

**Base:** CAP §7 — delegação só vale se registrada no GoService, para subordinado
direto, sem quebrar segregação.

---

## 8. `SEM_BENEFICIARIO` — 14 · ALTERADA · TRAVA

> **"deve servir apenas para chamados abertos a menos de 15 dias, caso contrario
> volta para o solicitante"**

```
se dias_desde_abertura > 15:
    DEVOLVER_AO_SOLICITANTE
senão:
    TRAVA + DEVOLVER_AO_SOLICITANTE para completar o favorecido
```

Na prática as duas pontas devolvem ao solicitante; a diferença é que o caso novo
trava o pedido e o velho só devolve. **Base:** CAP §5.

---

## 9. `NOME_DIVERGE_DO_CNPJ` — 11 · ALTERADA · TRAVA

> **"se for apenas diferença de matriz e filial CNPJ manter"**

```
raiz_doc  = cnpj_do_documento[0:8]
raiz_cad  = cnpj_do_cadastro[0:8]

se raiz_doc == raiz_cad:
    não sinaliza                          # matriz × filial da mesma empresa
senão se raiz_doc in CAP_ANEXO_I:
    reclassificar como INTERCOMPANY       # não é divergência, é operação entre partes relacionadas
senão se divergencia_e_grafia:
    CORRIGIR_CADASTRO
senão:
    TRAVA + DEVOLVER_AO_SOLICITANTE       # entidade diferente
```

**Dado pronto:** `dados/mestre/empresas_grupo.csv` no repo do gate — 44 filiais do
CAP Anexo I, com coluna `raiz_cnpj` (27 raízes distintas). É o que resolve o caso
`#8857 "GOL LINHAS AEREAS SA"` com CNPJ `22.165.464/0003-52`, que é do GO COMERCIO.

---

## 10. `CNPJ_INVALIDO` — 8 · ALTERADA · TRAVA

> **"se for apenas diferença de matriz e filial CNPJ manter"**

**Confirmado em 18/09/2026:** CNPJ que falha no dígito verificador **trava sempre**.
A exceção de matriz/filial vale para o sinal 9 e para o caso de CNPJ válido de outra
filial — nunca para CNPJ malformado. Duas checagens separadas:

```
se não valida_digito_verificador(cnpj):
    TRAVA + CORRIGIR_CADASTRO             # sempre — ex.: 20.000.000/0000-00, 87.987.776/0000-00
senão se raiz_doc == raiz_cad:
    não sinaliza                          # filial diferente, CNPJ válido
senão:
    TRAVA + CORRIGIR_CADASTRO
```

Nenhum pedido com CNPJ que falha no dígito verificador entra em lote de pagamento.

**Base:** CAP §6 — conferência dos dados cadastrais é responsabilidade de Contas a Pagar.

---

## 11–13. `BENEFICIARIO_NOVO` · `BENEFICIARIO_ALTA_RECUSA` · `BENEFICIARIO_SO_RECUSADO` — DESLIGADOS

> **"remover da lista"** (nos três)

Remover a emissão e a contagem dos três sinais. São 20 disparos somados.

**Consequência a registrar, não a discutir:** sai a detecção de primeiro pagamento
a favorecido novo, que é a janela usual de fraude de boleto e PIX. A cobertura de
identidade passa a depender só de CNPJ válido (10), nome × CNPJ (9) e favorecido
presente (8) — todas checagens de **cadastro**, nenhuma de **histórico**.

Se depois quiserem de volta, o histórico de recusa por favorecido já está na base
do Goworker.

---

## 14. `AUTOAPROVACAO` — 7 · MANTIDA · TRAVA

```
se solicitante == aprovador:
    TRAVA                                  # sem exceção
    ROTEAR_PARA_ALCADA(alguem_que_nao_solicitou)
    registrar_em_compliance()
```

**O próprio aprovador não pode derrubar esta trava.** Foi mantido de propósito.

**Base:** CAP §7 — *"em nenhuma hipótese, o solicitante da despesa poderá ser o
próprio aprovador"*. CAP §4 — *"a segregação de funções é regra inviolável"*.

Casos observados: `#2322 BB - COFINS 10.2025`, `#5498 Cadastro de Cliente`,
`#14039/40/42 Unixlog`.

---

## 15. `VALOR_NO_TITULO` — 7 · MANTIDA · TRAVA

```
TRAVA
DEVOLVER_AO_SOLICITANTE pedindo o valor no campo
abrir_demanda_de_produto("expor valor, vencimento, NF e centro de custo em get_payment_request")
```

Este sinal acusa o sistema, não quem preencheu. As pessoas escrevem o valor no
título porque o campo não é legível. A demanda de produto é parte da regra, não
um extra.

**Base:** limite declarado pelo próprio Goworker — *"valor, vencimento, nota fiscal
e centro de custo não são legíveis no perfil atual do GoService
(`get_payment_request`)"*.

---

## O que precisa de decisão antes de subir

As duas pendências que bloqueavam foram resolvidas em 18/09/2026. **Dá para começar.**

| # | pendência | quem decide | bloqueia |
|---|---|---|---|
| ~~1~~ | ~~`FILA_ZUMBI`: o que é "eliminar"~~ | ✅ **resolvido** — eliminar tudo, para uma lixeira restaurável | não |
| ~~2~~ | ~~`CNPJ_INVALIDO`: dígito verificador~~ | ✅ **resolvido** — trava sempre | não |
| 3 | Retenção da lixeira: expira em quanto tempo, ou nunca? | Vinicius | não — comece sem expiração |
| 4 | `APROVADOR_INATIVO`: de-para login do GoService → pessoa no Teamguide | Bruno + RH | sim, para a regra 7 |
| 5 | `VOLUME_ACIMA_DO_PADRAO`: identificar tributo por nome do favorecido ou natureza financeira? | Bruno | não, comece por nome |
| 6 | `LOTE_AMBIGUO`: CAP §9 (10/20/30) ou POP 01 (quarta e sexta)? | Vinicius | não, CAP §9 por ora |

**Ordem sugerida de implementação:**

1. **Lixeira + `FILA_ZUMBI`** — 695 pedidos, 66% da fila. É o que muda o painel de verdade, e não depende de integração nenhuma.
2. **Desligar os três sinais de beneficiário** — é remoção, custa minutos.
3. **Raiz de CNPJ** (regras 9 e 10) — o `empresas_grupo.csv` já está pronto no repo.
4. **Janela de 15 dias** (regras 7 e 8) — a parte do Teamguide pode esperar o de-para; a janela sozinha já vale.
5. O resto.

## Insumos prontos para usar

**No repo do gate fiscal** (`~/gate-fiscal`, mesma máquina do Vinicius):

| arquivo | conteúdo |
|---|---|
| `dados/mestre/empresas_grupo.csv` | 44 filiais do CAP Anexo I, com `raiz_cnpj` — resolve as regras 9 e 10 |
| `dados/mestre/despesas_pre_aprovadas.csv` | 11 categorias do CAP Anexo II |
| `config/politica.json` | limites da CAP com a seção citada em cada um |
| `dados/fontes_oficiais/FONTES.md` | base normativa e o que o Playbook corrigiu no desenho |
| `nucleo/contratos.py` | contrato de validador: 4 métodos, `Achado` com regra/delta/evidência/origem/carimbo |

**Conectores MCP disponíveis nesta conta:**

| conector | serve para |
|---|---|
| **Teamguide MCP** | `get_employee`, `get_employee_tenure`, `list_employees` — regra 7 |
| **Webgex MCP** | `erp-contas-pagar` ✅, `erp-fornecedores` ✅, `erp-centros-de-resultado` ✅, `erp-naturezas-financeiras`, `erp-unidades` ✅ |

⚠️ **Testado e não funciona:** `erp-carteira-pedidos-de-compra` e
`erp-notas-fiscais-recebidas` retornam **HTTP 400** com `unidade` e com faixa de
datas. Sem esses dois não dá para casar nota fiscal contra pedido de compra pelo
Webgex. Vale perguntar ao fornecedor os parâmetros corretos.

---

## Como o gate fiscal se encaixa

São duas camadas diferentes, e vale não duplicar esforço:

| | Goworker (você) | Gate fiscal (nosso) |
|---|---|---|
| objeto | pedido de pagamento no GoService | documento fiscal: NF × pedido de compra |
| campos | solicitante, aprovador, favorecido, status | valor, vencimento, NF, centro de custo, itens |
| conferência de preço, quantidade, prazo | ❌ não enxerga os campos | ✅ |
| alçada e segregação | ✅ regras 5, 7, 14 | ✅ validador B3 — **sobreposição real** |

A sobreposição é só alçada/segregação. Se você implementar as regras 5, 7 e 14,
a gente desliga o B3 do gate em vez de manter dois donos da mesma regra.

---

## Anexo — as decisões em JSON

Para carregar direto no código, sem reinterpretar o texto acima.

```json
{
  "revisado_em": "2026-09-18",
  "fonte": "execucao #22 do Goworker, 18.926 registros",
  "regras": [
    {"sinal":"FILA_ZUMBI","n":695,"decisao":"alterar","severidade":"ARQUIVAR","ativo":true,
     "texto_revisor":"eliminar da base para higienizaçao",
     "decisao_final":"eliminar tudo, enviar para um espaco de lixeira onde fica armazenado",
     "bloqueado":false,"corte_de_dias":null,"destino":"lixeira","restauravel":true,
     "aprovacao_humana_em_lote":false,"escreve_no_goservice":false,
     "acao_aditiva":{"se":"sem_movimento_dias > 120 e sem_comprovacao_fiscal",
                     "entao":"RECOMENDAR_ESTORNO","base":"CAP §11"}},
    {"sinal":"SLA_ESTOURADO","n":192,"decisao":"manter","severidade":"RESSALVA","ativo":true,
     "acoes":["ROTEAR_PARA_ALCADA","NOTIFICAR_PENALIDADE"],"base":"CAP §8, §12"},
    {"sinal":"LOTE_AMBIGUO","n":165,"decisao":"manter","severidade":"RESSALVA","ativo":true,
     "acoes":["PROGRAMAR_CAP"],"base":"CAP §9"},
    {"sinal":"REGISTRO_DE_TESTE","n":106,"decisao":"manter","severidade":"ARQUIVAR","ativo":true,
     "acoes":["ENCERRAR_PEDIDO"],"notificar":false,"consome_alcada":false},
    {"sinal":"TIPO_DE_ALTO_RISCO","n":68,"decisao":"alterar","severidade":"RESSALVA","ativo":true,
     "texto_revisor":"deve seguir a alçada conforme a politica de CAP",
     "acoes":["ROTEAR_PARA_ALCADA"],"agravante_de_nivel":false,"base":"CAP §7"},
    {"sinal":"VOLUME_ACIMA_DO_PADRAO","n":60,"decisao":"alterar","severidade":"RESSALVA","ativo":true,
     "texto_revisor":"exceto tributos","excecao":"natureza == TRIBUTO"},
    {"sinal":"APROVADOR_INATIVO","n":44,"decisao":"alterar","severidade":"TRAVA","ativo":true,
     "texto_revisor":"deve confirmar no teamguide se o aprovador ainda trabalha na empresa e também deve servir apenas para chamados abertos a menos de 15 dias, caso contrario volta para o solicitante",
     "janela_dias":15,"integracao":"Teamguide.get_employee","base":"CAP §7"},
    {"sinal":"SEM_BENEFICIARIO","n":14,"decisao":"alterar","severidade":"TRAVA","ativo":true,
     "texto_revisor":"deve servir apenas para chamados abertos a menos de 15 dias, caso contrario volta para o solicitante",
     "janela_dias":15,"base":"CAP §5"},
    {"sinal":"NOME_DIVERGE_DO_CNPJ","n":11,"decisao":"alterar","severidade":"TRAVA","ativo":true,
     "texto_revisor":"se for apenas diferença de matriz e filial CNPJ manter",
     "excecao":"raiz_cnpj_igual","base":"CAP §6, Anexo I"},
    {"sinal":"CNPJ_INVALIDO","n":8,"decisao":"alterar","severidade":"TRAVA","ativo":true,
     "texto_revisor":"se for apenas diferença de matriz e filial CNPJ manter",
     "excecao":"raiz_cnpj_igual E digito_verificador_valido",
     "digito_verificador_invalido_trava_sempre":true,"confirmado_em":"2026-09-18","base":"CAP §6"},
    {"sinal":"BENEFICIARIO_NOVO","n":9,"decisao":"alterar","ativo":false,"texto_revisor":"remover da lista"},
    {"sinal":"BENEFICIARIO_ALTA_RECUSA","n":8,"decisao":"alterar","ativo":false,"texto_revisor":"remover da lista"},
    {"sinal":"BENEFICIARIO_SO_RECUSADO","n":3,"decisao":"alterar","ativo":false,"texto_revisor":"remover da lista"},
    {"sinal":"AUTOAPROVACAO","n":7,"decisao":"manter","severidade":"TRAVA","ativo":true,
     "acoes":["ROTEAR_PARA_ALCADA"],"sem_excecao":true,"aprovador_nao_pode_derrubar":true,
     "base":"CAP §4, §7"},
    {"sinal":"VALOR_NO_TITULO","n":7,"decisao":"manter","severidade":"TRAVA","ativo":true,
     "acoes":["DEVOLVER_AO_SOLICITANTE"],"abrir_demanda_produto":true}
  ]
}
```

---

**Página onde as decisões foram tomadas** (privada, pedir acesso ao Vinicius):
https://claude.ai/artifact/Eiax3LSkog8fTmJEj33RWk
