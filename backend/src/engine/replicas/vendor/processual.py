#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Análise processual · Motor de Réplicas

Cruza a petição inicial com a contestação e com os documentos juntados, e aponta
o que não fecha entre as peças: pedido não enfrentado, fato não impugnado de
forma específica, admissão da própria ré, contrato diverso do discutido, trecho
vindo de outro processo, documento essencial ausente e providência processual
pendente.

Vale aqui a mesma disciplina do resto do programa. Nada é afirmado sem o trecho
que sustenta. O que a leitura não consegue determinar sai como ponto a conferir,
e não como conclusão. Nenhum modelo de linguagem participa: são expressões
regulares e comparação de conjuntos, conferíveis linha a linha.

O ônus de cada achado é dito de forma expressa, porque nem toda lacuna é da ré:
a que for da inicial precisa ser corrigida na réplica, e não explorada.
"""

import re
import unicodedata
from datetime import date

Sinal = _MOD['forense'].Sinal
GRAVIDADE = _MOD['forense'].GRAVIDADE
data_br = _MOD['forense'].data_br
moeda = _MOD['forense'].moeda
fmt = _MOD['forense'].fmt


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def chave(s):
    return re.sub(r"\s+", " ", sem_acento(s).lower())


RX_CNJ = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
RX_CONTRATO = re.compile(r"contrato\s*(?:n[ºo°.]*\s*)?([\d]{5,20})")
RX_NOME = re.compile(r"\b([A-ZÀ-Ý][A-ZÀ-Ý\s]{9,60})\b")
RX_VALOR = re.compile(r"r\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})")

# temas que a inicial deduz e que a defesa precisa enfrentar de forma específica
TEMAS = [
    ("inexistencia", "declaração de inexistência do débito ou do contrato",
     r"inexist[êe]ncia\s+(?:do\s+)?(?:d[ée]bito|contrato|neg[óo]cio|rela[çc][ãa]o)",
     r"inexist[êe]ncia|v[áa]lid[ao]|contrata[çc][ãa]o\s+[ée]\s+regular|regular(?:idade)?|"
     r"legitim|efetivamente\s+contrat|houve\s+contrata|improced[êe]ncia"),
    ("repeticao", "repetição do indébito",
     r"repeti[çc][ãa]o\s+do\s+ind[ée]bito|restitui[çc][ãa]o\s+(?:em\s+dobro|dos\s+valores)|"
     r"devolu[çc][ãa]o\s+em\s+dobro",
     r"repeti[çc][ãa]o|ind[ée]bito|devolu[çc][ãa]o|restitui[çc][ãa]o|forma\s+simples|"
     r"enriquecimento|compensa[çc][ãa]o|abatimento"),
    ("moral", "dano moral",
     r"dano\s+moral|danos\s+morais",
     r"dano\s+moral|danos\s+morais|mero\s+dissabor|mero\s+aborrecimento|"
     r"quantum|inexist[êe]ncia\s+de\s+dano|ausência\s+de\s+dano"),
    ("tutela", "tutela de urgência para cessação dos descontos",
     r"tutela\s+de\s+urg[êe]ncia|tutela\s+antecipada|cessa[çc][ãa]o\s+(?:imediata\s+)?dos\s+descontos|"
     r"suspens[ãa]o\s+dos\s+descontos",
     r"tutela\s+de\s+urg[êe]ncia|tutela\s+antecipada|periculum|fumus|"
     r"cessa[çc][ãa]o\s+dos\s+descontos"),
    ("onus", "inversão do ônus da prova",
     r"invers[ãa]o\s+do\s+[ôo]nus\s+da\s+prova|artigo\s+6[ºo°]?,?\s*(?:inciso\s*)?viii",
     r"invers[ãa]o\s+do\s+[ôo]nus|[ôo]nus\s+da\s+prova|art(?:igo)?\.?\s*373|"
     r"cabe\s+[àa]\s+autora\s+provar|hipossufici"),
    ("exibicao", "exibição de documentos pela instituição",
     r"exibi[çc][ãa]o\s+(?:de\s+)?documento|art(?:igo)?\.?\s*(?:396|400)",
     r"exibi[çc][ãa]o|art(?:igo)?\.?\s*(?:396|397|400)"),
    ("pericia", "prova pericial grafotécnica ou digital",
     r"per[íi]cia\s+grafot[ée]cnica|prova\s+pericial|per[íi]cia\s+digital",
     r"per[íi]cia|pericial|grafot[ée]cnic"),
]

# documentos que a inicial de consignado precisa levar
ESSENCIAIS_INICIAL = [
    ("procuracao", "procuração", ["procuracao"]),
    ("hiscre", "histórico de consignações do benefício", ["hiscre"]),
    ("documento_pessoal", "documento de identificação da autora",
     ["documento_pessoal"]),
]

# o que a defesa costuma anunciar e não juntar
RX_ANUNCIA_DEFESA = [
    (r"log\s+completo", "log completo da jornada", "log"),
    (r"extrato\s+banc[áa]ri", "extrato bancário da conta da autora", "extrato"),
    (r"parecer\s+t[ée]cnico", "parecer técnico de segurança", None),
    (r"laudo\s+(?:t[ée]cnico|pericial)", "laudo técnico", None),
    (r"raz[õo]es\s+adicionais", "razões adicionais à defesa", None),
    (r"grava[çc][ãa]o\s+(?:telef[ôo]nica|de\s+voz)", "gravação telefônica", None),
    (r"biometria|selfie", "captura biométrica ou selfie", None),
]

TERMOS_ADMISSAO = [
    (r"analfabet", "que a autora é analfabeta"),
    (r"n[ãa]o\s+sabe\s+(?:ler|assinar|escrever)", "que a autora não sabe ler ou escrever"),
    (r"assinatura\s+a\s+rogo|assinou\s+a\s+rogo", "que o instrumento foi assinado a rogo"),
    (r"impress[ãa]o\s+digital", "que a autora se identifica por impressão digital"),
    (r"idad[e]?\s+avan[çc]ada|pessoa\s+idosa", "que a autora é pessoa idosa"),
    (r"correspondente\s+banc[áa]rio", "que a contratação passou por correspondente bancário"),
    (r"incontrovers", "que o ponto é incontroverso"),
]


def _ev(doc, m, folga=80):
    p = doc.paginas[0]
    for pg in doc.paginas:
        if m.group(0)[:30] in chave(pg.texto):
            p = pg
            break
    k = chave(p.texto)
    i = k.find(m.group(0)[:40])
    if i < 0:
        i = 0
    return {"arquivo": doc.nome, "pagina": p.n, "fonte": p.fonte,
            "trecho": re.sub(r"\s+", " ", p.texto[max(0, i - folga):i + 190]).strip()[:210]}


def _busca(docs, rx):
    r = re.compile(rx)
    for d in docs:
        m = r.search(d.k)
        if m:
            return d, m
    return None, None


def analisar(leitura, hoje=None):
    """Cruza inicial, contestação e documentos. Devolve sinais processuais."""
    hoje = hoje or date.today()
    S = []
    docs = leitura.documentos
    por = lambda *t: [d for d in docs if d.tipo in t]
    iniciais = por("inicial")
    defesas = por("contestacao")
    contratos = por("contrato")
    tipos = set(d.tipo for d in docs)

    if not iniciais:
        S.append(Sinal(
            "PRO-00", "Petição inicial não localizada", "medio",
            "Nenhum documento da pasta foi reconhecido como petição inicial. Sem ela "
            "não há como conferir o que foi pedido contra o que foi enfrentado, nem "
            "verificar se a prova da inicial está completa. Junte a inicial à pasta e "
            "leia de novo.", "nenhum arquivo classificado como inicial", ""))
    if not defesas:
        S.append(Sinal(
            "PRO-00b", "Contestação não localizada", "medio",
            "Nenhum documento foi reconhecido como contestação. O cotejo entre as "
            "peças fica prejudicado.", "nenhum arquivo classificado como contestação", ""))

    # ---- 1 · pedidos deduzidos e não enfrentados -------------------------
    if iniciais and defesas:
        ki = " ".join(d.k for d in iniciais)
        kd = " ".join(d.k for d in defesas)
        nao_enfrentados = []
        for cod, rotulo, rx_ini, rx_def in TEMAS:
            if re.search(rx_ini, ki) and not re.search(rx_def, kd):
                nao_enfrentados.append(rotulo)
        if nao_enfrentados:
            S.append(Sinal(
                "PRO-01", "Pontos da inicial sem correspondência visível na defesa",
                "medio",
                "A leitura não localizou, na contestação, tratamento de %d ponto(s) "
                "deduzido(s) na inicial: %s. Isso é indício de falta de impugnação "
                "específica, e não prova dela: a busca é por termos, e a defesa pode "
                "ter enfrentado o tema com outras palavras. Releia esses trechos antes "
                "de invocar a presunção do art. 341 do Código de Processo Civil, "
                "porque afirmar silêncio que não houve custa credibilidade na réplica."
                % (len(nao_enfrentados), "; ".join(nao_enfrentados)),
                "temas sem correspondência: %s" % ", ".join(nao_enfrentados), "",
                "Se confirmada a omissão na leitura dos autos: reconhecimento da "
                "presunção do art. 341 do CPC quanto aos pontos não impugnados."))

        # defesa genérica: nega tudo sem enfrentar documento
        d, m = _busca(defesas, r"impugna\s+(?:todos|genericamente)|nega\s+todos\s+os\s+fatos|"
                              r"por\s+negativa\s+geral")
        if d is not None:
            S.append(Sinal(
                "PRO-02", "Defesa por negativa geral", "alto",
                "A contestação nega os fatos em bloco, sem enfrentar documento por "
                "documento. Negativa geral não satisfaz o ônus da impugnação "
                "específica do art. 341 do CPC.",
                _ev(d, m)["trecho"], d.nome))

    # ---- 2 · admissões da própria ré ------------------------------------
    admitidos = []
    for rx, rotulo in TERMOS_ADMISSAO:
        d, m = _busca(defesas, rx)
        if d is not None:
            admitidos.append((rotulo, _ev(d, m)))
    if admitidos:
        S.append(Sinal(
            "PRO-03", "A ré admite fatos que sustentam a tese da autora", "alto",
            "A própria contestação reconhece %s. Ponto admitido pela parte contrária "
            "dispensa prova e deve abrir o capítulo da condição da parte autora."
            % "; ".join(r for r, _ in admitidos),
            " | ".join(e["trecho"][:110] for _, e in admitidos[:3]),
            admitidos[0][1]["arquivo"]))

    # ---- 3 · contrato discutido contra contrato juntado -----------------
    def numeros(lista):
        out = set()
        for d in lista:
            for m in RX_CONTRATO.finditer(d.k):
                n = re.sub(r"\D", "", m.group(1))
                if len(n) >= 5:
                    out.add(n)
        return out

    n_ini, n_def, n_doc = numeros(iniciais), numeros(defesas), numeros(contratos)
    if n_ini and n_doc and not (n_ini & n_doc):
        S.append(Sinal(
            "PRO-04", "A ré juntou contrato diverso do discutido na inicial", "critico",
            "A inicial impugna o contrato %s e o instrumento juntado é o %s. A defesa "
            "não se desincumbiu do ônus quanto ao contrato dos autos: apresentou outro."
            % (", ".join(sorted(n_ini)[:3]), ", ".join(sorted(n_doc)[:3])),
            "inicial: %s | juntado: %s"
            % (", ".join(sorted(n_ini)[:5]), ", ".join(sorted(n_doc)[:5])), "",
            "Exibição do instrumento correspondente ao contrato impugnado na inicial."))

    # ---- 4 · trecho vindo de outro processo -----------------------------
    if defesas:
        proc_autos = leitura.dados.get("processo", "")
        outros = set()
        for d in defesas:
            for m in RX_CNJ.finditer(d.texto):
                if proc_autos and m.group(0) != proc_autos:
                    outros.add(m.group(0))
        if outros:
            S.append(Sinal(
                "PRO-05", "Número de processo estranho dentro da contestação", "critico",
                "A defesa menciona o processo %s, diverso do número destes autos (%s). "
                "É indício de peça montada a partir de modelo de outro caso, e o "
                "trecho correspondente não se refere a esta lide."
                % (", ".join(sorted(outros)[:2]), proc_autos),
                "encontrados: %s" % ", ".join(sorted(outros)[:5]), defesas[0].nome))

        # contrato citado na defesa que não é nem o da inicial nem o juntado
        estranhos = n_def - n_ini - n_doc
        if estranhos and (n_ini or n_doc):
            S.append(Sinal(
                "PRO-06", "Contrato estranho citado na contestação", "alto",
                "A contestação se refere ao contrato %s, que não é o impugnado na "
                "inicial nem o instrumento juntado. Costuma ser parágrafo aproveitado "
                "de outra defesa." % ", ".join(sorted(estranhos)[:3]),
                "na defesa: %s | na inicial: %s | juntado: %s"
                % (", ".join(sorted(n_def)[:4]), ", ".join(sorted(n_ini)[:4]),
                   ", ".join(sorted(n_doc)[:4])), defesas[0].nome))

        # nome de parte estranho
        if iniciais:
            nomes_ini = set()
            for d in iniciais:
                for m in RX_NOME.finditer(d.texto[:4000]):
                    nomes_ini.add(m.group(1).strip())
            autor = leitura.dados.get("autor", "")
            for d in defesas:
                for m in re.finditer(r"(?:autora?|requerente|reclamante)\s*[,:]?\s*"
                                     r"([A-ZÀ-Ý][A-ZÀ-Ý\s]{9,50})", d.texto):
                    nome = " ".join(m.group(1).split())
                    if (autor and nome[:14] not in autor and autor[:14] not in nome
                            and not any(nome[:14] in x for x in nomes_ini)):
                        S.append(Sinal(
                            "PRO-07", "Nome de parte estranho na contestação", "critico",
                            "A defesa se refere a %s como autora, nome que não aparece "
                            "na inicial. Parágrafo de outro processo dentro da peça: "
                            "aponte na réplica e requeira o desentranhamento ou a "
                            "desconsideração do trecho." % nome,
                            re.sub(r"\s+", " ", d.texto[max(0, m.start() - 70):
                                                        m.end() + 90]).strip(), d.nome))
                        break

    # ---- 5 · documentos essenciais da inicial ---------------------------
    if iniciais:
        faltando = [rot for _, rot, tps in ESSENCIAIS_INICIAL
                    if not any(t in tipos for t in tps)]
        if faltando:
            S.append(Sinal(
                "DOC-01", "Documento essencial da autora não localizado", "alto",
                "Não foi localizado nos arquivos: %s. O ônus aqui é da autora, e a "
                "falta enfraquece a própria peça. Confira se está nos autos e não na "
                "pasta, e junte antes de protocolar a réplica."
                % "; ".join(faltando),
                "tipos localizados: %s" % ", ".join(sorted(tipos)), "",
                "Juntada pela autora, com justificativa do art. 435 do CPC se tardia."))

        # prova da impossibilidade de assinar, que sustenta os cenários A a F
        d, m = _busca(iniciais, r"analfabet|n[ãa]o\s+sabe\s+(?:ler|assinar|escrever)|"
                                r"impossibilidad[e]?\s+de\s+assinar|impress[ãa]o\s+digital")
        if d is None:
            S.append(Sinal(
                "DOC-02", "Inicial não afirma a impossibilidade de assinar", "medio",
                "A inicial não traz afirmação de analfabetismo ou de impossibilidade "
                "de assinar. Os cenários A a F do caderno dependem dessa base: sem "
                "ela, o vício de forma do art. 595 do Código Civil não é apreciado.",
                "nenhuma ocorrência na inicial", iniciais[0].nome))
        else:
            S.append(Sinal(
                "DOC-03", "Inicial afirma a impossibilidade de assinar", "nota",
                "A base dos cenários A a F está posta na inicial. Confirme que a "
                "prova documental correspondente também está nos autos, e não apenas "
                "a alegação.", _ev(d, m)["trecho"], d.nome))

        # o que a inicial anunciou e não juntou
        for rx, rotulo, tipo in RX_ANUNCIA_DEFESA:
            d, m = _busca(iniciais, rx)
            if d is not None and tipo and tipo not in tipos:
                S.append(Sinal(
                    "DOC-04", "Documento anunciado na inicial e não localizado", "medio",
                    "A inicial se refere a %s, que não está entre os arquivos lidos. "
                    "Lacuna da autora, e não da ré: corrija antes de a defesa apontar."
                    % rotulo, _ev(d, m)["trecho"], d.nome))

    # ---- 6 · o que só o banco tem e não exibiu --------------------------
    for rx, rotulo, tipo in RX_ANUNCIA_DEFESA:
        d, m = _busca(defesas, rx)
        if d is not None and tipo and tipo not in tipos:
            S.append(Sinal(
                "DOC-05", "Documento anunciado na defesa e não juntado", "alto",
                "A contestação afirma a existência de %s e não o junta. Prova "
                "anunciada e não produzida não socorre quem tem o ônus, e autoriza a "
                "consequência do art. 400 do CPC." % rotulo,
                _ev(d, m)["trecho"], d.nome,
                "Intimação da ré para exibir %s, sob a consequência do art. 400 do "
                "Código de Processo Civil." % rotulo))

    if defesas and not contratos:
        d, m = _busca(defesas, r"contrato|instrumento|c[ée]dula")
        S.append(Sinal(
            "DOC-06", "A ré afirma o contrato e não o exibe", "critico",
            "A defesa se apoia na existência de contrato, mas nenhum instrumento foi "
            "localizado entre os arquivos juntados. O art. 434 do CPC exige que o "
            "documento acompanhe a peça em que se funda.",
            _ev(d, m)["trecho"] if d is not None else "sem instrumento nos arquivos",
            d.nome if d is not None else "",
            "Reconhecimento de que a ré não se desincumbiu do ônus do art. 373, II, "
            "do CPC."))

    # ---- 7 · marcha processual ------------------------------------------
    if iniciais:
        d, m = _busca(iniciais, r"tutela\s+de\s+urg[êe]ncia|tutela\s+antecipada")
        if d is not None:
            apreciada, _ = _busca(docs, r"defiro\s+(?:parcialmente\s+)?a\s+tutela|"
                                        r"indefiro\s+a\s+tutela|decis[ãa]o\s+interlocut")
            if apreciada is None:
                S.append(Sinal(
                    "MAR-01", "Tutela de urgência pedida e sem decisão localizada",
                    "alto",
                    "A inicial pede tutela de urgência e não há, entre os arquivos, "
                    "decisão que a aprecie. O pedido sobrevive à contestação e pode "
                    "ser reiterado na réplica; se houver suspensão de tema repetitivo, "
                    "a tutela de urgência não é alcançada por ela.",
                    _ev(d, m)["trecho"], d.nome,
                    "Reiteração do pedido de tutela de urgência, com apreciação "
                    "imediata."))

        d, m = _busca(iniciais, r"protesta\s+provar|requer\s+a\s+produ[çc][ãa]o\s+de\s+prova|"
                                r"per[íi]cia")
        if d is None:
            S.append(Sinal(
                "MAR-02", "Inicial sem requerimento de prova", "medio",
                "A inicial não requereu produção de prova. Pela Súmula 67 do TJPI, "
                "pedir a prova e ter o pedido indeferido protege contra a "
                "improcedência por ausência dessa mesma prova: requeira na réplica, "
                "em segundo lugar, depois do julgamento antecipado.",
                "nenhum requerimento de prova localizado", iniciais[0].nome))

    # citação e prazo da defesa, quando as datas estiverem nos arquivos
    dcit, mcit = _busca(docs, r"cita[çc][ãa]o\s+(?:realizada|cumprida|em)|"
                              r"aviso\s+de\s+recebimento|mandado\s+cumprido")
    if dcit is not None and defesas:
        datas_cit = [data_br(x) for x in re.findall(r"\b\d{2}/\d{2}/\d{4}\b", dcit.texto)]
        datas_def = [data_br(x) for x in re.findall(r"\b\d{2}/\d{2}/\d{4}\b",
                                                    defesas[0].texto)]
        datas_cit = [x for x in datas_cit if x and x <= hoje]
        datas_def = [x for x in datas_def if x and x <= hoje]
        if datas_cit and datas_def:
            dias = (max(datas_def) - min(datas_cit)).days
            if dias > 25:
                S.append(Sinal(
                    "MAR-03", "Prazo da contestação a conferir", "medio",
                    "Entre a data de citação localizada (%s) e a data mais recente na "
                    "contestação (%s) há %d dias corridos. O prazo do art. 335 do CPC "
                    "conta em dias úteis: confira a tempestividade no andamento, "
                    "porque a leitura de datas soltas não substitui a certidão."
                    % (min(datas_cit).strftime("%d/%m/%Y"),
                       max(datas_def).strftime("%d/%m/%Y"), dias),
                    "citação=%s defesa=%s" % (min(datas_cit), max(datas_def)),
                    defesas[0].nome))

    # ---- 8 · valores: inicial contra defesa -----------------------------
    if iniciais and defesas:
        vi = {moeda(m.group(1)) for d in iniciais for m in RX_VALOR.finditer(d.k)}
        vd = {moeda(m.group(1)) for d in defesas for m in RX_VALOR.finditer(d.k)}
        vi.discard(None)
        vd.discard(None)
        if vi and vd and not (vi & vd):
            S.append(Sinal(
                "PRO-08", "Nenhum valor da defesa coincide com os da inicial", "medio",
                "Os valores citados na contestação não batem com nenhum dos indicados "
                "na inicial. Pode ser divergência de cálculo, e pode ser peça de outro "
                "caso: confira antes de escolher o eixo do ataque.",
                "inicial: %s | defesa: %s"
                % (", ".join(fmt(x) for x in sorted(vi)[:4]),
                   ", ".join(fmt(x) for x in sorted(vd)[:4])), ""))

    S.sort(key=lambda x: (-GRAVIDADE.get(x.gravidade, 0), x.codigo))
    return S
