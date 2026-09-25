# Regimes de autorização do consignado INSS: plano de implementação

> **Para agentes executores:** SUB-SKILL OBRIGATÓRIA: use superpowers:subagent-driven-development (recomendado) ou superpowers:executing-plans para executar este plano tarefa por tarefa. Os passos usam caixas de seleção (`- [ ]`) para acompanhamento.

**Objetivo:** fazer o exame da imagem do dossiê (selfie, prova de vida, § 4.4) e da autorização do consignado INSS seguir o regime vigente na data do contrato, em vez de tratar toda selfie do banco como a prova central.

**Arquitetura:** três módulos novos e puros no motor (`regimeInss.js` enquadra o contrato pela data, `evidenciasAutorizacao.js` lê do texto o que o dossiê traz sobre Meu INSS, gov.br, averbação e DIB, `avaliacaoInss.js` transforma isso em achados `INS0` a `INS11` e em diligências). A extração grava o resultado em `extracted.regime_inss`; biometria, sumário, graus, quesitos, fundamentação, PDF e tela apenas leem esse objeto. Nada de regra normativa fica duplicada entre servidor e navegador: o motor já entrega rótulos, notas e itens de fundamentação prontos.

**Stack:** Node.js ESM, Vitest (`npm test` no backend e no frontend), PDFKit (`reportPdfService.js`), React/Vite (`frontend/src/laudo`).

## Restrições globais

- Norma ou dispositivo não conferido no DOU não é citado com número de artigo. A citação passa por `citarMarco()` e `citarDispositivo()`, que só devolvem o artigo quando `conferido: true`.
- A norma de maio de 2026 nunca aparece com número enquanto o jurídico não o confirmar.
- Nenhum texto entregue (laudo, quesito, nota, este plano) usa travessão; reescrever com dois-pontos, vírgula ou período próprio.
- O laudo não publica condições econômicas. `INS2` fala da existência e da anterioridade do demonstrativo prévio, nunca de valores.
- A verificação geográfica (GPS x IP, mapas, `gps-outro-municipio`) não sai nem perde texto; `INS1` soma, não substitui.
- Cópias do frontend continuam iguais às do backend: `grausConclusao.js`, `eixosAchado.js`, `quesitos.js` e `issueBucket` em `laudoUtils.js`.
- Git pelo binário `/opt/homebrew/bin/git` (o do sistema falha por licença do Xcode). Nada de push sem confirmação do usuário.
- O dossiê real nunca entra no repositório; testes usam texto sintético ou o corpus já versionado.

## Pré-requisitos jurídicos (conferir no DOU antes do merge)

O texto recebido veio de fonte jornalística e de blogs. A conferência no acervo (`backend/src/engine/replicas/vendor/caderno.json`) mostrou o seguinte:

| Afirmação | O que o acervo diz | Tratamento no código |
|---|---|---|
| IN 138/2022 como regime anterior a maio de 2026 | Vigente desde 1º/12/2022. Antes disso vale a IN INSS/PRES 28/2008, revogada pelo art. 39 da IN 138 | Regime adicional `IN_28_2008` para contratos até 30/11/2022 |
| Correspondente de outro estado viola o art. 5º, VIII | O acervo mapeia art. 4º, VIII (conceito de reconhecimento biométrico), art. 5º, II e III, e art. 5º, § 5º. Não localizei o art. 5º, VIII com esse conteúdo | `DISPOSITIVOS_IN138.LOCAL_DOMICILIO.conferido = false`: o laudo cita só "IN PRES/INSS nº 138/2022" |
| Demonstrativo prévio do art. 5º, § 9º | Não mapeado no acervo | `DISPOSITIVOS_IN138.DEMONSTRATIVO_PREVIO.conferido = false` |
| Norma de maio de 2026 (número não localizado) | O acervo registra a IN 138 "alterada pelas INs nº 143/2023, 190/2025, 194/2025 e 207/2026". A IN 207/2026 é candidata a ser a norma de maio | `MARCOS_INSS.MEU_INSS.norma = null` até a conferência |
| IN 213 de 17/08/2026 e vedação dos 90 dias | Não mapeado | `MARCOS_INSS.IN_213.conferido = false`; laudo cita com "(texto e vigência a conferir no DOU)" |

Quando cada item for conferido, a mudança é trocar o flag e, se for o caso, a data ou o número em `regimeInss.js`. Os testes da Tarefa 1 que exigem a ressalva precisam ser ajustados junto.

## Decisões com padrão adotado (o usuário pode inverter)

- **D1.** O dia exato de início do regime Meu INSS não foi informado. Padrão: 01/05/2026, com ressalva automática para contratos a até 31 dias de qualquer marco não conferido.
- **D2.** "A mesma norma proibiu a contratação nos primeiros 90 dias" foi lido como a IN 213. Padrão: a regra vale para contratos a partir de 17/08/2026 (`REGRA_DIB.marco = "IN_213"`).
- **D3.** A IN 138 continua vigente, alterada. Padrão: `INS1` e `INS2` valem para os três regimes a partir de 1º/12/2022, e não só para o primeiro.
- **D4.** Para o local da assinatura, o achado `gps-outro-municipio` mantém a gravidade MÉDIA e ganha uma frase normativa quando o contrato é INSS e a UF difere. O achado novo e ALTA é o do correspondente (`INS1`).

## Mapa de arquivos

| Arquivo | Papel |
|---|---|
| `backend/src/engine/regimeInss.js` (novo) | Marcos, regimes, citação condicionada à conferência, classificação pela data, fundamentação do regime |
| `backend/src/engine/evidenciasAutorizacao.js` (novo) | Leitura do texto: Meu INSS, via facial ou gov.br, bases oficiais, contas, averbação, demonstrativo prévio, DIB |
| `backend/src/engine/avaliacaoInss.js` (novo) | Achados `INS0`, `INS2` a `INS11` e diligências por regime |
| `backend/src/engine/extraction.js` | UF do correspondente; grava `extracted.regime_inss` e os achados |
| `backend/src/engine/irregularitySummary.js` | `INS1` com o domicílio de referência do § 5; frase normativa no `gps-outro-municipio`; diligências do regime |
| `backend/src/engine/biometria.js` e `analisarDocumento.js` | BIO2 conforme o regime; nota do § 4.4 |
| `backend/src/engine/grausConclusao.js`, `eixosAchado.js` e cópias no frontend | Grau e eixo dos códigos `INS` |
| `backend/src/reports/laudoApresentacao.js` e `frontend/src/laudo/laudoUtils.js` | Grupo dos achados `INS` no § 6 |
| `backend/src/reports/quesitosTemplate.js` e `frontend/src/laudo/quesitos.js` | Quesitos ao INSS e à Dataprev; retirada do quesito de prova de vida na via gov.br |
| `backend/src/reports/laudoTexts.js`, `reportPdfService.js`, `LaudoForense.jsx` | Fundamentação por regime; seção "Autorização do benefício (INSS)"; nota do § 4.4 |

## Tabela de achados

| Código | Gravidade | Grau | Quando |
|---|---|---|---|
| INS0 | MÉDIA | Não verificável | Consignado INSS sem data do contrato |
| INS1 | ALTA | Constatado | Correspondente em UF diversa do domicílio (regimes da IN 138 em diante) |
| INS2 | MÉDIA | Não verificável | Demonstrativo prévio não localizado (regimes da IN 138 em diante) |
| INS3 | ALTA | Não verificável | Regime Meu INSS, via facial: registro da autorização ausente ou incompleto |
| INS4 | ALTA | Constatado | Averbação ou crédito anterior à autorização no Meu INSS |
| INS5 | MÉDIA | Não verificável | Regime IN 213: via de autorização não identificada ou ambígua |
| INS6 | ALTA | Constatado | Via gov.br usada por quem tinha biometria cadastrada |
| INS7 | ALTA | Não verificável | Via gov.br sem demonstração de que faltava biometria nas bases oficiais |
| INS8 | ALTA | Não verificável | Via gov.br sem nível da conta, IP, dispositivo ou conta validada |
| INS9 | ALTA | Constatado | Conta validada diferente da conta de recebimento do benefício |
| INS10 | ALTA | Constatado | Contrato nos primeiros 90 dias da DIB (a partir da IN 213) |
| INS11 | MÉDIA | Não verificável | DIB não localizada quando a vedação dos 90 dias se aplica |

---

### Tarefa 1: enquadramento do regime pela data do contrato

**Arquivos:**
- Criar: `backend/src/engine/regimeInss.js`
- Teste: `backend/tests/engine/regimeInss.test.js`

**Interfaces:**
- Produz: `MARCOS_INSS`, `REGIMES`, `DISPOSITIVOS_IN138`, `REGRA_DIB`, `REGIMES_COM_IN138: Set<string>`, `REGIMES_MEU_INSS: Set<string>`, `ROTULOS_VIA`, `NOTA_OFICIO_INSS: string`, `paraDia(valor): number|null`, `diasEntre(inicio, fim): number|null`, `citarMarco(chave): string|null`, `citarDispositivo(chave): string`, `classificarRegimeInss({ produtoCodigo, dataContrato, confiancaData }): { codigo, rotulo, marco, norma, data_contrato, ressalvas: string[] } | null`, `fundamentacaoDoRegime(regime): Array<[string, string]>`.

- [ ] **Passo 0: criar a branch a partir do master**

```bash
cd /Users/narcisojunior/Documents/repositorios/Forense_DOC/forensedoc-ForenseDoc
/opt/homebrew/bin/git switch master
/opt/homebrew/bin/git pull --ff-only
/opt/homebrew/bin/git switch -c feat/regimes-autorizacao-inss
```

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import {
  classificarRegimeInss, citarDispositivo, citarMarco, diasEntre, fundamentacaoDoRegime,
} from "../../src/engine/regimeInss.js";

const regime = (data, extra = {}) => classificarRegimeInss({ produtoCodigo: "CONSIGNADO_INSS", dataContrato: data, ...extra });

describe("regime de autorização do consignado INSS", () => {
  it("não se aplica fora do consignado INSS", () => {
    expect(classificarRegimeInss({ produtoCodigo: "CONSIGNADO_CLT", dataContrato: "10/06/2026" })).toBeNull();
  });

  it.each([
    ["30/11/2022", "IN_28_2008"],
    ["01/12/2022", "IN_138_SELFIE_BANCO"],
    ["30/04/2026", "IN_138_SELFIE_BANCO"],
    ["01/05/2026", "MEU_INSS_BIOMETRIA"],
    ["16/08/2026", "MEU_INSS_BIOMETRIA"],
    ["17/08/2026", "IN_213_VIA_DUPLA"],
  ])("contrato de %s cai no regime %s", (data, codigo) => {
    expect(regime(data).codigo).toBe(codigo);
  });

  it("sem data do contrato o regime é indeterminado", () => {
    expect(regime(null).codigo).toBe("INDETERMINADO");
  });

  it("contrato de março de 2025 sai sem ressalva, porque a IN 138 está conferida", () => {
    expect(regime("15/03/2025").ressalvas).toEqual([]);
  });

  it("regime com vigência não conferida leva ressalva", () => {
    expect(regime("15/06/2026").ressalvas.join(" ")).toMatch(/não foi conferido no Diário Oficial/);
  });

  it("contrato perto de marco não conferido avisa que o regime pode mudar", () => {
    expect(regime("30/04/2026").ressalvas.join(" ")).toMatch(/dista 1 dia do início presumido/);
  });

  it("contrato no próprio dia do marco também avisa", () => {
    expect(regime("01/05/2026").ressalvas.join(" ")).toMatch(/coincide com o início presumido/);
  });

  it("data lida sem rótulo leva ressalva", () => {
    expect(regime("15/03/2025", { confiancaData: "BAIXA" }).ressalvas.join(" ")).toMatch(/sem rótulo de contratação/);
  });

  it("a norma de maio de 2026 nunca é citada por número", () => {
    expect(citarMarco("MEU_INSS")).not.toMatch(/nº/);
  });

  it("a IN 213 é citada com ressalva de conferência", () => {
    expect(citarMarco("IN_213")).toBe("IN PRES/INSS nº 213/2026 (texto e vigência a conferir no DOU)");
  });

  it("artigo não conferido não é citado", () => {
    expect(citarDispositivo("LOCAL_DOMICILIO")).toBe("IN PRES/INSS nº 138/2022");
    expect(citarDispositivo("DEMONSTRATIVO_PREVIO")).toBe("IN PRES/INSS nº 138/2022");
  });

  it("diasEntre conta dias corridos", () => {
    expect(diasEntre("01/05/2026", "30/07/2026")).toBe(90);
  });

  it("fundamentação cresce com o regime", () => {
    expect(fundamentacaoDoRegime(regime("10/05/2021")).map(([d]) => d)).toEqual(["IN INSS/PRES nº 28/2008"]);
    expect(fundamentacaoDoRegime(regime("15/03/2025"))).toHaveLength(1);
    expect(fundamentacaoDoRegime(regime("15/06/2026"))).toHaveLength(2);
    expect(fundamentacaoDoRegime(regime("10/09/2026"))).toHaveLength(3);
    expect(fundamentacaoDoRegime(regime(null))).toEqual([]);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/regimeInss.test.js`
Esperado: FAIL, "Failed to resolve import ../../src/engine/regimeInss.js".

- [ ] **Passo 3: implementar**

```js
/**
 * Regime de autorização do consignado em benefício do INSS.
 *
 * A régua da perícia muda com a data do contrato. Até 30/11/2022 vale a IN
 * INSS/PRES 28/2008. De 1º/12/2022 em diante, a IN PRES/INSS 138/2022, em que a
 * selfie é colhida e guardada pela própria instituição, sem validação estatal. A
 * partir de maio de 2026 a autorização passou a ser dada no Meu INSS, com
 * biometria facial e validação de vivacidade, em etapa distinta da assinatura
 * com o banco. A partir da IN PRES/INSS 213/2026 o beneficiário sem biometria
 * nas bases oficiais pode autorizar pela conta gov.br.
 *
 * Marcos e dispositivos com `conferido: false` vieram de fonte secundária. O
 * laudo enquadra o contrato, avisa que o enquadramento depende da conferência
 * no DOU e não cita artigo que o jurídico não confirmou.
 */

export const MARCOS_INSS = {
  IN_138: { inicio: "2022-12-01", norma: "IN PRES/INSS nº 138/2022", conferido: true },
  MEU_INSS: {
    inicio: "2026-05-01",
    norma: null,
    descricao: "Norma do INSS de maio de 2026 sobre autorização no Meu INSS (número a confirmar no DOU)",
    conferido: false,
  },
  IN_213: { inicio: "2026-08-17", norma: "IN PRES/INSS nº 213/2026", conferido: false },
};

export const REGIMES = {
  IN_28_2008: "Regime anterior à IN PRES/INSS nº 138/2022 (IN INSS/PRES nº 28/2008)",
  IN_138_SELFIE_BANCO: "Selfie colhida e guardada pela instituição, sem validação estatal (IN PRES/INSS nº 138/2022)",
  MEU_INSS_BIOMETRIA: "Autorização no Meu INSS com biometria facial e validação de vivacidade",
  IN_213_VIA_DUPLA: "Autorização no Meu INSS por biometria facial ou, sem biometria nas bases oficiais, pela conta gov.br",
  INDETERMINADO: "Regime não determinável: data do contrato não localizada",
};

/** Dispositivos da IN 138 que o laudo só cita pelo número depois de conferidos. */
export const DISPOSITIVOS_IN138 = {
  LOCAL_DOMICILIO: { artigo: "art. 5º, VIII", conferido: false },
  DEMONSTRATIVO_PREVIO: { artigo: "art. 5º, § 9º", conferido: false },
};

/** Vedação de consignado nos primeiros dias do benefício, a partir do marco indicado. */
export const REGRA_DIB = { dias: 90, marco: "IN_213" };

export const REGIMES_COM_IN138 = new Set(["IN_138_SELFIE_BANCO", "MEU_INSS_BIOMETRIA", "IN_213_VIA_DUPLA"]);
export const REGIMES_MEU_INSS = new Set(["MEU_INSS_BIOMETRIA", "IN_213_VIA_DUPLA"]);

export const ROTULOS_VIA = {
  FACIAL: "Biometria facial no Meu INSS",
  GOVBR: "Conta gov.br com validação dos dados bancários",
  AMBIGUA: "Não identificada: o dossiê menciona as duas vias",
};

export const NOTA_OFICIO_INSS =
  "O registro da autorização no Meu INSS é mantido pelo INSS e pela Dataprev e deve ser requisitado por ofício. O que a instituição juntar sozinha não o substitui.";

const JANELA_FRONTEIRA_DIAS = 31;
const DIA_MS = 86400000;

const ORDEM = [
  ["IN_213_VIA_DUPLA", "IN_213"],
  ["MEU_INSS_BIOMETRIA", "MEU_INSS"],
  ["IN_138_SELFIE_BANCO", "IN_138"],
];

const dataBr = (iso) => iso.split("-").reverse().join("/");
const dias = (n) => `${n} ${n === 1 ? "dia" : "dias"}`;

/** "dd/mm/aaaa" ou "aaaa-mm-dd" em milissegundos UTC do dia; null se ilegível. */
export function paraDia(valor) {
  const texto = String(valor || "");
  const br = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (br) return Date.UTC(Number(br[3]), Number(br[2]) - 1, Number(br[1]));
  const iso = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return Date.UTC(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  return null;
}

/** Dias corridos de `inicio` até `fim` (negativo se `fim` for anterior). */
export function diasEntre(inicio, fim) {
  const a = paraDia(inicio);
  const b = paraDia(fim);
  return a === null || b === null ? null : Math.round((b - a) / DIA_MS);
}

export function citarMarco(chave) {
  const marco = MARCOS_INSS[chave];
  if (!marco) return null;
  if (marco.norma && marco.conferido) return marco.norma;
  if (marco.norma) return `${marco.norma} (texto e vigência a conferir no DOU)`;
  return marco.descricao;
}

export function citarDispositivo(chave) {
  const d = DISPOSITIVOS_IN138[chave];
  return d?.conferido ? `${d.artigo}, da IN PRES/INSS nº 138/2022` : "IN PRES/INSS nº 138/2022";
}

export function classificarRegimeInss({ produtoCodigo, dataContrato, confiancaData = "ALTA" } = {}) {
  if (produtoCodigo !== "CONSIGNADO_INSS") return null;
  const dia = paraDia(dataContrato);
  if (dia === null) {
    return { codigo: "INDETERMINADO", rotulo: REGIMES.INDETERMINADO, marco: null, norma: null, data_contrato: null, ressalvas: [] };
  }

  const [codigo, marco] = ORDEM.find(([, chave]) => dia >= paraDia(MARCOS_INSS[chave].inicio)) || ["IN_28_2008", null];
  const ressalvas = [];
  if (marco && !MARCOS_INSS[marco].conferido) {
    ressalvas.push(`O início deste regime (${dataBr(MARCOS_INSS[marco].inicio)}) foi informado por fonte secundária e ainda não foi conferido no Diário Oficial da União.`);
  }
  for (const [chave, m] of Object.entries(MARCOS_INSS)) {
    if (m.conferido) continue;
    const distancia = Math.round(Math.abs(dia - paraDia(m.inicio)) / DIA_MS);
    if (distancia > JANELA_FRONTEIRA_DIAS) continue;
    const relacao = distancia === 0 ? "coincide com o início presumido" : `dista ${dias(distancia)} do início presumido`;
    ressalvas.push(`O contrato ${relacao} de ${citarMarco(chave)} (${dataBr(m.inicio)}). Se a vigência conferida for outra, o regime aplicável muda.`);
  }
  if (confiancaData === "BAIXA") {
    ressalvas.push("A data do contrato foi lida sem rótulo de contratação; o enquadramento no regime depende da confirmação dessa data no instrumento.");
  }

  return {
    codigo,
    rotulo: REGIMES[codigo],
    marco,
    norma: marco ? citarMarco(marco) : "IN INSS/PRES nº 28/2008",
    data_contrato: dataContrato,
    ressalvas,
  };
}

/** Itens de fundamentação do regime, no formato [dispositivo, texto] do § 9. */
export function fundamentacaoDoRegime(regime) {
  if (!regime || regime.codigo === "INDETERMINADO") return [];
  if (regime.codigo === "IN_28_2008") {
    return [["IN INSS/PRES nº 28/2008", "Regime de consignação vigente até 30/11/2022, revogado pelo art. 39 da IN PRES/INSS nº 138/2022 e aplicável ao contrato por direito intertemporal."]];
  }
  const itens = [[
    "IN PRES/INSS nº 138/2022, art. 4º, VIII, e art. 5º, II, III e § 5º",
    "Reconhecimento biométrico como rotina que confirma a operação feita pelo beneficiário; autorização expressa com biometria, vedadas a autorização por telefone e a gravação de voz como prova; documento oficial com foto.",
  ]];
  if (REGIMES_MEU_INSS.has(regime.codigo)) {
    itens.push([citarMarco("MEU_INSS"), "Autorização da operação no aplicativo Meu INSS com biometria facial e validação de vivacidade, em etapa distinta da assinatura com a instituição."]);
  }
  if (regime.codigo === "IN_213_VIA_DUPLA") {
    itens.push([citarMarco("IN_213"), `Autorização por biometria facial ou, para o beneficiário sem biometria nas bases oficiais, pela conta gov.br com validação dos dados bancários; vedação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício.`]);
  }
  return itens;
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd backend && npx vitest run tests/engine/regimeInss.test.js`
Esperado: PASS (todos os casos).

- [ ] **Passo 5: commit**

```bash
cd /Users/narcisojunior/Documents/repositorios/Forense_DOC/forensedoc-ForenseDoc
/opt/homebrew/bin/git add docs/superpowers/plans/2026-09-25-regimes-autorizacao-inss.md backend/src/engine/regimeInss.js backend/tests/engine/regimeInss.test.js
/opt/homebrew/bin/git commit -m "feat(motor): enquadra o consignado INSS no regime de autorização pela data do contrato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 2: leitura das evidências de autorização no texto

**Arquivos:**
- Criar: `backend/src/engine/evidenciasAutorizacao.js`
- Teste: `backend/tests/engine/evidenciasAutorizacao.test.js`

**Interfaces:**
- Produz: `extrairEvidenciasAutorizacao(texto: string)` devolvendo

```js
{
  meu_inss: { mencionado: boolean, autorizacao: { data: string, hora: string|null } | null, via_facial: boolean, vivacidade: boolean, bases_oficiais: string[] },
  govbr: { mencionado: boolean, nivel: "bronze"|"prata"|"ouro"|null, ip: string|null, dispositivo: string|null },
  via: "FACIAL" | "GOVBR" | "AMBIGUA" | null,
  biometria_cadastrada: true | false | null,
  conta_validada: { banco: string|null, agencia: string, conta: string } | null,
  conta_beneficio: { banco: string|null, agencia: string, conta: string } | null,
  averbacao: { data: string, hora: string|null } | null,
  demonstrativo_previo: boolean,
  dib: string | null,
}
```

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";

const MEU_INSS_FACIAL = [
  "Autorização no Meu INSS registrada em 10/06/2026 às 14:32:10.",
  "Método: biometria facial com prova de vivacidade, confronto com a base da CNH.",
  "Averbação em 11/06/2026. DIB: 02/01/2026.",
  "Demonstrativo prévio da operação apresentado em 09/06/2026.",
].join("\n");

const GOVBR = [
  "Autorização no Meu INSS em 20/08/2026 10:00 por acesso gov.br, nível prata.",
  "IP 177.10.20.30 Dispositivo: Android 14 SM-A155M",
  "Beneficiário sem biometria cadastrada nas bases oficiais.",
  "Conta bancária validada: Banco 104 Agência 1234 Conta 55555-1",
  "Conta de recebimento do benefício: Banco 104 Agência 1234 Conta 99999-0",
].join("\n");

describe("evidências de autorização do consignado INSS", () => {
  it("lê a autorização facial no Meu INSS", () => {
    const e = extrairEvidenciasAutorizacao(MEU_INSS_FACIAL);
    expect(e.meu_inss.autorizacao).toEqual({ data: "10/06/2026", hora: "14:32:10" });
    expect(e.meu_inss.via_facial).toBe(true);
    expect(e.meu_inss.vivacidade).toBe(true);
    expect(e.meu_inss.bases_oficiais).toEqual(["CNH"]);
    expect(e.via).toBe("FACIAL");
    expect(e.averbacao).toEqual({ data: "11/06/2026", hora: null });
    expect(e.dib).toBe("02/01/2026");
    expect(e.demonstrativo_previo).toBe(true);
    expect(e.biometria_cadastrada).toBeNull();
  });

  it("lê a via gov.br com nível, IP, dispositivo e contas", () => {
    const e = extrairEvidenciasAutorizacao(GOVBR);
    expect(e.via).toBe("GOVBR");
    expect(e.govbr).toEqual({ mencionado: true, nivel: "prata", ip: "177.10.20.30", dispositivo: "Android 14 SM-A155M" });
    expect(e.biometria_cadastrada).toBe(false);
    expect(e.conta_validada).toEqual({ banco: "104", agencia: "1234", conta: "55555-1" });
    expect(e.conta_beneficio).toEqual({ banco: "104", agencia: "1234", conta: "99999-0" });
  });

  it("biometria declarada como cadastrada", () => {
    expect(extrairEvidenciasAutorizacao("Beneficiário com biometria cadastrada na base da CNH.").biometria_cadastrada).toBe(true);
  });

  it("duas vias mencionadas ficam ambíguas", () => {
    expect(extrairEvidenciasAutorizacao(`${MEU_INSS_FACIAL}\n${GOVBR}`).via).toBe("AMBIGUA");
  });

  it("horário isolado não é lido como IPv6", () => {
    expect(extrairEvidenciasAutorizacao("Acesso gov.br às 10:25:33, nível ouro.").govbr.ip).toBeNull();
  });

  it("texto sem nada disso devolve tudo vazio", () => {
    const e = extrairEvidenciasAutorizacao("Cédula de crédito bancário. Selfie capturada.");
    expect(e.meu_inss.mencionado).toBe(false);
    expect(e.meu_inss.autorizacao).toBeNull();
    expect(e.via).toBeNull();
    expect(e.dib).toBeNull();
    expect(e.demonstrativo_previo).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/evidenciasAutorizacao.test.js`
Esperado: FAIL, módulo inexistente.

- [ ] **Passo 3: implementar**

```js
/**
 * O que o dossiê traz sobre a autorização do consignado INSS.
 *
 * Nos contratos com autorização no Meu INSS a prova central é o registro dessa
 * autorização, mantido pelo INSS e pela Dataprev, e não a selfie da instituição.
 * Este módulo só lê o texto: diz o que está e o que falta. Quem decide se a
 * falta é achado é `avaliacaoInss.js`, conforme o regime.
 *
 * A via facial só conta quando o termo aparece perto de "Meu INSS": a selfie da
 * própria instituição também é descrita como "biometria facial".
 */

const DATA_HORA = /(\d{2}\/\d{2}\/\d{4})(?:[^\d\n]{1,8}(\d{2}:\d{2}(?::\d{2})?))?/;
const CONTA = /(?:Banco\s*:?\s*(\d{3})[\s\S]{0,40}?)?Ag[êe]ncia\s*:?\s*(\d{3,6}(?:-\d)?)[\s\S]{0,40}?Conta\s*:?\s*([\d.]{3,15}-?[\dxX]?)/i;
const IP = /\b((?:\d{1,3}\.){3}\d{1,3}|(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4})\b/i;

/** Trechos ao redor de cada ocorrência do termo, unidos. */
function janelas(texto, regex, raio) {
  const global = new RegExp(regex.source, regex.flags.includes("g") ? regex.flags : `${regex.flags}g`);
  return Array.from(texto.matchAll(global), (m) => texto.slice(Math.max(0, m.index - raio), m.index + m[0].length + raio)).join("\n");
}

function dataDepois(texto, rotulo, alcance = 160) {
  const m = texto.match(rotulo);
  if (!m) return null;
  const d = texto.slice(m.index, m.index + m[0].length + alcance).match(DATA_HORA);
  return d ? { data: d[1], hora: d[2] || null } : null;
}

function contaDepois(texto, rotulo, alcance = 200) {
  const m = texto.match(rotulo);
  if (!m) return null;
  const c = texto.slice(m.index, m.index + m[0].length + alcance).match(CONTA);
  return c ? { banco: c[1] || null, agencia: c[2], conta: c[3] } : null;
}

export function extrairEvidenciasAutorizacao(texto) {
  const t = String(texto || "");
  const meuInss = janelas(t, /Meu\s*INSS/i, 400);
  const govbr = janelas(t, /gov\.br/i, 300);

  const viaFacial = /(?:biometria|reconhecimento|valida[çc][ãa]o)\s+facial/i.test(meuInss);
  const viaGovbr = /(?:conta|login|acesso|autentica[çc][ãa]o)\s+(?:na\s+|pela\s+|via\s+)?gov\.br|gov\.br[\s\S]{0,120}n[íi]vel/i.test(t);
  const bases = [
    /\bCNH\b|Carteira\s+Nacional\s+de\s+Habilita[çc][ãa]o|SENATRAN/i.test(meuInss) ? "CNH" : null,
    /Justi[çc]a\s+Eleitoral|\bTSE\b/i.test(meuInss) ? "Justiça Eleitoral" : null,
  ].filter(Boolean);

  const semBiometria = /sem\s+biometria\s+(?:facial\s+)?(?:cadastrada|nas\s+bases)|biometria\s+(?:facial\s+)?n[ãa]o\s+(?:cadastrada|localizada|encontrada)/i.test(t);
  const comBiometria = /(?:possui|com)\s+biometria\s+(?:facial\s+)?cadastrada|biometria\s+(?:facial\s+)?(?:cadastrada|localizada|encontrada)\s+nas?\s+bases?/i.test(t);
  const nivel = govbr.match(/n[íi]vel\s+(?:da\s+conta\s+)?(bronze|prata|ouro)|conta\s+(bronze|prata|ouro)/i);

  return {
    meu_inss: {
      mencionado: Boolean(meuInss),
      autorizacao: dataDepois(t, /autoriza[çc][ãa]o[^.\n]{0,80}Meu\s*INSS|Meu\s*INSS[^.\n]{0,80}autoriza/i),
      via_facial: viaFacial,
      vivacidade: /vivacidade|liveness|prova\s+de\s+vida/i.test(meuInss),
      bases_oficiais: bases,
    },
    govbr: {
      mencionado: viaGovbr,
      nivel: nivel ? (nivel[1] || nivel[2]).toLowerCase() : null,
      ip: govbr.match(IP)?.[1] || null,
      dispositivo: govbr.match(/(?:dispositivo|aparelho|user[\s-]?agent)\s*[:\-]?\s*([^\n]{3,80})/i)?.[1]?.trim() || null,
    },
    via: viaFacial && viaGovbr ? "AMBIGUA" : viaFacial ? "FACIAL" : viaGovbr ? "GOVBR" : null,
    biometria_cadastrada: semBiometria ? false : comBiometria ? true : null,
    conta_validada: contaDepois(t, /conta\s+(?:banc[áa]ria\s+)?validada/i),
    conta_beneficio: contaDepois(t, /conta\s+(?:de\s+)?recebimento\s+do\s+benef[íi]cio/i),
    averbacao: dataDepois(t, /averba[çc][ãa]o|averbad[oa]\s+em/i),
    demonstrativo_previo: /demonstrativo\s+pr[ée]vio|simula[çc][ãa]o\s+pr[ée]via|demonstrativo\s+(?:da\s+)?opera[çc][ãa]o\s+anterior/i.test(t),
    dib: t.match(/\bDIB\b\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})|Data\s+de\s+In[íi]cio\s+do\s+Benef[íi]cio\s*[:\-]?\s*(\d{2}\/\d{2}\/\d{4})/i)?.slice(1).find(Boolean) || null,
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd backend && npx vitest run tests/engine/evidenciasAutorizacao.test.js`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/evidenciasAutorizacao.js backend/tests/engine/evidenciasAutorizacao.test.js
/opt/homebrew/bin/git commit -m "feat(motor): lê do dossiê as evidências de autorização no Meu INSS e na conta gov.br

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 3: achados dos regimes IN 138 e Meu INSS (INS0, INS2, INS3, INS4)

**Arquivos:**
- Criar: `backend/src/engine/avaliacaoInss.js`
- Teste: `backend/tests/engine/avaliacaoInss.test.js`

**Interfaces:**
- Consome: `citarDispositivo`, `citarMarco`, `diasEntre`, `paraDia`, `MARCOS_INSS`, `REGRA_DIB`, `REGIMES_COM_IN138`, `REGIMES_MEU_INSS` (Tarefa 1); objeto de `extrairEvidenciasAutorizacao` (Tarefa 2).
- Produz: `avaliarAutorizacaoInss({ regime, evidencias, contrato, liberacao }): { achados: Array<{codigo, gravidade, titulo, texto}>, diligencias: Array<{chave, titulo, texto}> }`. O `regime` recebido já traz `via` (a Tarefa 5 preenche).

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { avaliarAutorizacaoInss } from "../../src/engine/avaliacaoInss.js";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";

const codigos = (r) => r.achados.map((a) => a.codigo);
const avaliar = (regime, texto, extra = {}) => avaliarAutorizacaoInss({ regime, evidencias: extrairEvidenciasAutorizacao(texto), ...extra });

const IN138 = { codigo: "IN_138_SELFIE_BANCO", rotulo: "Selfie colhida e guardada pela instituição", data_contrato: "15/03/2025", via: null };
const MEU_INSS = { codigo: "MEU_INSS_BIOMETRIA", rotulo: "Autorização no Meu INSS com biometria facial e validação de vivacidade", data_contrato: "10/06/2026", via: "FACIAL" };
const COMPLETO = "Autorização no Meu INSS em 10/06/2026 às 14:32:10 por biometria facial com prova de vivacidade, confronto com a CNH. Demonstrativo prévio anexo.";

describe("autorização INSS: regimes IN 138 e Meu INSS", () => {
  it("fora do consignado INSS não avalia nada", () => {
    expect(avaliar(null, "")).toEqual({ achados: [], diligencias: [] });
  });

  it("sem data do contrato aponta INS0 e para", () => {
    expect(codigos(avaliar({ codigo: "INDETERMINADO" }, ""))).toEqual(["INS0"]);
  });

  it("contrato sob a IN 28/2008 não recebe exigências da IN 138", () => {
    expect(avaliar({ codigo: "IN_28_2008", data_contrato: "10/05/2021" }, "").achados).toEqual([]);
  });

  it("regime 138 sem demonstrativo prévio aponta INS2 e não pede ofício ao INSS", () => {
    const r = avaliar(IN138, "Contrato sem anexos");
    expect(codigos(r)).toEqual(["INS2"]);
    expect(r.diligencias).toEqual([]);
  });

  it("INS2 não cita artigo que o jurídico não conferiu", () => {
    expect(avaliar(IN138, "").achados[0].texto).not.toMatch(/§ 9º/);
  });

  it("regime Meu INSS sem registro da autorização aponta INS3 e pede ofício", () => {
    const r = avaliar(MEU_INSS, "Selfie colhida pelo banco. Demonstrativo prévio anexo.");
    expect(codigos(r)).toContain("INS3");
    expect(r.achados.find((a) => a.codigo === "INS3").texto).toMatch(/não a fotografia colhida pela instituição/);
    expect(r.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("registro completo da autorização não gera INS3, mas mantém o ofício", () => {
    const r = avaliar(MEU_INSS, COMPLETO);
    expect(codigos(r)).not.toContain("INS3");
    expect(r.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("averbação anterior à autorização aponta INS4", () => {
    expect(codigos(avaliar(MEU_INSS, `Averbação em 09/06/2026 10:00. ${COMPLETO}`))).toContain("INS4");
  });

  it("crédito anterior à autorização aponta INS4", () => {
    const r = avaliar(MEU_INSS, COMPLETO, { liberacao: { comprovante: { data: "09/06/2026" } } });
    expect(r.achados.find((a) => a.codigo === "INS4").texto).toMatch(/crédito comprovado \(09\/06\/2026\)/);
  });

  it("crédito no mesmo dia, sem hora, não permite afirmar anterioridade", () => {
    expect(codigos(avaliar(MEU_INSS, COMPLETO, { liberacao: { comprovante: { data: "10/06/2026" } } }))).not.toContain("INS4");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/avaliacaoInss.test.js`
Esperado: FAIL, módulo inexistente.

- [ ] **Passo 3: implementar**

```js
import {
  citarDispositivo, citarMarco, diasEntre, paraDia, MARCOS_INSS, REGRA_DIB, REGIMES_COM_IN138, REGIMES_MEU_INSS,
} from "./regimeInss.js";

/**
 * Achados da autorização do consignado INSS, conforme o regime da data do
 * contrato (regimeInss.js) e o que o dossiê traz (evidenciasAutorizacao.js).
 *
 * INS1 (correspondente de outra UF) não mora aqui: depende do domicílio de
 * referência do § 5 e é produzido em irregularitySummary.js.
 */

const lista = (itens) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens.at(-1)}`);
const dataHora = (x) => `${x.data}${x.hora ? ` ${x.hora}` : ""}`;

/** `a` é anterior a `b`? Mesmo dia só conta com as duas horas. */
function anterior(a, b) {
  const d = diasEntre(b.data, a.data);
  if (d === null) return false;
  if (d !== 0) return d < 0;
  return Boolean(a.hora && b.hora && a.hora < b.hora);
}

export function avaliarAutorizacaoInss({ regime, evidencias, contrato = {}, liberacao = {} }) {
  const achados = [];
  const diligencias = [];
  if (!regime) return { achados, diligencias };
  const add = (codigo, gravidade, titulo, texto) => achados.push({ codigo, gravidade, titulo, texto });
  const e = evidencias || {};

  if (regime.codigo === "INDETERMINADO") {
    add("INS0", "MÉDIA", "Regime de autorização do benefício não determinado", "A data do contrato não foi localizada no instrumento. No consignado em benefício do INSS a régua de exame depende dessa data: até 30/11/2022 vale a IN INSS/PRES nº 28/2008; de 1º/12/2022 em diante, a IN PRES/INSS nº 138/2022, com selfie colhida pela instituição; a partir de maio de 2026, a autorização no Meu INSS com biometria facial; e a partir de 17/08/2026, também a via gov.br. A data deve ser confirmada antes de qualquer conclusão sobre a biometria.");
    return { achados, diligencias };
  }

  if (REGIMES_COM_IN138.has(regime.codigo) && !e.demonstrativo_previo) {
    add("INS2", "MÉDIA", "Demonstrativo prévio da operação não localizado", `O dossiê não traz o demonstrativo prévio exigido pela ${citarDispositivo("DEMONSTRATIVO_PREVIO")}, documento próprio e anterior ao contrato. Sem ele não se verifica o que foi informado ao beneficiário antes da contratação.`);
  }

  if (REGIMES_MEU_INSS.has(regime.codigo)) {
    diligencias.push({
      chave: "oficio-inss-dataprev",
      titulo: "Ofício ao INSS e à Dataprev",
      texto: `Requisitar ao INSS e à Dataprev, por ofício, o registro da autorização da operação no Meu INSS${contrato.numero ? ` referente ao contrato ${contrato.numero}` : ""}, com data, hora, método de validação (biometria facial ou conta gov.br), base oficial usada no confronto facial, resultado da validação de vivacidade e, na via gov.br, nível da conta, IP, dispositivo e conta bancária validada. O que a instituição juntar sozinha não substitui esse registro.`,
    });

    if (regime.via !== "GOVBR") {
      const m = e.meu_inss || {};
      const ausentes = [];
      if (!m.autorizacao) ausentes.push("o registro da autorização no Meu INSS com data e hora");
      else if (!m.autorizacao.hora) ausentes.push("a hora da autorização no Meu INSS");
      if (!m.via_facial) ausentes.push("o método de validação usado");
      if (!m.vivacidade) ausentes.push("o resultado da validação de vivacidade");
      if (!(m.bases_oficiais || []).length) ausentes.push("a base oficial usada no confronto facial (CNH ou Justiça Eleitoral)");
      if (ausentes.length) {
        add("INS3", "ALTA", "Autorização no Meu INSS não demonstrada", `No regime aplicável à data do contrato (${regime.rotulo}), a prova central da manifestação do beneficiário é o registro da autorização no Meu INSS, mantido pelo INSS e pela Dataprev, e não a fotografia colhida pela instituição. O dossiê não traz ${lista(ausentes)}.`);
      }
    }

    const autorizacao = e.meu_inss?.autorizacao;
    if (autorizacao) {
      const credito = liberacao?.comprovante?.data ? { data: liberacao.comprovante.data, hora: null } : null;
      const anteriores = [
        e.averbacao && anterior(e.averbacao, autorizacao) ? `a averbação (${dataHora(e.averbacao)})` : null,
        credito && anterior(credito, autorizacao) ? `o crédito comprovado (${credito.data})` : null,
      ].filter(Boolean);
      if (anteriores.length) {
        add("INS4", "ALTA", "Averbação ou crédito anterior à autorização no Meu INSS", `O dossiê registra a autorização no Meu INSS em ${dataHora(autorizacao)}, mas ${lista(anteriores)} ${anteriores.length > 1 ? "são anteriores" : "é anterior"} a ela. A sequência esperada é proposta na instituição, autorização no Meu INSS, averbação e liberação.`);
      }
    }
  }

  return { achados, diligencias };
}
```

A Tarefa 4 acrescenta, antes do `return` final, os blocos da IN 213 e da DIB. Os imports `citarMarco`, `paraDia`, `MARCOS_INSS` e `REGRA_DIB` já ficam declarados aqui para isso.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd backend && npx vitest run tests/engine/avaliacaoInss.test.js`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/avaliacaoInss.js backend/tests/engine/avaliacaoInss.test.js
/opt/homebrew/bin/git commit -m "feat(motor): achados de autorização INSS nos regimes da IN 138 e do Meu INSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 4: achados da IN 213 e da DIB (INS5 a INS11)

**Arquivos:**
- Modificar: `backend/src/engine/avaliacaoInss.js`
- Teste: `backend/tests/engine/avaliacaoInss213.test.js`

**Interfaces:**
- Consome: `avaliarAutorizacaoInss` da Tarefa 3.
- Produz: os mesmos retornos, agora com `INS5` a `INS11` e a diligência `dib-beneficio`.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { avaliarAutorizacaoInss } from "../../src/engine/avaliacaoInss.js";
import { extrairEvidenciasAutorizacao } from "../../src/engine/evidenciasAutorizacao.js";

const codigos = (r) => r.achados.map((a) => a.codigo);
const IN213 = (via, data = "25/08/2026") => ({ codigo: "IN_213_VIA_DUPLA", rotulo: "Autorização no Meu INSS por biometria facial ou pela conta gov.br", data_contrato: data, via });
const avaliar = (regime, texto) => avaliarAutorizacaoInss({ regime, evidencias: extrairEvidenciasAutorizacao(texto) });

const GOVBR_COMPLETO = [
  "Autorização no Meu INSS em 25/08/2026 às 10:00 por acesso gov.br, nível prata.",
  "IP 177.10.20.30 Dispositivo: Android 14 SM-A155M",
  "Beneficiário sem biometria cadastrada nas bases oficiais.",
  "Conta bancária validada: Banco 104 Agência 1234 Conta 99999-0",
  "Conta de recebimento do benefício: Banco 104 Agência 1234 Conta 99999-0",
  "DIB: 01/01/2026. Demonstrativo prévio anexo.",
].join("\n");

describe("autorização INSS: IN 213 e DIB", () => {
  it("via não identificada aponta INS5", () => {
    expect(codigos(avaliar(IN213(null), "DIB: 01/01/2026"))).toContain("INS5");
  });

  it("via ambígua explica que as duas foram mencionadas", () => {
    const r = avaliar(IN213("AMBIGUA"), "DIB: 01/01/2026");
    expect(r.achados.find((a) => a.codigo === "INS5").texto).toMatch(/tanto a biometria facial quanto/);
  });

  it("via gov.br completa e cabível não gera achado de via", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO);
    expect(codigos(r)).toEqual([]);
  });

  it("via gov.br com biometria cadastrada aponta INS6", () => {
    const texto = GOVBR_COMPLETO.replace("sem biometria cadastrada nas bases oficiais", "com biometria cadastrada na base da CNH");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS6");
  });

  it("via gov.br sem prova de que faltava biometria aponta INS7", () => {
    const texto = GOVBR_COMPLETO.replace("Beneficiário sem biometria cadastrada nas bases oficiais.", "");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS7");
  });

  it("via gov.br sem log aponta INS8 com a lista do que falta", () => {
    const r = avaliar(IN213("GOVBR"), "Autorização no Meu INSS em 25/08/2026 por acesso gov.br. DIB: 01/01/2026.");
    const ins8 = r.achados.find((a) => a.codigo === "INS8");
    expect(ins8.texto).toMatch(/nível da conta gov\.br, o IP de acesso, o dispositivo de acesso e a conta bancária validada/);
  });

  it("via gov.br não cobra selfie nem prova de vida (sem INS3)", () => {
    expect(codigos(avaliar(IN213("GOVBR"), "Acesso gov.br. DIB: 01/01/2026."))).not.toContain("INS3");
  });

  it("conta validada diferente da conta do benefício aponta INS9", () => {
    const texto = GOVBR_COMPLETO.replace("Conta bancária validada: Banco 104 Agência 1234 Conta 99999-0", "Conta bancária validada: Banco 104 Agência 1234 Conta 55555-1");
    expect(codigos(avaliar(IN213("GOVBR"), texto))).toContain("INS9");
  });

  it("via facial na IN 213 segue a régua do Meu INSS (INS3)", () => {
    expect(codigos(avaliar(IN213("FACIAL"), "DIB: 01/01/2026"))).toContain("INS3");
  });

  it("contrato 46 dias depois da DIB aponta INS10", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO.replace("DIB: 01/01/2026", "DIB: 10/07/2026"));
    expect(r.achados.find((a) => a.codigo === "INS10").texto).toMatch(/46 dias depois da data de início do benefício/);
  });

  it("sem DIB aponta INS11 e pede a carta de concessão", () => {
    const r = avaliar(IN213("GOVBR"), GOVBR_COMPLETO.replace("DIB: 01/01/2026. ", ""));
    expect(codigos(r)).toContain("INS11");
    expect(r.diligencias.map((d) => d.chave)).toContain("dib-beneficio");
  });

  it("a vedação dos 90 dias não alcança contrato anterior à IN 213", () => {
    const regime = { codigo: "MEU_INSS_BIOMETRIA", rotulo: "Meu INSS", data_contrato: "10/06/2026", via: "FACIAL" };
    expect(codigos(avaliar(regime, ""))).not.toContain("INS11");
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/avaliacaoInss213.test.js`
Esperado: FAIL nos casos de INS5 a INS11 (códigos ausentes). O caso "via gov.br completa" já passa.

- [ ] **Passo 3: implementar**

Em `backend/src/engine/avaliacaoInss.js`, acrescentar no topo, junto de `lista`:

```js
const normalizarConta = (c) => String(c || "").replace(/\D/g, "");
```

e inserir, imediatamente antes do `return { achados, diligencias };` final:

```js
  if (regime.codigo === "IN_213_VIA_DUPLA") {
    const via = regime.via;
    if (!via || via === "AMBIGUA") {
      add("INS5", "MÉDIA", "Via de autorização não identificada", via === "AMBIGUA"
        ? "O dossiê menciona tanto a biometria facial quanto o acesso pela conta gov.br, sem indicar qual via autorizou a operação. As duas vias têm requisitos e provas diferentes, e a via usada deve ser informada pelo INSS."
        : "O dossiê não indica se a operação foi autorizada no Meu INSS por biometria facial ou pela conta gov.br. As duas vias têm requisitos e provas diferentes, e a via usada deve ser informada pelo INSS.");
    }
    if (via === "GOVBR") {
      if (e.biometria_cadastrada === true) {
        add("INS6", "ALTA", "Via gov.br usada por beneficiário com biometria cadastrada", `O dossiê indica que o beneficiário tinha biometria facial nas bases oficiais e, ainda assim, a operação foi autorizada pela conta gov.br. Pela ${citarMarco("IN_213")}, quem tem foto cadastrada continua obrigado à validação facial, e a via gov.br não era cabível.`);
      }
      if (e.biometria_cadastrada === null) {
        add("INS7", "ALTA", "Cabimento da via gov.br não demonstrado", `A operação foi autorizada pela conta gov.br, via que a ${citarMarco("IN_213")} reserva ao beneficiário sem biometria nas bases oficiais. O dossiê não demonstra essa condição, que deve ser confirmada pelo INSS.`);
      }
      const faltas = [
        e.govbr?.nivel ? null : "o nível da conta gov.br",
        e.govbr?.ip ? null : "o IP de acesso",
        e.govbr?.dispositivo ? null : "o dispositivo de acesso",
        e.conta_validada ? null : "a conta bancária validada",
      ].filter(Boolean);
      if (faltas.length) {
        add("INS8", "ALTA", "Registro de acesso gov.br incompleto", `Na via gov.br, a fotografia e a prova de vida deixam de ser o objeto do exame; entram o registro de acesso à conta gov.br e a conta bancária validada. O dossiê não traz ${lista(faltas)}.`);
      }
      const validada = e.conta_validada;
      const beneficio = e.conta_beneficio;
      if (validada && beneficio && normalizarConta(validada.conta) !== normalizarConta(beneficio.conta)) {
        add("INS9", "ALTA", "Conta validada diverge da conta do benefício", `A conta validada na autorização gov.br (agência ${validada.agencia}, conta ${validada.conta}) não é a conta de recebimento do benefício (agência ${beneficio.agencia}, conta ${beneficio.conta}). Na via gov.br, a conta validada deve ser a de recebimento do benefício.`);
      }
    }
  }

  if (paraDia(regime.data_contrato) >= paraDia(MARCOS_INSS[REGRA_DIB.marco].inicio)) {
    const norma = citarMarco(REGRA_DIB.marco);
    if (!e.dib) {
      add("INS11", "MÉDIA", "Data de início do benefício não localizada", `A ${norma} vedou a contratação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício. O dossiê não traz a data de início do benefício (DIB), e o confronto com a data do contrato fica pendente.`);
      diligencias.push({ chave: "dib-beneficio", titulo: "Data de início do benefício", texto: "Juntar a carta de concessão ou o extrato HISCRE com a data de início do benefício (DIB), para confronto com a data do contrato." });
    } else {
      const decorridos = diasEntre(e.dib, regime.data_contrato);
      if (decorridos !== null && decorridos >= 0 && decorridos < REGRA_DIB.dias) {
        add("INS10", "ALTA", `Contrato nos primeiros ${REGRA_DIB.dias} dias do benefício`, `O contrato (${regime.data_contrato}) foi celebrado ${decorridos} ${decorridos === 1 ? "dia" : "dias"} depois da data de início do benefício (${e.dib}). A ${norma} vedou a contratação de consignado nos primeiros ${REGRA_DIB.dias} dias do benefício.`);
      }
    }
  }
```

- [ ] **Passo 4: rodar as duas suítes de avaliação**

Rodar: `cd backend && npx vitest run tests/engine/avaliacaoInss.test.js tests/engine/avaliacaoInss213.test.js`
Esperado: PASS nas duas. Atenção ao caso "via gov.br completa": `GOVBR_COMPLETO` tem demonstrativo prévio e DIB de 01/01/2026 (237 dias antes do contrato), então nenhum `INS` sai.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/avaliacaoInss.js backend/tests/engine/avaliacaoInss213.test.js
/opt/homebrew/bin/git commit -m "feat(motor): via gov.br, conta validada e vedação dos 90 dias da DIB na IN 213

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 5: integração na extração e UF do correspondente

**Arquivos:**
- Modificar: `backend/src/engine/extraction.js` (imports no topo; linhas 785 a 786; objeto `correspondente` na linha 1294; bloco novo logo depois do laço do seguro, por volta da linha 1528)
- Criar: `backend/tests/helpers/textoInss.js` (texto sintético compartilhado com a Tarefa 11)
- Teste: `backend/tests/engine/regimeInssExtracao.test.js`

**Interfaces:**
- Consome: Tarefas 1 a 4.
- Produz: `extracted.regime_inss` com `{ codigo, rotulo, marco, norma, data_contrato, ressalvas, via, via_rotulo, regra_dib_dias, nota_oficio, evidencias, diligencias, fundamentacao }` ou `null`; `extracted.correspondente.uf`; achados `INS0`, `INS2` a `INS11` em `achados_irregularidade`.

- [ ] **Passo 1: escrever o helper e o teste que falha**

`backend/tests/helpers/textoInss.js`:

```js
/** Dossiê sintético de consignado INSS no regime da IN 213, via gov.br. */
export const TEXTO_GOVBR = [
  "CONTRATO DE EMPRÉSTIMO PESSOAL - CONSIGNADO - INSS",
  "Nome do Cliente: Maria Aparecida Souza Cidade: Teresina UF: PI",
  "NB: 1234567890",
  "Data da contratação: 25/08/2026",
  "DIB: 10/07/2026",
  "Averbação em 25/08/2026 16:00.",
  "Autorização no Meu INSS registrada em 26/08/2026 às 09:15:00 por acesso gov.br, nível prata.",
  "IP 177.10.20.30",
  "Dispositivo: Android 14 SM-A155M",
  "Conta bancária validada: Banco 104 Agência 1234 Conta 55555-1",
  "Conta de recebimento do benefício: Banco 104 Agência 1234 Conta 99999-0",
  "VII - CORRESPONDENTE NO PAÍS Nome: Promotora Exemplo Cidade: São Paulo UF: SP",
].join("\n");
```

`backend/tests/engine/regimeInssExtracao.test.js`:

```js
import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { heuristicExtractionFromText } from "../../src/engine/extraction.js";
import { TEXTO_GOVBR } from "../helpers/textoInss.js";

describe("regime INSS na extração", () => {
  it("classifica o regime e leva os achados da via gov.br", () => {
    const e = heuristicExtractionFromText(TEXTO_GOVBR);
    expect(e.contrato.produto_codigo).toBe("CONSIGNADO_INSS");
    expect(e.regime_inss.codigo).toBe("IN_213_VIA_DUPLA");
    expect(e.regime_inss.via).toBe("GOVBR");
    expect(e.regime_inss.via_rotulo).toBe("Conta gov.br com validação dos dados bancários");
    expect(e.regime_inss.nota_oficio).toMatch(/requisitado por ofício/);
    const codigos = e.achados_irregularidade.map((a) => a.codigo);
    expect(codigos).toEqual(expect.arrayContaining(["INS2", "INS4", "INS7", "INS9", "INS10"]));
    expect(codigos).not.toContain("INS3");
    expect(e.regime_inss.fundamentacao.length).toBe(3);
    expect(e.regime_inss.diligencias.map((d) => d.chave)).toContain("oficio-inss-dataprev");
  });

  it("extrai a UF do correspondente", () => {
    expect(heuristicExtractionFromText(TEXTO_GOVBR).correspondente.uf).toBe("SP");
  });

  it("o dossiê C6 (CLT) fica sem regime e sem achados INS", async () => {
    const caso = JSON.parse(await readFile(new URL("../corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
    const e = heuristicExtractionFromText(caso.texto);
    expect(e.regime_inss).toBeNull();
    expect(e.achados_irregularidade.some((a) => /^INS\d/.test(a.codigo))).toBe(false);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/regimeInssExtracao.test.js`
Esperado: FAIL, `e.regime_inss` indefinido e `correspondente.uf` indefinido.

- [ ] **Passo 3: implementar**

No topo de `extraction.js`, junto dos outros imports do motor:

```js
import { classificarRegimeInss, fundamentacaoDoRegime, NOTA_OFICIO_INSS, REGIMES_MEU_INSS, REGRA_DIB, ROTULOS_VIA } from "./regimeInss.js";
import { extrairEvidenciasAutorizacao } from "./evidenciasAutorizacao.js";
import { avaliarAutorizacaoInss } from "./avaliacaoInss.js";
```

Logo depois da linha 786 (`const correspondenteCidade = ...`):

```js
  const correspondenteUf = firstMatch(correspondentBlock || "", [/\b(?:UF|Estado)\s*[:\-]?\s*([A-Z]{2})\b/]);
```

No objeto `correspondente` (linha 1294), depois de `cidade: correspondenteCidade,`:

```js
      uf: correspondenteUf,
```

Logo depois de `for (const a of seguro?.achados || []) addIssue(a.codigo, a.gravidade, a.titulo, a.texto);`:

```js
  // Regime de autorização do consignado INSS pela data do contrato. A régua do
  // exame da imagem (§ 4.4) e da autorização depende dele: ver regimeInss.js.
  const regimeInss = classificarRegimeInss({
    produtoCodigo: contratoExtraido.produto_codigo,
    dataContrato: contratoExtraido.data_contrato,
    confiancaData: contratoExtraido.data_contrato_confianca,
  });
  if (regimeInss) {
    const evidencias = extrairEvidenciasAutorizacao(text);
    const via = regimeInss.codigo === "IN_213_VIA_DUPLA" ? evidencias.via : regimeInss.codigo === "MEU_INSS_BIOMETRIA" ? "FACIAL" : null;
    const regime = { ...regimeInss, via };
    const avaliacao = avaliarAutorizacaoInss({ regime, evidencias, contrato: contratoExtraido, liberacao: extracted.liberacao_credito || {} });
    extracted.regime_inss = {
      ...regime,
      via_rotulo: via ? ROTULOS_VIA[via] : regimeInss.codigo === "IN_213_VIA_DUPLA" ? "Não identificada no dossiê" : null,
      regra_dib_dias: REGRA_DIB.dias,
      nota_oficio: REGIMES_MEU_INSS.has(regimeInss.codigo) ? NOTA_OFICIO_INSS : null,
      evidencias,
      diligencias: avaliacao.diligencias,
      fundamentacao: fundamentacaoDoRegime(regimeInss),
    };
    for (const a of avaliacao.achados) addIssue(a.codigo, a.gravidade, a.titulo, a.texto);
  } else {
    extracted.regime_inss = null;
  }
```

- [ ] **Passo 4: rodar e ver passar, e rodar a suíte do motor**

Rodar: `cd backend && npx vitest run tests/engine/regimeInssExtracao.test.js && npx vitest run tests/engine tests/regressaoDossieC6.test.js tests/corpus.test.js`
Esperado: PASS. Se o corpus acusar diferença em caso INSS existente (`banco-pan-cartao-consignado.json`), conferir se o achado `INS` novo é correto para a data daquele contrato antes de atualizar a expectativa; não apagar achado para o teste passar.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/extraction.js backend/tests/helpers/textoInss.js backend/tests/engine/regimeInssExtracao.test.js
/opt/homebrew/bin/git commit -m "feat(motor): grava o regime INSS na extração e lê a UF do correspondente

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 6: INS1, frase normativa no confronto geográfico e diligências do regime

**Arquivos:**
- Modificar: `backend/src/engine/irregularitySummary.js` (import no topo; bloco depois da linha 461, onde `domicilioUf` é calculado; texto do `gps-outro-municipio` na linha 462; diligências perto da linha 589)
- Teste: `backend/tests/engine/irregularitySummaryInss.test.js`

**Interfaces:**
- Consome: `extracted.regime_inss` (Tarefa 5), `REGIMES_COM_IN138`, `citarDispositivo` (Tarefa 1).
- Produz: achado `INS1` em `summary.allFindings`; diligências do regime em `summary.diligences`.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { buildIrregularitySummary } from "../../src/engine/irregularitySummary.js";

function relatorio(extracted) {
  return {
    reportId: "FD-TESTE-INSS",
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    metadata: { totalPages: 2, warnings: [] },
    extracted: {
      contrato: { numero: "123", banco: "Banco Exemplo", data_contrato: "15/03/2025", produto_codigo: "CONSIGNADO_INSS" },
      cliente: { nome: "Maria Aparecida Souza", cidade: "Teresina", estado: "PI" },
      assinatura: {},
      ...extracted,
    },
    ipAnalysis: [],
  };
}

describe("sumário: autorização INSS", () => {
  it("correspondente de outra UF no regime da IN 138 aponta INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "São Paulo", uf: "SP" },
      regime_inss: { codigo: "IN_138_SELFIE_BANCO", diligencias: [] },
    }));
    const ins1 = s.allFindings.find((f) => f.key === "INS1");
    expect(ins1.severity).toBe("ALTA");
    expect(ins1.text).toMatch(/São Paulo\/SP/);
    expect(ins1.text).not.toMatch(/art\. 5º, VIII/);
  });

  it("mesma UF não aponta INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "Parnaíba", uf: "PI" },
      regime_inss: { codigo: "IN_138_SELFIE_BANCO", diligencias: [] },
    }));
    expect(s.allFindings.some((f) => f.key === "INS1")).toBe(false);
  });

  it("contrato sob a IN 28/2008 não recebe INS1", () => {
    const s = buildIrregularitySummary(relatorio({
      correspondente: { cidade: "São Paulo", uf: "SP" },
      regime_inss: { codigo: "IN_28_2008", diligencias: [] },
    }));
    expect(s.allFindings.some((f) => f.key === "INS1")).toBe(false);
  });

  it("diligências do regime entram no sumário", () => {
    const s = buildIrregularitySummary(relatorio({
      regime_inss: { codigo: "MEU_INSS_BIOMETRIA", diligencias: [{ chave: "oficio-inss-dataprev", titulo: "Ofício ao INSS e à Dataprev", texto: "Requisitar o registro." }] },
    }));
    expect(s.diligences.some((d) => d.key === "oficio-inss-dataprev")).toBe(true);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/irregularitySummaryInss.test.js`
Esperado: FAIL, sem `INS1` e sem a diligência. Se `buildIrregularitySummary` lançar erro por campo ausente no relatório mínimo, completar `relatorio()` com os campos de `baseReport()` em `tests/engine/irregularitySummary.test.js`, sem mudar o que o teste verifica.

- [ ] **Passo 3: implementar**

Import no topo de `irregularitySummary.js`:

```js
import { citarDispositivo, REGIMES_COM_IN138 } from "./regimeInss.js";
```

Logo depois da linha `const ufsDiferentes = ...` (linha 461), antes do `if (gpsMunicipio && residenciaMunicipio ...)`:

```js
  // INS1: no consignado INSS (IN 138 em diante), o correspondente tem de estar
  // na UF do domicílio. O domicílio é o mesmo do confronto geográfico do § 5.
  const regimeInss = extracted.regime_inss;
  const regimeComIn138 = Boolean(regimeInss && REGIMES_COM_IN138.has(regimeInss.codigo));
  const ufCorrespondente = String(extracted.correspondente?.uf || contract.correspondente?.uf || "").toUpperCase();
  if (regimeComIn138 && ufCorrespondente && domicilioUf && ufCorrespondente !== normalizeText(domicilioUf).toUpperCase()) {
    const cidadeCorrespondente = extracted.correspondente?.cidade || contract.correspondente?.cidade;
    addFinding("ALTA", "INS1", "Correspondente bancário de outra unidade da federação.", `O correspondente que originou a operação está em ${cidadeCorrespondente ? `${cidadeCorrespondente}/` : ""}${ufCorrespondente}, e o domicílio do beneficiário, em ${domicilioCidade ? `${domicilioCidade}/` : ""}${domicilioUf}${referenciaMunicipio ? " (residência de referência)" : ""}. No consignado em benefício do INSS, a ${citarDispositivo("LOCAL_DOMICILIO")} exige local de contratação compatível com o domicílio do beneficiário.`);
  }
```

Conferir que `normalizeText` devolve a UF sem acento e em caixa comparável; se devolver minúsculas, o `.toUpperCase()` acima já resolve.

No texto do `addFinding("MÉDIA", "gps-outro-municipio", ...)` (linha 462), acrescentar ao final da template string, antes do fechamento da crase:

```js
${regimeComIn138 && ufsDiferentes ? ` No consignado em benefício do INSS, a ${citarDispositivo("LOCAL_DOMICILIO")} exige local de contratação compatível com o domicílio do beneficiário.` : ""}
```

Junto das demais diligências (depois da linha do `addDiligence("biometric-original", ...)`, por volta da linha 590):

```js
  for (const d of extracted.regime_inss?.diligencias || []) addDiligence(d.chave, d.titulo, d.texto);
```

- [ ] **Passo 4: rodar e ver passar, com a suíte geográfica**

Rodar: `cd backend && npx vitest run tests/engine/irregularitySummaryInss.test.js tests/engine/irregularitySummary.test.js tests/engine/conclusaoGeografica.test.js tests/engine/referenciaMunicipal.test.js`
Esperado: PASS. O quadro geográfico continua igual para contratos não INSS.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/irregularitySummary.js backend/tests/engine/irregularitySummaryInss.test.js
/opt/homebrew/bin/git commit -m "feat(sumario): correspondente de outra UF no consignado INSS e diligências do regime

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 7: imagem do dossiê (BIO2 e § 4.4) conforme o regime

**Arquivos:**
- Modificar: `backend/src/engine/biometria.js`
- Modificar: `backend/src/engine/analisarDocumento.js:74-78` (chamada de `analisarBiometria`)
- Teste: `backend/tests/engine/biometriaRegime.test.js`

**Interfaces:**
- Consome: `extracted.regime_inss` (`codigo`, `via`).
- Produz: `analisarBiometria({ imagens, flat, alegaBiometria, regime })`; bloco com o campo novo `nota_regime: string|null`; BIO2 ALTA sem regime ou na IN 138, MÉDIA no regime Meu INSS, ausente na via gov.br.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { analisarBiometria } from "../../src/engine/biometria.js";

const imagens = {
  imagens: [{ biometricaProvavel: true, page: 3, num: 7, width: 400, height: 500, megapixels: 0.2, exif: false, classificacao: "fotografia/biometria provável" }],
};
const base = { imagens, flat: "", alegaBiometria: true };

describe("BIO2 conforme o regime de autorização", () => {
  it("fora do INSS o BIO2 continua ALTA e sem nota", () => {
    const b = analisarBiometria(base);
    expect(b.achado.gravidade).toBe("ALTA");
    expect(b.nota_regime).toBeNull();
  });

  it("regime da IN 138 cobra também o hash da captura", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "IN_138_SELFIE_BANCO" } });
    expect(b.dados_do_processo_ausentes).toContain("hash da captura biométrica");
    expect(b.achado.gravidade).toBe("ALTA");
  });

  it("regime Meu INSS rebaixa o BIO2 e diz que a selfie é complementar", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "MEU_INSS_BIOMETRIA", via: "FACIAL" } });
    expect(b.achado.gravidade).toBe("MÉDIA");
    expect(b.achado.texto).toMatch(/elemento complementar/);
    expect(b.nota_regime).toMatch(/registro da autorização no Meu INSS/);
  });

  it("via gov.br tira a fotografia do objeto e não gera BIO2", () => {
    const b = analisarBiometria({ ...base, regime: { codigo: "IN_213_VIA_DUPLA", via: "GOVBR" } });
    expect(b.achado).toBeNull();
    expect(b.nota_regime).toMatch(/deixam de ser o objeto do exame/);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/biometriaRegime.test.js`
Esperado: FAIL (`nota_regime` indefinido, gravidade sempre ALTA).

- [ ] **Passo 3: implementar**

Em `biometria.js`, depois de `DADOS_DO_PROCESSO_BIOMETRICO`:

```js
/** Na IN 138 a selfie é do banco: o hash da captura entra na lista do que ele tem de mostrar. */
const HASH_DA_CAPTURA = { nome: "hash da captura biométrica", regex: /hash\s+(?:da\s+)?(?:selfie|imagem|captura|biometria)/i };

const NOTA_MEU_INSS = "No regime aplicável à data do contrato, a fotografia colhida pela instituição é elemento complementar: a prova central da manifestação é o registro da autorização no Meu INSS (ver a seção Autorização do benefício).";
const NOTA_GOVBR = "A operação foi autorizada pela conta gov.br. Nessa via a fotografia e a prova de vida deixam de ser o objeto do exame, que passa ao registro de acesso gov.br e à conta bancária validada (ver a seção Autorização do benefício).";
```

Trocar a assinatura e o começo da função:

```js
/**
 * @param {object} args
 * @param {object} args.imagens resultado de `inspectPdfImages`
 * @param {string} args.flat texto corrido do documento
 * @param {boolean} args.alegaBiometria o documento afirma assinatura/validação biométrica
 * @param {object|null} [args.regime] `extracted.regime_inss` (consignado INSS)
 */
export function analisarBiometria({ imagens, flat, alegaBiometria, regime = null }) {
  const faciais = (imagens?.imagens || []).filter((i) => i.biometricaProvavel);
  if (!faciais.length) return null;
  const principal = [...faciais].sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
  const documento = (imagens.imagens || []).some((i) => !i.biometricaProvavel && i.classificacao === "imagem documental" && i.pixels >= 150000);
  const texto = String(flat || "");
  const viaGovbr = regime?.codigo === "IN_213_VIA_DUPLA" && regime.via === "GOVBR";
  const complementar = !viaGovbr && (regime?.codigo === "MEU_INSS_BIOMETRIA" || regime?.codigo === "IN_213_VIA_DUPLA");
  const exigidos = regime?.codigo === "IN_138_SELFIE_BANCO" ? [...DADOS_DO_PROCESSO_BIOMETRICO, HASH_DA_CAPTURA] : DADOS_DO_PROCESSO_BIOMETRICO;
  // Só conta como informado se o processo biométrico for descrito, e não apenas
  // listado entre as finalidades de tratamento de dados.
  const ausentes = exigidos.filter(({ regex }) => !regex.test(texto)).map((d) => d.nome);
```

No objeto `bloco`, depois de `ela: principal.ela || null,`:

```js
    nota_regime: viaGovbr ? NOTA_GOVBR : complementar ? NOTA_MEU_INSS : null,
```

Logo depois de `const achadoELA = principal.ela?.achado || null;`:

```js
  if (viaGovbr) return { ...bloco, achado: null, achado_ela: achadoELA };
```

E no `return` final, trocar o objeto `achado`:

```js
    achado: {
      codigo: "BIO2",
      gravidade: complementar ? "MÉDIA" : "ALTA",
      titulo: "Lastro biométrico frágil",
      texto: complementar ? `${texto_achado} ${NOTA_MEU_INSS}` : texto_achado,
    },
```

Em `analisarDocumento.js`, na chamada de `analisarBiometria`, acrescentar o regime:

```js
  const biometria = analisarBiometria({
    imagens: imageAnalysis,
    flat: textoDoProcesso.replace(/\s+/g, " "),
    alegaBiometria: Boolean(fallback.assinatura?.biometria_registrada_como_evento) || /biometria\s+facial/i.test(textoDoProcesso),
    regime: fallback.regime_inss || null,
  });
```

- [ ] **Passo 4: rodar e ver passar, com as suítes que tocam biometria**

Rodar: `cd backend && npx vitest run tests/engine/biometriaRegime.test.js tests/engine/motorFase4.test.js tests/engine/motorFase5.test.js tests/motorPericial.test.js tests/regressaoDossieC6.test.js`
Esperado: PASS. O dossiê C6 é CLT e não muda. Se `coerenciaLaudo.js` acusar incoerência com BIO2 MÉDIA, ajustar a regra de coerência para aceitar `nota_regime`, sem retirar a verificação.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/biometria.js backend/src/engine/analisarDocumento.js backend/tests/engine/biometriaRegime.test.js
/opt/homebrew/bin/git commit -m "feat(motor): exame da selfie do dossiê segue o regime de autorização do INSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 8: grau, eixo e grupo dos achados INS (servidor e tela)

**Arquivos:**
- Modificar: `backend/src/engine/grausConclusao.js` e `frontend/src/laudo/grausConclusao.js` (início de `classificarGrauProcessual`)
- Modificar: `backend/src/engine/eixosAchado.js` e `frontend/src/laudo/eixosAchado.js` (lista `EIXOS`)
- Modificar: `backend/src/reports/laudoApresentacao.js` (`issueBucket`, linha 263) e `frontend/src/laudo/laudoUtils.js` (`issueBucket`, linha 201)
- Teste: `backend/tests/engine/grauEixoInss.test.js`

**Interfaces:**
- Produz: `classificarGrauProcessual("INS4") === "CONSTATADO"`, `eixoDoAchado("INS3").eixo === "autorizacao"`, `issueBucket({ codigo: "INS3" }) === "lacunas"`, `issueBucket({ codigo: "INS4" }) === "instrumento"`, iguais nas duas pontas.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import * as grausServidor from "../../src/engine/grausConclusao.js";
import * as grausTela from "../../../frontend/src/laudo/grausConclusao.js";
import * as eixosServidor from "../../src/engine/eixosAchado.js";
import * as eixosTela from "../../../frontend/src/laudo/eixosAchado.js";
import { issueBucket as bucketServidor } from "../../src/reports/laudoApresentacao.js";
import { issueBucket as bucketTela } from "../../../frontend/src/laudo/laudoUtils.js";

const CONSTATADOS = ["INS1", "INS4", "INS6", "INS9", "INS10"];
const NAO_VERIFICAVEIS = ["INS0", "INS2", "INS3", "INS5", "INS7", "INS8", "INS11"];

describe.each([
  ["servidor", grausServidor, eixosServidor, bucketServidor],
  ["tela", grausTela, eixosTela, bucketTela],
])("achados INS no %s", (_lado, graus, eixos, bucket) => {
  it.each(CONSTATADOS)("%s é constatado e vai para inconsistências do instrumento", (codigo) => {
    expect(graus.classificarGrauProcessual(codigo, "ALTA")).toBe(graus.GRAUS.CONSTATADO);
    expect(bucket({ codigo })).toBe("instrumento");
  });

  it.each(NAO_VERIFICAVEIS)("%s é não verificável e vai para lacunas", (codigo) => {
    expect(graus.classificarGrauProcessual(codigo, "MÉDIA")).toBe(graus.GRAUS.NAO_VERIFICAVEL);
    expect(bucket({ codigo })).toBe("lacunas");
  });

  it("eixo próprio, logo depois de assinatura", () => {
    expect(eixos.eixoDoAchado("INS3")).toEqual({ eixo: "autorizacao", ordem: 1 });
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/engine/grauEixoInss.test.js`
Esperado: FAIL (INS cai no fallback por gravidade e no eixo "outros").

- [ ] **Passo 3: implementar, igual nas duas cópias**

Em `grausConclusao.js` (backend e frontend), antes de `export function classificarGrauProcessual`:

```js
/** Achados de autorização INSS que o próprio dossiê demonstra (ver regimeInss.js). */
const INS_CONSTATADOS = new Set(["INS1", "INS4", "INS6", "INS9", "INS10"]);
```

e logo depois de `const c = String(codigo || "").toUpperCase();`:

```js
  // Autorização do consignado INSS: o que o dossiê mostra é constatado; o que o
  // INSS ou a instituição não apresentou é não verificável.
  if (/^INS\d+$/.test(c)) return INS_CONSTATADOS.has(c) ? GRAUS.CONSTATADO : GRAUS.NAO_VERIFICAVEL;
```

Em `eixosAchado.js` (backend e frontend), na lista `EIXOS`, logo depois da linha do eixo `assinatura`:

```js
  { eixo: "autorizacao", regex: /^INS\d/ },
```

Em `issueBucket` (backend `laudoApresentacao.js` e frontend `laudoUtils.js`), como primeira regra depois do cálculo de `code` e `text`:

```js
  if (/^INS\d/.test(code)) return classificarGrauProcessual(code) === GRAUS.CONSTATADO ? "instrumento" : "lacunas";
```

e acrescentar `GRAUS` ao import de `grausConclusao.js` já existente em cada um dos dois arquivos.

- [ ] **Passo 4: rodar e ver passar, nas duas pontas**

Rodar: `cd backend && npx vitest run tests/engine/grauEixoInss.test.js tests/engine/grausConclusao.test.js tests/engine/grauEFaixa.test.js tests/reportPdfParidadeTela.test.js && cd ../frontend && npm test`
Esperado: PASS em tudo.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/engine/grausConclusao.js frontend/src/laudo/grausConclusao.js backend/src/engine/eixosAchado.js frontend/src/laudo/eixosAchado.js backend/src/reports/laudoApresentacao.js frontend/src/laudo/laudoUtils.js backend/tests/engine/grauEixoInss.test.js
/opt/homebrew/bin/git commit -m "feat(laudo): grau, eixo e grupo dos achados de autorização INSS

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 9: quesitos ao INSS e à Dataprev

**Arquivos:**
- Modificar: `backend/src/reports/quesitosTemplate.js` e `frontend/src/laudo/quesitos.js` (quesito geral 4 e objeto `MODELOS`)
- Teste: `backend/tests/quesitosInss.test.js`

**Interfaces:**
- Consome: `extracted.regime_inss` (`codigo`, `via`, `data_contrato`, `regra_dib_dias`, `evidencias`).
- Produz: modelos `INS3`, `INS4`, `INS6`, `INS7`, `INS8`, `INS9`, `INS10`; quesito geral de prova de vida omitido na via gov.br.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { generateJudicialQuesitos } from "../src/reports/quesitosTemplate.js";
import { generateJudicialQuesitos as naTela } from "../../frontend/src/laudo/quesitos.js";

const GOVBR = {
  regime_inss: {
    codigo: "IN_213_VIA_DUPLA", via: "GOVBR", data_contrato: "25/08/2026", regra_dib_dias: 90,
    evidencias: {
      dib: "10/07/2026",
      meu_inss: { autorizacao: { data: "26/08/2026", hora: "09:15:00" } },
      conta_validada: { agencia: "1234", conta: "55555-1" },
      conta_beneficio: { agencia: "1234", conta: "99999-0" },
    },
  },
};
const ACHADOS_GOVBR = [
  { codigo: "INS4", gravidade: "ALTA" },
  { codigo: "INS7", gravidade: "ALTA" },
  { codigo: "INS8", gravidade: "ALTA" },
  { codigo: "INS9", gravidade: "ALTA" },
  { codigo: "INS10", gravidade: "ALTA" },
];

describe("quesitos da autorização INSS", () => {
  it("via gov.br tira o quesito geral de prova de vida e traz os quesitos da via", () => {
    const titulos = generateJudicialQuesitos({ achados: ACHADOS_GOVBR, extracted: GOVBR }).map((q) => q.titulo);
    expect(titulos.some((t) => /Liveness/.test(t))).toBe(false);
    expect(titulos).toEqual(expect.arrayContaining([
      "Cronologia entre Autorização, Averbação e Crédito",
      "Cabimento da Autorização pela Conta gov.br",
      "Registro de Acesso pela Conta gov.br",
      "Conta Validada e Conta de Recebimento do Benefício",
      "Contratação nos Primeiros 90 Dias do Benefício",
    ]));
  });

  it("regime Meu INSS leva quesito ao INSS e à Dataprev e mantém o de prova de vida", () => {
    const extracted = { regime_inss: { codigo: "MEU_INSS_BIOMETRIA", via: "FACIAL", data_contrato: "10/06/2026", evidencias: {} } };
    const qs = generateJudicialQuesitos({ achados: [{ codigo: "INS3", gravidade: "ALTA" }], extracted });
    const ins3 = qs.find((q) => q.titulo === "Registro da Autorização no Meu INSS (Ofício ao INSS e à Dataprev)");
    expect(ins3.quesito).toMatch(/Dataprev/);
    expect(qs.some((q) => /Liveness/.test(q.titulo))).toBe(true);
  });

  it("tela e servidor geram os mesmos quesitos", () => {
    expect(naTela({ achados: ACHADOS_GOVBR, extracted: GOVBR })).toEqual(generateJudicialQuesitos({ achados: ACHADOS_GOVBR, extracted: GOVBR }));
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/quesitosInss.test.js`
Esperado: FAIL (sem modelos INS e com o quesito de Liveness na via gov.br).

- [ ] **Passo 3: implementar, igual nas duas cópias**

Em `generateJudicialQuesitos`, antes de `const quesitos = [`:

```js
  // Na via gov.br a fotografia e a prova de vida não são o objeto do exame.
  const semFotografiaNoObjeto = extracted?.regime_inss?.codigo === "IN_213_VIA_DUPLA" && extracted.regime_inss.via === "GOVBR";
```

e, na entrada do quesito geral 4, fazer duas trocas pontuais sem tocar no texto do quesito:

1. a linha de abertura `    porAchado.BIO2 || {` passa a ser `    !semFotografiaNoObjeto && (porAchado.BIO2 || {`;
2. o fechamento dessa entrada, `    },` logo depois da linha `finalidade: "Verificar o resultado individual da validação biométrica e sua vinculação à operação.",`, passa a ser `    }),`.

O `filter(Boolean)` do final já descarta o `false`.

Acrescentar ao objeto `MODELOS`:

```js
  INS3(e, { bancoRef, contratoRef }) {
    const r = e.regime_inss;
    return {
      titulo: "Registro da Autorização no Meu INSS (Ofício ao INSS e à Dataprev)",
      quesito: `Queira o INSS, com apoio da Dataprev, informar se consta autorização da operação${contratoRef ? ` ${contratoRef}` : ""} no aplicativo Meu INSS e, em caso positivo, apresentar o registro com data, hora, método de validação, base oficial usada no confronto facial e resultado da validação de vivacidade${r?.data_contrato ? `, considerando que o contrato é de ${r.data_contrato}` : ""}. Queira ainda ${bancoRef} esclarecer se a operação foi averbada antes desse registro.`,
      finalidade: "Obter do órgão público a prova central da manifestação, que a instituição não pode produzir sozinha.",
    };
  },
  INS4(e, { bancoRef }) {
    const a = e.regime_inss?.evidencias?.meu_inss?.autorizacao;
    if (!a) return null;
    return {
      titulo: "Cronologia entre Autorização, Averbação e Crédito",
      quesito: `Considerando que o dossiê registra a autorização no Meu INSS em ${a.data}${a.hora ? ` ${a.hora}` : ""}, queira ${bancoRef} explicar como a averbação ou a liberação do crédito ocorreram antes dessa autorização, apresentando os registros de data e hora de cada etapa.`,
      finalidade: "Demonstrar se a operação foi efetivada antes da manifestação do beneficiário no Meu INSS.",
    };
  },
  INS6: quesitoViaGovbr,
  INS7: quesitoViaGovbr,
  INS8() {
    return {
      titulo: "Registro de Acesso pela Conta gov.br",
      quesito: "Queira o INSS, com apoio da Dataprev, apresentar o registro do acesso à conta gov.br que autorizou a operação, com o nível da conta, o endereço IP, o dispositivo, a data e a hora, e a conta bancária validada na autorização.",
      finalidade: "Na via gov.br, esses registros tomam o lugar da fotografia e da prova de vida como objeto do exame.",
    };
  },
  INS9(e, { bancoRef }) {
    const v = e.regime_inss?.evidencias?.conta_validada;
    const b = e.regime_inss?.evidencias?.conta_beneficio;
    if (!v || !b) return null;
    return {
      titulo: "Conta Validada e Conta de Recebimento do Benefício",
      quesito: `Queira ${bancoRef} esclarecer por que a conta validada na autorização (agência ${v.agencia}, conta ${v.conta}) difere da conta de recebimento do benefício (agência ${b.agencia}, conta ${b.conta}), e o INSS informar qual conta estava cadastrada para o pagamento do benefício na data da operação.`,
      finalidade: "Verificar se a conta validada pertence ao beneficiário e é a de recebimento do benefício.",
    };
  },
  INS10(e) {
    const r = e.regime_inss;
    const dib = r?.evidencias?.dib;
    if (!dib || !r?.data_contrato || !r?.regra_dib_dias) return null;
    return {
      titulo: `Contratação nos Primeiros ${r.regra_dib_dias} Dias do Benefício`,
      quesito: `Queira o INSS confirmar a data de início do benefício (a DIB informada no dossiê é ${dib}) e informar se a consignação averbada para o contrato de ${r.data_contrato} observou a vedação de contratação nos primeiros ${r.regra_dib_dias} dias do benefício.`,
      finalidade: "Confrontar a data do contrato com a DIB.",
    };
  },
```

E, antes de `const MODELOS = {`:

```js
function quesitoViaGovbr() {
  return {
    titulo: "Cabimento da Autorização pela Conta gov.br",
    quesito: "Queira o INSS informar se, na data da autorização, o beneficiário possuía biometria facial cadastrada nas bases oficiais (CNH ou Justiça Eleitoral), esclarecendo por que a operação foi autorizada pela conta gov.br e não pela validação facial.",
    finalidade: "Verificar se a via gov.br era cabível, já que quem tem biometria cadastrada continua obrigado à validação facial.",
  };
}
```

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd backend && npx vitest run tests/quesitosInss.test.js tests/rodada2Medios.test.js && cd ../frontend && npm test`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/reports/quesitosTemplate.js frontend/src/laudo/quesitos.js backend/tests/quesitosInss.test.js
/opt/homebrew/bin/git commit -m "feat(quesitos): autorização no Meu INSS por ofício ao INSS e à Dataprev

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 10: fundamentação normativa pelo regime

**Arquivos:**
- Modificar: `backend/src/reports/laudoTexts.js` (`fundamentacaoPara`)
- Modificar: `backend/src/services/reportPdfService.js:2418` (chamada de `fundamentacaoPara`)
- Modificar: `frontend/src/laudo/LaudoForense.jsx:1589-1593` (grupo "Crédito consignado e benefício do INSS")
- Teste: `backend/tests/fundamentacaoInss.test.js`

**Interfaces:**
- Consome: `extracted.regime_inss.fundamentacao` (Tarefa 5).
- Produz: `fundamentacaoPara(produtoCodigo, regime = null)`.

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect } from "vitest";
import { fundamentacaoPara } from "../src/reports/laudoTexts.js";
import { classificarRegimeInss, fundamentacaoDoRegime } from "../src/engine/regimeInss.js";

const comRegime = (data) => {
  const r = classificarRegimeInss({ produtoCodigo: "CONSIGNADO_INSS", dataContrato: data });
  return { ...r, fundamentacao: fundamentacaoDoRegime(r) };
};
const grupo = (produto, regime, nome) => JSON.stringify(fundamentacaoPara(produto, regime).find((g) => g.grupo === nome));
const INSS = "Crédito consignado e benefício do INSS";

describe("fundamentação pelo regime INSS", () => {
  it("sem regime mantém o item genérico", () => {
    expect(grupo("CONSIGNADO_INSS", null, INSS)).toMatch(/Normas do INSS/);
  });

  it("contrato de 2021 cita a IN 28/2008 no lugar do item genérico", () => {
    const g = grupo("CONSIGNADO_INSS", comRegime("10/05/2021"), INSS);
    expect(g).toMatch(/IN INSS\/PRES nº 28\/2008/);
    expect(g).not.toMatch(/Normas do INSS/);
  });

  it("contrato de 2025 cita os dispositivos da IN 138 mapeados no acervo", () => {
    expect(grupo("CONSIGNADO_INSS", comRegime("15/03/2025"), INSS)).toMatch(/art\. 4º, VIII, e art\. 5º, II, III e § 5º/);
  });

  it("contrato de setembro de 2026 cita a IN 213 com ressalva e a norma de maio sem número", () => {
    const g = grupo("CONSIGNADO_INSS", comRegime("10/09/2026"), INSS);
    expect(g).toMatch(/IN PRES\/INSS nº 213\/2026 \(texto e vigência a conferir no DOU\)/);
    expect(g).toMatch(/Norma do INSS de maio de 2026/);
  });

  it("CLT continua sem normas do INSS", () => {
    expect(grupo("CONSIGNADO_CLT", comRegime("10/09/2026"), "Crédito consignado do trabalhador (CLT)")).not.toMatch(/INSS/);
  });
});
```

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/fundamentacaoInss.test.js`
Esperado: FAIL nos casos com regime.

- [ ] **Passo 3: implementar**

Em `laudoTexts.js`, trocar `fundamentacaoPara`:

```js
/**
 * Fundamentação aplicável ao produto classificado na extração.
 * CDC e renegociação não recebem grupo de consignado; os demais recebem o do
 * próprio produto. No consignado INSS com regime enquadrado, o item genérico
 * ("verificar a IN vigente") dá lugar às normas do regime da data do contrato.
 */
export function fundamentacaoPara(produtoCodigo, regime = null) {
  return FUNDAMENTACAO.flatMap((bloco) => {
    if (bloco !== GRUPO_CONSIGNADO) return [bloco];
    if (produtoCodigo === "CDC") return [];
    const grupo = GRUPOS_CONSIGNADO[produtoCodigo] || GRUPO_CONSIGNADO;
    const doRegime = regime?.fundamentacao || [];
    if (grupo !== GRUPOS_CONSIGNADO.CONSIGNADO_INSS || !doRegime.length) return [grupo];
    return [{ ...grupo, itens: [...grupo.itens.filter(([dispositivo]) => !/^Normas do INSS/.test(dispositivo)), ...doRegime] }];
  });
}
```

Em `reportPdfService.js`, linha 2418:

```js
  for (const { grupo, itens } of fundamentacaoPara(extracted.contrato?.produto_codigo, extracted.regime_inss)) {
```

Em `LaudoForense.jsx`, no grupo `"Crédito consignado e benefício do INSS"` (linhas 1589 a 1593), a única linha que muda é a 1592, a do item `["Normas do INSS sobre consignações (Instrução Normativa vigente) e Resoluções do CNPS", "..."],`. Três trocas pontuais, sem tocar no texto do item:

1. imediatamente antes dessa linha, inserir:

```jsx
                      // Regime da data do contrato (backend/src/engine/regimeInss.js):
                      // o item genérico só fica quando o regime não foi enquadrado.
                      ...(report.extracted.regime_inss?.fundamentacao?.length
                        ? report.extracted.regime_inss.fundamentacao
                        : [
```

2. na própria linha, trocar a vírgula final `],` por `]]),`;
3. nenhuma outra linha do grupo muda.

- [ ] **Passo 4: rodar e ver passar**

Rodar: `cd backend && npx vitest run tests/fundamentacaoInss.test.js tests/regressaoDossieC6.test.js && cd ../frontend && npm test`
Esperado: PASS.

- [ ] **Passo 5: commit**

```bash
/opt/homebrew/bin/git add backend/src/reports/laudoTexts.js backend/src/services/reportPdfService.js frontend/src/laudo/LaudoForense.jsx backend/tests/fundamentacaoInss.test.js
/opt/homebrew/bin/git commit -m "feat(laudo): fundamentação do consignado INSS pelo regime da data do contrato

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 11: seção "Autorização do benefício (INSS)" e nota do § 4.4 no PDF e na tela

**Arquivos:**
- Modificar: `backend/src/services/reportPdfService.js` (função nova depois de `sectionImages`; chamada na ordem das seções, linha 164; nota no `sectionImages`, depois do primeiro `paragraph`)
- Modificar: `frontend/src/laudo/LaudoForense.jsx` (nota no bloco `imagem_biometrica`, por volta da linha 998; seção nova logo depois do fechamento da seção "§ 4.3 · Trilha de eventos da contratação")
- Teste: `backend/tests/reportPdfInss.test.js`

**Interfaces:**
- Consome: `extracted.regime_inss` (inclusive `via_rotulo`, `nota_oficio`, `ressalvas`) e `extracted.imagem_biometrica.nota_regime`.
- Produz: seção "§ 4.5 · Autorização do benefício (INSS)" no PDF e "§ 4.4 · Autorização do benefício (INSS)" na tela (a numeração da tela já é própria: lá imagens é § 4.2 e trilha é § 4.3).

- [ ] **Passo 1: escrever o teste que falha**

```js
import { describe, it, expect, vi } from "vitest";
import { readFile } from "node:fs/promises";
import { PDFParse } from "pdf-parse";

vi.mock("../src/services/staticMapService.js", () => ({
  fetchStaticMap: vi.fn(async () => null),
  mapPointsIpVsHome: () => [],
  mapPointsHomeVsDeclared: () => [],
  mapPointsDeclaredVsIp: () => [],
}));

const { buildReportPdf } = await import("../src/services/reportPdfService.js");
const { heuristicExtractionFromText } = await import("../src/services/extractionService.js");
const { TEXTO_GOVBR } = await import("./helpers/textoInss.js");

async function textoDoPdf(extracted) {
  const result = {
    text: JSON.stringify(extracted),
    metadata: { version: "1.7", totalPages: 1, warnings: [] },
    hashes: { sha256: "A".repeat(64), sha1: "B".repeat(40) },
    ipAnalysis: [],
  };
  const doc = await buildReportPdf({ id: "11111111-2222-3333-4444-555555555555", createdAt: new Date() }, result);
  const partes = [];
  for await (const p of doc) partes.push(p);
  const parser = new PDFParse({ data: Buffer.concat(partes) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

describe("PDF: autorização do benefício (INSS)", () => {
  it("traz regime, via, ofício e ressalva de vigência", async () => {
    const texto = await textoDoPdf(heuristicExtractionFromText(TEXTO_GOVBR));
    expect(texto).toMatch(/Autorização do benefício \(INSS\)/i);
    expect(texto).toMatch(/Conta gov\.br com validação dos dados bancários/);
    expect(texto).toMatch(/requisitado por ofício/);
    expect(texto).toMatch(/não foi conferido no Diário Oficial/);
  });

  it("dossiê C6 (CLT) não ganha a seção", async () => {
    const caso = JSON.parse(await readFile(new URL("./corpus/casos/c6-consig-clt-dossie.json", import.meta.url), "utf8"));
    const texto = await textoDoPdf(heuristicExtractionFromText(caso.texto));
    expect(texto).not.toMatch(/Autorização do benefício \(INSS\)/i);
  });
});
```

Se `buildReportPdf` exigir campo de `result` que o objeto mínimo não traz, copiar o campo de `resultCompleto()` em `tests/reportPdfParidadeTela.test.js`.

- [ ] **Passo 2: rodar e ver falhar**

Rodar: `cd backend && npx vitest run tests/reportPdfInss.test.js`
Esperado: FAIL no primeiro caso (seção inexistente); o caso CLT já passa.

- [ ] **Passo 3: implementar no PDF**

Em `reportPdfService.js`, depois de `sectionImages`:

```js
/**
 * § 4.5: regime de autorização do consignado INSS pela data do contrato e o que
 * o dossiê traz sobre a autorização. O texto normativo vem pronto do motor
 * (regimeInss.js), para a tela e o PDF dizerem a mesma coisa.
 */
function sectionInssAuthorization(ctx, extracted) {
  const r = extracted.regime_inss;
  if (!r) return;
  const e = r.evidencias || {};
  const altos = (extracted.achados_irregularidade || []).some((a) => /^INS\d/.test(a.codigo || "") && a.gravidade === "ALTA");
  const naoLocalizado = "não localizado no dossiê";
  const dataHora = (x) => (x ? [x.data, x.hora].filter(Boolean).join(" ") : null);
  const conta = (c) => (c ? `agência ${c.agencia}, conta ${c.conta}` : null);

  heading(ctx, "§ 4.5 · Autorização do benefício (INSS)", { danger: altos });
  field(ctx, "Data do contrato", r.data_contrato || "não localizada no instrumento");
  field(ctx, "Regime aplicável", r.rotulo);
  field(ctx, "Norma de referência", r.norma);
  field(ctx, "Via de autorização", r.via_rotulo);
  if (r.nota_oficio) {
    badge(ctx, "Registro da autorização no Meu INSS", e.meu_inss?.autorizacao ? "LOCALIZADO" : "AUSENTE", Boolean(e.meu_inss?.autorizacao));
    field(ctx, "   Data e hora", dataHora(e.meu_inss?.autorizacao));
    field(ctx, "Base oficial do confronto facial", (e.meu_inss?.bases_oficiais || []).join(", ") || naoLocalizado);
    field(ctx, "Averbação", dataHora(e.averbacao) || naoLocalizado);
  }
  if (r.via === "GOVBR") {
    field(ctx, "Nível da conta gov.br", e.govbr?.nivel || naoLocalizado);
    field(ctx, "IP de acesso gov.br", e.govbr?.ip || naoLocalizado, { mono: true });
    field(ctx, "Dispositivo de acesso gov.br", e.govbr?.dispositivo || naoLocalizado);
    field(ctx, "Conta validada", conta(e.conta_validada) || naoLocalizado);
    field(ctx, "Conta de recebimento do benefício", conta(e.conta_beneficio) || naoLocalizado);
  }
  if (r.codigo === "IN_213_VIA_DUPLA") field(ctx, "Data de início do benefício (DIB)", e.dib || naoLocalizado);
  if (r.nota_oficio) paragraph(ctx, r.nota_oficio, { color: MUTED, size: 8.5 });
  for (const ressalva of r.ressalvas || []) paragraph(ctx, ressalva, { color: MUTED, size: 8.5 });
}
```

Na ordem das seções (linha 164), logo depois de `sectionImages(ctx, extracted);`:

```js
  sectionInssAuthorization(ctx, extracted);
```

Em `sectionImages`, logo depois do primeiro `paragraph(...)` (o que começa com "Auditoria automática dos objetos de imagem"):

```js
  if (b?.nota_regime) paragraph(ctx, b.nota_regime, { color: MUTED, size: 8.5 });
```

- [ ] **Passo 4: implementar na tela**

Em `LaudoForense.jsx`, dentro do bloco `report.extracted.imagem_biometrica && (() => { ... })`, logo depois da abertura `<div className="ip-block" ...>` e do `ip-head`:

```jsx
                          {b.nota_regime && <div className="note" style={{ marginTop: 0 }}>{b.nota_regime}</div>}
```

E logo depois do fechamento da seção `§ 4.3 · Trilha de eventos da contratação`:

```jsx
              {/* §4.4 Autorização do benefício (INSS): regime pela data do contrato */}
              {report.extracted.regime_inss && (() => {
                const r = report.extracted.regime_inss;
                const e = r.evidencias || {};
                const altos = (report.extracted.achados_irregularidade || []).some((a) => /^INS\d/.test(a.codigo || "") && a.gravidade === "ALTA");
                const dataHora = (x) => (x ? [x.data, x.hora].filter(Boolean).join(" ") : null);
                const conta = (c) => (c ? `agência ${c.agencia}, conta ${c.conta}` : null);
                const ausente = "Não localizado no dossiê";
                return (
                  <Section title="§ 4.4 · Autorização do benefício (INSS)" danger={altos}>
                    <Row label="Data do contrato" value={r.data_contrato} nullText="Não localizada no instrumento" />
                    <Row label="Regime aplicável" value={r.rotulo} />
                    <Row label="Norma de referência" value={r.norma} />
                    {r.via_rotulo && <Row label="Via de autorização" value={r.via_rotulo} />}
                    {r.nota_oficio && (
                      <>
                        <Row label="Registro da autorização no Meu INSS" value={dataHora(e.meu_inss?.autorizacao)} nullText={ausente} />
                        <Row label="Base oficial do confronto facial" value={(e.meu_inss?.bases_oficiais || []).join(", ")} nullText={ausente} />
                        <Row label="Averbação" value={dataHora(e.averbacao)} nullText={ausente} />
                      </>
                    )}
                    {r.via === "GOVBR" && (
                      <>
                        <Row label="Nível da conta gov.br" value={e.govbr?.nivel} nullText={ausente} />
                        <Row label="IP de acesso gov.br" value={e.govbr?.ip} mono nullText={ausente} />
                        <Row label="Dispositivo de acesso gov.br" value={e.govbr?.dispositivo} nullText={ausente} />
                        <Row label="Conta validada" value={conta(e.conta_validada)} nullText={ausente} />
                        <Row label="Conta de recebimento do benefício" value={conta(e.conta_beneficio)} nullText={ausente} />
                      </>
                    )}
                    {r.codigo === "IN_213_VIA_DUPLA" && <Row label="Data de início do benefício (DIB)" value={e.dib} nullText={ausente} />}
                    {r.nota_oficio && <div className="note">{r.nota_oficio}</div>}
                    {(r.ressalvas || []).map((texto) => <div className="note" key={texto}>{texto}</div>)}
                  </Section>
                );
              })()}
```

- [ ] **Passo 5: rodar e ver passar, com a paridade**

Rodar: `cd backend && npx vitest run tests/reportPdfInss.test.js tests/reportPdfParidadeTela.test.js tests/laudoTemaModelo.test.js tests/reportPdfPaginacao.test.js && cd ../frontend && npm test && npm run build`
Esperado: PASS e build sem erro.

- [ ] **Passo 6: conferência visual**

Gerar um PDF com `node backend/scripts/gerarLaudoTeste.mjs` a partir de uma extração de `TEXTO_GOVBR` e abrir a seção nova nos dois temas (`modelo` e `classico`). Conferir: título da seção pesquisável no texto do PDF, nenhuma linha "undefined", nenhum travessão, ressalvas em cinza abaixo dos campos.

- [ ] **Passo 7: commit**

```bash
/opt/homebrew/bin/git add backend/src/services/reportPdfService.js frontend/src/laudo/LaudoForense.jsx backend/tests/reportPdfInss.test.js
/opt/homebrew/bin/git commit -m "feat(laudo): seção de autorização do benefício INSS e nota de regime no exame da imagem

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Tarefa 12: homologação e trava jurídica

**Arquivos:** nenhum código novo.

- [ ] **Passo 1: suítes completas**

Rodar: `cd backend && npm test && npm run test:replicas && cd ../frontend && npm test`
Esperado: tudo verde. Qualquer falha em teste antigo é investigada com superpowers:systematic-debugging antes de mexer na expectativa.

- [ ] **Passo 2: homologação do dossiê C6**

Rodar: `cd backend && node scripts/homologarDossie.mjs ../../documentação/doc_teste/dossiê.pdf`
Esperado: os mesmos 39 itens de antes. O C6 é CLT e não pode ganhar nenhum achado `INS` nem a seção nova.

- [ ] **Passo 3: laudo INSS real, fora do repositório**

Com um dossiê INSS real apontado por `FORENSEDOC_FIXTURES_DIR`, gerar o laudo pelo frontend e conferir à mão: data do contrato, regime escolhido, § 4.4 com a nota certa, seção de autorização, quesitos, fundamentação. Nenhum arquivo desse dossiê entra no Git.

- [ ] **Passo 4: trava jurídica antes do merge**

Levar ao jurídico a tabela de "Pré-requisitos jurídicos" e registrar a resposta. Para cada item confirmado, trocar o flag em `regimeInss.js`, ajustar o teste correspondente da Tarefa 1 e fazer um commit próprio. Enquanto a norma de maio e a IN 213 não forem conferidas, o laudo continua saindo com as ressalvas; isso é o comportamento esperado, não pendência de código.

- [ ] **Passo 5: encerramento**

Usar superpowers:verification-before-completion e depois superpowers:finishing-a-development-branch. Não fazer push nem abrir PR sem o usuário pedir.

## Fora do escopo desta rodada

- Via gov.br encontrada em contrato do regime Meu INSS anterior à IN 213 (seria via ainda não admitida). Só entra depois de conferidas as datas de vigência.
- Demonstrativo prévio com data posterior ao contrato. Hoje só se verifica a presença; a anterioridade exige ler a data do demonstrativo com segurança.
- Varredura retroativa de laudos já emitidos de consignado INSS. Os achados novos aparecem ao reprocessar a análise; a varredura, se o usuário quiser, reaproveita `scripts/varrerLaudosAfetados.js` em modo leitura.
