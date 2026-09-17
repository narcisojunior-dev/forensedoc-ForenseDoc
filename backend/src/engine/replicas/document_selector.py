#!/usr/bin/env python3
"""Seleção determinística do instrumento bancário discutido nos autos.

Este módulo faz parte do fluxo de produção do Motor de Réplicas e também é
consumido pela validação em lote. A regra central é conservadora: uma peça
judicial nunca é recuperada por pontuação e a ausência de candidato elegível é
um resultado válido.
"""

from __future__ import annotations

import re
import unicodedata


CNJ = re.compile(r"\b\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}\b")
CPF = re.compile(r"\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b")
CONTRACT_NUMBER = re.compile(
    r"(?:contrato|ccb|proposta)\s*(?:n[ºo°.]*)?\s*[:#-]?\s*([A-Z0-9][A-Z0-9./-]{4,30})",
    re.I,
)

JUDICIAL_TYPES = {
    "inicial", "contestacao", "replica", "jurisprudencia", "decisao",
    "sentenca", "acordao", "despacho",
}

ADDRESSING = re.compile(
    r"\b(?:AO\s+JU[IÍ]ZO|AO\s+DOUTO|EXCELENT[IÍ]SSIMO|MM\.?\s*JU[IÍ]ZO|"
    r"AO\s+JUIZO\s+DE\s+DIREITO|EGR[EÉ]GIO|COLENDA)\b",
    re.I,
)
LAWYER_SIGNATURE = re.compile(
    r"assinado\s+eletronicamente\s+por\s*:?[^\n]{0,180}(?:\n[^\n]{0,180})?\bOAB\b",
    re.I,
)
COURT_HEADER = re.compile(
    r"\b(?:TRIBUNAL\s+DE\s+JUSTI[CÇ]A|C[AÂ]MARA\s+ESPECIALIZADA|"
    r"APELA[CÇ][AÃ]O\s+C[IÍ]VEL|AC[ÓO]RD[AÃ]O|DESEMBARGADOR(?:A)?|RELATOR(?:A)?)\b",
    re.I,
)
PJE_COVER = (
    re.compile(r"PJe\s*-\s*Processo\s+Judicial\s+Eletr[oô]nico", re.I),
    re.compile(r"\bClasse\s*:", re.I),
    re.compile(r"[ÓO]rg[aã]o\s+julgador\s*:", re.I),
)
ELECTRONIC_CONTRACT = re.compile(
    r"contrata[cç][aã]o\s+(?:por\s+)?aplicativo|assinatura\s+(?:eletr[oô]nica|digital)|"
    r"biometria(?:\s+facial)?|selfie|token\s+(?:sms|de\s+seguran[cç]a)|"
    r"trilha\s+de\s+auditoria|rastreabilidade\s+de\s+acesso|endere[cç]o\s+ip",
    re.I,
)

PJE_FOOTER_PATTERNS = (
    re.compile(r"^Este documento foi gerado pelo usu[aá]rio\s+\S+(?:\s+\S+)*\s+em\s+\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}$", re.I),
    re.compile(r"^N[uú]mero do documento:\s*\d{20,}$", re.I),
    re.compile(r"^https://pje\.[^\s]+$", re.I),
    re.compile(r"^Assinado eletronicamente por:\s*.+\s+-\s+\d{2}/\d{2}/\d{4}\s+\d{2}:\d{2}:\d{2}$", re.I),
    re.compile(r"^Num\.\s*\d+\s*-\s*P[áa]g\.\s*\d+$", re.I),
)

POSITIVE_SIGNALS = (
    ("DOSSIER", "Dossiê Comprobatório", 10, re.compile(r"dossi[eê]\s+comprobat[oó]rio", re.I)),
    ("PROCESS_UUID", "Identificador de processo com UUID", 10, re.compile(
        r"identificador\s+processo[^\n]{0,80}\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b",
        re.I,
    )),
    ("DECLARED_HASH", "Resumo criptográfico declarado", 9, re.compile(
        r"(?:resumo\(?s?\)?\s+acordo|hash\s+do\s+documento|sha-?256)[^\n]{0,120}\b[0-9a-f]{64}\b",
        re.I,
    )),
    ("CCB", "Cédula de Crédito Bancário", 8, re.compile(
        r"c[eé]dula\s+de\s+cr[eé]dito\s+banc[aá]rio|\bCCB\s*(?:n[ºo°.]*)?\s*[:#-]?\s*[A-Z0-9]",
        re.I,
    )),
    ("AUDIT_TRAIL", "Trilha nativa de auditoria", 8, re.compile(
        r"rastreabilidade\s+de\s+acesso|trilha\s+de\s+auditoria[\s\S]{0,500}\d{2}[/.-]\d{2}[/.-]\d{4}[^\n]{0,80}\d{1,2}:\d{2}",
        re.I,
    )),
    ("UTC_SEND", "Data e hora de envio UTC", 7, re.compile(r"data\s+e\s+hora\s+de\s+envio\s*\(UTC\)", re.I)),
    ("CET", "Planilha CET ou simulação de crédito", 5, re.compile(r"planilha\s+CET|simula[cç][aã]o\s+de\s+cr[eé]dito", re.I)),
    ("GENERIC_TERMS", "Regulamento ou condições gerais", 3, re.compile(r"regulamento\s+do\s+cart[aã]o|condi[cç][oõ]es\s+gerais", re.I)),
)


def _plain(value):
    return "".join(
        char for char in unicodedata.normalize("NFKD", str(value or ""))
        if not unicodedata.combining(char)
    ).lower()


def _digits(value):
    return re.sub(r"\D", "", str(value or ""))


def strip_pje_footer(value):
    """Remove somente linhas integrais de rodapé e devolve o material retirado."""
    text = str(value or "")
    kept, removed = [], []
    for line in text.splitlines():
        trimmed = line.strip()
        if trimmed and any(pattern.fullmatch(trimmed) for pattern in PJE_FOOTER_PATTERNS):
            removed.append(trimmed)
        else:
            kept.append(line)
    return {"text": "\n".join(kept), "removed": removed}


def positive_signals(text):
    """Devolve os sinais positivos únicos e a pontuação total."""
    found = []
    for code, label, weight, pattern in POSITIVE_SIGNALS:
        if pattern.search(text or ""):
            found.append({"code": code, "label": label, "weight": weight})
    return found


def hard_exclusions(document, case_number=None, known_judicial_ids=None):
    """Aplica as exclusões que não podem ser compensadas por pontuação."""
    text = str(document.get("text") or "")
    first = text[:1600]
    first_pages = text[:14000]
    doc_id = str(document.get("id") or "")
    predicted = str(document.get("predictedType") or "").lower()
    known = {str(item) for item in (known_judicial_ids or [])}
    exclusions = []

    def add(code, reason):
        if not any(item["code"] == code for item in exclusions):
            exclusions.append({"code": code, "reason": reason})

    if doc_id in known or predicted in JUDICIAL_TYPES:
        add("KNOWN_JUDICIAL_DOCUMENT", "Documento já reconhecido como peça judicial.")
    if ADDRESSING.search(first):
        add("JUDICIAL_ADDRESSING", "Endereçamento judicial localizado no início do documento.")
    if LAWYER_SIGNATURE.search(text):
        add("LAWYER_SIGNATURE", "Assinatura eletrônica vinculada a inscrição na OAB.")
    if COURT_HEADER.search(first_pages):
        add("COURT_HEADER", "Cabeçalho, órgão ou autoridade judicial localizado.")
    if all(pattern.search(first_pages) for pattern in PJE_COVER):
        add("PJE_COVER", "Capa de autuação do PJe.")

    current = _digits(case_number)
    foreign = []
    for found in CNJ.findall(first_pages):
        found_digits = _digits(found)
        if current and not found_digits.startswith(current) and not current.startswith(found_digits):
            foreign.append(found)
    if foreign:
        add("FOREIGN_CASE_NUMBER", "Número CNJ diverso nas primeiras páginas: %s." % foreign[0])
    return exclusions


def case_links(text, context=None):
    """Registra vínculos materiais entre o documento e o caso concreto."""
    context = context or {}
    plain_text = _plain(text)
    digit_text = _digits(text)
    links = []

    for cpf in context.get("partyCpfs", []) or []:
        digits = _digits(cpf)
        if len(digits) == 11 and digits in digit_text:
            links.append({"type": "cpf", "value": cpf})
    for number in context.get("contractNumbers", []) or []:
        digits = _digits(number)
        if len(digits) >= 5 and digits in digit_text:
            links.append({"type": "contract", "value": number})
    for name in context.get("partyNames", []) or []:
        normalized = _plain(name).strip()
        if len(normalized) >= 8 and normalized in plain_text:
            links.append({"type": "partyName", "value": name})

    unique = []
    seen = set()
    for link in links:
        key = (link["type"], _plain(link["value"]))
        if key not in seen:
            seen.add(key)
            unique.append(link)
    return unique


def _valid_party_name(value):
    name = re.sub(r"\s+", " ", str(value or "")).strip(" .,:;-\n\t")
    if len(name) < 8 or len(name.split()) < 2 or re.search(r"\d", name):
        return None
    if re.search(r"\d{2}/\d{2}/\d{4}|\d{1,2}:\d{2}", name):
        return None
    if re.search(r"assinado\s+eletronicamente|\bOAB\b", name, re.I):
        return None
    return name


def derive_case_context(documents, case_number=None, dados=None):
    """Extrai somente identificadores estáveis de peças do próprio processo."""
    judicial_texts = [
        str(item.get("text") or "") for item in documents
        if str(item.get("predictedType") or "").lower() in {"inicial", "hiscre", "contestacao"}
    ]
    joined = "\n".join(judicial_texts)
    cnjs = CNJ.findall(joined)
    partial_case = _digits(case_number)
    resolved_case = next((value for value in cnjs if _digits(value).startswith(partial_case)), case_number)
    cpfs = sorted(set(CPF.findall(joined)))
    contracts = sorted(set(
        value for match in CONTRACT_NUMBER.finditer(joined)
        if (value := match.group(1).rstrip(".,;"))
        and not re.fullmatch(r"\d{1,2}/\d{1,2}/\d{2,4}", value)
        and not CNJ.fullmatch(value)
    ))
    dados = dados or {}
    plaintiff = _valid_party_name(dados.get("autor"))
    counterparty = _valid_party_name(dados.get("re"))
    return {
        "caseNumber": resolved_case,
        "partyCpfs": cpfs,
        "contractNumbers": contracts,
        "partyNames": [plaintiff] if plaintiff else [],
        "counterpartyNames": [counterparty] if counterparty else [],
    }


def evaluate_document(document, context=None, known_judicial_ids=None):
    context = context or {}
    text = str(document.get("text") or "")
    exclusions = hard_exclusions(
        document,
        case_number=context.get("caseNumber"),
        known_judicial_ids=known_judicial_ids,
    )
    signals = positive_signals(text)
    links = case_links(text, context)
    score = sum(item["weight"] for item in signals)
    if links:
        score += 4
    elif any(context.get(key) for key in ("partyCpfs", "contractNumbers", "partyNames")):
        score -= 2
    return {
        "id": str(document.get("id") or ""),
        "path": document.get("path"),
        "predictedType": document.get("predictedType") or "indefinido",
        "pages": int(document.get("pages") or 0),
        "eligible": not exclusions and bool(signals) and score > 0,
        "score": score,
        "positiveSignals": signals,
        "caseLinks": links,
        "linkStatus": "demonstrated" if links else "not-demonstrated",
        "hardExclusions": exclusions,
        "electronic": bool(ELECTRONIC_CONTRACT.search(text)),
    }


def select_native_document(documents, context=None, known_judicial_ids=None):
    """Seleciona o melhor candidato ou recusa, sem fallback inseguro."""
    evaluated = [
        evaluate_document(item, context=context, known_judicial_ids=known_judicial_ids)
        for item in documents
        if item.get("path")
    ]
    eligible = [item for item in evaluated if item["eligible"]]
    eligible.sort(key=lambda item: (-item["score"], -len(item["caseLinks"]), -item["pages"], item["id"]))
    selected = eligible[0] if eligible else None
    ambiguous = bool(
        selected
        and not selected["caseLinks"]
        and len(eligible) > 1
        and eligible[1]["score"] == selected["score"]
        and not eligible[1]["caseLinks"]
    )
    if ambiguous:
        selected = None
    return {
        "status": "selected" if selected else ("ambiguous-native-documents" if ambiguous else "no-eligible-document"),
        "selected": selected,
        "candidates": sorted(evaluated, key=lambda item: (-item["score"], item["id"])),
        "ruleVersion": "native-document-selector-v1",
        "reason": None if selected else (
            "Mais de um documento bancário sem vínculo demonstrado obteve a mesma pontuação; a seleção exige conferência humana."
            if ambiguous else
            "Nenhum documento bancário sobreviveu às exclusões e apresentou sinal positivo nativo."
        ),
    }
