#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Bateria forense · Motor de Réplicas

O que o olho não vê ao ler o PDF: metadados, cronologia interna do arquivo,
assinatura criptográfica, camadas de imagem, marcas de ambiente de teste,
recálculo de taxa, cruzamento de IP e de inscrição entre documentos.

Cada achado carrega o dado bruto que o sustenta e uma gravidade. Nada aqui
afirma fraude: aponta o que está ausente, o que está incoerente e o que precisa
ser exigido da instituição. A conclusão jurídica é do advogado.

Nenhum modelo de linguagem participa. São leitura de bytes, expressões
regulares e aritmética, conferíveis linha a linha.
"""

import os
import re
import json
import subprocess
import unicodedata
from datetime import datetime, date

GRAVIDADE = {"critico": 3, "alto": 2, "medio": 1, "nota": 0}

CHECAGENS_POR_CAPACIDADE = {
    "cryptographicSignatureAssessable": ["SIG-01", "SIG-02", "SIG-03"],
    "nativeMetadataAssessable": [
        "META-01", "META-02", "META-03", "META-04",
        "IMG-01", "IMG-02", "FNT-01", "HSH-01",
    ],
}

TITULOS_CHECAGENS = {
    "SIG-01": "Ausência de assinatura criptográfica incorporada",
    "SIG-02": "Presença de assinatura digital no arquivo",
    "SIG-03": "Menção textual a certificação ICP-Brasil",
    "META-01": "Data de criação do PDF",
    "META-02": "Data de modificação do PDF",
    "META-03": "Programa produtor do PDF",
    "META-04": "Atualizações incrementais do PDF",
    "IMG-01": "Camada de texto do arquivo nativo",
    "IMG-02": "Estrutura interna das imagens",
    "FNT-01": "Fontes tipográficas incorporadas",
    "HSH-01": "Conferência do hash declarado contra o arquivo nativo",
}

MOTIVO_DERIVADO = (
    "O arquivo examinado é derivado de extração de texto ou de fatiamento do "
    "caderno do PJe. Metadados internos, data de criação e ausência de assinatura "
    "criptográfica pertencem ao arquivo derivado e não permitem conclusão sobre "
    "o documento bancário nativo."
)


def sem_acento(s):
    return "".join(c for c in unicodedata.normalize("NFKD", s)
                   if not unicodedata.combining(c))


def chave(s):
    return re.sub(r"\s+", " ", sem_acento(s).lower())


def existe(prog):
    from shutil import which
    return which(prog) is not None


class Sinal(object):
    def __init__(self, codigo, titulo, gravidade, detalhe, dado="", arquivo="",
                 pedido=""):
        self.codigo = codigo
        self.titulo = titulo
        self.gravidade = gravidade
        self.detalhe = detalhe
        self.dado = dado
        self.arquivo = arquivo
        self.pedido = pedido            # o que exigir da ré, quando couber

    def js(self):
        return self.__dict__.copy()


# --------------------------------------------------------------------------
# leitura de metadados
# --------------------------------------------------------------------------

def pdfinfo(caminho):
    if not existe("pdfinfo"):
        return {}
    try:
        r = subprocess.run(["pdfinfo", "-isodates", caminho],
                           capture_output=True, timeout=60)
        out = {}
        for linha in r.stdout.decode("utf-8", "replace").splitlines():
            if ":" in linha:
                k, v = linha.split(":", 1)
                out[k.strip()] = v.strip()
        return out
    except (subprocess.SubprocessError, OSError):
        return {}


def pdffonts(caminho):
    if not existe("pdffonts"):
        return []
    try:
        r = subprocess.run(["pdffonts", caminho], capture_output=True, timeout=60)
        linhas = r.stdout.decode("utf-8", "replace").splitlines()[2:]
        return [l.split()[0] for l in linhas if l.strip()]
    except (subprocess.SubprocessError, OSError):
        return []


def pdfimages_lista(caminho):
    if not existe("pdfimages"):
        return []
    try:
        r = subprocess.run(["pdfimages", "-list", caminho],
                           capture_output=True, timeout=120)
        linhas = r.stdout.decode("utf-8", "replace").splitlines()[2:]
        out = []
        for l in linhas:
            c = l.split()
            if len(c) >= 5 and c[0].isdigit():
                out.append({"pagina": int(c[0]), "tipo": c[2],
                            "largura": c[3], "altura": c[4]})
        return out
    except (subprocess.SubprocessError, OSError):
        return []


def data_iso(s):
    if not s:
        return None
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    m = re.match(r"D:(\d{4})(\d{2})(\d{2})", s or "")
    if m:
        return date(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def data_br(s):
    m = re.match(r"(\d{2})/(\d{2})/(\d{4})", s or "")
    if m:
        try:
            return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
        except ValueError:
            return None
    return None


# --------------------------------------------------------------------------
# taxa efetiva: recálculo por tentativa e erro
# --------------------------------------------------------------------------

def taxa_mensal(liberado, parcela, n):
    """Taxa que iguala o valor liberado ao valor presente das parcelas.

    Bisseção entre 0 e 100% ao mês. Devolve None quando não há solução no
    intervalo, que é o caso quando os números informados não fecham.
    """
    if not (liberado and parcela and n) or liberado <= 0 or parcela <= 0 or n <= 0:
        return None
    total = parcela * n
    if total < liberado:
        return None          # as parcelas não devolvem nem o principal
    if abs(total - liberado) < 0.01:
        return 0.0           # empréstimo sem juros

    def vp(i):
        if i == 0:
            return parcela * n
        return parcela * (1 - (1 + i) ** (-n)) / i

    lo, hi = 0.0, 1.0
    if vp(hi) > liberado:
        return None
    for _ in range(200):
        meio = (lo + hi) / 2
        if vp(meio) > liberado:
            lo = meio
        else:
            hi = meio
    return (lo + hi) / 2


# --------------------------------------------------------------------------
# bateria
# --------------------------------------------------------------------------

RX_AUTENT = re.compile(r"autentica[çc][ãa]o[^\n:]{0,20}[:\s]+([A-Z0-9]{6,40})", re.I)
RX_IP = re.compile(r"\b(?:\d{1,3}\.){3}\d{1,3}\b")
RX_HASH = re.compile(r"\b[a-f0-9]{32,64}\b", re.I)
RX_CPF = re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b")
RX_VALOR = re.compile(r"r\$\s*([\d]{1,3}(?:\.\d{3})*,\d{2})")
RX_MODELO = re.compile(r"(?:mod\.?|modelo)\s*([\w./-]{3,20}).{0,30}?"
                       r"vers[ãa]o\s*(\d{2}/\d{4}|\d{4})", re.I)
RX_VERSAO = re.compile(r"vers[ãa]o\s*(\d{2}/(\d{4}))", re.I)

TERMOS_TESTE = [
    ("homolog", "ambiente de homologação"),
    (" homol", "ambiente de homologação"),
    ("teste ti", "ambiente de teste"),
    ("dds teste", "ambiente de teste"),
    ("nome do beneficiario", "campo de gabarito não substituído"),
    ("nome do cliente teste", "campo de gabarito não substituído"),
    ("lorem ipsum", "texto de gabarito"),
    ("xxxxx", "campo de gabarito não substituído"),
    ("ambiente de teste", "ambiente de teste"),
    ("sandbox", "ambiente de teste"),
]

TERMOS_ANUNCIADO = [
    (r"conforme\s+doc(?:umento)?s?\s*\.?\s*(?:n[ºo°]?\s*)?\d+", "documento numerado"),
    (r"em\s+anexo", "documento anunciado como anexo"),
    (r"documento\s+anexo", "documento anunciado como anexo"),
    (r"parecer\s+t[ée]cnico", "parecer técnico"),
    (r"raz[õo]es\s+adicionais", "razões adicionais à defesa"),
    (r"laudo\s+(?:t[ée]cnico|pericial)", "laudo"),
    (r"log\s+completo", "log completo"),
    (r"extrato\s+banc[áa]rio", "extrato bancário"),
]

TERMOS_ICP = r"icp-?brasil|assinado\s+digitalmente|certificado\s+digital"


def moeda(s):
    try:
        return float(s.replace(".", "").replace(",", "."))
    except (ValueError, AttributeError):
        return None


def fmt(v):
    if v is None:
        return ""
    inteiro, dec = ("%.2f" % v).split(".")
    partes = []
    while len(inteiro) > 3:
        partes.insert(0, inteiro[-3:])
        inteiro = inteiro[:-3]
    partes.insert(0, inteiro)
    return "R$ " + ".".join(partes) + "," + dec


def pct(v):
    return ("%.2f" % v).replace(".", ",") + "%"


def _proveniencia_documento(documento, proveniencias=None):
    if not proveniencias:
        return {}
    return (
        proveniencias.get(os.path.abspath(documento.caminho))
        or proveniencias.get(os.path.realpath(documento.caminho))
        or proveniencias.get(documento.caminho)
        or proveniencias.get(documento.nome)
        or {}
    )


def checagens_suprimidas(leitura, proveniencias=None):
    """Lista, sem silêncio, as verificações não cabíveis para cada arquivo."""
    grouped = {}
    for documento in leitura.documentos:
        provenance = _proveniencia_documento(documento, proveniencias)
        for capability, codes in CHECAGENS_POR_CAPACIDADE.items():
            if provenance.get(capability, True) is not False:
                continue
            for code in codes:
                grouped.setdefault(code, []).append(documento.nome)
    return [{
        "codigo": code,
        "titulo": TITULOS_CHECAGENS.get(code, code),
        "motivo": MOTIVO_DERIVADO,
        "arquivos": sorted(set(files)),
    } for code, files in sorted(grouped.items())]


def periciar(leitura, hoje=None, proveniencias=None):
    """Roda a bateria sobre uma Leitura já feita pelo leitor. Devolve sinais."""
    hoje = hoje or date.today()
    S = []
    produtores = []
    docs = leitura.documentos
    por = lambda *t: [d for d in docs if d.tipo in t]
    contratos, comprovantes = por("contrato"), por("comprovante")
    logs, hiscres = por("log"), por("hiscre")

    # ---- 1 · metadados e cronologia interna do arquivo -------------------
    for d in docs:
        info = pdfinfo(d.caminho)
        d.meta = info
        criado = data_iso(info.get("CreationDate"))
        alterado = data_iso(info.get("ModDate"))
        produtor = info.get("Producer", "") or info.get("Creator", "")

        # data declarada no corpo do documento
        datas = [data_br(x) for x in re.findall(r"\b\d{2}/\d{2}/\d{4}\b", d.texto)]
        datas = [x for x in datas if x and x.year >= 1990 and x <= hoje]
        declarada = min(datas) if datas else None

        if criado and declarada and d.tipo in ("contrato", "comprovante", "log"):
            dias = (criado - declarada).days
            if dias > 365:
                S.append(Sinal(
                    "META-01", "PDF gerado muito depois da data do documento", "alto",
                    "O arquivo foi criado em %s, %d dias depois da data mais antiga "
                    "que consta do próprio documento (%s). O instrumento juntado não é "
                    "o documento da época: é uma reimpressão posterior, produzida "
                    "unilateralmente pela ré, já no curso da controvérsia."
                    % (criado.strftime("%d/%m/%Y"), dias, declarada.strftime("%d/%m/%Y")),
                    "CreationDate=%s | data no corpo=%s"
                    % (info.get("CreationDate", ""), declarada.strftime("%d/%m/%Y")),
                    d.nome,
                    "Exibição do arquivo original da contratação, com a data de "
                    "geração de origem, na forma dos arts. 396 e 400 do CPC."))
        if criado and alterado and alterado > criado:
            S.append(Sinal(
                "META-02", "Arquivo alterado depois de criado", "medio",
                "O PDF registra data de modificação posterior à de criação. "
                "Sozinho não prova adulteração, mas afasta a ideia de documento "
                "extraído direto do sistema e juntado sem manuseio.",
                "CreationDate=%s | ModDate=%s"
                % (info.get("CreationDate", ""), info.get("ModDate", "")), d.nome))
        if produtor:
            produtores.append((d.nome, produtor))

        # atualizações incrementais: cada %%EOF é uma gravação
        try:
            with open(d.caminho, "rb") as f:
                bruto = f.read()
        except OSError:
            bruto = b""
        eofs = bruto.count(b"%%EOF")
        if eofs > 1:
            S.append(Sinal(
                "META-04", "Arquivo gravado mais de uma vez", "medio",
                "O PDF traz %d marcas de fim de arquivo, o que indica %d gravação(ões) "
                "sucessiva(s) sobre o mesmo documento. Em documento que se afirma "
                "extraído do sistema, o esperado é uma só." % (eofs, eofs),
                "%%%%EOF encontrado %d vezes" % eofs, d.nome))

        # assinatura criptográfica embarcada
        tem_sig = (b"/Sig" in bruto or b"/ByteRange" in bruto
                   or b"Adobe.PPKLite" in bruto)
        if d.tipo in ("contrato", "comprovante"):
            if not tem_sig:
                S.append(Sinal(
                    "SIG-01", "Sem assinatura criptográfica incorporada", "alto",
                    "O arquivo não contém dicionário de assinatura digital. Não há "
                    "o que verificar: nenhuma âncora criptográfica liga este PDF a "
                    "quem o teria assinado, nem permite detectar alteração posterior.",
                    "ausentes /Sig, /ByteRange e Adobe.PPKLite", d.nome,
                    "Exibição dos arquivos nativos com a trilha de assinatura e o "
                    "respectivo certificado."))
            else:
                S.append(Sinal(
                    "SIG-02", "Assinatura digital presente no arquivo", "nota",
                    "Há dicionário de assinatura no PDF. Confira a cadeia do "
                    "certificado e a integridade do ByteRange antes de impugnar a forma.",
                    "encontrado /ByteRange ou /Sig", d.nome))

        if d.tipo == "contrato" and not re.search(TERMOS_ICP, d.k):
            S.append(Sinal(
                "SIG-03", "Nenhuma menção a certificação ICP-Brasil", "medio",
                "O instrumento não menciona certificação no padrão ICP-Brasil. Isso "
                "não invalida por si só, à luz do REsp 2.197.156/SP, mas desloca a "
                "discussão para a cadeia de custódia: sem ICP, a validade depende de "
                "trilha íntegra, e é ela que precisa ser exibida.",
                "sem ocorrência de ICP-Brasil no texto", d.nome))

    # ---- 2 · marcas de ambiente de teste --------------------------------
    for d in docs:
        for termo, rotulo in TERMOS_TESTE:
            i = d.k.find(termo)
            if i >= 0:
                S.append(Sinal(
                    "AMB-01", "Marca de ambiente de teste ou de gabarito", "critico",
                    "O documento traz expressão típica de %s. Tela de homologação não "
                    "registra contratação real: registra simulação. Se a ré junta esse "
                    "material como prova da jornada, ela não está provando o contrato "
                    "dos autos." % rotulo,
                    re.sub(r"\s+", " ", d.texto[max(0, i - 60):i + 90]).strip(),
                    d.nome,
                    "Exibição dos registros do ambiente de produção, com data, hora e "
                    "identificador da sessão real."))
                break

    # ---- 3 · rodapé de modelo com versão posterior ao contrato ----------
    for d in contratos:
        datas = [data_br(x) for x in re.findall(r"\b\d{2}/\d{2}/\d{4}\b", d.texto)]
        datas = [x for x in datas if x and x <= hoje]
        base = min(datas) if datas else None
        for m in RX_VERSAO.finditer(d.texto):
            ano = int(m.group(2))
            if base and ano > base.year:
                S.append(Sinal(
                    "MOD-01", "Formulário posterior à data do contrato", "critico",
                    "O rodapé indica versão de formulário de %s, em instrumento datado "
                    "de %s. Um contrato não pode ter sido celebrado em impresso que "
                    "ainda não existia: o documento juntado foi montado depois."
                    % (m.group(1), base.strftime("%d/%m/%Y")),
                    re.sub(r"\s+", " ", d.texto[max(0, m.start() - 80):m.end() + 40]).strip(),
                    d.nome,
                    "Exibição do instrumento na versão vigente à data da contratação."))
                break

    # ---- 4 · autenticação declarada e não conferível --------------------
    for d in comprovantes:
        m = RX_AUTENT.search(d.texto)
        if m:
            S.append(Sinal(
                "AUT-01", "Código de autenticação declarado, sem meio de conferência",
                "alto",
                "O comprovante exibe um código de autenticação, mas o documento não "
                "indica onde conferi-lo. Código impresso pelo próprio emitente, sem "
                "canal de verificação, é afirmação, não é prova.",
                m.group(0)[:80], d.nome,
                "Exibição do registro da operação no sistema de liquidação, com o "
                "identificador que permita conferência independente."))
        else:
            S.append(Sinal(
                "AUT-02", "Comprovante sem código de autenticação", "alto",
                "Não há no documento código de autenticação bancária. É o primeiro "
                "dos oito itens da Súmula 69 do TJPI, e a lista é cumulativa.",
                "nenhuma ocorrência de código de autenticação", d.nome,
                "Exibição de comprovante que reúna os oito itens do enunciado."))

    # ---- 5 · recálculo da taxa ------------------------------------------
    liberado = parcela = None
    n_parcelas = None
    for d in contratos:
        m = re.search(r"(?:valor\s+liberado|valor\s+l[íi]quido|cr[ée]dito\s+ao\s+cliente)"
                      r"[^\d]{0,40}r?\$?\s*([\d]{1,3}(?:\.\d{3})*,\d{2})", d.k)
        if m:
            liberado = moeda(m.group(1))
        m = re.search(r"(?:valor\s+da\s+parcela|presta[çc][ãa]o|parcela\s+mensal)"
                      r"[^\d]{0,40}r?\$?\s*([\d]{1,3}(?:\.\d{3})*,\d{2})", d.k)
        if m:
            parcela = moeda(m.group(1))
        m = re.search(r"(\d{1,3})\s*(?:x|parcelas|presta[çc][õo]es)", d.k)
        if m:
            n_parcelas = int(m.group(1))
        m = re.search(r"(?:taxa\s+de\s+juros|juros)[^\d]{0,40}(\d{1,2},\d{1,4})\s*%", d.k)
        taxa_declarada = moeda(m.group(1)) if m else None

        i = taxa_mensal(liberado, parcela, n_parcelas)
        if i is not None:
            am = i * 100
            aa = ((1 + i) ** 12 - 1) * 100
            det = ("Do valor liberado %s, %d parcelas de %s, resulta taxa efetiva de "
                   "%s ao mês e %s ao ano."
                   % (fmt(liberado), n_parcelas, fmt(parcela), pct(am), pct(aa)))
            grav = "nota"
            if taxa_declarada is not None and abs(am - taxa_declarada) > 0.05:
                det += (" O instrumento declara %s ao mês: divergência de %s "
                        "entre o declarado e o que os próprios números do contrato "
                        "produzem." % (pct(taxa_declarada),
                                       pct(abs(am - taxa_declarada))))
                grav = "alto"
            S.append(Sinal(
                "TAX-01", "Taxa efetiva recalculada", grav, det,
                "liberado=%s parcela=%s n=%s declarada=%s"
                % (fmt(liberado), fmt(parcela), n_parcelas,
                   pct(taxa_declarada) if taxa_declarada else "não localizada"),
                d.nome))
        elif liberado and parcela and n_parcelas:
            S.append(Sinal(
                "TAX-02", "Os números do contrato não fecham", "alto",
                "Não há taxa positiva que iguale o valor liberado %s ao valor presente "
                "de %d parcelas de %s. Ou o valor liberado informado está errado, ou a "
                "soma das parcelas não corresponde à operação descrita."
                % (fmt(liberado), n_parcelas, fmt(parcela)),
                "liberado=%s parcela=%s n=%d" % (fmt(liberado), fmt(parcela), n_parcelas),
                d.nome))

        # CET sem demonstrativo
        if "cet" in d.k or "custo efetivo total" in d.k:
            tem_demo = re.search(r"demonstrativ|composi[çc][ãa]o\s+do\s+cet|"
                                 r"mem[óo]ria\s+de\s+c[áa]lculo", d.k)
            if not tem_demo:
                S.append(Sinal(
                    "CET-01", "CET indicado sem demonstrativo de cálculo", "alto",
                    "O instrumento menciona o Custo Efetivo Total sem trazer o "
                    "demonstrativo de cálculo. O art. 7º da Resolução CMN nº 4.881/2020 "
                    "exige a informação com destaque e o respectivo demonstrativo.",
                    "ocorrência de CET sem demonstrativo no mesmo documento", d.nome,
                    "Exibição do demonstrativo de cálculo do CET, na forma do art. 7º "
                    "e parágrafos da Resolução CMN nº 4.881/2020."))

    # ---- 6 · trilha eletrônica: IP, geolocalização, biometria -----------
    if logs or any(d.tipo == "contrato" for d in docs):
        alvo = logs or contratos
        for rotulo, rx, cod in [
            ("endereço IP", RX_IP, "TRI-01"),
            ("geolocalização", re.compile(r"geolocaliza|latitude|longitude|coordenada"), "TRI-02"),
            ("biometria ou selfie", re.compile(r"biometri|selfie|reconhecimento\s+facial|liveness"), "TRI-03"),
            ("identificação do dispositivo", re.compile(r"device|dispositivo|imei|user\s*agent|so\s+do\s+aparelho"), "TRI-04"),
            ("carimbo de hora", re.compile(r"\b\d{1,2}[:h]\d{2}(?::\d{2})?\b"), "TRI-05"),
        ]:
            achou = None
            for d in alvo:
                m = rx.search(d.texto if cod == "TRI-01" else d.k)
                if m:
                    achou = (d, m)
                    break
            if achou:
                d, m = achou
                S.append(Sinal(
                    cod, "Trilha registra %s" % rotulo, "nota",
                    "Elemento presente na trilha. Confira se o dado é coerente com a "
                    "rotina da autora e com a data da operação.",
                    re.sub(r"\s+", " ", d.texto[max(0, m.start() - 40):m.end() + 40]).strip(),
                    d.nome))
            else:
                S.append(Sinal(
                    cod, "Trilha não registra %s" % rotulo, "alto",
                    "A jornada apresentada não traz %s. Sem esse elemento não há como "
                    "atribuir a operação a uma pessoa, a um aparelho e a um momento: "
                    "o registro descreve o que o sistema fez, não quem o acionou." % rotulo,
                    "nenhuma ocorrência nos documentos de trilha",
                    alvo[0].nome if alvo else "",
                    "Exibição dos logs completos de acesso e aceite, com IP, "
                    "geolocalização, identificador do dispositivo e biometria."))

    # ---- 7 · cruzamento de IP entre autores distintos -------------------
    ips = {}
    for d in docs:
        for m in RX_IP.finditer(d.texto):
            ip = m.group(0)
            if ip.startswith(("0.", "255.")):
                continue
            ips.setdefault(ip, set()).add(d.nome)
    repetidos = {k: v for k, v in ips.items() if len(v) > 1}
    if repetidos:
        S.append(Sinal(
            "IP-01", "Mesmo IP em documentos distintos", "alto",
            "O mesmo endereço aparece em mais de um documento juntado. Se os "
            "documentos são de contratações diferentes, a coincidência aponta "
            "contratação feita de um mesmo ponto, e não pelo consumidor em sua casa.",
            "; ".join("%s em %s" % (k, ", ".join(sorted(v)))
                      for k, v in list(repetidos.items())[:3]), ""))

    # ---- 8 · hash declarado no log contra o arquivo juntado -------------
    for d in logs:
        for m in RX_HASH.finditer(d.texto):
            declarado = m.group(0).lower()
            bate = any(declarado == x.sha256.lower() for x in docs)
            S.append(Sinal(
                "HSH-01",
                "Hash declarado no log %s o arquivo juntado"
                % ("confere com" if bate else "não confere com"),
                "nota" if bate else "critico",
                "O log declara um resumo criptográfico. %s"
                % ("Ele corresponde a um dos arquivos dos autos, o que preserva a "
                   "cadeia nesse ponto." if bate else
                   "Nenhum arquivo juntado produz esse resumo. O documento exibido "
                   "não é o documento que o log registra."),
                declarado, d.nome,
                "" if bate else "Exibição do arquivo cujo resumo corresponda ao "
                                "registrado em log."))
            break

    # ---- 9 · documentos anunciados e não juntados ----------------------
    tipos_presentes = set(d.tipo for d in docs)
    for rx, rotulo in TERMOS_ANUNCIADO:
        for d in por("contestacao"):
            m = re.search(rx, d.k)
            if not m:
                continue
            faltou = False
            if "extrato" in rotulo and "extrato" not in tipos_presentes:
                faltou = True
            if "log" in rotulo and "log" not in tipos_presentes:
                faltou = True
            if ("parecer" in rotulo or "laudo" in rotulo) and len(docs) < 3:
                faltou = True
            if faltou:
                S.append(Sinal(
                    "ANX-01", "Documento anunciado na defesa e não juntado", "alto",
                    "A contestação se refere a %s que não está entre os arquivos "
                    "juntados. Prova anunciada e não produzida não socorre quem tem "
                    "o ônus." % rotulo,
                    re.sub(r"\s+", " ", d.texto[max(0, m.start() - 70):m.end() + 90]).strip(),
                    d.nome,
                    "Intimação da ré para juntar o documento a que se referiu, sob as "
                    "consequências do art. 400 do CPC."))
            break

    # ---- 10 · páginas de imagem e montagem do arquivo -------------------
    for d in docs:
        imgs = pdfimages_lista(d.caminho)
        so_imagem = [p for p in d.paginas if p.fonte in ("ocr", "vazia")]
        if d.tipo in ("contrato", "comprovante") and so_imagem:
            S.append(Sinal(
                "IMG-01", "Documento sem camada de texto", "alto",
                "%d de %d página(s) não têm texto: são imagem. Imagem não guarda "
                "estrutura, não guarda campo e não guarda assinatura verificável. "
                "É reprodução, e reprodução impugnada não vale como original."
                % (len(so_imagem), len(d.paginas)),
                "páginas: %s" % ", ".join(str(p.n) for p in so_imagem[:12]), d.nome,
                "Exibição do arquivo nativo, em formato que preserve a estrutura "
                "do documento."))
        larguras = set(x["largura"] for x in imgs)
        if len(larguras) > 3 and len(imgs) > 3:
            S.append(Sinal(
                "IMG-02", "Imagens de origens diferentes no mesmo arquivo", "medio",
                "As imagens do PDF têm %d resoluções distintas. Documento extraído de "
                "uma única fonte tende a ter imagens uniformes; a variação indica "
                "arquivo montado a partir de peças de origens diversas."
                % len(larguras),
                "larguras: %s" % ", ".join(sorted(larguras)[:8]), d.nome))

        fontes = pdffonts(d.caminho)
        if len(set(fontes)) > 8:
            S.append(Sinal(
                "FNT-01", "Muitas fontes tipográficas no documento", "medio",
                "O arquivo embute %d fontes distintas. Em formulário padronizado de "
                "banco isso é incomum e costuma indicar sobreposição de conteúdo de "
                "origens diferentes." % len(set(fontes)),
                ", ".join(sorted(set(fontes))[:10]), d.nome))

    # ---- 11 · cronologia entre contrato, repasse e desconto ------------
    def primeira_data(lista):
        ds = []
        for d in lista:
            for x in re.findall(r"\b\d{2}/\d{2}/\d{4}\b", d.texto):
                v = data_br(x)
                if v and v <= hoje:
                    ds.append(v)
        return min(ds) if ds else None

    d_contrato = primeira_data(contratos)
    d_repasse = primeira_data(comprovantes)
    d_desconto = primeira_data(hiscres)
    if d_contrato and d_repasse and d_repasse < d_contrato:
        S.append(Sinal(
            "CRO-01", "Repasse anterior ao contrato", "critico",
            "O comprovante é de %s e o instrumento é de %s. O dinheiro teria saído "
            "antes de existir contrato que o justificasse."
            % (d_repasse.strftime("%d/%m/%Y"), d_contrato.strftime("%d/%m/%Y")),
            "repasse=%s contrato=%s" % (d_repasse, d_contrato), ""))
    if d_contrato and d_desconto and d_desconto < d_contrato:
        S.append(Sinal(
            "CRO-02", "Desconto iniciado antes do contrato", "critico",
            "O histórico registra desconto desde %s, anterior à data do instrumento, "
            "%s. Desconto que antecede a contratação não tem causa."
            % (d_desconto.strftime("%d/%m/%Y"), d_contrato.strftime("%d/%m/%Y")),
            "desconto=%s contrato=%s" % (d_desconto, d_contrato), ""))

    # ---- 12 · prescrição e alcance da repetição ------------------------
    if d_desconto:
        anos = (hoje - d_desconto).days / 365.25
        if anos > 5:
            S.append(Sinal(
                "PRE-01", "Descontos anteriores ao quinquênio", "medio",
                "O primeiro desconto localizado é de %s, há cerca de %.1f anos. A "
                "declaração de inexistência não prescreve, mas a repetição alcança "
                "os cinco anos anteriores: module o pedido para não expor a peça."
                % (d_desconto.strftime("%d/%m/%Y"), anos),
                "primeiro desconto=%s" % d_desconto.strftime("%d/%m/%Y"), ""))

    # ---- 13 · inscrições divergentes -----------------------------------
    cpfs = {}
    for d in docs:
        for m in RX_CPF.finditer(d.texto):
            cpfs.setdefault(m.group(0), set()).add(d.nome)
    if len(cpfs) > 2:
        S.append(Sinal(
            "CPF-01", "Mais de duas inscrições distintas nos documentos", "medio",
            "Foram localizadas %d inscrições de pessoa física diferentes entre os "
            "arquivos. Confira quem são: rogatário, testemunha, correspondente e "
            "terceiro estranho à relação aparecem aqui." % len(cpfs),
            "; ".join("%s em %s" % (k, ", ".join(sorted(v)))
                      for k, v in list(cpfs.items())[:4]), ""))

    # ---- 14 · número do contrato: instrumento contra histórico do INSS ----
    def numeros_contrato(lista):
        out = set()
        for d in lista:
            for m in re.finditer(r"contrato\s*(?:n[\u00ba\u00b0o.]*\s*)?([\d]{5,20})", d.k):
                out.add(re.sub(r"\D", "", m.group(1)))
        return {x for x in out if len(x) >= 5}

    n_inst = numeros_contrato(contratos)
    n_his = numeros_contrato(hiscres)
    if n_inst and n_his and not (n_inst & n_his):
        S.append(Sinal(
            "NUM-01", "Número do contrato não bate com o histórico do INSS", "critico",
            "O instrumento juntado indica contrato %s e o histórico de consignações "
            "registra o desconto sob o número %s. O documento apresentado pela ré não "
            "\u00e9 o contrato que gerou o desconto discutido nestes autos."
            % (", ".join(sorted(n_inst)[:3]), ", ".join(sorted(n_his)[:3])),
            "instrumento: %s | histórico: %s"
            % (", ".join(sorted(n_inst)[:5]), ", ".join(sorted(n_his)[:5])), "",
            "Exibição do instrumento correspondente ao contrato averbado no benefício."))
    elif n_inst and n_his:
        S.append(Sinal(
            "NUM-02", "Número do contrato confere com o histórico", "nota",
            "O número do instrumento corresponde ao averbado no benefício. Esse ponto "
            "do cotejo está fechado e não deve ser atacado.",
            "em comum: %s" % ", ".join(sorted(n_inst & n_his)[:5]), ""))

    # ---- 15 · programas que geraram os arquivos --------------------------
    if produtores:
        S.append(Sinal(
            "META-03", "Programas que geraram os arquivos", "nota",
            "Registro do software produtor de cada PDF, útil para confrontar a "
            "alegação de extração direta do sistema bancário. Editor de texto ou "
            "gerador genérico enfraquece essa alegação.",
            " | ".join("%s: %s" % (n, p) for n, p in produtores[:10]), ""))

    suppressed = {item["codigo"]: set(item["arquivos"])
                  for item in checagens_suprimidas(leitura, proveniencias)}
    if suppressed:
        document_names = {document.nome for document in docs}
        filtered = []
        for signal in S:
            affected = suppressed.get(signal.codigo)
            if not affected:
                filtered.append(signal)
                continue
            # Sinais agregados (META-03) sem arquivo também medem somente os
            # arquivos derivados quando todos os documentos da leitura são afetados.
            if signal.arquivo in affected or (not signal.arquivo and document_names <= affected):
                continue
            filtered.append(signal)
        S = filtered

    S.sort(key=lambda x: (-GRAVIDADE.get(x.gravidade, 0), x.codigo))
    return S


def resumo(sinais):
    c = {"critico": 0, "alto": 0, "medio": 0, "nota": 0}
    for s in sinais:
        c[s.gravidade] = c.get(s.gravidade, 0) + 1
    return c
