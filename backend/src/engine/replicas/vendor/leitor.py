#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Leitor de autos · Motor de Réplicas

Lê a contestação e os documentos que a instituição juntou, classifica cada peça,
e responde as doze perguntas do diagnóstico do Caderno de Réplicas com o trecho
que sustenta cada resposta.

Regras da casa, valendo aqui como valem na peça:

  1. Nada é afirmado sem trecho localizável. Todo achado carrega arquivo, página
     e o texto lido. Sem trecho, não há achado.
  2. O que não foi possível determinar volta como pergunta, e não como palpite.
     Confiança baixa nunca vira resposta automática.
  3. Nenhum modelo de linguagem participa da leitura. São expressões regulares
     e contagem sobre o texto extraído, conferíveis linha a linha neste arquivo.
  4. Tudo roda na máquina local. Nenhum byte dos autos sai daqui.

Extração de texto: pdftotext quando há camada de texto; tesseract quando não há.
A ausência de camada de texto é, ela própria, um achado: é o que separa o
contrato digitalizado do contrato eletrônico reduzido a uma imagem.
"""

import os
import re
import io
import json
import hashlib
import subprocess
import tempfile
import unicodedata
from collections import Counter

MIN_CHARS_PAGINA = 140          # abaixo disso a página é tratada como sem texto
OCR_IDIOMA = "por"
OCR_DPI = "200"
TRECHO = 190                    # tamanho do trecho de evidência

EXT_PDF = (".pdf",)
EXT_IMG = (".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp")
EXT_TXT = (".txt", ".md")


# --------------------------------------------------------------------------
# utilidades de texto
# --------------------------------------------------------------------------

def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def chave(s):
    """Forma canônica para busca: sem acento, minúscula, espaço único."""
    return re.sub(r"\s+", " ", sem_acento(s).lower())


def existe(prog):
    from shutil import which
    return which(prog) is not None


MINUSCULAS = {"de", "da", "do", "das", "dos", "e"}


def titulo_br(s):
    """Maiúsculas de nome próprio, respeitando preposições e algarismo romano."""
    out = []
    for i, w in enumerate(s.split()):
        b = w.lower()
        if i and b in MINUSCULAS:
            out.append(b)
        elif re.fullmatch(r"[ivxl]+", b):
            out.append(b.upper())
        else:
            out.append(b.capitalize())
    return " ".join(out)


def moeda(s):
    """'1.234,56' -> 1234.56 ; devolve None se não for número."""
    try:
        return float(s.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def fmt_moeda(v):
    if v is None:
        return ""
    inteiro, dec = ("%.2f" % v).split(".")
    partes = []
    while len(inteiro) > 3:
        partes.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    partes.insert(0, inteiro)
    return "R$ " + ".".join(partes) + "," + dec


# --------------------------------------------------------------------------
# extração
# --------------------------------------------------------------------------

class Pagina(object):
    def __init__(self, arquivo, n, texto, fonte):
        self.arquivo = arquivo
        self.n = n
        self.texto = texto or ""
        self.fonte = fonte              # texto | ocr | vazia
        self.k = chave(self.texto)

    @property
    def uteis(self):
        return len(re.sub(r"[^0-9A-Za-zÀ-ÿ]", "", self.texto))


class Documento(object):
    def __init__(self, caminho):
        self.caminho = caminho
        self.nome = os.path.basename(caminho)
        self.paginas = []
        self.tipo = "indefinido"
        self.pontos_tipo = {}
        self.sha256 = ""
        self.erro = ""

    @property
    def texto(self):
        return "\n".join(p.texto for p in self.paginas)

    @property
    def k(self):
        return chave(self.texto)

    @property
    def paginas_sem_texto(self):
        return [p for p in self.paginas if p.fonte != "texto"]


def _hash(caminho):
    h = hashlib.sha256()
    with open(caminho, "rb") as f:
        for bloco in iter(lambda: f.read(1 << 20), b""):
            h.update(bloco)
    return h.hexdigest()


def _pdftotext(caminho):
    """Devolve a lista de páginas com camada de texto. \f separa as páginas."""
    if not existe("pdftotext"):
        return None
    try:
        r = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", caminho, "-"],
                           capture_output=True, timeout=180)
        if r.returncode != 0:
            return None
        return r.stdout.decode("utf-8", "replace").split("\f")
    except (subprocess.SubprocessError, OSError):
        return None


def _pdfplumber(caminho):
    try:
        import pdfplumber
    except ImportError:
        return None
    try:
        with pdfplumber.open(caminho) as pdf:
            return [(p.extract_text() or "") for p in pdf.pages]
    except Exception:
        return None


def _ocr_pagina(caminho, n):
    """OCR de uma página de PDF, via pdftoppm mais tesseract."""
    if not (existe("pdftoppm") and existe("tesseract")):
        return ""
    with tempfile.TemporaryDirectory() as tmp:
        base = os.path.join(tmp, "p")
        try:
            subprocess.run(["pdftoppm", "-f", str(n), "-l", str(n), "-r", OCR_DPI,
                            "-png", caminho, base],
                           capture_output=True, timeout=180)
            imgs = [os.path.join(tmp, x) for x in sorted(os.listdir(tmp))
                    if x.endswith(".png")]
            if not imgs:
                return ""
            return _ocr_imagem(imgs[0])
        except (subprocess.SubprocessError, OSError):
            return ""


def _ocr_imagem(caminho):
    if not existe("tesseract"):
        return ""
    try:
        r = subprocess.run(["tesseract", caminho, "stdout", "-l", OCR_IDIOMA],
                           capture_output=True, timeout=180)
        return r.stdout.decode("utf-8", "replace")
    except (subprocess.SubprocessError, OSError):
        return ""


def ler_documento(caminho, usar_ocr=True):
    d = Documento(caminho)
    ext = os.path.splitext(caminho)[1].lower()
    try:
        d.sha256 = _hash(caminho)
    except OSError as e:
        d.erro = str(e)
        return d

    if ext in EXT_TXT:
        with open(caminho, encoding="utf-8", errors="replace") as f:
            partes = f.read().split("\f")
            d.paginas = [Pagina(d.nome, numero, texto, "texto")
                         for numero, texto in enumerate(partes, start=1)]
            while d.paginas and d.paginas[-1].uteis == 0 and len(d.paginas) > 1:
                d.paginas.pop()
        return d

    if ext in EXT_IMG:
        t = _ocr_imagem(caminho) if usar_ocr else ""
        d.paginas = [Pagina(d.nome, 1, t, "ocr" if t.strip() else "vazia")]
        return d

    if ext not in EXT_PDF:
        d.erro = "extensão não suportada"
        return d

    paginas = _pdftotext(caminho)
    if paginas is None:
        paginas = _pdfplumber(caminho)
    if paginas is None:
        d.erro = "não foi possível abrir o PDF"
        return d

    for i, t in enumerate(paginas, start=1):
        if t is None:
            t = ""
        p = Pagina(d.nome, i, t, "texto")
        if p.uteis < MIN_CHARS_PAGINA:
            alt = _ocr_pagina(caminho, i) if usar_ocr else ""
            if len(re.sub(r"[^0-9A-Za-zÀ-ÿ]", "", alt)) > p.uteis:
                p = Pagina(d.nome, i, alt, "ocr")
            else:
                p.fonte = "vazia" if p.uteis < 25 else "texto"
        d.paginas.append(p)
    # pdftotext costuma devolver uma página fantasma no fim
    while d.paginas and d.paginas[-1].uteis == 0 and len(d.paginas) > 1:
        d.paginas.pop()
    return d


# --------------------------------------------------------------------------
# classificação documental
# --------------------------------------------------------------------------

PERFIS = {
    "inicial": [
        ("acao declaratoria de inexistencia", 8),
        ("peticao inicial", 5), ("vem propor", 5), ("vem, respeitosamente, propor", 6),
        ("dos pedidos", 2), ("da tutela de urgencia", 4), ("requer a citacao", 6),
        ("valor da causa", 4), ("da gratuidade", 2), ("do direito", 1),
        ("inversao do onus da prova", 3), ("da causa de pedir", 3),
        ("protesta provar", 4), ("da-se a causa o valor", 5),
    ],
    "contestacao": [
        ("contestacao", 6), ("contesta", 2), ("vem, respeitosamente", 2),
        ("preliminar", 2), ("impugna", 1), ("improcedencia", 2),
        ("mm. juiz", 1), ("meritissim", 1), ("da defesa", 1),
        ("requer a improcedencia", 3), ("da contestacao", 4),
        ("apresentar contestacao", 8), ("ora contestada", 5),
        ("a autora afirma", 2), ("a parte autora alega", 2),
    ],
    "contrato": [
        ("cedula de credito bancario", 6), ("contrato de emprestimo", 5),
        ("emprestimo consignado", 3), ("custo efetivo total", 3), ("cet", 1),
        ("valor liberado", 3), ("taxa de juros", 2), ("numero do contrato", 3),
        ("prazo", 1), ("parcelas", 1), ("contratante", 2), ("mutuario", 2),
    ],
    "comprovante": [
        ("comprovante de transferencia", 6), ("ted", 3), ("doc", 1),
        ("transferencia eletronica", 4), ("autenticacao", 3),
        ("favorecido", 3), ("beneficiario", 1), ("ordem de pagamento", 3),
        ("credito em conta", 3), ("reserva de imagem", 6),
    ],
    "extrato": [
        ("extrato", 5), ("saldo anterior", 4), ("lancamentos", 3),
        ("saldo disponivel", 3), ("data mov", 2), ("historico", 1),
    ],
    "hiscre": [
        ("hiscre", 8), ("historico de consignacoes", 8),
        ("historico de creditos", 6), ("emprestimos consignados", 3),
        ("competencia", 2), ("beneficio n", 2), ("margem consignavel", 4),
    ],
    "log": [
        ("jornada", 5), ("log", 3), ("geolocalizacao", 5), ("endereco ip", 5),
        ("dispositivo", 3), ("trilha de auditoria", 5), ("hash", 3),
        ("biometria", 4), ("selfie", 4), ("aceite", 2),
    ],
    "documento_pessoal": [
        ("registro geral", 4), ("carteira de identidade", 5),
        ("orgao expedidor", 4), ("filiacao", 3), ("naturalidade", 3),
        ("cadastro de pessoas fisicas", 3),
    ],
    "procuracao": [
        ("procuracao", 6), ("outorgante", 4), ("outorgado", 4),
        ("poderes", 2), ("ad judicia", 5),
    ],
}


def classificar(doc):
    k = doc.k
    pontos = {}
    for tipo, termos in PERFIS.items():
        s = 0
        for termo, peso in termos:
            if termo in k:
                s += peso
        if s:
            pontos[tipo] = s
    doc.pontos_tipo = pontos
    if not pontos:
        doc.tipo = "indefinido"
        return doc
    tipo, s = max(pontos.items(), key=lambda x: x[1])
    doc.tipo = tipo if s >= 5 else "indefinido"
    # o nome do arquivo desempata quando o texto é pobre
    kn = chave(doc.nome)
    for tipo2, termos in PERFIS.items():
        for termo, peso in termos:
            if peso >= 5 and termo in kn:
                doc.tipo = tipo2
                return doc
    return doc


# --------------------------------------------------------------------------
# achados
# --------------------------------------------------------------------------

class Achado(object):
    def __init__(self, campo, valor=None, confianca="baixa", nota="", evidencias=None):
        self.campo = campo
        self.valor = valor
        self.confianca = confianca      # alta | media | baixa
        self.nota = nota
        self.evidencias = evidencias or []

    def js(self):
        return {"campo": self.campo, "valor": self.valor,
                "confianca": self.confianca, "nota": self.nota,
                "evidencias": self.evidencias}


def _ev(pagina, inicio, fim):
    a = max(0, inicio - 70)
    b = min(len(pagina.texto), fim + 70)
    t = re.sub(r"\s+", " ", pagina.texto[a:b]).strip()
    return {"arquivo": pagina.arquivo, "pagina": pagina.n,
            "fonte": pagina.fonte, "trecho": t[:TRECHO]}


def procurar(docs, padrao, tipos=None, limite=4):
    """Busca uma expressão no texto canônico e devolve evidências localizadas."""
    rx = re.compile(padrao)
    out = []
    for d in docs:
        if tipos and d.tipo not in tipos:
            continue
        for p in d.paginas:
            for m in rx.finditer(p.k):
                out.append(_ev(p, m.start(), m.end()))
                if len(out) >= limite:
                    return out
    return out


# --------------------------------------------------------------------------
# diagnóstico
# --------------------------------------------------------------------------

RX_CNJ = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
RX_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RX_VALOR = re.compile(r"r\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})")
RX_DATA = re.compile(r"\b(\d{2}/\d{2}/\d{4})\b")
RX_BENEF = re.compile(r"benef[ií]cio\s*(?:n[ºo°.]*\s*)?([\d.\-]{7,20})")
RX_CONTRATO_N = re.compile(r"contrato\s*(?:n[ºo°.]*\s*)?([\d.\-/]{5,25})")
RX_PARCELAS = re.compile(r"(\d{1,3})\s*(?:x|parcelas|presta[çc][õo]es)")

# O delimitador de palavra é indispensável: sem ele "ha pedido de antecipação
# de tutela", que aparece em formulário de audiência, casava como assinatura a
# rogo e transformava contratação por aplicativo em contrato de papel.
TERMOS_ROGO = (r"\ba\s+rogo\b|assinatura\s+a\s+rogo\b|"
               r"\bassina\s+a\s+pedido\s+d[eao]\b|\brogat[áa]ri[oa]\b")

# Prova positiva de instrumento em papel. Mais estreito de propósito: é o que
# devolve os cenários do art. 595 à mesa, e devolver por engano é o erro caro.
ROGO_ESTRITO = r"\ba\s+rogo\b|\brogat[áa]ri[oa]\b"
TERMOS_ANALF = (r"analfabet|nao\s+sabe\s+(?:ler|assinar|escrever)|"
                r"impossibilidad[e]?\s+de\s+assinar|impress[ãa]o\s+digital|"
                r"datilosc[óo]pic|polegar")
TERMOS_IMAGEM = r"reserva\s+de\s+imagem|tela\s+do\s+sistema|print\s+de\s+tela|captura\s+de\s+tela"
TERMOS_PORT = r"portabilidade|refinanciamento|quita[çc][ãa]o\s+do\s+contrato|contrato\s+origin[áa]rio"

# marcas de contratação eletrônica: aparecem no instrumento, no log e na defesa
TERMOS_ELETRONICA = [
    (r"contrata[çc][ãa]o\s+(?:por|via)\s+(?:aplicativo|app)|via\s+aplicativo|"
     r"pelo\s+aplicativo|no\s+aplicativo", "contratação por aplicativo"),
    (r"assinatura\s+eletr[ôo]nica|assinado\s+eletronicamente\s+pelo\s+cliente|"
     r"aceite\s+eletr[ôo]nico", "assinatura eletrônica"),
    (r"biometri|reconhecimento\s+facial|selfie|liveness|prova\s+de\s+vida",
     "biometria"),
    (r"token|senha\s+pessoal|chave\s+de\s+seguran[çc]a", "token ou senha pessoal"),
    (r"mp\s*2\.?200|14\.?063/2020|icp-?brasil", "moldura da assinatura eletrônica"),
    (r"dossi[êe]\s+comprobat[óo]rio|jornada\s+(?:de\s+)?contrata",
     "dossiê ou jornada de contratação"),
]

# elementos técnicos que sustentam a contratação eletrônica
ELEMENTOS_TECNICOS = [
    ("ip", r"\b(?:\d{1,3}\.){3}\d{1,3}\b|endere[çc]o\s+ip", "endereço IP"),
    ("geo", r"geolocaliza|latitude|longitude|coordenada", "geolocalização"),
    ("biometria", r"biometri|selfie|reconhecimento\s+facial|liveness", "biometria"),
    ("dispositivo", r"device|dispositivo|imei|user\s*agent", "identificação do dispositivo"),
    ("hora", r"\b\d{1,2}[:h]\d{2}(?::\d{2})?\b", "carimbo de hora"),
    ("hash", r"\bhash\b|sha-?256|resumo\s+criptogr", "resumo criptográfico"),
]

PRELIMINARES_RX = [
    ("III.1", r"falta\s+de\s+interesse\s+de\s+agir|aus[êe]ncia\s+de\s+interesse\s+de\s+agir|"
              r"interesse\s+processual|pr[ée]vio\s+requerimento\s+administrativo"),
    ("III.2", r"in[ée]pcia\s+da\s+(?:peti[çc][ãa]o\s+)?inicial|inepta"),
    ("III.3", r"gratuidade\s+da\s+justi[çc]a|justi[çc]a\s+gratuita|hipossufici[êe]ncia"),
    ("III.4", r"litig[âa]ncia\s+predat[óo]ria|advocacia\s+predat[óo]ria|"
              r"demandas\s+predat[óo]rias|recomenda[çc][ãa]o\s+n[ºo°.]*\s*159"),
    ("III.5", r"prescri[çc][ãa]o|prescricional"),
]

ITENS_69 = [
    ("a", "autenticação bancária verificável",
     r"autentica[çc][ãa]o|c[óo]digo\s+de\s+autentica|nsu\b|autenticacao\s+mecanica"),
    ("b", "emissão no âmbito do sistema de pagamentos",
     r"\bspb\b|\bspi\b|sistema\s+de\s+pagamentos|\bstr\b|\bted\b|\bpix\b"),
    ("c", "identificação da instituição remetente",
     r"institui[çc][ãa]o\s+(?:remetente|emitente)|banco\s+(?:remetente|emitente)|\bispb\b|remetente"),
    ("d", "identificação da instituição destinatária",
     r"institui[çc][ãa]o\s+destinat[áa]ria|banco\s+destino|banco\s+destinat[áa]rio|destinat[áa]ri"),
    ("e", "identificação das respectivas contas",
     r"ag[êe]ncia\s*[:n]|conta\s+corrente|conta\s+destino|c/c\s*\d|\bconta\s*[:n]"),
    ("f", "valor transferido", r"r\$\s*\d"),
    ("g", "data da operação", r"\d{2}/\d{2}/\d{4}"),
    ("h", "horário da operação", r"\b\d{1,2}[:h]\d{2}(?::\d{2})?\b"),
]


class Leitura(object):
    def __init__(self):
        self.documentos = []
        self.achados = {}
        self.dados = {}
        self.preliminares = []
        self.conformidade69 = []
        self.avisos = []

    def js(self):
        return {
            "documentos": [{"nome": d.nome, "tipo": d.tipo, "paginas": len(d.paginas),
                            "sem_texto": len(d.paginas_sem_texto),
                            "ocr": sum(1 for p in d.paginas if p.fonte == "ocr"),
                            "sha256": d.sha256[:16], "erro": d.erro}
                           for d in self.documentos],
            "achados": {k: v.js() for k, v in self.achados.items()},
            "dados": self.dados,
            "preliminares": self.preliminares,
            "conformidade69": self.conformidade69,
            "avisos": self.avisos,
        }


def avaliar_contratacao(leitura, nomes_permitidos=None, nomes_defesa=None):
    """Recalcula natureza e trilha sem converter peças judiciais em prova técnica.

    Sem restrições, preserva o comportamento histórico do leitor. Quando os
    conjuntos são informados, somente documento sem exclusão dura é fonte
    primária; contestação é fonte secundária declarada, nunca instrumento.
    """
    docs = leitura.documentos
    restricted = nomes_permitidos is not None
    permitted = set(nomes_permitidos or [])
    defense_names = set(nomes_defesa or [])
    primary = [d for d in docs if not restricted or d.nome in permitted]
    defenses = [d for d in docs if d.nome in defense_names]

    def put(field, value, confidence, note, evidence=None):
        leitura.achados[field] = Achado(field, value, confidence, note, evidence or [])

    def electronic_marks(source, preserve_types=False):
        marks, evidence = [], []
        for rx, label in TERMOS_ELETRONICA:
            found = procurar(
                source, rx,
                ["contrato", "log", "contestacao"] if preserve_types else None,
                limite=1,
            )
            if found:
                marks.append(label)
                evidence.extend(found)
        return marks, evidence

    marks, electronic_evidence = electronic_marks(primary, preserve_types=not restricted)
    defense_marks, defense_evidence = electronic_marks(defenses)
    rogo = procurar(primary, ROGO_ESTRITO)
    if rogo:
        put("contratacao", "papel", "alta",
            "Há registro escrito de assinatura a rogo em documento técnico não excluído. "
            "Os cenários de vício formal permanecem cogitáveis.", rogo)
    elif marks and (restricted or len(marks) >= 2):
        put("contratacao", "eletronica", "alta",
            "A contratação se apresenta como eletrônica (%s) em documento não "
            "excluído, sem registro de assinatura a rogo. O ataque deve recair sobre "
            "os elementos técnicos e a cadeia de custódia, não sobre o art. 595."
            % ", ".join(marks[:4]), electronic_evidence[:3])
    elif not restricted and marks:
        put("contratacao", None, "baixa",
            "Há uma marca isolada de contratação eletrônica (%s) e nenhum registro "
            "de rogo. Insuficiente para decidir a natureza da contratação: confira o "
            "instrumento." % marks[0], electronic_evidence[:2])
    elif defense_marks:
        put("contratacao", "eletronica", "media",
            "A natureza eletrônica aparece somente na alegação da própria ré (%s). "
            "É uma base secundária e precisa ser confirmada no instrumento bancário."
            % ", ".join(defense_marks[:4]), defense_evidence[:3])
    else:
        put("contratacao", None, "baixa",
            "Não foi possível determinar a natureza da contratação em documento "
            "técnico não excluído. Alegações da inicial, réplica ou decisão não foram "
            "tratadas como prova do instrumento.", [])

    primary_trail = (
        ([d for d in docs if d.tipo == "log"] or [d for d in docs if d.tipo == "contrato"])
        if not restricted else
        [d for d in primary if d.tipo in ("log", "contrato")]
    )
    defense_trail = defenses if not primary_trail and defense_marks else []
    target = primary_trail or defense_trail
    present, absent, technical_evidence = [], [], []
    for _key, rx, label in ELEMENTOS_TECNICOS:
        found = procurar(target, rx, limite=1)
        (present if found else absent).append(label)
        if found:
            technical_evidence.extend(found)
    if not target:
        put("elementos_tecnicos", None, "baixa",
            "Não há log ou instrumento não excluído que permita examinar a trilha.", [])
    elif absent:
        confidence = "media" if defense_trail else ("alta" if restricted else "media")
        source_note = " segundo a contestação; confirme no instrumento" if defense_trail else ""
        put("elementos_tecnicos", "incompletos", confidence,
            "A trilha%s não registra %d de %d elementos: %s."
            % (source_note, len(absent), len(ELEMENTOS_TECNICOS), ", ".join(absent)),
            technical_evidence[:2])
    else:
        confidence = "media" if defense_trail or not restricted else "alta"
        source_note = " segundo a contestação" if defense_trail else ""
        put("elementos_tecnicos", "completos", confidence,
            "A trilha%s registra os seis elementos verificados; confira a coerência "
            "de cada dado com a rotina da autora." % source_note,
            technical_evidence[:2])


def ler_autos(caminhos, usar_ocr=True):
    """Lê os arquivos, classifica e diagnostica. Devolve um objeto Leitura."""
    L = Leitura()
    for c in sorted(caminhos):
        d = ler_documento(c, usar_ocr=usar_ocr)
        classificar(d)
        L.documentos.append(d)

    docs = L.documentos
    por = lambda *t: [d for d in docs if d.tipo in t]
    contratos = por("contrato")
    comprovantes = por("comprovante")
    contestacoes = por("contestacao")
    extratos = por("extrato")
    hiscres = por("hiscre")

    def po(campo, valor, conf, nota="", ev=None):
        L.achados[campo] = Achado(campo, valor, conf, nota, ev)

    # ---------------- Bloco 1 · contrato ----------------
    if not contratos:
        po("contrato", "nada", "alta",
           "Nenhum documento juntado tem feição de instrumento contratual.", [])
    else:
        c = contratos[0]
        sem_txt = len(c.paginas_sem_texto)
        if sem_txt and sem_txt == len(c.paginas):
            po("contrato", "imagem", "alta",
               "O contrato não tem camada de texto: as %d página(s) são imagem." % sem_txt,
               [{"arquivo": c.nome, "pagina": 1, "fonte": "vazia",
                 "trecho": "página sem texto extraível"}])
        else:
            po("contrato", "papel", "alta",
               "Instrumento com camada de texto em %d de %d página(s)."
               % (len(c.paginas) - sem_txt, len(c.paginas)),
               [{"arquivo": c.nome, "pagina": 1, "fonte": c.paginas[0].fonte,
                 "trecho": re.sub(r"\s+", " ", c.paginas[0].texto)[:TRECHO]}])

    ev_rogo = procurar(contratos, TERMOS_ROGO, ["contrato"])
    if ev_rogo:
        po("assinatura", "rogo", "alta",
           "O instrumento traz expressão de assinatura a rogo.", ev_rogo)
    elif contratos:
        po("assinatura", None, "baixa",
           "Não foi localizada expressão de rogo. O campo da assinatura precisa ser "
           "conferido a olho, no documento: texto extraído não distingue campo "
           "assinado de campo em branco.", [])
    else:
        po("assinatura", "na", "alta", "Não há contrato nos autos.", [])

    ev_test = procurar(contratos, r"testemunha", ["contrato"], limite=6)
    n_test = n_rotulos = 0
    for d in contratos:
        for p in d.paginas:
            # texto sem acento, minúsculo, mas com as quebras de linha preservadas:
            # o campo em branco só se distingue do preenchido dentro da própria linha
            bruto = sem_acento(p.texto).lower()
            for m in re.finditer(r"testemunha[^\n]{0,120}", bruto):
                n_rotulos += 1
                resto = m.group(0)[len("testemunha"):]
                resto = re.sub(r"^\s*\d?\s*[:\-]?", "", resto)
                nome = re.search(r"[a-zà-ÿ]{3,}\s+[a-zà-ÿ]{2,}", resto)
                insc = re.search(r"\d{3}\.\d{3}\.\d{3}-\d{2}", resto)
                if nome or insc:
                    n_test += 1
    if not contratos:
        po("testemunhas", "na", "alta", "Não há contrato nos autos.", [])
    elif n_rotulos == 0:
        po("testemunhas", "nenhuma", "media",
           "A palavra testemunha não aparece no instrumento.", [])
    else:
        # rótulo sem nome ao lado costuma indicar campo em branco
        po("testemunhas", "duas" if n_test >= 2 else ("uma" if n_test == 1 else "nenhuma"),
           "media",
           "A palavra testemunha aparece %d vez(es) no instrumento e %d campo(s) "
           "parece(m) preenchido(s) com nome ou inscrição. Confira no documento."
           % (n_rotulos, n_test), ev_test)

    # cumulação e repetição de subscritores
    nomes_rogo = set()
    for d in contratos:
        for m in re.finditer(r"a\s+rogo\s+(?:de\s+)?([a-z\s]{6,45})", d.k):
            nomes_rogo.add(m.group(1).strip())
    cumul, ev_cum = "nao", []
    for d in contratos:
        for nome in nomes_rogo:
            for p in d.paginas:
                i = p.k.find("testemunha")
                if i >= 0 and nome[:18] in p.k[i:i + 400]:
                    cumul, ev_cum = "sim", [_ev(p, i, i + 40)]
    po("cumulacao", cumul, "media" if cumul == "sim" else "baixa",
       "Nome que assina a rogo reaparece na área das testemunhas." if cumul == "sim"
       else "Não foi possível cruzar rogatário e testemunha pelo texto. Confira no documento.",
       ev_cum)

    cpfs = Counter()
    ev_cpf = {}
    for d in contratos:
        for p in d.paginas:
            for m in RX_CPF.finditer(p.texto):
                cpfs[m.group(0)] += 1
                ev_cpf.setdefault(m.group(0), _ev(p, m.start(), m.end()))
    repet = [c for c, n in cpfs.items() if n > 1]
    po("repeticao", "sim" if repet else "nao",
       "media" if repet else "baixa",
       ("A mesma inscrição aparece mais de uma vez no instrumento: %s."
        % ", ".join(repet[:3])) if repet else
       "Nenhuma inscrição repetida foi localizada no texto extraído.",
       [ev_cpf[c] for c in repet[:2]])

    tem_doc_terceiro = bool(por("documento_pessoal")) or len(cpfs) > 1
    po("docsubscritores", "sim" if tem_doc_terceiro else ("nao" if contratos else "na"),
       "media" if contratos else "alta",
       ("Foram localizadas %d inscrições distintas e %d documento(s) pessoal(is) juntado(s)."
        % (len(cpfs), len(por("documento_pessoal")))) if contratos else
       "Não há contrato nos autos.",
       list(ev_cpf.values())[:2])

    # a impossibilidade de assinar tem forças diferentes conforme a origem:
    # admissão da ré é a mais forte, prova documental vem depois, e alegação da
    # própria inicial, sozinha, não é prova, como adverte a nota do caderno
    ev_re = procurar(contestacoes, TERMOS_ANALF, ["contestacao"])
    ev_doc = procurar(por("documento_pessoal", "procuracao"), TERMOS_ANALF)
    ev_ini = procurar(por("inicial"), TERMOS_ANALF, ["inicial"])
    if ev_re:
        po("impossibilidade", "provada", "alta",
           "A própria contestação reconhece a impossibilidade de assinar. Admissão da "
           "parte contrária dispensa prova e é o fundamento mais forte do cenário: "
           "ninguém colhe rogo de quem assina.", ev_re)
    elif ev_doc:
        po("impossibilidade", "provada", "media",
           "Documento pessoal ou instrumento de mandato indica identificação por "
           "impressão digital ou impossibilidade de assinar.", ev_doc)
    elif ev_ini:
        po("impossibilidade", "semprova", "media",
           "A inicial afirma a impossibilidade de assinar, mas afirmação não é prova. "
           "Confira se o documento que a demonstra está nos autos; se não estiver, "
           "junte agora, na forma do art. 435 do Código de Processo Civil.", ev_ini)
    else:
        po("impossibilidade", None, "baixa",
           "Nada nos documentos lidos indica analfabetismo ou impossibilidade de "
           "assinar. Sem essa base os cenários A a F não se sustentam: responda com "
           "o que consta dos autos.", [])

    ev_port = procurar(docs, TERMOS_PORT, ["contestacao", "contrato", "hiscre"])
    po("portabilidade", "sim" if ev_port else "nao",
       "alta" if ev_port else "media",
       "A defesa ou o instrumento menciona portabilidade ou refinanciamento."
       if ev_port else "Nenhuma menção a portabilidade ou refinanciamento.", ev_port)

    # ---------------- natureza da contratação ----------------
    avaliar_contratacao(L)

    # ---------------- Bloco 2 · repasse ----------------
    ev_img = procurar(comprovantes or docs, TERMOS_IMAGEM)
    if not comprovantes and not ev_img:
        po("repasse", "nada", "alta",
           "Nenhum documento juntado tem feição de comprovante de repasse.", [])
    elif ev_img:
        po("repasse", "imagem", "alta",
           "O documento se apresenta como reserva de imagem ou tela de sistema.", ev_img)
    else:
        c = comprovantes[0]
        po("repasse", "comprovante", "alta",
           "Há documento apresentado como comprovante de transferência.",
           [{"arquivo": c.nome, "pagina": 1, "fonte": c.paginas[0].fonte,
             "trecho": re.sub(r"\s+", " ", c.paginas[0].texto)[:TRECHO]}])

    # conformidade com os oito itens da Súmula 69
    alvo = comprovantes or []
    if alvo:
        kk = " ".join(d.k for d in alvo)
        for letra, rotulo, rx in ITENS_69:
            m = re.search(rx, kk)
            L.conformidade69.append({
                "item": letra, "rotulo": rotulo,
                "situacao": "presente" if m else "ausente",
                "trecho": (re.sub(r"\s+", " ", kk[max(0, m.start() - 40):m.end() + 60])
                           if m else ""),
            })
    ausentes69 = [x["item"] for x in L.conformidade69 if x["situacao"] == "ausente"]

    ev_conta = procurar(alvo, r"conta\s+destino|conta\s+destinat|favorecido|"
                              r"benefici[áa]rio\s*:|cr[ée]dito\s+em\s+conta", ["comprovante"])
    if not alvo:
        po("conta", "na", "alta", "Não há comprovante a examinar.", [])
    else:
        tem_conta = any(x["item"] == "e" and x["situacao"] == "presente"
                        for x in L.conformidade69)
        po("conta", "sim" if tem_conta else "nao", "media",
           "O comprovante identifica conta e agência." if tem_conta else
           "Não foi localizada identificação da conta destinatária no comprovante.",
           ev_conta)

    if not extratos:
        po("extrato", "ausente", "alta",
           "Nenhum extrato bancário foi localizado entre os documentos lidos.", [])

    # ---------------- valores e cotejo ----------------
    def valores_de(lista):
        out = []
        for d in lista:
            for p in d.paginas:
                for m in RX_VALOR.finditer(p.k):
                    v = moeda(m.group(1))
                    if v:
                        out.append((v, _ev(p, m.start(), m.end())))
        return out

    v_contrato = valores_de(contratos)
    v_comprov = valores_de(comprovantes)
    v_hiscre = valores_de(hiscres)

    ev_liberado = procurar(contratos, r"valor\s+liberado|valor\s+l[íi]quido|"
                                      r"cr[ée]dito\s+ao\s+cliente", ["contrato"])
    liberado = None
    for d in contratos:
        for p in d.paginas:
            m = re.search(r"(?:valor\s+liberado|valor\s+l[íi]quido)[^\d]{0,40}"
                          r"r?\$?\s*([\d]{1,3}(?:\.\d{3})*,\d{2})", p.k)
            if m:
                liberado = moeda(m.group(1))
                ev_liberado = [_ev(p, m.start(), m.end())]
                break
        if liberado:
            break

    transferido = v_comprov[0][0] if v_comprov else None
    if liberado and transferido:
        difere = abs(liberado - transferido) > 0.01
        po("valores", "nao" if difere else "sim", "media",
           ("Valor liberado no contrato %s e valor do comprovante %s."
            % (fmt_moeda(liberado), fmt_moeda(transferido))),
           ev_liberado + [v_comprov[0][1]])
    else:
        po("valores", "na", "baixa",
           "Não foi possível cotejar valores: falta o valor liberado no contrato "
           "ou o valor do comprovante.", ev_liberado)

    # ---------------- dados do processo ----------------
    fonte_dados = contestacoes or docs
    dd = {}
    for d in fonte_dados:
        for p in d.paginas:
            m = RX_CNJ.search(p.texto)
            if m and "processo" not in dd:
                dd["processo"] = m.group(0)
            m = re.search(r"(\d{1,2})[ªa]?\s*vara\s+c[íi]vel", p.k)
            if m and "vara" not in dd:
                dd["vara"] = m.group(1) + "ª"
            m = re.search(r"comarca\s+de\s+([a-zà-ÿ\s]{3,40})", p.k)
            if m and "comarca" not in dd:
                dd["comarca"] = titulo_br(m.group(1).strip())
    for d in contratos + hiscres:
        for p in d.paginas:
            m = RX_BENEF.search(p.k)
            if m and "beneficio" not in dd:
                dd["beneficio"] = m.group(1)
            m = RX_CONTRATO_N.search(p.k)
            if m and "contrato_n" not in dd:
                dd["contrato_n"] = m.group(1).strip(".")
            m = re.search(r"(\d{1,3})\s*(?:x|parcelas|presta[çc][õo]es)", p.k)
            if m and "parcelas" not in dd:
                dd["parcelas"] = m.group(1)
    if liberado:
        dd["valor_liberado"] = fmt_moeda(liberado)
    if transferido:
        dd["valor_transferido"] = fmt_moeda(transferido)
    if v_hiscre:
        dd["valor_parcela"] = fmt_moeda(min(v[0] for v in v_hiscre))
    for d in comprovantes:
        for p in d.paginas:
            m = RX_DATA.search(p.texto)
            if m:
                dd["data_transferencia"] = m.group(1)
                break
        if "data_transferencia" in dd:
            break
    # primeira competência e quantas o histórico registra
    datas_his = []
    for d in hiscres:
        for p in d.paginas:
            for x in RX_DATA.findall(p.texto):
                v = x.split("/")
                datas_his.append((v[2], v[1], v[0]))
            for m in re.finditer(r"compet[êe]ncia\s*:?\s*(\d{2})/(\d{4})", p.k):
                datas_his.append((m.group(2), m.group(1), "01"))
    if datas_his:
        a, me, di = min(datas_his)
        dd["data_primeiro_desconto"] = "%s/%s/%s" % (di, me, a)
        dd["competencias"] = str(len({(x[0], x[1]) for x in datas_his}))
    # partes: quem propôs e contra quem
    for d in iniciais_ if (iniciais_ := por("inicial")) else []:
        m = re.search(r"^\s*([A-ZÀ-Ý][A-ZÀ-Ý\s]{8,55}?),\s*(?:brasileir|"
                      r"portador|inscrit|aposentad|pension)", d.texto, re.M)
        if m and "autor" not in dd:
            dd["autor"] = " ".join(m.group(1).split())
        m = re.search(r"em\s+face\s+de\s+([A-ZÀ-Ý][A-ZÀ-Ý\s.&/-]{4,60}?"
                      r"(?:S\.?\s?A\.?|LTDA\.?|S\.?/?A\.?))(?=[\s,.;]|$)", d.texto)
        if m and "re" not in dd:
            dd["re"] = " ".join(m.group(1).split()).rstrip(",")
    for d in contestacoes:
        if "autor" not in dd:
            m = re.search(r"(?:a[çc][ãa]o\s+)?proposta\s+por\s+"
                          r"([A-ZÀ-Ý][A-ZÀ-Ý\s]{8,55})", d.texto)
            if m:
                dd["autor"] = " ".join(m.group(1).split()).rstrip(",.")
        if "re" not in dd:
            m = re.search(r"^\s*([A-ZÀ-Ý][A-ZÀ-Ý\s.&/-]{6,60}?(?:S\.?A\.?|LTDA))",
                          d.texto, re.M)
            if m:
                dd["re"] = " ".join(m.group(1).split()).rstrip(",")

    L.dados = dd

    # folhas: qual arquivo sustenta cada referência de documento
    L.dados["fls_contrato"] = contratos[0].nome if contratos else ""
    L.dados["fls_comprovante"] = comprovantes[0].nome if comprovantes else ""

    # ---------------- preliminares efetivamente arguidas ----------------
    for cod, rx in PRELIMINARES_RX:
        ev = procurar(contestacoes, rx, ["contestacao"], limite=1)
        if ev:
            L.preliminares.append({"cod": cod, "evidencia": ev[0]})

    # ---------------- avisos ----------------
    if not contestacoes:
        L.avisos.append("Nenhum documento foi reconhecido como contestação. "
                        "As preliminares e os dados do processo não puderam ser lidos.")
    ocr = sum(1 for d in docs for p in d.paginas if p.fonte == "ocr")
    if ocr:
        L.avisos.append("%d página(s) foram lidas por reconhecimento óptico. "
                        "Texto de OCR erra número e acento: confira os valores e as "
                        "datas antes de usar." % ocr)
    vazias = sum(1 for d in docs for p in d.paginas if p.fonte == "vazia")
    if vazias:
        L.avisos.append("%d página(s) não renderam texto algum, nem por OCR." % vazias)
    if ausentes69 and alvo:
        L.avisos.append("O comprovante não reúne %d dos oito itens da Súmula 69: %s."
                        % (len(ausentes69), ", ".join(ausentes69)))
    baixas = [k for k, a in L.achados.items() if a.confianca == "baixa"]
    if baixas:
        L.avisos.append("%d resposta(s) ficaram com confiança baixa e precisam da sua "
                        "conferência: %s." % (len(baixas), ", ".join(baixas)))
    return L


def coletar(pasta, limite=200):
    """Lista os arquivos legíveis de uma pasta, sem entrar em pastas ocultas."""
    out = []
    for raiz, dirs, arqs in os.walk(pasta):
        dirs[:] = [x for x in dirs if not x.startswith(".")]
        for a in sorted(arqs):
            if a.startswith("."):
                continue
            if os.path.splitext(a)[1].lower() in EXT_PDF + EXT_IMG + EXT_TXT:
                out.append(os.path.join(raiz, a))
                if len(out) >= limite:
                    return out
    return out
