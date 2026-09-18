import { haversineKm } from "../utils/geoUtils.js";

/**
 * Trilha de eventos do dossiê de contratação, com intervalos, segundos por
 * página lida e fuso horário.
 *
 * ─── Por que ─────────────────────────────────────────────────────────────────
 *
 * O laudo do dossiê C6 marcou "trilha de auditoria: SIM" e parou aí. A trilha
 * mostra a jornada inteira em 204 segundos: termos de uso (10 páginas) aceitos
 * em 45 s, cédula e condições gerais (12 páginas) em 27 s, proposta de seguro
 * (3 páginas) em 7 s. É o material mais eloquente do dossiê.
 *
 * Ela também rotula os horários como "Hora GMT", enquanto o bloco de assinatura
 * traz "Data e hora" sem fuso. Na leitura GMT, o ato das 10:45 ocorreu às 06:45
 * no horário de Manaus.
 *
 * ─── Formato lido ────────────────────────────────────────────────────────────
 *
 *   <Nome do evento>
 *   Hora GMT, Data: 25/06/2025 10:41:39
 *   [IP e Porta Lógica: ...]  [Latitude e Longitude: ...]
 *   [Navegador ...]           [Identificador do aparelho: ...]
 */

const LINHA_HORA = /^(?:Hora\s+(GMT|UTC|BRT|local)[^,]*,\s*)?Data\s*:\s*(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s*$/i;

// Fuso civil por UF (sem horário de verão desde 2019).
const FUSO_POR_UF = {
  AC: { iana: "America/Rio_Branco", rotulo: "Rio Branco (UTC-5)" },
  AM: { iana: "America/Manaus", rotulo: "Manaus (UTC-4)" },
  RR: { iana: "America/Boa_Vista", rotulo: "Boa Vista (UTC-4)" },
  RO: { iana: "America/Porto_Velho", rotulo: "Porto Velho (UTC-4)" },
  MT: { iana: "America/Cuiaba", rotulo: "Cuiabá (UTC-4)" },
  MS: { iana: "America/Campo_Grande", rotulo: "Campo Grande (UTC-4)" },
};
const FUSO_PADRAO = { iana: "America/Sao_Paulo", rotulo: "Brasília (UTC-3)" };

export function fusoDaUf(uf) {
  return FUSO_POR_UF[String(uf || "").toUpperCase()] || FUSO_PADRAO;
}

function horaNoFuso(dataUtc, iana) {
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: iana, day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
  }).format(dataUtc).replace(",", "");
}

function lerDetalhes(linhas) {
  const junto = linhas.join("\n");
  // Guloso: em IPv6 a porta é o último grupo depois de ":".
  const ipPorta = junto.match(/IP\s+e\s+Porta\s+L[óo]gica\s*:\s*([0-9a-f:.]+):(\d{2,5})\b/i);
  const coord = junto.match(/Latitude\s+e\s+Longitude\s*:\s*(-?\d{1,2}[.,]\d+)\s*\/\s*(-?\d{1,3}[.,]\d+)/i);
  const navegador = junto.match(/Navegador[^:]*:\s*([^\n]+(?:\n(?!\s*(?:Identificador|IP\s+e|Latitude))[^\n]+)?)/i)?.[1]?.replace(/\s+/g, " ").trim() || null;
  return {
    ip: ipPorta?.[1] || null,
    porta: ipPorta?.[2] || null,
    lat: coord ? Number(coord[1].replace(",", ".")) : null,
    lon: coord ? Number(coord[2].replace(",", ".")) : null,
    navegador,
    aparelho: junto.match(/Identificador\s+do\s+aparelho\s*:\s*(\S+)/i)?.[1] || null,
  };
}

/**
 * @param {string} texto texto do documento
 * @returns {object[]} eventos em ordem de aparição
 */
export function extrairEventosTrilha(texto) {
  const linhas = String(texto || "").replace(/\f/g, "\n").split("\n").map((l) => l.trim());
  const indices = [];
  linhas.forEach((linha, i) => {
    const m = linha.match(LINHA_HORA);
    if (!m) return;
    let j = i - 1;
    while (j >= 0 && !linhas[j]) j -= 1;
    if (j < 0) return;
    indices.push({ iHora: i, iNome: j, m });
  });
  return indices.map(({ iHora, iNome, m }, k) => {
    const fim = indices[k + 1] ? indices[k + 1].iNome : Math.min(linhas.length, iHora + 12);
    const [, fuso, dd, mm, aaaa, hh, mi, ss] = m;
    const detalhes = lerDetalhes(linhas.slice(iHora + 1, fim));
    return {
      nome: linhas[iNome],
      data_hora: `${dd}/${mm}/${aaaa} ${hh}:${mi}:${ss}`,
      fuso: fuso ? fuso.toUpperCase() : null,
      epoch: Date.UTC(Number(aaaa), Number(mm) - 1, Number(dd), Number(hh), Number(mi), Number(ss)),
      ...detalhes,
    };
  });
}

// Evento de aceite e o documento lógico que ele aceita.
const ACEITES = [
  { regex: /termos\s+de\s+uso|pol[íi]tica\s+de\s+privacidade/i, tipos: ["TERMOS"], rotulo: "termos de uso e política de privacidade", codigo: "TRL1-TERMOS" },
  { regex: /\bCCB\b|c[ée]dula/i, tipos: ["INSTRUMENTO_PRINCIPAL", "CONDICOES_GERAIS"], rotulo: "cédula e condições gerais", codigo: "TRL1-CCB" },
  { regex: /seguro/i, tipos: ["SEGURO"], rotulo: "proposta de seguro", codigo: "TRL1-SEGURO" },
];

const paginasDoTipo = (segmentacao, tipos) =>
  (segmentacao?.documentos || []).filter((d) => tipos.includes(d.tipo)).reduce((acc, d) => acc + d.paginaFinal - d.paginaInicial + 1, 0);

// D11: a contagem com conteúdo negocial anda ao lado da total, que continua
// sendo a base da métrica. A defesa vai apontar a página de fecho; o achado
// fica mais forte antecipando do que sendo corrigido.
const paginasNegociaisDoTipo = (segmentacao, tipos) =>
  (segmentacao?.documentos || [])
    .filter((d) => tipos.includes(d.tipo))
    .reduce((acc, d) => acc + (Number.isFinite(d.paginas_conteudo_negocial) ? d.paginas_conteudo_negocial : d.paginaFinal - d.paginaInicial + 1), 0);

function duracaoPt(segundos) {
  if (!Number.isFinite(segundos)) return null;
  const min = Math.floor(segundos / 60);
  const s = segundos % 60;
  return min ? `${min} min ${s} s` : `${s} s`;
}

/**
 * @param {object} args
 * @param {string} args.texto
 * @param {object|null} args.segmentacao
 * @param {string|null} args.ufEmissao UF do local de emissão do contrato
 * @param {string|null} args.dataHoraAssinatura "Data e hora" do bloco de assinatura
 * @param {string} args.flat texto corrido, para saber se o bloco declara fuso
 */
export function analisarTrilhaEventos({ texto, segmentacao, ufEmissao, dataHoraAssinatura, flat }) {
  const eventos = extrairEventosTrilha(texto);
  if (eventos.length < 2) return null;

  eventos.forEach((ev, i) => {
    ev.intervalo_s = i === 0 ? null : Math.round((ev.epoch - eventos[i - 1].epoch) / 1000);
    ev.ausencias = [!ev.ip ? "IP" : null, ev.lat === null ? "geolocalização" : null].filter(Boolean);
    const aceite = /aceite/i.test(ev.nome) ? ACEITES.find((a) => a.regex.test(ev.nome)) : null;
    const paginas = aceite ? paginasDoTipo(segmentacao, aceite.tipos) : 0;
    const paginasNegociais = aceite ? paginasNegociaisDoTipo(segmentacao, aceite.tipos) : 0;
    ev.documento_aceito = aceite
      ? {
        rotulo: aceite.rotulo,
        paginas: paginas || null,
        paginas_conteudo_negocial: paginas ? paginasNegociais : null,
        paginas_fecho: paginas ? paginas - paginasNegociais : null,
      }
      : null;
    ev.segundos_por_pagina = aceite && paginas && ev.intervalo_s !== null ? Number((ev.intervalo_s / paginas).toFixed(2)) : null;
  });
  const duracao = Math.round((eventos.at(-1).epoch - eventos[0].epoch) / 1000);

  const fusoLocal = fusoDaUf(ufEmissao);
  const fusoTrilha = eventos.find((e) => e.fuso)?.fuso || null;
  if (fusoTrilha && /GMT|UTC/.test(fusoTrilha)) {
    eventos.forEach((ev) => { ev.hora_local = horaNoFuso(new Date(ev.epoch), fusoLocal.iana); });
  }

  const achados = [];
  const add = (codigo, gravidade, titulo, textoAchado) => achados.push({ codigo, gravidade, titulo, texto: textoAchado });

  for (const ev of eventos) {
    if (ev.segundos_por_pagina === null || ev.segundos_por_pagina >= 5) continue;
    const aceite = ACEITES.find((a) => a.regex.test(ev.nome));
    add(
      aceite.codigo,
      "INFO",
      `Intervalo registrado antes do aceite de ${aceite.rotulo}`,
      `O evento "${ev.nome}" ocorreu ${ev.intervalo_s} segundos após o evento anterior. O conjunto documental examinado tem ${ev.documento_aceito.paginas} páginas relacionadas a esse aceite; a divisão do intervalo pelo número de páginas resulta em ${String(ev.segundos_por_pagina).replace(".", ",")} s/pág. Essa razão não mede tempo de leitura. Sem registros de início da exibição, versão apresentada e interação, não é possível afirmar que o arquivo inteiro foi exibido ou que não houve leitura prévia. Solicitar os logs de exibição e aceite.`
    );
  }
  if (duracao < 600) {
    add("TRL2", "INFO", "Jornada de contratação concluída em poucos minutos", `Do primeiro evento (${eventos[0].nome}, ${eventos[0].data_hora}) ao último (${eventos.at(-1).nome}, ${eventos.at(-1).data_hora}) decorreram ${duracaoPt(duracao)}, para ${eventos.length} etapas.`);
  }
  const algumComIp = eventos.some((e) => e.ip);
  const algumComGeo = eventos.some((e) => e.lat !== null);
  const semIp = eventos.filter((e) => !e.ip);
  const semGeo = eventos.filter((e) => e.lat === null);
  if ((algumComIp && semIp.length) || (algumComGeo && semGeo.length)) {
    add(
      "TRL3",
      "MÉDIA",
      "Eventos da trilha sem IP ou sem geolocalização",
      `A trilha registra IP e geolocalização em parte dos eventos, mas ${[
        algumComIp && semIp.length ? `${semIp.length === 1 ? "1 evento não tem" : `${semIp.length} eventos não têm`} IP (${semIp.map((e) => e.nome).join("; ")})` : null,
        algumComGeo && semGeo.length ? `${semGeo.length === 1 ? "1 evento não tem" : `${semGeo.length} eventos não têm`} geolocalização (${semGeo.map((e) => e.nome).join("; ")})` : null,
      ].filter(Boolean).join(" e ")}. Os registros ausentes justamente nas etapas iniciais impedem vincular o acesso à plataforma ao mesmo aparelho e local do aceite.`
    );
  }
  const repetidos = eventos.filter((e, i) => eventos.findIndex((x) => x.nome === e.nome) !== i);
  if (repetidos.length) {
    add("TRL4", "MÉDIA", "Evento repetido na trilha", `A trilha repete ${repetidos.map((e) => `"${e.nome}" (${e.data_hora})`).join(", ")}, o que indica reabertura ou nova tentativa no fluxo, sem explicação no dossiê.`);
  }
  const comGeo = eventos.filter((e) => e.lat !== null);
  for (let i = 1; i < comGeo.length; i += 1) {
    const km = haversineKm(comGeo[i - 1].lat, comGeo[i - 1].lon, comGeo[i].lat, comGeo[i].lon);
    if (km > 50) {
      add("TRL5", "ALTA", "Salto geográfico entre eventos da trilha", `Entre "${comGeo[i - 1].nome}" e "${comGeo[i].nome}" a geolocalização registrada muda ${km.toFixed(0)} km em ${Math.round((comGeo[i].epoch - comGeo[i - 1].epoch) / 1000)} segundos.`);
      break;
    }
  }

  // FEAT-08: fuso declarado na trilha contra bloco de assinatura sem fuso.
  let fuso = null;
  if (fusoTrilha) {
    const assinaturaSemFuso = Boolean(dataHoraAssinatura) && !/Data\s+e\s+hora\s*\((?:UTC|GMT)\)|Data\s+e\s+hora\s+(?:UTC|GMT)/i.test(flat || "");
    const coincide = eventos.find((e) => e.data_hora === dataHoraAssinatura);
    fuso = {
      trilha: fusoTrilha,
      local: fusoLocal.rotulo,
      assinatura_sem_fuso: assinaturaSemFuso,
      assinatura_leitura_local: coincide?.hora_local || null,
    };
    if (assinaturaSemFuso && /GMT|UTC/.test(fusoTrilha)) {
      const horaAssinatura = dataHoraAssinatura.split(" ")[1];
      add(
        "TZ1",
        "MÉDIA",
        // D8: o título antigo era "Referências de horário misturadas no dossiê",
        // e sugeria conflito de VALORES que não existe. Conferidos os dois na
        // pág. 1, trazem exatamente o mesmo valor. O que há é um rótulo de fuso
        // ausente em um dos dois lugares. A observação de fundo continua de pé;
        // o que estava errado era a descrição do que se observou.
        coincide ? "Bloco de assinatura sem fuso declarado" : "Bloco de assinatura sem fuso declarado e sem evento de mesmo horário na trilha",
        // A afirmação de coincidência é condicionada à coincidência efetiva. A
        // primeira redação do D8 dizia "os dois valores coincidem" sempre, o
        // que é falso quando nenhum evento da trilha bate com o carimbo da
        // assinatura: trocar um erro de descrição por outro não corrige nada.
        `O bloco de assinatura informa "${dataHoraAssinatura}" sem indicar fuso, enquanto a trilha rotula seus eventos como ${fusoTrilha}. ${coincide
          ? `O valor do bloco coincide com o do evento "${coincide.nome}" da trilha, de modo que não há divergência de horário entre eles: o que falta é o rótulo do fuso no bloco de assinatura, e disso depende a hora local do ato.`
          : "Nenhum evento da trilha registra esse mesmo horário, de modo que não é possível afirmar, a partir do arquivo, a qual fuso o carimbo da assinatura se refere."}${coincide?.hora_local ? ` Se o valor for ${fusoTrilha}, como o da trilha, o ato ocorreu às ${coincide.hora_local.split(" ")[1]} no horário de ${fusoLocal.rotulo}, e não às ${horaAssinatura}.` : ""} O dossiê deve esclarecer o fuso efetivamente aplicado em cada carimbo.`
      );
    }
  }

  return {
    eventos: eventos.map(({ epoch, ...resto }) => resto),
    duracao_total_s: duracao,
    duracao_total: duracaoPt(duracao),
    fuso,
    achados,
  };
}
