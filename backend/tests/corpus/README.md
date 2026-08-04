# Corpus de regressão da extração

Cada arquivo em `casos/` é um documento que já apareceu, com o texto anonimizado
e os campos que a extração precisa devolver. `tests/corpus.test.js` descobre os
casos sozinho: acrescentar documento é acrescentar um JSON, sem escrever teste.

## Por que existe

Três documentos revelaram quatro defeitos, todos de interpretação e nenhum de
OCR:

| Documento | Defeito |
|---|---|
| Dossiê C6 | IP não extraído: o regex só via IPv4 e o documento traz IPv6 com porta |
| Contrato PAN | Contratante virava "Do Cliente" |
| Contrato PAN | Geolocalização com 3 casas decimais era dada como ausente |
| Dossiê de trilha | Nome não extraído: a correção do defeito anterior passou a exigir caixa alta |
| PAN e C6 | Número do contrato capturava as palavras "Documento" e "contratada" |

O penúltimo é o que justifica tudo: **a correção de um defeito criou outro**, e
só apareceu porque um terceiro documento entrou no teste.

Não existe regex que cubra o formato que ainda não apareceu. O que existe é
garantir que o formato que já apareceu nunca mais quebre.

## Acrescentar um documento

1. Rode a análise com o documento real e confira o resultado.
2. Escreva um mapa de substituição (formato abaixo). **Ele fica fora do
   repositório**, porque contém os valores reais.
3. Gere o caso:

   ```bash
   node tests/corpus/anonimizar.mjs <documento.pdf> <mapa.json> tests/corpus/casos/<nome>.json
   ```

4. Rode a suíte. Se o caso novo falhar, esse é o ponto: ele capturou o defeito.
5. Corrija a extração.
6. Rode de novo. O caso novo passa **e os antigos continuam passando**.

O passo 6 é o que teria pego a regressão do Title Case.

## O mapa de substituição

```jsonc
{
  "origem": "Banco PAN, contrato de cartão de crédito consignado",
  "motivo": "Cabeçalho de tabela fazia o contratante virar 'Do Cliente'",

  // Valor real → valor fictício. Aplicado em TODAS as ocorrências.
  "substituicoes": {
    "LUCILENE FRANCA ABREU": "MARIA APARECIDA SOUZA",
    "036.112.833-98": "111.444.777-35"
  },

  // Falsos positivos da varredura: CNPJ do banco, telefone de central de
  // atendimento, numeração de cláusula. Não são dados de uma pessoa.
  "residuoPermitido": ["22.479.119/0001-21"],

  // O que a extração PRECISA devolver, depois da substituição.
  "esperado": { "cliente.nome": "Maria Aparecida Souza" },

  // O que NÃO pode aparecer. Prende o defeito específico deste documento.
  "proibido": { "cliente.nome": ["Do Cliente", "do cliente"] }
}
```

## Anonimizar é substituir, nunca apagar

Todos os defeitos encontrados foram sensíveis à **forma**, não ao conteúdo:

| Original | Anonimizado | O que preserva |
|---|---|---|
| `LUCILENE FRANCA ABREU` | `MARIA APARECIDA SOUZA` | caixa alta, três palavras |
| `Francisco Chaves Da Silva` | `Joao Carlos De Oliveira` | Title Case, conectivo |
| `036.112.833-98` | `111.444.777-35` | máscara, e dígito verificador válido |
| `-7.115` | `-8.221` | três casas decimais |
| `2804:18:6881:4f33:…` | `2804:18:aaaa:bbbb:…` | IPv6, mesmo número de blocos |

Trocar por `[REDIGIDO]` destruiria justamente a propriedade que o teste verifica.

## As duas varreduras da ferramenta

Ela recusa gravar enquanto sobrar algo com cara de dado pessoal:

- **Por formato**: CPF, CNPJ, CEP, e-mail, IPv4, IPv6, coordenada, telefone.
- **Por rótulo**: nome, nome da mãe, telefone, CEP, e-mail, RG, data de
  nascimento.

A segunda existe porque **nome não tem formato**. Na primeira geração deste
corpus, o mapa cobria o nome do titular e o nome da MÃE, três linhas abaixo sob
outro rótulo, passou pela varredura por formato e só foi pego na conferência
manual. Qualquer heurística que tentasse reconhecer nome pelo conteúdo
confundiria pessoa com razão social.

A varredura por rótulo é conservadora e vai apontar texto de contrato que
menciona "nome da mãe" no meio de uma cláusula. Classificar é trabalho do
operador, e é barato perto do que custa o erro na outra direção.

`tests/corpus.test.js` repete a varredura de CPF a cada execução da suíte, para
o caso escrito à mão que não passou pela ferramenta.

## Antes de commitar

Leia o texto gerado. Anonimização automática erra, e um CPF real que escape para
o repositório é incidente de proteção de dados, não bug.
