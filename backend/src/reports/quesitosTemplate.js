/**
 * Gerador de Quesitos Periciais Judiciais Prontos.
 * Permite que o advogado anexe diretamente à Petição Inicial ou Impugnação à Contestação,
 * fixando os pontos controvertidos para o Perito Judicial e intimando a instituição financeira.
 *
 * ─── Quesitos por achado (MED-05 da rodada 2) ───────────────────────────────
 *
 * O conjunto era fixo. No dossiê C6 os achados de maior gravidade (crédito sem
 * comprovante, seguro com carência maior que a operação, aceite da CCB em 27
 * segundos) ficaram sem quesito. Regra: um quesito por achado ALTA que tenha
 * modelo, mais EMP1 e CAD4. INT1 e BIO2 substituem os quesitos gerais de
 * integridade e de biometria, para não repetir o tema.
 */

import { ordenarAchados } from "../engine/eixosAchado.js";

export function generateJudicialQuesitos({
  clienteNome,
  clienteCpf,
  contratoNumero,
  banco,
  ip,
  porta,
  gpsCoords,
  cidadeIp,
  cidadeDomicilio,
  distanciaKm,
  dataHora,
  achados = [],
  extracted = {},
}) {
  const nomeRef = clienteNome || "da parte Autora";
  const cpfRef = clienteCpf ? `inscrito(a) no CPF nº ${clienteCpf}` : "";
  const bancoRef = banco || "a Instituição Financeira";
  const contratoRef = contratoNumero ? `vinculado à proposta/contrato nº ${contratoNumero}` : "";
  const ipRef = ip ? `endereço IP ${ip}${porta ? ` (porta lógica: ${porta})` : ""}` : "endereço IP";
  const dataRef = dataHora || "na data e hora registradas no dossiê";

  /*
   * O Quesito 2 afirma ao juízo onde fica o domicílio e a que distância o ato
   * ocorreu. Sem domicílio confirmado e distância medida, ele não é montado: o
   * texto padrão ("milhares de quilômetros", "outro estado/município") afirmava
   * incompatibilidade que ninguém mediu. No dossiê C6 isso levou ao juízo um
   * domicílio no Piauí digitado por engano.
   */
  const temConfrontoGeografico = Boolean(cidadeDomicilio && distanciaKm);

  const ctx = { bancoRef, nomeRef, contratoRef };
  const selecionados = ordenarAchados((achados || []).filter((a) => a && MODELOS[a.codigo] && (a.gravidade === "ALTA" || SEMPRE.has(a.codigo))));
  const porAchado = {};
  const especificos = [];
  for (const achado of selecionados) {
    if (porAchado[achado.codigo]) continue;
    const q = MODELOS[achado.codigo](extracted || {}, ctx, achado);
    if (!q) continue;
    porAchado[achado.codigo] = q;
    if (!SUBSTITUI_GERAL.has(achado.codigo)) especificos.push(q);
  }

  const quesitos = [
    {
      numero: 1,
      titulo: "Identificação e Registro Integral da Conexão (Marco Civil da Internet)",
      quesito: `Queira o Sr. Perito ou ${bancoRef} apresentar o relatório de conexão integral referente à operação${contratoRef ? ` ${contratoRef}` : ""}, informando detalhadamente o endereço IP completo, a porta lógica de origem, o fuso horário (com indicação UTC) e os registros de cabeçalho da sessão, nos termos do art. 10 e art. 15 da Lei nº 12.965/2014 (Marco Civil da Internet).`,
      finalidade: "Exigir a cadeia técnica sem omissão de porta lógica ou masquerading.",
    },
    temConfrontoGeografico && {
      numero: 2,
      titulo: "Esclarecimento sobre a Divergência Geográfica",
      quesito: `Considerando que o dossiê acostado aos autos aponta conexão realizada a partir de ${cidadeIp || "localidade informada pelo provedor"} (${ipRef})${gpsCoords ? ` e coordenadas de GPS em ${gpsCoords}` : ""}, enquanto o domicílio de ${nomeRef} situa-se em ${cidadeDomicilio}, distando aproximadamente ${distanciaKm} km, queira esclarecer se há elementos técnicos que justifiquem ou comprovem a presença física do titular no local registrado no instante da assinatura (${dataRef}).`,
      finalidade: "Consolidar a incompatibilidade espacial e o afastamento da tese de contratação presencial/regular.",
    },
    {
      numero: 3,
      titulo: "Autenticação em Fatores Múltiplos e Destinatário de Token (SMS / WhatsApp)",
      quesito: `Caso a contratação tenha utilizado autenticação secundária (como envio de código SMS ou token via WhatsApp), queira ${bancoRef} comprovar documentalmente a linha telefônica exata (número de telefone e operadora) que recebeu o código, demonstrando se referida linha pertencia de fato à titularidade de ${nomeRef} na data da operação.`,
      finalidade: "Demonstrar eventuais fraudes por SIM Swap, número falso ou intermediário ilícito.",
    },
    porAchado.BIO2 || {
      numero: 4,
      titulo: "Validação Biométrica e Prova de Vida Ativa (Liveness Detection)",
      quesito: `Queira o Sr. Perito informar se os registros biométricos apresentados nos autos contêm comprovação de 'Prova de Vida' ativa (Liveness Detection) com desafio dinâmico no momento da captura da imagem, ou se tratou de mera foto estática ou upload de imagem prévia passível de injeção digital ou deepfake.`,
      finalidade: "Verificar o resultado individual da validação biométrica e sua vinculação à operação.",
    },
    porAchado.INT1 || {
      numero: 5,
      titulo: "Integridade Criptográfica e Ônus Probatório (Tema 1.061 STJ e MP 2.200-2/2001)",
      quesito: `Caso haja impugnação da autenticidade pelo consumidor, observada a hipótese do Tema 1.061 do STJ (CPC, art. 429, II), queira informar se a assinatura eletrônica utilizada possui certificado emitido sob a infraestrutura ICP-Brasil (assinatura qualificada) ou se depende exclusivamente de meios eletrônicos avançados/simples, especificando se o código hash do contrato original permaneceu inalterado desde a contratação.`,
      finalidade: "Fixar a incumbência probatória sobre a instituição financeira requerida.",
    },
    ...especificos,
  ];

  return quesitos.filter(Boolean).map((q, i) => ({ ...q, numero: i + 1 }));
}

/**
 * Achados de gravidade MÉDIA que o relatório da rodada 2 pediu nominalmente.
 *
 * SEG1 entrou aqui por causa do D9: sem o certificado individual do seguro, o
 * achado é rebaixado de ALTA para MÉDIA, porque depende de uma premissa de
 * início de vigência. Mas é exatamente esse quesito que PEDE o certificado.
 * Deixá-lo cair com o rebaixamento fecharia o único caminho para confirmar a
 * premissa, e o achado ficaria rebaixado para sempre por falta do documento
 * que o próprio quesito requisita.
 */
const SEMPRE = new Set(["EMP1", "CAD4", "SEG1", "TRL1-CCB"]);
/** Achados cujo quesito toma o lugar do quesito geral do mesmo tema. */
const SUBSTITUI_GERAL = new Set(["INT1", "BIO2"]);

const juntarLista = (lista) => (lista.length <= 1 ? lista.join("") : `${lista.slice(0, -1).join(", ")} e ${lista.at(-1)}`);
const dias = (n) => `${n} ${n === 1 ? "dia" : "dias"}`;

/*
 * Cada modelo devolve null quando falta o dado que o torna específico; nunca
 * imprime "undefined" nem valor inventado. Os valores vêm do próprio resultado.
 */
const MODELOS = {
  LIB1(e, { bancoRef, contratoRef }) {
    const d = e.liberacao_credito?.declarada || {};
    const destino = [d.conta ? `conta ${d.conta}` : null, d.agencia ? `agência ${d.agencia}` : null, d.banco ? `Banco ${d.banco}` : null].filter(Boolean).join(", ");
    return {
      titulo: "Comprovação do Crédito Liberado",
      quesito: `Queira ${bancoRef} apresentar o comprovante de transferência relativo ao crédito${destino ? ` na ${destino}` : ""}${contratoRef ? `, ${contratoRef}` : ""}, com identificação do lançamento, data, valor e titularidade da conta de destino.`.replace(/\s+,/g, ",").replace(/\s{2,}/g, " "),
      finalidade: "Exigir a prova da efetiva disponibilização do crédito, que cabe a quem afirma tê-lo realizado.",
    };
  },
  EMP1(e, { bancoRef }) {
    const literal = e.contrato?.empregador?.literal;
    return {
      titulo: "Identificação do Empregador e da Averbação",
      quesito: `Queira ${bancoRef} identificar a instituição consignante${literal ? ` registrada apenas como "${literal}"` : ""}, com razão social e CNPJ, e comprovar a averbação da margem consignável e o vínculo empregatício na data da operação.`,
      finalidade: "Demonstrar se existe o vínculo que sustenta o desconto em folha.",
    };
  },
  CAD4(e, { bancoRef }) {
    const estados = e.cliente?.estados_campos || {};
    const campos = [
      estados.rg?.estado === "LOCALIZADO_SUSPEITO" && estados.rg.valor ? `documento de identidade preenchido como ${estados.rg.valor}` : null,
      estados.endereco?.estado === "LOCALIZADO_VAZIO" ? `endereço registrado como "${estados.endereco.valor || "não informado"}"` : null,
    ].filter(Boolean);
    return {
      titulo: "Cadastro do Contratante",
      quesito: `Queira ${bancoRef} esclarecer a formalização da operação${campos.length ? ` com ${juntarLista(campos)}` : " com campos de qualificação fictícios ou não informados"}, informando qual documento foi efetivamente conferido e por qual canal.`,
      finalidade: "Esclarecer as limitações cadastrais e os documentos utilizados na identificação.",
    };
  },
  SEG1(e, { nomeRef }) {
    const sg = e.seguro_prestamista || {};
    const cobertura = [...(sg.coberturas || [])]
      .filter((c) => Number.isFinite(c.carencia_dias) && (c.carencia_dias > 0 || c.franquia_dias > 0))
      .sort((a, b) => (b.carencia_dias + (b.franquia_dias || 0)) - (a.carencia_dias + (a.franquia_dias || 0)))[0];
    if (!cobertura) return null;
    const minimo = cobertura.carencia_dias + (cobertura.franquia_dias || 0);
    const carencia = e.contrato?.carencia_dias;
    const estipulante = sg.estipulante?.nome;
    return {
      titulo: "Seguro Prestamista Vinculado à Operação",
      quesito: `Queira a seguradora ou o estipulante apresentar a apólice, o certificado individual e a comprovação da opção de ${nomeRef} pela cobertura de ${cobertura.nome}, esclarecer o início e o fim da vigência e os marcos de contagem da carência de ${dias(cobertura.carencia_dias)} e da franquia de ${dias(cobertura.franquia_dias || 0)}. Os dois prazos têm marcos próprios e não fixam, por soma automática, a primeira indenização.`,
      finalidade: "Conferir adesão, vigência e condições de cobertura, sem presumir parcelas descobertas.",
    };
  },
  "TRL1-CCB"(e, { bancoRef }) {
    const ev = (e.trilha_eventos?.eventos || []).find((x) => /c[ée]dula/i.test(x.documento_aceito?.rotulo || "") && Number.isFinite(x.segundos_por_pagina));
    return {
      titulo: "Tempo de Exibição do Instrumento na Jornada",
      quesito: `Queira ${bancoRef} apresentar os registros de exibição e rolagem da cédula na jornada de contratação${ev ? `, cujo aceite ocorreu ${ev.intervalo_s} segundos após o evento anterior para ${ev.documento_aceito.paginas} páginas` : ""}, informando o tempo em que o documento permaneceu aberto e se houve leitura integral antes do aceite.`,
      finalidade: "Esclarecer quando e qual conteúdo foi disponibilizado antes do aceite, sem presumir tempo de leitura.",
    };
  },
  IDN1(_e, { bancoRef }, achado) {
    return {
      titulo: "Vinculação entre Identificador e Conteúdo Assinado",
      quesito: `Queira ${bancoRef} esclarecer o método técnico que vincula o identificador${achado.valor ? ` ${achado.valor}` : ""}, repetido em documentos distintos do dossiê, ao conteúdo efetivamente assinado de cada um deles.`,
      finalidade: "Demonstrar se o identificador garante a integridade de cada documento ou é apenas número de protocolo.",
    };
  },
  INT1(e) {
    const protocolo = e.assinatura?.codigo_autenticacao_declarado;
    return {
      titulo: "Integridade Criptográfica e Ônus Probatório (Tema 1.061 STJ e MP 2.200-2/2001)",
      quesito: `Caso haja impugnação da autenticidade pelo consumidor, observada a hipótese do Tema 1.061 do STJ (CPC, art. 429, II), e considerando que o dossiê não apresenta resumo criptográfico (hash) do documento assinado${protocolo ? `, mas apenas o protocolo interno ${protocolo}, verificável somente no sítio da própria instituição` : ""}, queira informar se a assinatura possui certificado ICP-Brasil e apresentar o hash do arquivo original, calculado no momento da assinatura, com indicação do algoritmo e do meio de conferência por terceiro.`,
      finalidade: "Fixar a incumbência probatória sobre a instituição financeira e afastar a autoverificação.",
    };
  },
  BIO2(e) {
    const b = e.imagem_biometrica;
    if (!b) return null;
    const caracteristicas = [
      b.pagina ? `pág. ${b.pagina}` : null,
      b.largura && b.altura ? `${b.largura} x ${b.altura} pixels` : null,
      Number.isFinite(b.megapixels) ? `${String(b.megapixels).replace(".", ",")} megapixel` : null,
      b.exif === false ? "sem metadados EXIF de captura" : null,
    ].filter(Boolean);
    const ausentes = b.dados_do_processo_ausentes || [];
    return {
      titulo: "Validação Biométrica e Prova de Vida Ativa (Liveness Detection)",
      quesito: `Considerando que o arquivo exibe ${b.contagem_faciais === 1 ? "uma única fotografia" : "fotografia"}${caracteristicas.length ? ` (${caracteristicas.join(", ")})` : ""}, queira o Sr. Perito ou a instituição informar se houve prova de vida ativa com desafio dinâmico no momento da captura${ausentes.length ? ` e apresentar ${juntarLista(ausentes)}` : ""}, esclarecendo se a imagem pode ter sido obtida por upload ou reaproveitamento de foto prévia.`,
      finalidade: "Verificar o resultado individual da validação biométrica e sua vinculação à operação.",
    };
  },
};
