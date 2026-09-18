/**
 * Métodos de autenticação descritos no instrumento (D1).
 *
 * ─── O defeito que motivou ───────────────────────────────────────────────────
 *
 * O § 4 do laudo FD-20260917-ABC18B73E5 imprimiu "Métodos apenas mencionados no
 * clausulado: SMS Token · E-mail" para um dossiê que não contém a palavra
 * "token" em nenhuma das 27 páginas. A regra anterior era uma busca por palavra
 * sobre o texto achatado do arquivo inteiro:
 *
 *     /token|sms/i.test(flat) ? "SMS Token" : null
 *
 * Três defeitos somados. O teste casava com "SMS" e emitia um rótulo constante
 * que afirmava "token". Não distinguia a menção em cláusula de comunicação
 * ("o cliente receberá avisos por SMS") da descrição de uma etapa do fluxo de
 * contratação. E não lia negação: "a assinatura não utiliza SMS Token" também
 * retornava verdadeiro.
 *
 * ─── A regra ─────────────────────────────────────────────────────────────────
 *
 * Método de autenticação só é afirmado quando existe trecho ancorado em que o
 * documento o descreve como etapa do fluxo de contratação. Três filtros, nesta
 * ordem, sobre o segmento em que o termo aparece:
 *
 *   1. negação no segmento derruba o achado;
 *   2. vocabulário de comunicação/marketing no segmento derruba o achado, ainda
 *      que haja vocabulário de fluxo junto (é o caso de "após o aceite, o
 *      cliente receberá comunicações por SMS");
 *   3. sem vocabulário de fluxo, não há afirmação.
 *
 * O rótulo é construído a partir do que foi lido, nunca de constante. Token sem
 * canal nomeado no mesmo segmento sai como token, sem SMS. O canal só entra
 * quando o próprio segmento o nomeia.
 *
 * Nada aqui afirma que o método foi EXECUTADO. Método descrito e evento
 * observado são eixos distintos: o evento observado vem da trilha e vive em
 * `metodos_autenticacao`.
 */

export const ESTADO_METODOS = {
  LOCALIZADO: "LOCALIZADO",
  NAO_LOCALIZADO_NO_MATERIAL: "nao_localizado_no_material",
};

/** Vocabulário que caracteriza etapa do fluxo de contratação/assinatura. */
const FLUXO = /assinatura\s+eletr[oô]nica|assinar|assinad[oa]|aceite|aceitar|autentica[cç][ãa]o|autenticar|valida[cç][ãa]o\s+de\s+identidade|confirma[cç][ãa]o\s+da\s+contrata[cç][ãa]o|formaliza[cç][ãa]o|manifesta[cç][ãa]o\s+de\s+vontade|celebra[cç][ãa]o\s+do\s+contrato|comprova[r|cç][ãa]?o?\s+(?:a\s+)?identidade/i;

/**
 * Vocabulário de comunicação, aviso e marketing. Menção a SMS ou e-mail aqui é
 * canal de contato, não fator de autenticação, e derruba o achado mesmo quando
 * o segmento também contém palavra de fluxo.
 */
const COMUNICACAO = /comunica[cç][ãa]|informa[cç][õo]es\s+sobre|notifica[cç][ãa]|aviso|avisar|marketing|publicidade|propaganda|receber\s+informa|cobran[cç]a|canal\s+de\s+atendimento|\bSAC\b|extrato|boleto|newsletter|dados\s+cadastrais/i;

/**
 * ─── Negação ────────────────────────────────────────────────────────────────
 *
 * A primeira versão desta regra enumerava verbos ("não utiliza", "não usa") no
 * nível do segmento. A revisão independente do Codex derrubou três casos que a
 * enumeração não previa:
 *
 *   "a assinatura eletrônica não é realizada com SMS Token"  cópula + particípio
 *   "a assinatura eletrônica dispensa senha"                 verbo de exclusão, sem "não"
 *   "a autenticação ocorre sem token"                        preposição
 *
 * O defeito não era a lista curta, era o nível. Negação é relação entre o
 * marcador e o termo, não propriedade do segmento. Agora o escopo é a janela
 * imediatamente anterior ao termo, mais uma janela posterior para a ordem
 * inversa ("SMS Token não é utilizado").
 */

/** Janela, em caracteres, examinada de cada lado do termo. */
const JANELA_NEGACAO = 80;

/** Marcador que, antes do termo, nega ou exclui o método. */
const NEGACAO_ANTES = /\b(?:n[ãa]o|sem|nem|dispensa[m]?|dispensand[oa]|dispensad[oa]s?|prescinde[m]?|independe[m]?|exclu[ií](?:d[oa]s?|em|i)?|isent[ao]s?|isenta[m]?|veda[m]?|vedad[oa]s?|pro[ií]be[m]?|pro[ií]bid[oa]s?|nenhum[ao]?|jamais|nunca|inexist[êe]ncia|aus[êe]ncia)\b/i;

/** Negação posposta ao termo: "token não é utilizado", "senha não será exigida". */
const NEGACAO_DEPOIS = /^[^.;]{0,60}?\bn[ãa]o\s+(?:se\s+)?(?:[ée]|s[ãa]o|ser[áa]|ser[ãa]o|foi|for[ao]m|est[áa]|h[áa])?\s*(?:utilizad|usad|us[ao]\b|exigid|exige|requerid|requer|empregad|solicitad|necess[áa]ri|aplic|disponibiliz|previst|contemplad)/i;

/**
 * Marcador de predicado afirmativo. Depois de "e"/"ou", ele reabre a afirmação
 * e impede que a negação do predicado anterior alcance o termo seguinte:
 * "dispensa senha E SE DÁ pela coleta da biometria" nega a senha, não a
 * biometria. Sem conjunção no meio, este teste não se aplica.
 */
const AFIRMACAO = /\bse\s+d[áa]|por\s+meio\s+d|mediante|atrav[ée]s\s+d|pela?\s+coleta|realizad[oa]|ocorre|utiliza|exige|requer|informa|digita/i;

/** Há negação do termo localizado em `indice`, dentro do segmento `texto`? */
function termoNegado(texto, indice, tamanho) {
  const antes = texto.slice(Math.max(0, indice - JANELA_NEGACAO), indice);
  // A janela é quebrada nas conjunções coordenativas. Se o último trecho, o
  // que governa o termo, traz predicado afirmativo próprio, a negação dos
  // trechos anteriores não o alcança. Coordenação de substantivos ("senha ou
  // token") não tem predicado próprio e continua sob a negação.
  // A quebra ignora o "e" que na verdade é a cópula "é" escrita sem acento,
  // comum em OCR: em "não e realizada com token", "e realizada" é predicado,
  // não coordenação, e tratá-lo como conjunção fazia a negação deixar de
  // alcançar o termo. O particípio seguinte é o que distingue os dois casos.
  const trechos = antes.split(/\s+(?:e|ou)\s+(?!\w+(?:ad[oa]|id[oa])s?\b)/i);
  const governante = trechos.at(-1) || "";
  const negadoAntes = trechos.length > 1 && AFIRMACAO.test(governante)
    ? NEGACAO_ANTES.test(governante)
    : NEGACAO_ANTES.test(antes);
  if (negadoAntes) return true;
  const depois = texto.slice(indice + tamanho);
  return NEGACAO_DEPOIS.test(depois);
}

/**
 * Catálogo de métodos. `termo` localiza o candidato; `canal` é opcional e só
 * qualifica o rótulo quando o mesmo segmento o nomeia.
 */
const CATALOGO = [
  {
    codigo: "TOKEN",
    termo: /\btokens?\b|\bOTP\b|c[oó]digo\s+(?:de\s+)?(?:verifica[cç][ãa]o|autentica[cç][ãa]o|de\s+acesso|de\s+uso\s+[uú]nico|tempor[aá]rio)/i,
    rotulo: "Token de autenticação descrito como etapa do fluxo",
  },
  {
    codigo: "BIOMETRIA",
    termo: /biometr[ií]a|biom[eé]tric[oa]|facematch|reconhecimento\s+facial/i,
    rotulo: "Biometria descrita como etapa do fluxo",
  },
  {
    codigo: "SELFIE",
    termo: /\bselfies?\b|foto(?:grafia)?\s+do\s+rosto/i,
    rotulo: "Selfie descrita como etapa do fluxo",
  },
  {
    codigo: "SENHA",
    termo: /\bsenhas?\b|\bPIN\b/i,
    rotulo: "Senha descrita como etapa do fluxo",
  },
];

/** Canais nomeáveis. Só qualificam o rótulo; sozinhos não são método. */
const CANAIS = [
  { nome: "SMS", termo: /\bSMS\b|mensagem\s+de\s+texto/i },
  { nome: "e-mail", termo: /\be-?mails?\b|correio\s+eletr[oô]nico/i },
  { nome: "aplicativo", termo: /\baplicativo\b|\bapp\b|plataforma/i },
  { nome: "WhatsApp", termo: /\bwhatsapp\b/i },
];

const compactar = (s, max = 300) => {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
};

/** Largura máxima do trecho impresso como evidência. */
const JANELA_TRECHO = 300;

/**
 * Trecho de evidência ancorado nas ocorrências, não no início do segmento.
 *
 * Cortar os primeiros 300 caracteres da cláusula parecia suficiente até o Codex
 * mostrar um preâmbulo longo ("para formalização da contratação, observadas as
 * condições gerais...") que empurrava método e canal para fora da janela. A
 * classificação acertava e a evidência impressa saía sem o que a sustentava,
 * que é pior do que não afirmar: o leitor confere o trecho e não acha o fato.
 *
 * A janela agora cobre obrigatoriamente todas as âncoras, com o contexto que
 * couber em volta, e marca com reticências o que ficou de fora.
 */
function trechoAncorado(texto, ancoras, max = JANELA_TRECHO) {
  const inicioAncoras = Math.min(...ancoras.map((a) => a.inicio));
  const fimAncoras = Math.max(...ancoras.map((a) => a.fim));
  const vao = fimAncoras - inicioAncoras;
  const largura = Math.max(max, vao);
  const folga = Math.max(0, largura - vao);

  let inicio = Math.max(0, inicioAncoras - Math.floor(folga / 2));
  let fim = Math.min(texto.length, inicio + largura);
  inicio = Math.max(0, Math.min(inicio, fim - largura));

  // Não cortar palavra ao meio quando há texto de sobra dos dois lados.
  if (inicio > 0) {
    const espaco = texto.indexOf(" ", inicio);
    if (espaco !== -1 && espaco < inicioAncoras) inicio = espaco + 1;
  }
  if (fim < texto.length) {
    const espaco = texto.lastIndexOf(" ", fim);
    if (espaco > fimAncoras) fim = espaco;
  }

  const corpo = texto.slice(inicio, fim).replace(/\s+/g, " ").trim();
  return `${inicio > 0 ? "…" : ""}${corpo}${fim < texto.length ? "…" : ""}`;
}

/**
 * Quebra o texto em segmentos com posição de origem preservada. O segmento é a
 * unidade de ancoragem: o termo e o contexto que o qualifica precisam estar no
 * mesmo segmento, senão a leitura vaza de uma cláusula para a vizinha.
 */
function segmentar(text) {
  const segmentos = [];
  const re = /[^.;\n\f]+/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const bruto = m[0];
    if (bruto.trim().length < 12) continue;
    segmentos.push({ texto: bruto, inicio: m.index });
  }
  return segmentos;
}

/** Página 1-based do offset, quando o texto traz quebras de página (\f). */
function paginaDoOffset(text, offset) {
  if (!text.includes("\f")) return null;
  let pagina = 1;
  for (let i = 0; i < offset && i < text.length; i += 1) {
    if (text[i] === "\f") pagina += 1;
  }
  return pagina;
}

/**
 * @param {string} text texto do documento, com quebras de linha preservadas
 * @param {object} [opcoes]
 * @param {boolean} [opcoes.biometriaRegistradaComoEvento] biometria já observada
 *   como evento da trilha; nesse caso ela não é "apenas descrita" e sai daqui
 * @returns {{estado: string, metodos: Array<object>}}
 */
export function extrairMetodosDescritos(text, opcoes = {}) {
  const documento = String(text || "");
  const { biometriaRegistradaComoEvento = false } = opcoes;
  const segmentos = segmentar(documento);
  const achados = new Map();

  for (const segmento of segmentos) {
    const { texto, inicio } = segmento;
    if (COMUNICACAO.test(texto)) continue;
    if (!FLUXO.test(texto)) continue;

    for (const entrada of CATALOGO) {
      if (entrada.codigo === "BIOMETRIA" && biometriaRegistradaComoEvento) continue;
      // Um achado por método. O primeiro segmento que o sustenta é a âncora.
      if (achados.has(entrada.codigo)) continue;

      // O termo é localizado com posição, não apenas testado: a negação é
      // avaliada em relação a ele, e não no segmento inteiro.
      const ocorrencia = texto.match(new RegExp(entrada.termo.source, "i"));
      if (!ocorrencia) continue;
      if (termoNegado(texto, ocorrencia.index, ocorrencia[0].length)) continue;

      // O canal também precisa estar afirmado: "token enviado por SMS" nomeia
      // canal, "token, sem envio de SMS" não.
      const canalEncontrado = CANAIS.map((c) => ({ nome: c.nome, m: texto.match(new RegExp(c.termo.source, "i")) }))
        .find((c) => c.m && !termoNegado(texto, c.m.index, c.m[0].length));
      const canal = canalEncontrado?.nome || null;
      achados.set(entrada.codigo, {
        codigo: entrada.codigo,
        // O rótulo nomeia o canal só quando o próprio trecho o nomeia. Sem isso
        // o laudo afirmaria um canal que não leu, que foi o defeito do "SMS
        // Token" emitido por constante.
        rotulo: canal ? `${entrada.rotulo} (canal declarado: ${canal})` : entrada.rotulo,
        canal,
        // A evidência impressa cobre método e canal, venham eles onde vierem
        // na cláusula.
        trecho: trechoAncorado(texto, [
          { inicio: ocorrencia.index, fim: ocorrencia.index + ocorrencia[0].length },
          ...(canalEncontrado ? [{ inicio: canalEncontrado.m.index, fim: canalEncontrado.m.index + canalEncontrado.m[0].length }] : []),
        ]),
        pagina: paginaDoOffset(documento, inicio),
        eixo: "descrito_no_instrumento",
      });
    }
  }

  const metodos = [...achados.values()];
  return {
    estado: metodos.length ? ESTADO_METODOS.LOCALIZADO : ESTADO_METODOS.NAO_LOCALIZADO_NO_MATERIAL,
    metodos,
  };
}
