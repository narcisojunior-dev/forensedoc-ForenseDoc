#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Motor de Réplicas · Consignado INSS
Ronney Menezes Advocacia

Monta a réplica a partir do Caderno de Réplicas, 2ª edição.
Roda inteiramente na máquina local: nenhum dado do processo sai do computador.

Uso:  python3 motor_replicas.py
      abre sozinho em http://127.0.0.1:8777

Papel timbrado: coloque o arquivo .docx do timbrado na subpasta "timbrado".
O primeiro .docx encontrado ali é usado como base, preservando cabeçalho e rodapé.
Sem timbrado, a peça sai em documento limpo, formatado em Calibri 12.
"""

import json
import os
import re
import io
import sys
import webbrowser
import threading
import unicodedata
from datetime import date
from http.server import HTTPServer, BaseHTTPRequestHandler

leitor = _MOD["leitor"]
forense = _MOD["forense"]
processual = _MOD["processual"]

BASE = os.path.dirname(os.path.abspath(__file__))
CADERNO = os.path.join(BASE, "caderno.json")
PASTA_TIMBRADO = os.path.join(BASE, "timbrado")
PASTA_SAIDA = os.path.join(BASE, "pecas")
PORTA = 8777

MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro"]

# --------------------------------------------------------------------------
# regras de diagnóstico: perguntas dos Blocos 1 e 2 do caderno
# --------------------------------------------------------------------------

PERGUNTAS = [
    {"id": "contrato", "bloco": 1,
     "p": "O que a ré juntou como contrato",
     "op": [["nada", "Não juntou contrato"],
            ["papel", "Instrumento em papel, digitalizado"],
            ["imagem", "Contrato eletrônico reduzido a uma imagem"]]},
    {"id": "assinatura", "bloco": 1,
     "p": "Assinatura no campo do contratante",
     "op": [["propria", "Assinada pela própria autora"],
            ["rogo", "Assinada a rogo, por terceiro"],
            ["branco", "Campo em branco, sem assinatura alguma"],
            ["na", "Não se aplica, não há contrato"]]},
    {"id": "testemunhas", "bloco": 1,
     "p": "Testemunhas instrumentárias no instrumento",
     "op": [["duas", "Duas ou mais, identificadas"],
            ["uma", "Apenas uma"],
            ["nenhuma", "Nenhuma"],
            ["na", "Não se aplica"]]},
    {"id": "cumulacao", "bloco": 1,
     "p": "O rogatário também figura como testemunha",
     "op": [["nao", "Não"], ["sim", "Sim"]]},
    {"id": "repeticao", "bloco": 1,
     "p": "A mesma pessoa aparece em mais de uma posição de subscrição",
     "op": [["nao", "Não"], ["sim", "Sim"]]},
    {"id": "docsubscritores", "bloco": 1,
     "p": "Documentos de identificação dos subscritores juntados",
     "op": [["sim", "Sim"], ["nao", "Não"], ["na", "Não se aplica"]]},
    {"id": "impossibilidade", "bloco": 1,
     "p": "Autora analfabeta ou impossibilitada de assinar",
     "op": [["provada", "Sim, com prova nos autos"],
            ["semprova", "Sim, mas a prova ainda não foi juntada"],
            ["nao", "Não, a autora assina o próprio nome"]]},
    {"id": "portabilidade", "bloco": 1,
     "p": "A ré alega portabilidade ou refinanciamento de contrato anterior",
     "op": [["nao", "Não"], ["sim", "Sim"]]},
    {"id": "repasse", "bloco": 2,
     "p": "O que a ré juntou como prova de repasse",
     "op": [["nada", "Nada"],
            ["comprovante", "Comprovante de transferência"],
            ["imagem", "Reserva de imagem ou tela de sistema"]]},
    {"id": "conta", "bloco": 2,
     "p": "O comprovante identifica a conta destinatária",
     "op": [["sim", "Sim"], ["nao", "Não"], ["na", "Não se aplica"]]},
    {"id": "extrato", "bloco": 2,
     "p": "O extrato da conta da autora confirma a entrada do valor",
     "op": [["nao", "Não confirma"], ["sim", "Confirma"],
            ["ausente", "O extrato ainda não foi juntado"]]},
    {"id": "valores", "bloco": 2,
     "p": "Valores conferem entre contrato, transferência e histórico de consignações",
     "op": [["sim", "Conferem"], ["nao", "Divergem"], ["na", "Não há como cotejar"]]},
]


# Confiança abaixo deste patamar não decide cenário: volta como pergunta.
CONFIANCA_SUFICIENTE = {"alta", "media"}

# Cenários que dependem da forma do instrumento em papel, art. 595 do Código
# Civil. Contrato eletrônico não tem rogo nem testemunha instrumentária.
CENARIOS_FORMAIS = {"A", "B", "C", "D", "E", "F"}


def filtrar_respostas(achados):
    """Descarta o que a leitura marcou como indeterminado.

    Quem chama o diagnóstico deve passar por aqui. O leitor grada cada resposta
    em alta, média ou baixa, e devolve valor nulo com confiança baixa
    exatamente onde não conseguiu determinar. Copiar tudo sem olhar a confiança
    faz "não sei" chegar ao diagnóstico com a mesma força de "não tem".
    """
    saida = {}
    for chave, item in (achados or {}).items():
        if not isinstance(item, dict):
            saida[chave] = item
            continue
        valor = item.get("valor")
        if valor in (None, "", "na"):
            continue
        if item.get("confianca") not in CONFIANCA_SUFICIENTE:
            continue
        saida[chave] = valor
    return saida


def diagnosticar(r, sinais=None):
    """Aplica a matriz de decisão do caderno e devolve os cenários candidatos.

    Duas travas que não existiam antes:

    Toda regra exige valor afirmativo. Comparação por desigualdade contra um
    campo que pode vir vazio fazia ausência de informação valer como afirmação
    negativa, e era isso que punha o art. 595 em processo de contratação por
    aplicativo.

    Contratação reconhecida como eletrônica retira os cenários formais da mesa,
    salvo prova positiva em contrário, que é o registro escrito de rogo nos
    autos. Nesse caso o leitor devolve "papel" e nada é retirado.
    """
    def c(k):
        v = r.get(k)
        return v if v is not None else ""

    cand = []
    bloqueados = []

    eletronica = c("contratacao") == "eletronica"

    def add(letra, sev, motivo):
        if letra in CENARIOS_FORMAIS and eletronica:
            bloqueados.append({"letra": letra, "motivo": motivo})
            return
        cand.append({"letra": letra, "sev": sev, "motivo": motivo})

    if c("contrato") == "nada" and c("repasse") == "nada":
        add("N", 100, "A contestação veio desacompanhada de contrato e de comprovante.")
    if c("contrato") == "nada" and c("repasse") in ("comprovante", "imagem"):
        add("I", 84, "Há transferência isolada, sem apresentação do contrato.")
    if c("contrato") == "imagem":
        add("O", 90, "O contrato eletrônico foi reduzido a uma imagem, sem elementos técnicos.")
    if eletronica and c("elementos_tecnicos") == "incompletos":
        add("O", 90, "Contratação eletrônica com trilha incompleta: o ataque é aos "
                     "elementos técnicos e à distinção em relação ao REsp 2.197.156/SP.")
    if c("assinatura") == "branco":
        add("J", 88, "O campo da assinatura está em branco: não há manifestação de vontade.")
    if c("assinatura") == "rogo" and c("testemunhas") in ("nenhuma", "uma"):
        add("A", 80, "Há assinatura a rogo sem as duas testemunhas do art. 595 do Código Civil.")
    if c("assinatura") == "rogo" and c("cumulacao") == "sim":
        add("C", 78, "O rogatário cumula a função de testemunha e quebra o controle da forma.")
    if c("repeticao") == "sim":
        add("D", 76, "A mesma pessoa subscreve em posições diferentes e reduz o número mínimo de subscritores.")
    if (c("impossibilidade") in ("provada", "semprova")
            and c("assinatura") in ("propria", "branco")
            and c("testemunhas") in ("duas", "uma")):
        add("B", 74, "Há testemunhas, mas falta a assinatura a rogo de quem não pode assinar.")
    if (c("impossibilidade") in ("provada", "semprova")
            and c("assinatura") in ("propria", "branco")
            and c("testemunhas") == "nenhuma"
            and c("contrato") == "papel"):
        add("F", 82, "O instrumento não traz rogo nem testemunhas: ausência integral de forma.")
    if c("docsubscritores") == "nao" and c("contrato") == "papel":
        add("E", 70, "Os subscritores não estão documentados e não há como verificá-los.")
    if c("portabilidade") == "sim":
        add("K", 72, "A ré alega portabilidade não reconhecida pela consumidora.")
    if c("repasse") == "imagem":
        add("G", 68, "O comprovante é reserva de imagem ou tela de sistema.")
    if c("repasse") == "comprovante" and c("conta") == "nao":
        add("H", 66, "O comprovante não identifica a conta destinatária.")
    if c("contrato") in ("papel", "imagem") and c("repasse") == "nada":
        add("M", 64, "Há contrato, mas nenhuma prova de repasse.")
    if c("valores") == "nao":
        add("L", 62, "Os valores divergem entre contrato, transferência e consignações.")

    # um mesmo cenário pode entrar por dois caminhos: fica o de maior gravidade
    melhor = {}
    for x in cand:
        atual = melhor.get(x["letra"])
        if atual is None or x["sev"] > atual["sev"]:
            melhor[x["letra"]] = x
    cand = list(melhor.values())

    if sinais:
        cand = priorizar(cand, sinais)
    cand.sort(key=lambda x: -x["sev"])
    for x in cand:
        x["bloqueados"] = bloqueados
    if bloqueados and not cand:
        return [{"letra": None, "sev": 0, "bloqueados": bloqueados,
                 "motivo": "A contratação é eletrônica e nenhum cenário de repasse "
                           "ou de trilha se confirmou. Não há cenário a propor: "
                           "releia o instrumento antes de escolher o eixo."}]
    return cand


# Achados que deslocam o eixo do ataque. Cada um carrega o código, para que a
# tela e o laudo mostrem por que o cenário subiu, e não apenas que subiu.
PESO_ACHADO = [
    ("AMB-01", "O", 14, "tela de ambiente de homologação servindo de prova da jornada"),
    ("MOD-01", "O", 12, "formulário de versão posterior à data do contrato"),
    ("HSH-01", "O", 12, "resumo declarado em log que não corresponde ao arquivo juntado"),
    ("IP-01", "O", 10, "mesmo endereço IP em documentos distintos"),
    ("TRI-01", "O", 6, "trilha sem endereço IP"),
    ("TRI-02", "O", 4, "trilha sem geolocalização"),
    ("TRI-03", "O", 6, "trilha sem biometria"),
    ("SIG-03", "O", 4, "sem menção a certificação ICP-Brasil"),
    ("AUT-01", "G", 8, "autenticação declarada e sem meio de conferência"),
    ("AUT-02", "G", 8, "comprovante sem código de autenticação"),
    ("AUT-01", "H", 6, "autenticação declarada e sem meio de conferência"),
    ("AUT-02", "H", 6, "comprovante sem código de autenticação"),
    ("CRO-01", "M", 8, "repasse anterior ao contrato"),
    ("NUM-01", "L", 10, "número do contrato divergente do histórico do INSS"),
    ("TAX-01", "L", 4, "taxa efetiva recalculada diverge da declarada"),
    ("TAX-02", "L", 8, "os números do contrato não fecham em taxa alguma"),
]


def priorizar(candidatos, sinais):
    """Deixa os achados forenses pesarem na ordem dos cenários.

    Sem isto, um achado como o IP repetido entra no relatório e não influencia
    a escolha do capítulo, que foi exatamente o que aconteceu no lote de
    validação: a máquina encontrou o marcador certo e montou o capítulo errado.

    Só pesa achado que aponte defeito. Vários códigos existem nas duas
    direções: TRI-01 tanto diz que a trilha registra o IP quanto que não
    registra, e a diferença está na gravidade, não no código. Somar pelo código
    faria trilha íntegra reforçar o mesmo cenário que trilha quebrada.
    """
    relevantes = {}
    for s in sinais or []:
        codigo = s.get("codigo") if isinstance(s, dict) else getattr(s, "codigo", "")
        grav = s.get("gravidade") if isinstance(s, dict) else getattr(s, "gravidade", "")
        titulo = s.get("titulo") if isinstance(s, dict) else getattr(s, "titulo", "")
        if grav in ("critico", "alto", "medio"):
            relevantes.setdefault(codigo, titulo)
    por_letra = {x["letra"]: x for x in candidatos}
    for codigo, letra, delta, motivo in PESO_ACHADO:
        if codigo in relevantes and letra in por_letra:
            alvo = por_letra[letra]
            alvo["sev"] = alvo.get("sev", 0) + delta
            alvo.setdefault("reforcos", []).append({
                "codigo": codigo, "motivo": motivo,
                "achado": relevantes[codigo]})
    return list(por_letra.values())


AVISOS = {
    "semprova": ("A prova da impossibilidade de assinar ainda não está nos autos. "
                 "Os cenários A a F dependem dela. Junte agora e justifique a juntada "
                 "tardia, na forma do art. 435 do Código de Processo Civil."),
    "assina": ("A autora assina o próprio nome. Se ela assina mas não compreendeu o que "
               "assinou, o caso não é de art. 595: o caminho é falha do dever de "
               "informação, art. 6º, III, e art. 46 do Código de Defesa do Consumidor."),
    "autenticacao": ("Se o comprovante trouxer autenticação bancária conferível, o eixo do "
                     "ataque muda: pare de discutir a existência da transferência e passe "
                     "a discutir o destino do valor."),
}

# --------------------------------------------------------------------------
# montagem da peça
# --------------------------------------------------------------------------

C = json.loads(_CADERNO_TEXTO)

INSTRUCOES = ("mantenha apenas os itens efetivamente arguidos",)
RE_PRELIM = re.compile(r"^III\.(\d)\.\s")


def bloco(bid):
    return C["blocos"].get(bid, [])


class PreRequisitoAusente(Exception):
    """Levantada quando faltam peças sem as quais a peça não pode ser montada."""

    def __init__(self, motivos):
        self.motivos = motivos
        super().__init__("; ".join(motivos))


def prerequisitos(analise):
    """Diz o que impede a montagem. Lista vazia significa caminho livre.

    A peça afirma o que a defesa juntou e o que deixou de juntar. Sem a
    contestação lida, essa afirmação não tem lastro; sem a inicial, não há como
    conferir o que foi pedido contra o que foi enfrentado. Montar assim mesmo
    produz peça bem escrita sobre autos que ninguém leu.
    """
    faltas = []
    docs = (analise or {}).get("documentos") or []
    tipos = [d.get("tipo") for d in docs]
    if not any(t == "inicial" for t in tipos):
        faltas.append("a petição inicial não foi reconhecida entre os documentos lidos")
    if not any(t == "contestacao" for t in tipos):
        faltas.append("a contestação não foi reconhecida entre os documentos lidos")
    if len(docs) < 3:
        faltas.append("foram lidos apenas %d documento(s), insuficiente para "
                      "sustentar afirmação sobre o conjunto probatório" % len(docs))
    return faltas


def montar_peca(analise, letra, dados, preliminares, modulo_extra=None,
                conformidade=None, forcar=False):
    """Porta única de montagem: confere os pré-requisitos e só então monta."""
    faltas = prerequisitos(analise)
    if faltas and not forcar:
        raise PreRequisitoAusente(faltas)
    return montar(letra, dados, preliminares, modulo_extra, conformidade)


def montar(letra, dados, preliminares, modulo_extra=None, conformidade=None):
    """Devolve a lista de parágrafos da peça, já com os campos globais aplicados."""
    r = C["replicas"][letra]
    saida = []

    for p in bloco(r["enderecamento"]):
        saida.append({"t": p["t"], "b": p["b"], "tipo": "abertura"})
    saida.append({"t": "RÉPLICA À CONTESTAÇÃO", "b": True, "tipo": "rotulo"})

    for cap in r["capitulos"]:
        saida.append({"t": "%s. %s" % (cap["num"], cap["titulo"]),
                      "b": True, "tipo": "capitulo"})
        ativo = True
        for p in bloco(cap["bloco"]):
            t = p["t"]
            if any(t.lower().startswith(i) for i in INSTRUCOES):
                continue
            m = RE_PRELIM.match(t)
            if m:
                ativo = ("III.%s" % m.group(1)) in preliminares
            if not ativo:
                continue
            saida.append({"t": t, "b": p["b"], "tipo": "corpo"})

        if modulo_extra and cap["num"] == proximo_ao_modulo(r):
            saida.extend(transplante(modulo_extra, cap["num"]))

    for p in bloco(r["encerramento"]):
        saida.append({"t": p["t"], "b": p["b"], "tipo": "fecho"})

    out = []
    for p in saida:
        t = aplicar_campos(p["t"], dados)
        t = preencher_contexto(t, dados, conformidade or [])
        out.append(dict(p, t=t))
    return out


def proximo_ao_modulo(r):
    """Número do capítulo de ataque probatório da peça base."""
    for cap in r["capitulos"]:
        tt = cap["titulo"]
        if tt.startswith(("DA AUSÊNCIA", "DA CUMULAÇÃO", "DA REPETIÇÃO DE SUBSCRITORES",
                          "DA TRANSFERÊNCIA", "DA INCOMPATIBILIDADE", "DA DEFESA")):
            return cap["num"]
    return None


def transplante(letra, num_base=None):
    """Capítulo de ataque de outro cenário, para casos mistos.

    Quando o cenário transplantado é de repasse, o capítulo de conformidade com
    a Súmula 69 vem junto: o caderno os apresenta em par, e o ataque ao
    comprovante sem a lista dos oito itens perde exatamente o que o enunciado
    lhe dá, que é transformar impugnação em conferência.
    """
    r = C["replicas"][letra]
    num = proximo_ao_modulo(r)
    prefixo = num_base or num          # a numeração segue a peça base, não a doadora
    out, levando, sufixo = [], False, ord("A")
    for cap in r["capitulos"]:
        if cap["num"] == num:
            levando = True
        elif levando and not cap["titulo"].startswith("DA NÃO CONFORMIDADE"):
            break
        if not levando:
            continue
        out.append({"t": "%s-%s. %s (cenário %s, transplantado)"
                         % (prefixo, chr(sufixo), cap["titulo"], letra),
                    "b": True, "tipo": "capitulo"})
        for p in bloco(cap["bloco"]):
            out.append({"t": p["t"], "b": p["b"], "tipo": "corpo"})
        sufixo += 1
    return out


# regras de preenchimento por contexto: o que vem antes do colchete decide o campo
CONTEXTO = [
    (r"valor\s+liberado\s+de\s*$", "[valor]", "valor_liberado"),
    (r"transfer[êe]ncia\s+de\s*$", "[valor]", "valor_transferido"),
    (r"parcelas\s+de\s*$", "[valor]", "valor_parcela"),
    (r"desconto\s+mensal\s+de\s*$", "[valor]", "valor_parcela"),
    (r"contrato\s+n[ºo°]\s*$", "[número]", "contrato_n"),
    (r"benef[íi]cio\s+n[ºo°]\s*$", "[número]", "beneficio"),
    (r"instrumento\s+(?:de\s+)?fls\.\s*$", "[__]", "fls_contrato"),
    (r"contrato\s+de\s+fls\.\s*$", "[__]", "fls_contrato"),
    (r"comprovante\s+(?:de\s+|[àa]s\s+)?fls\.\s*$", "[__]", "fls_comprovante"),
    (r"transfer[êe]ncia\s+de\s+[^,]{0,40},\s*em\s*$", "[data]", "data_transferencia"),
    (r"iniciado\s+em\s*$", "[data]", "data_primeiro_desconto"),
    (r"registra\s+desconto\s+mensal\s+de\s*$", "[valor]", "valor_parcela"),
]

RX_ITEM69 = re.compile(r"^([a-h])\)\s")


def preencher_contexto(t, dados, conformidade):
    """Preenche os colchetes que os documentos lidos respondem, e só esses.

    O que o leitor não achou fica como estava: colchete aberto é pendência
    visível, e pendência visível é melhor que número inventado.
    """
    if not dados and not conformidade:
        return t

    # itens a) a h) da Súmula 69: a ordem da lista é a do enunciado
    m = RX_ITEM69.match(t.strip())
    if m and conformidade and "[ausente ou presente" in t:
        item = next((x for x in conformidade if x["item"] == m.group(1)), None)
        if item:
            if "e por quê" in t:
                razao = ("ausente, o documento não traz código de autenticação "
                         "passível de conferência independente"
                         if item["situacao"] == "ausente"
                         else "presente, conferir a validade do código junto ao emissor")
                t = re.sub(r"\[ausente ou presente, e por qu[êe]\]", razao, t)
            else:
                t = re.sub(r"\[ausente ou presente\]", item["situacao"], t)
            return t

    # demais marcadores, pelo texto que os antecede
    saida, pos = [], 0
    for m in re.finditer(r"\[[^\]]{1,40}\]", t):
        marcador = m.group(0)
        antes = t[max(0, m.start() - 60):m.start()]
        troca = None
        for rx, alvo, campo in CONTEXTO:
            if marcador == alvo and re.search(rx, antes, re.I) and dados.get(campo):
                troca = str(dados[campo])
                break
        # "[número] parcelas" e "[número] competências" se resolvem pelo que vem depois
        if troca is None and marcador == "[número]":
            depois = t[m.end():]
            if re.match(r"\s*compet[êe]ncias", depois) and dados.get("competencias"):
                troca = str(dados["competencias"])
            elif (re.match(r"\s*(?:parcelas|presta[çc][õo]es)", depois)
                  and dados.get("parcelas")):
                troca = str(dados["parcelas"])
        saida.append(t[pos:m.start()])
        saida.append(troca if troca is not None else marcador)
        pos = m.end()
    saida.append(t[pos:])
    return "".join(saida)


def aplicar_campos(t, d):
    vara = d.get("vara", "").strip()
    comarca = d.get("comarca", "").strip()
    uf = d.get("uf", "").strip()
    if t.startswith("EXCELENTÍSSIMO"):
        t = ("EXCELENTÍSSIMO(A) SENHOR(A) DOUTOR(A) JUIZ(A) DE DIREITO DA %s VARA "
             "CÍVEL DA COMARCA DE %s/%s" % (vara or "___",
                                            comarca or "___________", uf or "___"))
    # a linha de fecho é tratada inteira: fora dela, [data] é data de fato,
    # e quem a preenche é o contexto, não a data da assinatura
    if "[Cidade]/[UF], [data]" in t:
        t = t.replace("[Cidade]/[UF], [data]",
                      "%s/%s, %s" % (d.get("cidade", "[Cidade]"), uf or "[UF]",
                                     d.get("data", "[data]")))
    pares = {
        "[NÚMERO DO PROCESSO]": d.get("processo", ""),
        "[NOME DO AUTOR]": d.get("autor", ""),
        "[NOME DA INSTITUIÇÃO]": d.get("re", ""),
        "[NOME DO ADVOGADO]": d.get("advogado", ""),
        "[Cidade]": d.get("cidade", ""),
        "[UF]": uf,
        "[NÚMERO]": d.get("oab", ""),
    }
    for k, v in pares.items():
        if v:
            t = t.replace(k, v)
    return t


# --------------------------------------------------------------------------
# geração do DOCX
# --------------------------------------------------------------------------

def achar_timbrado():
    if not os.path.isdir(PASTA_TIMBRADO):
        return None
    for n in sorted(os.listdir(PASTA_TIMBRADO)):
        if n.lower().endswith(".docx") and not n.startswith("~$"):
            return os.path.join(PASTA_TIMBRADO, n)
    return None


def gerar_docx(paragrafos, nome):
    try:
        import docx
        from docx.shared import Pt, Cm
        from docx.enum.text import WD_ALIGN_PARAGRAPH
    except ImportError:
        raise RuntimeError(
            "python-docx não está instalado. Rode:  pip3 install python-docx")

    base = achar_timbrado()
    if base:
        d = docx.Document(base)
        corpo = d.element.body
        for el in list(corpo):
            if el.tag.endswith("}p") or el.tag.endswith("}tbl"):
                corpo.remove(el)
    else:
        d = docx.Document()
        for s in d.sections:
            s.top_margin = Cm(2.5)
            s.bottom_margin = Cm(2.5)
            s.left_margin = Cm(3.0)
            s.right_margin = Cm(3.0)

    normal = d.styles["Normal"]
    normal.font.name = "Calibri"
    normal.font.size = Pt(12)

    for p in paragrafos:
        t = p["t"]
        if not t.strip():
            continue
        par = d.add_paragraph()
        pf = par.paragraph_format
        pf.space_after = Pt(10)
        pf.line_spacing = 1.5
        if p["tipo"] in ("capitulo", "rotulo"):
            pf.space_before = Pt(16)
            par.alignment = WD_ALIGN_PARAGRAPH.LEFT
        elif p["tipo"] == "abertura":
            par.alignment = WD_ALIGN_PARAGRAPH.LEFT
        elif p["tipo"] == "fecho":
            par.alignment = WD_ALIGN_PARAGRAPH.CENTER
        else:
            par.alignment = WD_ALIGN_PARAGRAPH.JUSTIFY
            pf.first_line_indent = Cm(1.25)
        run = par.add_run(t)
        run.bold = bool(p.get("b"))
        run.font.name = "Calibri"
        run.font.size = Pt(12)

    os.makedirs(PASTA_SAIDA, exist_ok=True)
    caminho = os.path.join(PASTA_SAIDA, nome)
    d.save(caminho)
    return caminho, bool(base)


def limpar_nome(s):
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9._-]+", "_", s).strip("_")
    return s[:80] or "replica"


# --------------------------------------------------------------------------
# servidor local
# --------------------------------------------------------------------------

ULTIMA = {}

ROTULO_GRAV = {"critico": "CRÍTICO", "alto": "ALTO", "medio": "MÉDIO", "nota": "NOTA"}


def gerar_relatorio(L, sinais, dados):
    """Grava o relatório de achados forenses em DOCX, para instruir a peça."""
    pars = [
        {"t": "RELATÓRIO DE ACHADOS SOBRE OS DOCUMENTOS JUNTADOS", "b": True,
         "tipo": "rotulo"},
        {"t": "Documento de trabalho interno. Não é peça processual e não deve ser "
              "juntado aos autos. Serve para instruir a impugnação especificada e os "
              "pedidos de exibição.", "b": False, "tipo": "corpo"},
        {"t": "Processo nº %s" % (dados.get("processo") or "não informado"),
         "b": False, "tipo": "abertura"},
        {"t": "Autora: %s" % (dados.get("autor") or "não informada"),
         "b": False, "tipo": "abertura"},
        {"t": "Ré: %s" % (dados.get("re") or "não informada"),
         "b": False, "tipo": "abertura"},
        {"t": "I. DOCUMENTOS EXAMINADOS", "b": True, "tipo": "capitulo"},
    ]
    for d in L.documentos:
        pars.append({"t": "%s · %s · %d página(s) · SHA-256 %s"
                          % (d.nome, d.tipo, len(d.paginas), d.sha256[:32]),
                     "b": False, "tipo": "corpo"})

    proc = [x for x in sinais if x.codigo.startswith(("PRO", "DOC", "MAR"))]
    docm = [x for x in sinais if not x.codigo.startswith(("PRO", "DOC", "MAR"))]

    pars.append({"t": "II. ACHADOS PROCESSUAIS E DE COTEJO ENTRE AS PEÇAS", "b": True,
                 "tipo": "capitulo"})
    if not proc:
        pars.append({"t": "Nada a registrar.", "b": False, "tipo": "corpo"})
    for s_ in proc:
        pars.append({"t": "%s · %s · %s"
                          % (s_.codigo, ROTULO_GRAV.get(s_.gravidade, s_.gravidade),
                             s_.titulo), "b": True, "tipo": "corpo"})
        pars.append({"t": s_.detalhe, "b": False, "tipo": "corpo"})
        if s_.arquivo:
            pars.append({"t": "Arquivo: %s" % s_.arquivo, "b": False, "tipo": "corpo"})
        if s_.dado:
            pars.append({"t": "Dado observado: %s" % s_.dado, "b": False, "tipo": "corpo"})
        if s_.pedido:
            pars.append({"t": "A requerer: %s" % s_.pedido, "b": False, "tipo": "corpo"})

    pars.append({"t": "III. ACHADOS SOBRE OS ARQUIVOS", "b": True, "tipo": "capitulo"})
    for s_ in docm:
        pars.append({"t": "%s · %s · %s"
                          % (s_.codigo, ROTULO_GRAV.get(s_.gravidade, s_.gravidade),
                             s_.titulo), "b": True, "tipo": "corpo"})
        pars.append({"t": s_.detalhe, "b": False, "tipo": "corpo"})
        if s_.arquivo:
            pars.append({"t": "Arquivo: %s" % s_.arquivo, "b": False, "tipo": "corpo"})
        if s_.dado:
            pars.append({"t": "Dado observado: %s" % s_.dado, "b": False, "tipo": "corpo"})
        if s_.pedido:
            pars.append({"t": "A requerer: %s" % s_.pedido, "b": False, "tipo": "corpo"})

    pedidos = [s_.pedido for s_ in sinais if s_.pedido]
    if pedidos:
        pars.append({"t": "IV. EXIBIÇÕES E PROVIDÊNCIAS A REQUERER", "b": True,
                     "tipo": "capitulo"})
        vistos = set()
        i = 0
        for p in pedidos:
            if p in vistos:
                continue
            vistos.add(p)
            i += 1
            pars.append({"t": "%d) %s" % (i, p), "b": False, "tipo": "corpo"})

    pars.append({"t": "V. LIMITAÇÕES DESTA LEITURA", "b": True, "tipo": "capitulo"})
    for lim in [
        "A leitura recai sobre os arquivos entregues, no estado em que estão. "
        "Documento não juntado não é examinado.",
        "Página sem camada de texto é lida por reconhecimento óptico, que erra "
        "número e acento. Todo valor e toda data precisam de conferência no documento.",
        "Ausência de elemento no arquivo significa ausência no arquivo, e não prova "
        "de fraude. O que se afirma aqui é o que falta e o que não fecha.",
        "O cotejo entre as peças é feito por busca de termos. Ponto que a leitura não "
        "localizou na defesa pode ter sido enfrentado com outras palavras: confira "
        "antes de afirmar silêncio da ré.",
        "A qualificação jurídica dos achados é do advogado que subscreve a peça.",
    ]:
        pars.append({"t": lim, "b": False, "tipo": "corpo"})

    nome = "Achados_%s.docx" % limpar_nome(dados.get("processo") or "sem_numero")
    caminho, _ = gerar_docx(pars, nome)
    return caminho


class App(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, body, ctype="application/json; charset=utf-8"):
        if isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            self._send(200, PAGINA, "text/html; charset=utf-8")
        elif self.path == "/api/dados":
            hoje = date.today()
            self._send(200, json.dumps({
                "perguntas": PERGUNTAS,
                "matriz": C["matriz"],
                "normas": C["normas"],
                "replicas": {k: {"letra": v["letra"], "titulo": v["titulo"],
                                 "capitulos": [c["titulo"] for c in v["capitulos"]]}
                             for k, v in C["replicas"].items()},
                "estudos": C["estudos"],
                "checklist": C["anexos"]["checklist"],
                "alertas": C["anexos"]["alertas"],
                "timbrado": os.path.basename(achar_timbrado() or ""),
                "hoje": "%d de %s de %d" % (hoje.day, MESES[hoje.month - 1], hoje.year),
            }, ensure_ascii=False))
        else:
            self._send(404, "{}")

    def do_POST(self):
        n = int(self.headers.get("Content-Length", 0))
        req = json.loads(self.rfile.read(n) or b"{}")
        try:
            if self.path == "/api/ler":
                pasta = os.path.expanduser(req.get("pasta", "").strip())
                if not os.path.isdir(pasta):
                    self._send(200, json.dumps(
                        {"erro": "Pasta não encontrada: %s" % pasta}, ensure_ascii=False))
                    return
                arquivos = leitor.coletar(pasta)
                if not arquivos:
                    self._send(200, json.dumps(
                        {"erro": "Nenhum PDF, imagem ou texto nessa pasta."},
                        ensure_ascii=False))
                    return
                L = leitor.ler_autos(arquivos, usar_ocr=req.get("ocr", True))
                sinais = processual.analisar(L) + forense.periciar(L)
                sinais.sort(key=lambda x: (-forense.GRAVIDADE.get(x.gravidade, 0),
                                           x.codigo))
                global ULTIMA
                ULTIMA = {"leitura": L, "sinais": sinais}
                d = L.js()
                d["sinais"] = [x.js() for x in sinais]
                d["resumo"] = forense.resumo(sinais)
                self._send(200, json.dumps(d, ensure_ascii=False))

            elif self.path == "/api/relatorio":
                if not ULTIMA.get("sinais"):
                    self._send(200, json.dumps({"erro": "Nenhuma leitura na memória."},
                                               ensure_ascii=False))
                    return
                caminho = gerar_relatorio(ULTIMA["leitura"], ULTIMA["sinais"],
                                          req.get("dados", {}))
                self._send(200, json.dumps({"caminho": caminho}, ensure_ascii=False))

            elif self.path == "/api/diagnostico":
                cand = diagnosticar(req.get("respostas", {}))
                avisos = []
                rr = req.get("respostas", {})
                if rr.get("impossibilidade") == "semprova":
                    avisos.append(AVISOS["semprova"])
                if rr.get("impossibilidade") == "nao" and any(
                        x["letra"] in "ABCDEF" for x in cand):
                    avisos.append(AVISOS["assina"])
                if rr.get("repasse") == "comprovante":
                    avisos.append(AVISOS["autenticacao"])
                self._send(200, json.dumps(
                    {"candidatos": cand, "avisos": avisos}, ensure_ascii=False))

            elif self.path == "/api/montar":
                analise = ULTIMA.get("leitura").js() if ULTIMA.get("leitura") else None
                try:
                    pars = montar_peca(analise, req["letra"], req.get("dados", {}),
                                       set(req.get("preliminares", [])),
                                       req.get("transplante") or None,
                                       req.get("conformidade") or [],
                                       forcar=bool(req.get("forcar")))
                except PreRequisitoAusente as e:
                    self._send(200, json.dumps(
                        {"bloqueado": True, "motivos": e.motivos}, ensure_ascii=False))
                    return
                self._send(200, json.dumps({"paragrafos": pars}, ensure_ascii=False))

            elif self.path == "/api/gerar":
                pars = req["paragrafos"]
                pend = sum(len(re.findall(r"\[[^\]]{1,90}\]", p["t"])) for p in pars)
                d = req.get("dados", {})
                nome = "Replica_%s_%s.docx" % (
                    req.get("letra", "X"),
                    limpar_nome(d.get("processo") or d.get("autor") or "sem_numero"))
                caminho, com_timbrado = gerar_docx(pars, nome)
                self._send(200, json.dumps({
                    "caminho": caminho, "timbrado": com_timbrado,
                    "pendencias": pend}, ensure_ascii=False))
            else:
                self._send(404, "{}")
        except Exception as e:
            self._send(500, json.dumps({"erro": str(e)}, ensure_ascii=False))


PAGINA = r"""<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Motor de Réplicas · Consignado INSS</title>
<style>
:root{
 --navy:#000044; --gold:#F8BB05; --paper:#F4F5F9; --card:#FFFFFF;
 --text:#2B3050; --soft:#5C6285; --rule:#D9DDEA;
 --ok:#1F6F4A; --okbg:#E4F0EA; --warn:#9A6A05; --warnbg:#FBF0D8;
 --crit:#9E2B2B; --critbg:#F6E3E3;
}
*{box-sizing:border-box}
body{margin:0;background:var(--paper);color:var(--text);
 font:15px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
header{background:var(--navy);color:#fff;padding:18px 26px;display:flex;
 align-items:baseline;gap:16px;flex-wrap:wrap}
header h1{margin:0;font-size:1.05rem;font-weight:600;letter-spacing:.02em}
header .sub{font-size:.78rem;color:#A9B0D8}
header .tag{margin-left:auto;font-size:.7rem;letter-spacing:.1em;text-transform:uppercase;
 color:var(--gold);border:1px solid rgba(248,187,5,.45);padding:3px 9px;border-radius:2px}
.steps{display:flex;background:var(--card);border-bottom:1px solid var(--rule);
 padding:0 26px;overflow-x:auto}
.steps button{background:none;border:0;border-bottom:2px solid transparent;padding:13px 15px;
 font:inherit;font-size:.82rem;color:var(--soft);cursor:pointer;white-space:nowrap}
.steps button[aria-selected="true"]{color:var(--navy);border-bottom-color:var(--gold);font-weight:600}
main{max-width:1080px;margin:0 auto;padding:26px}
.card{background:var(--card);border:1px solid var(--rule);border-radius:3px;padding:20px 22px;margin-bottom:16px}
.card h2{margin:0 0 4px;font-size:1rem;color:var(--navy)}
.card .hint{color:var(--soft);font-size:.85rem;margin:0 0 16px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:14px}
.q{border:1px solid var(--rule);border-radius:3px;padding:12px 14px}
.q.auto{border-left:3px solid var(--ok)}
.q.duvida{border-left:3px solid var(--warn);background:#FFFDF6}
.q .lbl{font-weight:600;font-size:.86rem;margin-bottom:6px;color:var(--navy)}
.q label{display:block;font-size:.85rem;padding:3px 0;cursor:pointer}
.q input{margin-right:7px}
.ev{font-size:.76rem;color:var(--soft);background:#F2F4F9;border-left:2px solid var(--rule);
 padding:6px 9px;margin-top:8px;border-radius:0 2px 2px 0}
.ev b{color:var(--text);font-weight:600}
.ev .tr{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.72rem;display:block;margin-top:3px}
label.f{display:block;font-size:.75rem;letter-spacing:.06em;text-transform:uppercase;
 color:var(--soft);margin-bottom:4px}
input[type=text]{width:100%;padding:7px 9px;border:1px solid var(--rule);border-radius:2px;
 font:inherit;font-size:.9rem;background:#fff;color:var(--text)}
.fields{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));gap:12px}
button.go{background:var(--navy);color:#fff;border:0;padding:10px 20px;border-radius:2px;
 font:inherit;font-weight:600;font-size:.88rem;cursor:pointer}
button.go:hover{background:#000066}
button.alt{background:#fff;color:var(--navy);border:1px solid var(--rule)}
.cand{display:flex;align-items:flex-start;gap:12px;border:1px solid var(--rule);border-radius:3px;
 padding:12px 14px;margin-bottom:8px;cursor:pointer;background:#fff}
.cand:hover{border-color:var(--navy)}
.cand.sel{border-color:var(--gold);border-left:3px solid var(--gold);background:#FFFDF5}
.cand .let{font-weight:700;font-size:1.15rem;color:var(--navy);min-width:26px}
.cand .tt{font-weight:600;font-size:.9rem}
.cand .mv{font-size:.83rem;color:var(--soft)}
.pill{font-size:.66rem;letter-spacing:.07em;text-transform:uppercase;padding:3px 8px;border-radius:2px;
 background:#EDEFF6;color:var(--soft);white-space:nowrap}
.pill.base{background:var(--warnbg);color:var(--warn)}
.pill.ok{background:var(--okbg);color:var(--ok)}
.pill.crit{background:var(--critbg);color:var(--crit)}
.aviso{border-left:3px solid var(--warn);background:var(--warnbg);padding:10px 14px;margin-bottom:8px;font-size:.86rem}
.erro{border-left:3px solid var(--crit);background:var(--critbg);padding:10px 14px;margin-bottom:8px;font-size:.86rem}
table{width:100%;border-collapse:collapse;font-size:.83rem}
th,td{text-align:left;padding:7px 10px;border-bottom:1px solid var(--rule);vertical-align:top}
th{font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--soft);font-weight:600}
td.l{font-weight:700;color:var(--navy);width:34px}
details{border:1px solid var(--rule);border-radius:3px;padding:10px 14px;margin-bottom:10px;background:#fff}
summary{cursor:pointer;font-weight:600;font-size:.88rem;color:var(--navy)}
details .body{font-size:.86rem;color:var(--soft);margin-top:8px}
details .body p{margin:0 0 7px}
.bar{position:sticky;top:0;z-index:5;background:var(--card);border:1px solid var(--rule);
 border-radius:3px;padding:11px 14px;margin-bottom:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.bar .st{font-size:.85rem}
.par{margin-bottom:9px}
.par .cap{font-weight:700;font-size:.8rem;letter-spacing:.05em;color:var(--navy);
 text-transform:uppercase;margin:18px 0 6px}
textarea{width:100%;border:1px solid var(--rule);border-radius:2px;padding:8px 10px;font:inherit;
 font-size:.88rem;line-height:1.55;resize:vertical;background:#fff;color:var(--text)}
textarea.pend{border-color:#E0B4B4;background:#FFF8F8}
.mini{font-size:.72rem;color:var(--soft);margin-bottom:3px}
.res{border-left:3px solid var(--ok);background:var(--okbg);padding:12px 16px;font-size:.88rem;margin-top:12px}
.res code{background:#fff;padding:2px 6px;border-radius:2px;font-size:.85rem}
.chk label{display:block;font-size:.85rem;padding:4px 0}
.chk input{margin-right:8px}
.sinal{border:1px solid var(--rule);border-left-width:3px;border-radius:3px;padding:12px 14px;margin-bottom:9px;background:#fff}
.sinal.critico{border-left-color:var(--crit)}
.sinal.alto{border-left-color:#C4761E}
.sinal.medio{border-left-color:var(--warn)}
.sinal.nota{border-left-color:var(--rule)}
.sinal h3{margin:0 0 3px;font-size:.92rem;color:var(--navy);display:flex;gap:9px;align-items:center;flex-wrap:wrap}
.sinal .cod{font-family:ui-monospace,Menlo,monospace;font-size:.7rem;color:var(--soft)}
.sinal p{margin:0 0 6px;font-size:.86rem}
.sinal .dado{font-family:ui-monospace,Menlo,monospace;font-size:.75rem;color:var(--soft);
 background:#F2F4F9;padding:5px 8px;border-radius:2px;overflow-x:auto;white-space:pre-wrap;word-break:break-word}
.sinal .pedir{font-size:.82rem;color:var(--ok);margin-top:6px}
.contagem{display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px}
.contagem div{border:1px solid var(--rule);border-radius:3px;padding:9px 14px;background:#fff;min-width:96px}
.contagem b{display:block;font-size:1.5rem;line-height:1.1;font-variant-numeric:tabular-nums}
.contagem span{font-size:.68rem;letter-spacing:.09em;text-transform:uppercase;color:var(--soft)}
.contagem .c b{color:var(--crit)} .contagem .a b{color:#C4761E}
.contagem .m b{color:var(--warn)} .contagem .n b{color:var(--soft)}
@media (prefers-color-scheme:dark){
 :root{--paper:#0A0C1A;--card:#121631;--text:#D5DAEC;--soft:#939ABE;--rule:#272D51;--navy:#C9D0F0;
       --okbg:#0F2A1D;--warnbg:#241F10;--critbg:#2A1616}
 header{background:#05071A}
 input[type=text],textarea{background:#0D1128;border-color:#272D51;color:#D5DAEC}
 .cand{background:#121631}.cand.sel{background:#1B1B33}
 .q.duvida{background:#1B1A10}
 .ev,.sinal .dado{background:#0D1128}
 textarea.pend{background:#2A1616;border-color:#5C2D2D}
 .pill{background:#1B2143}
 .contagem div,.sinal,details{background:#121631}
}
</style></head><body>

<header>
  <h1>Motor de Réplicas · Consignado INSS</h1>
  <span class="sub">Caderno de Réplicas, 2ª edição · fechamento normativo 17/08/2026</span>
  <span class="tag" id="tagLocal">processamento local</span>
</header>

<div class="steps" role="tablist">
  <button id="t1" aria-selected="true" onclick="ir(1)">1 · Autos</button>
  <button id="t2" aria-selected="false" onclick="ir(2)">2 · Achados</button>
  <button id="t3" aria-selected="false" onclick="ir(3)">3 · Diagnóstico</button>
  <button id="t4" aria-selected="false" onclick="ir(4)">4 · Cenário</button>
  <button id="t5" aria-selected="false" onclick="ir(5)">5 · Dados</button>
  <button id="t6" aria-selected="false" onclick="ir(6)">6 · Peça</button>
  <button id="t7" aria-selected="false" onclick="ir(7)">7 · Conferência</button>
</div>

<main>
  <section id="p1"></section>
  <section id="p2" hidden></section>
  <section id="p3" hidden></section>
  <section id="p4" hidden></section>
  <section id="p5" hidden></section>
  <section id="p6" hidden></section>
  <section id="p7" hidden></section>
</main>

<script>
let D=null, LE=null, respostas={}, escolhido=null, transplante=null, pars=[], dados={};
let preliminares=new Set(["III.1","III.2","III.3","III.4","III.5"]);
const NP=7;

fetch('/api/dados').then(r=>r.json()).then(d=>{
  D=d; render1();
  document.getElementById('tagLocal').textContent =
    d.timbrado ? ('timbrado: '+d.timbrado) : 'sem timbrado';
});

function ir(n){
  for(let i=1;i<=NP;i++){
    document.getElementById('p'+i).hidden=(i!==n);
    document.getElementById('t'+i).setAttribute('aria-selected', i===n?'true':'false');
  }
  window.scrollTo(0,0);
}
function esc(s){return (s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));}

/* ---------- 1 · autos ---------- */
function render1(){
  document.getElementById('p1').innerHTML=`
   <div class="card"><h2>Pasta dos autos</h2>
    <p class="hint">Aponte a pasta com <b>a petição inicial, a contestação e todos os documentos juntados pelos dois lados</b>. A inicial é necessária: é contra ela que a defesa é cotejada. O programa lê PDF, imagem e texto, não escreve nada dentro dessa pasta, e nenhum arquivo sai desta máquina.</p>
    <div style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
      <div style="flex:1;min-width:320px">
        <label class="f" for="pasta">Caminho da pasta</label>
        <input type="text" id="pasta" placeholder="~/Documents/Processos/0801234-56.2026.8.18.0065"
          onkeydown="if(event.key==='Enter')lerAutos()">
      </div>
      <button class="go" onclick="lerAutos()">Ler os autos</button>
    </div>
    <label style="display:block;margin-top:12px;font-size:.85rem">
      <input type="checkbox" id="ocr" checked> Usar reconhecimento óptico nas páginas sem texto (mais lento)
    </label>
    <div id="statusLeitura"></div>
   </div>
   <div class="card"><h2>O que este passo faz</h2>
    <p class="hint">Para que fique claro antes de você confiar no resultado.</p>
    <table>
     <tr><th>Etapa</th><th>Método</th></tr>
     <tr><td>Extração do texto</td><td>Camada de texto do PDF; onde não houver, reconhecimento óptico. A ausência de camada de texto é registrada como achado.</td></tr>
     <tr><td>Classificação</td><td>Pontuação por termos característicos de cada tipo documental, com o nome do arquivo como desempate.</td></tr>
     <tr><td>Cotejo entre as peças</td><td>Pedidos da inicial contra o que a defesa enfrentou, admissões da ré, contrato diverso do discutido, trecho de outro processo, lacunas documentais dos dois lados e providências processuais pendentes.</td></tr>
     <tr><td>Diagnóstico</td><td>Expressões regulares sobre o texto extraído, respondendo as doze perguntas dos Blocos 1 e 2 do caderno.</td></tr>
     <tr><td>Bateria forense</td><td>Metadados, cronologia interna do arquivo, assinatura criptográfica, recálculo de taxa e cruzamentos entre documentos.</td></tr>
     <tr><td>Onde a máquina não conclui</td><td>A resposta volta como pergunta, marcada em amarelo, com o motivo. Confiança baixa nunca vira resposta automática.</td></tr>
    </table>
   </div>`;
}

function lerAutos(){
  const pasta=document.getElementById('pasta').value.trim();
  const ocr=document.getElementById('ocr').checked;
  if(!pasta){alert('Informe o caminho da pasta.');return;}
  const st=document.getElementById('statusLeitura');
  st.innerHTML='<div class="aviso">Lendo os arquivos. Páginas sem texto passam por reconhecimento óptico e isso demora.</div>';
  fetch('/api/ler',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({pasta,ocr})}).then(r=>r.json()).then(d=>{
      if(d.erro){st.innerHTML=`<div class="erro">${esc(d.erro)}</div>`;return;}
      LE=d;
      Object.keys(d.achados).forEach(k=>{
        const a=d.achados[k];
        if(a.valor && a.valor!=='na' && a.confianca!=='baixa') respostas[k]=a.valor;
      });
      preliminares=new Set(d.preliminares.map(p=>p.cod));
      const m={processo:'processo',vara:'vara',comarca:'comarca'};
      Object.keys(m).forEach(k=>{ if(d.dados[k]) dados[k]=d.dados[k]; });
      Object.keys(d.dados).forEach(k=>{ if(!(k in dados)) dados[k]=d.dados[k]; });
      st.innerHTML=`<div class="res">Foram lidos ${d.documentos.length} arquivo(s). ${d.sinais.length} achado(s) na bateria forense.</div>`;
      render2(); render3(); ir(2);
    });
}

/* ---------- 2 · achados forenses ---------- */
function render2(){
  if(!LE){document.getElementById('p2').innerHTML='<div class="card"><p class="hint">Leia os autos primeiro.</p></div>';return;}
  const r=LE.resumo;
  const docs=LE.documentos.map(d=>`<tr><td><b>${esc(d.nome)}</b></td><td>${esc(d.tipo)}</td>
    <td>${d.paginas}</td><td>${d.ocr?d.ocr+' por OCR':'texto'}${d.sem_texto?', '+d.sem_texto+' sem texto':''}</td>
    <td style="font-family:ui-monospace,Menlo,monospace;font-size:.72rem">${esc(d.sha256)}</td></tr>`).join('');
  const cartao=s=>`
    <div class="sinal ${s.gravidade}">
      <h3><span class="cod">${esc(s.codigo)}</span> ${esc(s.titulo)}
        <span class="pill ${s.gravidade==='critico'?'crit':(s.gravidade==='nota'?'':'base')}">${esc(s.gravidade)}</span></h3>
      <p>${esc(s.detalhe)}</p>
      ${s.arquivo?`<p class="mini">em ${esc(s.arquivo)}</p>`:''}
      ${s.dado?`<div class="dado">${esc(s.dado)}</div>`:''}
      ${s.pedido?`<div class="pedir">A requerer: ${esc(s.pedido)}</div>`:''}
    </div>`;
  const eProc=s=>/^(PRO|DOC|MAR)/.test(s.codigo);
  const proc=LE.sinais.filter(eProc).map(cartao).join('');
  const arq=LE.sinais.filter(s=>!eProc(s)).map(cartao).join('');
  const avisos=LE.avisos.map(a=>`<div class="aviso">${esc(a)}</div>`).join('');

  document.getElementById('p2').innerHTML=`
    <div class="contagem">
      <div class="c"><b>${r.critico}</b><span>críticos</span></div>
      <div class="a"><b>${r.alto}</b><span>altos</span></div>
      <div class="m"><b>${r.medio}</b><span>médios</span></div>
      <div class="n"><b>${r.nota}</b><span>notas</span></div>
    </div>
    ${avisos}
    <div class="card"><h2>Documentos examinados</h2>
      <p class="hint">Classificação e resumo criptográfico de cada arquivo, no estado em que foi entregue.</p>
      <table><tr><th>Arquivo</th><th>Tipo</th><th>Págs</th><th>Leitura</th><th>SHA-256</th></tr>${docs}</table></div>
    <div class="card"><h2>Processo e cotejo entre as peças</h2>
      <p class="hint">Inicial contra contestação: pedido sem resposta, fato admitido pela ré, contrato diverso do discutido, trecho vindo de outro processo, documento essencial ausente e providência pendente. Onde o ônus é da autora, o texto diz.</p>
      ${proc||'<p class="hint">Nada a registrar no cotejo entre as peças.</p>'}</div>
    <div class="card"><h2>Arquivos juntados</h2>
      <p class="hint">O que não se vê lendo: metadados, cronologia interna, assinatura criptográfica, recálculo de taxa e cruzamentos. Nenhum achado afirma fraude: apontam o que falta, o que não fecha e o que exigir da ré.</p>
      ${arq||'<p class="hint">Nenhum achado sobre os arquivos.</p>'}</div>
    <div class="card"><button class="go" onclick="ir(3)">Conferir o diagnóstico</button>
      <button class="go alt" onclick="relatorio()">Gerar o relatório de achados em DOCX</button>
      <div id="resRel"></div></div>`;
}

function relatorio(){
  fetch('/api/relatorio',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({dados})}).then(r=>r.json()).then(d=>{
      document.getElementById('resRel').innerHTML = d.erro
        ? `<div class="erro">${esc(d.erro)}</div>`
        : `<div class="res">Relatório gravado em <code>${esc(d.caminho)}</code>. É documento de trabalho interno: não vai aos autos.</div>`;
    });
}

/* ---------- 3 · diagnóstico conferido ---------- */
function render3(){
  const bloco=n=>D.perguntas.filter(q=>q.bloco===n).map(q=>{
    const a=(LE&&LE.achados[q.id])||null;
    const auto=a&&a.valor&&a.confianca!=='baixa';
    const cls=auto?'q auto':(a?'q duvida':'q');
    const ev=(a&&a.evidencias&&a.evidencias.length)
      ? a.evidencias.slice(0,2).map(e=>`<div class="ev"><b>${esc(e.arquivo)}</b>, p. ${e.pagina}${e.fonte==='ocr'?' (lida por OCR)':''}
          <span class="tr">${esc(e.trecho)}</span></div>`).join('') : '';
    const nota=a?`<div class="mini">${auto?'lido dos autos':'precisa da sua resposta'} · confiança ${esc(a.confianca)} · ${esc(a.nota)}</div>`:'';
    return `<div class="${cls}"><div class="lbl">${esc(q.p)}</div>${nota}`+
      q.op.map(o=>`<label><input type="radio" name="${q.id}" value="${o[0]}"
        ${respostas[q.id]===o[0]?'checked':''}
        onchange="respostas['${q.id}']=this.value">${esc(o[1])}</label>`).join('')+
      ev+`</div>`;
  }).join('');

  const pend=D.perguntas.filter(q=>!respostas[q.id]).length;
  document.getElementById('p3').innerHTML=`
   ${pend?`<div class="aviso">${pend} pergunta(s) a máquina não conseguiu responder com segurança. Estão em amarelo, com o motivo. Responda olhando o documento.</div>`
        :'<div class="res">Todas as doze perguntas foram respondidas a partir dos autos. Confira antes de seguir: a leitura acerta o que está escrito, não o que está implícito.</div>'}
   <div class="card"><h2>Bloco 1 · Verificação do contrato</h2>
    <p class="hint">Contrato primeiro, repasse depois. O contrato responde se houve vínculo e vontade.</p>
    <div class="grid">${bloco(1)}</div></div>
   <div class="card"><h2>Bloco 2 · Verificação do repasse</h2>
    <p class="hint">Transferência eletrônica não é imagem: é evento sistêmico, com trilha de emissão, liquidação e crédito.</p>
    <div class="grid">${bloco(2)}</div></div>
   <div class="card"><button class="go" onclick="diagnosticar()">Aplicar a matriz de decisão</button></div>`;
}

function diagnosticar(){
  fetch('/api/diagnostico',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({respostas})}).then(r=>r.json()).then(d=>{render4(d);ir(4);});
}

/* ---------- 4 · cenário ---------- */
function render4(d){
  const cs=d.candidatos;
  if(cs.length && !escolhido) escolhido=cs[0].letra;
  const lista=cs.length? cs.map((c,i)=>{
    const r=D.replicas[c.letra];
    return `<div class="cand ${c.letra===escolhido?'sel':''}" id="c_${c.letra}" onclick="pick('${c.letra}')">
      <span class="let">${c.letra}</span>
      <span style="flex:1"><span class="tt">${esc(r.titulo)}</span><br>
      <span class="mv">${esc(c.motivo)}</span></span>
      ${i===0?'<span class="pill base">peça base</span>':'<span class="pill">transplantável</span>'}
      ${(c.reforcos||[]).length?`<div class="ev" style="flex-basis:100%">subiu por achado da bateria: ${c.reforcos.map(x=>esc(x.codigo)+', '+esc(x.achado||x.motivo)).join('; ')}</div>`:''}</div>`;
  }).join('') : '<p class="hint">Nenhum cenário casou com as respostas. Escolha na matriz abaixo.</p>';

  const avisos=d.avisos.map(a=>`<div class="aviso">${esc(a)}</div>`).join('');
  const bl=(cs[0]&&cs[0].bloqueados)||[];
  const blHtml = bl.length ? `<div class="card"><h2>Cenários retirados da mesa</h2>
    <p class="hint">A contratação foi reconhecida como eletrônica e não há registro de assinatura a rogo em documento algum dos autos. Contrato eletrônico não tem rogo nem testemunha instrumentária: sustentar o art. 595 do Código Civil aqui é erro de categoria. Se houver instrumento em papel que a leitura não viu, junte-o à pasta e leia de novo.</p>
    ${bl.map(b=>`<div class="sinal medio"><h3><span class="cod">${esc(b.letra)}</span> retirado</h3><p>${esc(b.motivo)}</p></div>`).join('')}</div>` : '';
  const misto = cs.length>1 ? `<div class="card"><h2>Caso misto</h2>
    <p class="hint">O caderno orienta a usar a réplica do defeito mais grave como base e transplantar o capítulo de ataque do outro.</p>
    <select id="tp" onchange="transplante=this.value||null" style="padding:7px;font:inherit">
      <option value="">Sem transplante</option>
      ${cs.slice(1).map(c=>`<option value="${c.letra}">${c.letra} · ${esc(D.replicas[c.letra].titulo)}</option>`).join('')}
    </select></div>`:'';

  document.getElementById('p4').innerHTML=`
    ${avisos}
    <div class="card"><h2>Cenários que casam com o diagnóstico</h2>
      <p class="hint">Ordenados por gravidade do defeito, já com o peso dos achados da bateria forense. Clique para trocar a peça base.</p>${lista}</div>
    ${blHtml}
    ${misto}
    <div class="card"><h2>Matriz de decisão do caderno</h2>
      <table><tr><th>O que a instituição juntou</th><th>Réplica</th><th>Âncora principal</th></tr>
      ${D.matriz.map(m=>`<tr><td>${esc(m.documento)}</td><td class="l"><a href="#" onclick="pick('${m.replica}');return false">${m.replica}</a></td><td>${esc(m.ancora)}</td></tr>`).join('')}
      </table></div>
    <div class="card" id="estudo"></div>
    <div class="card"><button class="go" onclick="ir(5)">Continuar para os dados</button></div>`;
  mostrarEstudo();
}
function pick(l){
  escolhido=l;
  document.querySelectorAll('.cand').forEach(e=>e.classList.remove('sel'));
  const el=document.getElementById('c_'+l); if(el) el.classList.add('sel');
  mostrarEstudo();
}
function mostrarEstudo(){
  const e=document.getElementById('estudo'); if(!e||!escolhido) return;
  const est=D.estudos[escolhido]||[];
  e.innerHTML=`<h2>Estudo do cenário ${escolhido}</h2>
    <p class="hint">Orientação de trabalho. Não entra na peça.</p>
    <div class="body">${est.map(p=>p.b?`<p><b>${esc(p.t)}</b></p>`:`<p>${esc(p.t)}</p>`).join('')}</div>`;
}

/* ---------- 5 · dados ---------- */
function render5(){
  const f=[['processo','Número do processo'],['autor','Nome da autora'],
    ['re','Nome da instituição ré'],['vara','Vara'],['comarca','Comarca'],['uf','UF'],
    ['advogado','Advogado subscritor'],['oab','Número da OAB'],
    ['cidade','Cidade da assinatura'],['data','Data']];
  const extra=[['contrato_n','Número do contrato'],['beneficio','Número do benefício'],
    ['valor_liberado','Valor liberado'],['valor_parcela','Valor da parcela'],
    ['parcelas','Quantidade de parcelas'],['valor_transferido','Valor transferido'],
    ['data_transferencia','Data da transferência'],
    ['fls_contrato','Folhas do contrato'],['fls_comprovante','Folhas do comprovante']];
  const campo=([k,l])=>`<div><label class="f" for="f_${k}">${l}</label>
      <input type="text" id="f_${k}" value="${esc(dados[k]||(k==='data'?D.hoje:''))}"
        oninput="dados['${k}']=this.value"></div>`;
  const lidos=extra.filter(([k])=>dados[k]).length;

  document.getElementById('p5').innerHTML=`
   <div class="card"><h2>Dados do processo</h2>
    <p class="hint">O que a máquina leu da contestação já vem preenchido. Confira: número de processo lido por OCR erra dígito.</p>
    <div class="fields">${f.map(campo).join('')}</div></div>
   <div class="card"><h2>Dados que a peça usa no texto</h2>
    <p class="hint">${lidos} campo(s) vieram dos documentos. São aplicados nos pontos certos da peça, pelo texto que antecede cada colchete.</p>
    <div class="fields">${extra.map(campo).join('')}</div></div>
   <div class="card"><h2>Preliminares efetivamente arguidas</h2>
    <p class="hint">${LE&&LE.preliminares.length?'Marcadas conforme o que foi localizado na contestação. Confira o trecho ao lado de cada uma.':'Nenhuma contestação foi lida: marque manualmente.'}</p>
    <div class="chk">
     ${[['III.1','Falta de interesse de agir'],['III.2','Inépcia da petição inicial'],
        ['III.3','Impugnação à gratuidade da justiça'],['III.4','Litigância predatória'],
        ['III.5','Prejudicial de prescrição']].map(([k,l])=>{
       const p=LE?LE.preliminares.find(x=>x.cod===k):null;
       return `<label><input type="checkbox" ${preliminares.has(k)?'checked':''}
         onchange="this.checked?preliminares.add('${k}'):preliminares.delete('${k}')">${k} · ${l}</label>`+
         (p?`<div class="ev"><b>${esc(p.evidencia.arquivo)}</b>, p. ${p.evidencia.pagina}
             <span class="tr">${esc(p.evidencia.trecho)}</span></div>`:'');
     }).join('')}
    </div></div>
   <div class="card"><button class="go" onclick="montar()">Montar a peça</button></div>`;
  if(!dados.data) dados.data=D.hoje;
}

function montar(){
  fetch('/api/montar',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({letra:escolhido,dados,preliminares:[...preliminares],transplante,
     conformidade:(LE&&LE.conformidade69)||[]})})
   .then(r=>r.json()).then(d=>{
     if(d.bloqueado){
       alert('Montagem bloqueada:\n\n'+d.motivos.map(m=>'• '+m).join('\n')+
             '\n\nJunte as peças que faltam à pasta e leia os autos de novo.');
       return;
     }
     pars=d.paragrafos;render6();ir(6);});
}

/* ---------- 6 · peça ---------- */
function render6(){
  const corpo=pars.map((p,i)=>{
    if(p.tipo==='capitulo'||p.tipo==='rotulo')
      return `<div class="par"><div class="cap">${esc(p.t)}</div></div>`;
    const pend=/\[[^\]]{1,90}\]/.test(p.t);
    return `<div class="par">${pend?'<div class="mini">campo pendente</div>':''}
      <textarea id="tx_${i}" rows="1" class="${pend?'pend':''}"
        oninput="edit(${i},this)">${esc(p.t)}</textarea></div>`;
  }).join('');
  document.getElementById('p6').innerHTML=`
    <div class="bar">
      <span class="st">Cenário <b>${escolhido}</b> · ${esc(D.replicas[escolhido].titulo)}</span>
      <span class="st">Pendências: <b id="np">0</b></span>
      <button class="go alt" onclick="proxima()">Próxima pendência</button>
      <button class="go alt" onclick="massa()">Substituir em massa</button>
      <button class="go" onclick="ir(7)">Conferência final</button>
    </div>
    <div class="card">${corpo}</div>`;
  document.querySelectorAll('#p6 textarea').forEach(t=>auto(t));
  conta();
}
function auto(t){t.style.height='auto';t.style.height=(t.scrollHeight+2)+'px';}
function edit(i,el){pars[i].t=el.value;auto(el);
  el.classList.toggle('pend',/\[[^\]]{1,90}\]/.test(el.value));conta();}
function conta(){
  const n=pars.reduce((a,p)=>a+((p.t.match(/\[[^\]]{1,90}\]/g)||[]).length),0);
  const e=document.getElementById('np'); if(e) e.textContent=n;
  return n;
}
let ult=-1;
function proxima(){
  for(let k=1;k<=pars.length;k++){
    const i=(ult+k)%pars.length;
    if(/\[[^\]]{1,90}\]/.test(pars[i].t)){
      const el=document.getElementById('tx_'+i);
      if(el){el.scrollIntoView({block:'center'});el.focus();
        const m=el.value.search(/\[[^\]]{1,90}\]/);
        el.setSelectionRange(m,m+el.value.slice(m).indexOf(']')+1);}
      ult=i;return;
    }
  }
  alert('Nenhum campo pendente.');
}
function massa(){
  const alvo=prompt('Substituir qual marcador? Ex.: [valor], [número], [__]');
  if(!alvo) return;
  const val=prompt('Substituir '+alvo+' por:');
  if(val===null) return;
  pars.forEach(p=>{p.t=p.t.split(alvo).join(val);});
  render6();
}

/* ---------- 7 · conferência ---------- */
function render7(){
  const chk=(D.checklist||[]).map(p=>p.b?`<p><b>${esc(p.t)}</b></p>`:`<p>▫ ${esc(p.t)}</p>`).join('');
  const alr=(D.alertas||[]).map(p=>p.b?`<p><b>${esc(p.t)}</b></p>`:`<p>${esc(p.t)}</p>`).join('');
  const n=conta();
  const criticos=LE?LE.sinais.filter(s=>s.gravidade==='critico'):[];
  document.getElementById('p7').innerHTML=`
   ${criticos.length?`<div class="aviso"><b>${criticos.length} achado(s) crítico(s)</b> na leitura dos autos. Confira se cada um foi aproveitado na impugnação especificada e nos pedidos de exibição: ${esc(criticos.map(s=>s.titulo).join('; '))}.</div>`:''}
   <div class="card"><h2>Antes de assinar</h2>
    <p class="hint">${n?`Ainda há <b>${n}</b> campo(s) entre colchetes na peça.`:'Nenhum campo entre colchetes restante.'}</p>
    <button class="go" onclick="gerar()">Gerar a réplica em DOCX</button>
    <button class="go alt" onclick="relatorio2()">Gerar o relatório de achados</button>
    <div id="res"></div><div id="resRel2"></div></div>
   <details open><summary>Checklist de conferência antes do protocolo</summary><div class="body">${chk}</div></details>
   <details><summary>Alertas de conjuntura</summary><div class="body">${alr}</div></details>
   <details><summary>Quadro de conferência normativa</summary><div class="body">
     <table><tr><th>Norma</th><th>Situação</th><th>Observação</th></tr>
     ${D.normas.map(x=>`<tr><td>${esc(x.norma)}</td><td>${esc(x.situacao)}</td><td>${esc(x.obs)}</td></tr>`).join('')}
     </table></div></details>`;
}
function relatorio2(){
  fetch('/api/relatorio',{method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify({dados})}).then(r=>r.json()).then(d=>{
      document.getElementById('resRel2').innerHTML = d.erro
        ? `<div class="erro">${esc(d.erro)}</div>`
        : `<div class="res">Relatório gravado em <code>${esc(d.caminho)}</code>.</div>`;
    });
}
function gerar(){
  fetch('/api/gerar',{method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({letra:escolhido,dados,paragrafos:pars})})
   .then(r=>r.json()).then(d=>{
     const el=document.getElementById('res');
     if(d.erro){el.innerHTML=`<div class="erro">${esc(d.erro)}</div>`;return;}
     el.innerHTML=`<div class="res">Peça gravada em <code>${esc(d.caminho)}</code>.<br>
       ${d.timbrado?'Montada sobre o papel timbrado do escritório.':'Documento limpo, sem timbrado: coloque o .docx do timbrado na subpasta <code>timbrado</code> e gere de novo.'}
       ${d.pendencias?`<br><b>Atenção: ${d.pendencias} campo(s) entre colchetes foram para o documento.</b>`:''}</div>`;
   });
}

const _ir=ir;
ir=function(n){ if(n===3) render3(); if(n===5) render5(); if(n===7) render7(); _ir(n); };
</script></body></html>
"""


FERRAMENTAS = [
    ("pdftotext", "leitura do texto dos PDFs", True,
     "brew install poppler"),
    ("pdfinfo", "metadados e datas internas dos arquivos", True,
     "brew install poppler"),
    ("pdfimages", "exame das camadas de imagem", False, "brew install poppler"),
    ("pdffonts", "exame das fontes embutidas", False, "brew install poppler"),
    ("pdftoppm", "conversão de página para imagem, antes do OCR", False,
     "brew install poppler"),
    ("tesseract", "reconhecimento óptico das páginas sem texto", False,
     "brew install tesseract tesseract-lang"),
]


def verificar_ambiente():
    """Diz o que está instalado e o que falta, antes de o programa ser usado."""
    faltando = []
    print("Ambiente:")
    try:
        import docx  # noqa: F401
        print("  ok      python-docx, geração dos documentos")
    except ImportError:
        print("  FALTA   python-docx, geração dos documentos")
        print("          instale com:  pip3 install python-docx")
        faltando.append(("python-docx", True))
    for prog, para_que, essencial, como in FERRAMENTAS:
        if leitor.existe(prog):
            print("  ok      %s, %s" % (prog, para_que))
        else:
            print("  %s   %s, %s" % ("FALTA " if essencial else "opcional", prog, para_que))
            print("          instale com:  %s" % como)
            faltando.append((prog, essencial))
    if any(e for _, e in faltando):
        print()
        print("  Sem os itens marcados FALTA a leitura dos autos não funciona.")
        print("  A montagem da peça a partir do caderno continua funcionando.")
    print()


def main():
    if not os.path.exists(CADERNO):
        sys.exit("caderno.json não encontrado ao lado do programa.")
    verificar_ambiente()
    srv = HTTPServer(("127.0.0.1", PORTA), App)
    url = "http://127.0.0.1:%d/" % PORTA
    print("Motor de Réplicas rodando em", url)
    print("Timbrado:", os.path.basename(achar_timbrado() or "nenhum encontrado"))
    print("Peças geradas vão para:", PASTA_SAIDA)
    print("Para encerrar: Ctrl+C")
    threading.Timer(1.0, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print("\nEncerrado.")


if __name__ == "__main__":
    main()
