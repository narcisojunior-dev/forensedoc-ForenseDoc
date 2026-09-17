#!/usr/bin/env python3
"""Validação em lote do Motor de Réplicas sobre autos consolidados do PJe."""

from collections import OrderedDict
from datetime import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import runpy
import shutil
import sys
import tempfile
from types import SimpleNamespace

from pypdf import PdfReader, PdfWriter


HERE = Path(__file__).resolve().parent
MODULE = HERE.parent
VENDOR = MODULE / "vendor"
sys.path.insert(0, str(MODULE))
sys.path.insert(0, str(VENDOR))

import forense  # noqa: E402
import leitor  # noqa: E402
from document_selector import (  # noqa: E402
    derive_case_context,
    hard_exclusions,
    positive_signals,
    select_native_document,
    strip_pje_footer,
)

_modules = {"forense": forense, "leitor": leitor}
processual = SimpleNamespace(**runpy.run_path(
    str(VENDOR / "processual.py"), init_globals={"_MOD": _modules}
))
_modules["processual"] = processual
motor = SimpleNamespace(**runpy.run_path(
    str(VENDOR / "motor_replicas.py"),
    init_globals={
        "_MOD": _modules,
        "_CADERNO_TEXTO": (VENDOR / "caderno.json").read_text(encoding="utf-8"),
    },
))

DEFAULT_INPUT = Path("/Users/ronneywellyngton/Desktop/Analise_Replicas_07a11-06-2026/01_Processos")
DEFAULT_OUTPUT = HERE / "results"
DOC_ID = re.compile(r"Num\.\s*(\d{5,})\s*-\s*P[áa]g\.\s*(\d+)", re.I)
PROCESS_NUMBER = re.compile(r"\d{7}-\d{2}\.\d{4}\.\d\.\d{2}\.\d{4}")
ELECTRONIC = re.compile(
    r"assinatura\s+(?:eletr[oô]nica|digital)|trilha\s+de\s+auditoria|"
    r"endere[cç]o\s+ip|geolocaliza[cç][aã]o|biometria|selfie|token|hash",
    re.I,
)


def page_text(page):
    try:
        return page.extract_text() or ""
    except Exception:
        return ""


def split_pje(source, destination):
    reader = PdfReader(str(source), strict=False)
    groups = OrderedDict()
    texts = {}
    removed_footers = {}
    for index, page in enumerate(reader.pages):
        raw_text = page_text(page)
        matches = list(DOC_ID.finditer(raw_text))
        key = matches[-1].group(1) if matches else f"front-{index + 1:04d}"
        cleaned = strip_pje_footer(raw_text)
        groups.setdefault(key, []).append(index)
        texts.setdefault(key, []).append(cleaned["text"])
        removed_footers.setdefault(key, []).extend(cleaned["removed"])

    paths = []
    metadata = []
    for sequence, (key, indexes) in enumerate(groups.items(), start=1):
        target = destination / f"{sequence:03d}_{key}.pdf"
        analysis_target = destination / f"{sequence:03d}_{key}.txt"
        joined = "\n".join(texts[key])
        probe = leitor.Documento(str(target))
        probe.paginas = [leitor.Pagina(target.name, page_number, text, "texto")
                         for page_number, text in enumerate(texts[key], start=1)]
        leitor.classificar(probe)
        relevant_procedure = re.search(
            r"\b(?:decis[aã]o|senten[cç]a|despacho|cita[cç][aã]o|r[ée]plica|"
            r"peti[cç][aã]o\s+inicial|contesta[cç][aã]o)\b", joined, re.I
        )
        relevant = (
            probe.tipo != "indefinido"
            or bool(relevant_procedure)
            or bool(positive_signals(joined))
        )
        if relevant:
            writer = PdfWriter()
            for index in indexes:
                writer.add_page(reader.pages[index])
            with target.open("wb") as stream:
                writer.write(stream)
            analysis_target.write_text("\f".join(texts[key]), encoding="utf-8")
            paths.append(str(analysis_target))
        metadata.append({
            "id": key, "path": str(target) if relevant else None,
            "analysisPath": str(analysis_target) if relevant else None,
            "pages": len(indexes), "text": joined, "predictedType": probe.tipo,
            "pjeFooterRemoved": removed_footers[key],
            "provenance": {
                "kind": "pje-split",
                "derived": True,
                "tool": "pypdf",
                "nativeMetadataAssessable": False,
                "cryptographicSignatureAssessable": False,
            },
        })
    return paths, metadata, len(reader.pages)


def actual_replica(metadata):
    options = []
    for item in metadata:
        text = item["text"]
        if re.search(
            r"\b(?:R[ÉE]PLICA\s+(?:[ÀA]\s+)?CONTESTA[CÇ][AÃ]O|"
            r"IMPUGNA[CÇ][AÃ]O\s+(?:[ÀA]\s+)?CONTESTA[CÇ][AÃ]O|"
            r"MANIFESTA[CÇ][AÃ]O\s+(?:[ÀA]\s+)?CONTESTA[CÇ][AÃ]O)\b", text, re.I
        ):
            options.append(item)
    return max(options, key=lambda item: len(item["text"]), default=None)


def token_overlap(generated, actual):
    def tokens(value):
        return set(re.findall(r"[a-záàâãéêíóôõúç]{5,}", value.lower()))
    left, right = tokens(generated), tokens(actual)
    return round(len(left & right) / max(1, len(left | right)), 4)


def validate_case(source, work, output_dir):
    paths, metadata, total_pages = split_pje(source, work)
    replica = actual_replica(metadata)
    known_judicial_ids = {
        item["id"] for item in metadata
        if item["predictedType"] in {
            "inicial", "contestacao", "replica", "jurisprudencia", "decisao",
            "sentenca", "acordao", "despacho",
        }
    }
    if replica:
        known_judicial_ids.add(replica["id"])
    leitura = leitor.ler_autos(paths, usar_ocr=False)
    context = derive_case_context(
        metadata,
        source.stem.replace("_processo", ""),
        dados=leitura.js().get("dados", {}),
    )
    native_selection = select_native_document(
        metadata,
        context=context,
        known_judicial_ids=known_judicial_ids,
    )
    selected_native = native_selection.get("selected")
    nomes_permitidos = {
        item["id"] for item in metadata
        if not hard_exclusions(
            item,
            case_number=context.get("caseNumber"),
            known_judicial_ids=known_judicial_ids,
        )
    }
    nomes_defesa = {
        item["id"] for item in metadata if item["predictedType"] == "contestacao"
    }
    # Os ids do seletor são ids PJe; o leitor trabalha com os nomes dos arquivos.
    id_to_name = {
        item["id"]: Path(item["analysisPath"]).name
        for item in metadata if item["analysisPath"]
    }
    leitor.avaliar_contratacao(
        leitura,
        {id_to_name[item] for item in nomes_permitidos if item in id_to_name},
        {id_to_name[item] for item in nomes_defesa if item in id_to_name},
    )
    selected_item = next(
        (item for item in metadata if selected_native and item["id"] == selected_native["id"]),
        None,
    )
    selected_name = Path(selected_item["analysisPath"]).name if selected_item else None
    forensic_docs = [document for document in leitura.documentos if document.tipo in {
        "contestacao", "contrato", "comprovante", "extrato", "hiscre", "log",
    } or document.nome == selected_name]
    original_pdffonts = forense.pdffonts
    original_pdfimages = forense.pdfimages_lista
    forense.pdffonts = lambda _path: []
    forense.pdfimages_lista = lambda _path: []
    try:
        process_signals = processual.analisar(leitura)
        provenance_by_path = {
            str(Path(document.caminho).resolve()): next(
                (item["provenance"] for item in metadata
                 if item["analysisPath"] and Path(item["analysisPath"]).name == document.nome),
                {},
            ) for document in forensic_docs
        }
        forensic_signals = forense.periciar(
            SimpleNamespace(documentos=forensic_docs),
            proveniencias=provenance_by_path,
        )
        sinais = process_signals + forensic_signals
    finally:
        forense.pdffonts = original_pdffonts
        forense.pdfimages_lista = original_pdfimages
    sinais.sort(key=lambda item: (-forense.GRAVIDADE.get(item.gravidade, 0), item.codigo))
    analysis = leitura.js()
    answers = motor.filtrar_respostas(analysis["achados"])
    candidates = motor.diagnosticar(answers, [item.js() for item in sinais])
    candidate = candidates[0].get("letra") if candidates else None
    blocked_scenarios = candidates[0].get("bloqueados", []) if candidates else []
    reinforcements = candidates[0].get("reforcos", []) if candidates else []
    paragraphs = []
    draft_blocked_reasons = []
    if candidate:
        try:
            paragraphs = motor.montar_peca(
                analysis,
                candidate,
                analysis["dados"],
                {item["cod"] for item in analysis["preliminares"]},
                None,
                analysis["conformidade69"],
            )
        except motor.PreRequisitoAusente as exc:
            draft_blocked_reasons = exc.motivos
    draft_text = "\n".join(item["t"] for item in paragraphs)
    electronic_docs = []
    by_name = {Path(item["path"]).name: item for item in metadata if item["path"]}
    if selected_native:
        item = next((entry for entry in metadata if entry["id"] == selected_native["id"]), None)
        document = next((entry for entry in leitura.documentos if entry.nome == selected_name), None)
        if (item and document and ELECTRONIC.search(item["text"])
                and selected_native.get("linkStatus") == "demonstrated"):
            electronic_docs.append({
                "id": item["id"], "path": item["path"], "tipo": document.tipo,
                "pages": item["pages"], "sha256": document.sha256,
                "selection": selected_native,
                "provenance": item["provenance"],
            })

    saved_electronic = []
    if electronic_docs:
        electronic_dir = output_dir / "electronic-contracts"
        electronic_dir.mkdir(parents=True, exist_ok=True)
        for item in electronic_docs[:1]:
            target = electronic_dir / f"{source.stem.replace('_processo', '')}_{item['id']}.pdf"
            shutil.copy2(item["path"], target)
            saved_electronic.append(str(target))

    classified = {}
    for document in leitura.documentos:
        classified[document.tipo] = classified.get(document.tipo, 0) + 1
    placeholders = len(re.findall(r"\[[^\]]{1,90}\]", draft_text))
    assertions = {
        "split_created_multiple_documents": len(paths) > 2,
        "initial_found": classified.get("inicial", 0) > 0,
        "defense_found": classified.get("contestacao", 0) > 0,
        "contract_found": classified.get("contrato", 0) > 0,
        "signals_generated": len(sinais) > 0,
        "signal_entries_not_duplicated": len({
            (item.codigo, item.arquivo, item.dado, item.detalhe) for item in sinais
        }) == len(sinais),
        "diagnosis_completed": bool(candidates),
        "draft_generated_or_safely_blocked": len(paragraphs) > 10 or bool(draft_blocked_reasons) or candidate is None,
        "draft_has_title_or_is_blocked": "RÉPLICA À CONTESTAÇÃO" in draft_text or bool(draft_blocked_reasons) or candidate is None,
        "draft_has_no_python_none": "None" not in draft_text,
        "actual_replica_compared_when_available": replica is None or bool(draft_text),
        "evidence_on_high_findings": all(
            item.arquivo or item.dado for item in sinais if item.gravidade in {"critico", "alto"}
        ),
        "native_document_not_judicial": selected_native is None or not selected_native["hardExclusions"],
        "native_document_has_positive_signal": selected_native is None or bool(selected_native["positiveSignals"]),
        "electronic_report_requires_eligible_document": not electronic_docs or (
            selected_native is not None and selected_native["eligible"]
            and selected_native["linkStatus"] == "demonstrated"
        ),
    }
    return {
        "case": source.stem.replace("_processo", ""),
        "source": str(source),
        "sha256": hashlib.sha256(source.read_bytes()).hexdigest(),
        "pages": total_pages,
        "logicalDocuments": len(metadata),
        "selectedDocuments": len(paths),
        "classified": classified,
        "signals": [item.js() for item in sinais],
        "summary": forense.resumo(sinais),
        "nativeDocumentSelection": native_selection,
        "documentProvenance": {
            "source": str(source),
            "sourceSha256": hashlib.sha256(source.read_bytes()).hexdigest(),
            "kind": "pje-consolidated",
            "derivedDocuments": True,
            "nativeMetadataAssessable": False,
            "cryptographicSignatureAssessable": False,
        },
        "candidates": candidates,
        "selectedScenario": candidate,
        "contractingMode": analysis["achados"].get("contratacao", {}),
        "technicalElements": analysis["achados"].get("elementos_tecnicos", {}),
        "blockedScenarios": blocked_scenarios,
        "scenarioReinforcements": reinforcements,
        "draft": {
            "paragraphs": len(paragraphs),
            "placeholders": placeholders,
            "text": draft_text,
            "blockedReasons": draft_blocked_reasons,
        },
        "actualReplica": {
            "found": replica is not None,
            "documentId": replica["id"] if replica else None,
            "characters": len(replica["text"]) if replica else 0,
            "tokenOverlap": token_overlap(draft_text, replica["text"]) if replica and draft_text else None,
        },
        "electronicContractDocuments": electronic_docs,
        "electronicDocumentsSaved": saved_electronic,
        "requiresForenseDocReport": bool(electronic_docs),
        "assertions": assertions,
    }


def write_markdown(batch, target):
    cases = batch["cases"]
    lines = [
        "# Validação em lote - ForenseDoc + Motor de Réplicas",
        "",
        f"Executada em {batch['generatedAt']} sobre {len(cases)} autos completos do PJe.",
        "",
        f"- Verificações aprovadas: {batch['totals']['passedAssertions']}",
        f"- Verificações reprovadas: {batch['totals']['failedAssertions']}",
        f"- Contratos eletrônicos detectados: {batch['totals']['electronicCases']}",
        f"- Documentos nativos elegíveis selecionados: {batch['totals']['nativeDocumentsSelected']}",
        f"- Réplicas reais localizadas para comparação: {batch['totals']['actualReplicas']}",
        "",
        "| Processo | Páginas | Docs | Inicial | Defesa | Documento nativo | Vínculo | Cenário | Parágrafos | Pendências | Réplica real | Eletrônico |",
        "|---|---:|---:|:---:|:---:|:---:|:---:|:---:|---:|---:|:---:|:---:|",
    ]
    for case in cases:
        checks = case["assertions"]
        actual = case["actualReplica"]
        native = case["nativeDocumentSelection"].get("selected")
        lines.append(
            f"| {case['case']} | {case['pages']} | {case['logicalDocuments']} | "
            f"{'✓' if checks['initial_found'] else '✗'} | {'✓' if checks['defense_found'] else '✗'} | "
            f"{native['id'] if native else 'RECUSADO'} | {native['linkStatus'] if native else '-'} | {case['selectedScenario'] or '-'} | "
            f"{case['draft']['paragraphs']} | {case['draft']['placeholders']} | "
            f"{'✓' if actual['found'] else '✗'} | "
            f"{'SIM' if case['requiresForenseDocReport'] else 'não'} |"
        )
    lines.extend([
        "", "## Interpretação obrigatória", "",
        "Ausência de termo na busca automática não equivale a silêncio processual. Achados, valores, datas e OCR exigem conferência no documento indicado. RECUSADO é resultado de segurança, não falha a ser contornada. A minuta e os laudos permanecem não liberados para protocolo.",
    ])
    target.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    input_dir = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_INPUT
    output_dir = Path(sys.argv[2]) if len(sys.argv) > 2 else DEFAULT_OUTPUT
    output_dir.mkdir(parents=True, exist_ok=True)
    cases = []
    sources = sorted(input_dir.glob("*.pdf"))
    for index, source in enumerate(sources, start=1):
        print(f"[{index:02d}/{len(sources):02d}] {source.name}", flush=True)
        with tempfile.TemporaryDirectory(prefix="forensedoc-batch-") as temp:
            cases.append(validate_case(source, Path(temp), output_dir))
    passed = sum(sum(1 for value in case["assertions"].values() if value) for case in cases)
    failed = sum(sum(1 for value in case["assertions"].values() if not value) for case in cases)
    batch = {
        "generatedAt": datetime.now().isoformat(timespec="seconds"),
        "inputDirectory": str(input_dir),
        "totals": {
            "cases": len(cases), "passedAssertions": passed, "failedAssertions": failed,
            "electronicCases": sum(1 for case in cases if case["requiresForenseDocReport"]),
            "nativeDocumentsSelected": sum(1 for case in cases if case["nativeDocumentSelection"].get("selected")),
            "actualReplicas": sum(1 for case in cases if case["actualReplica"]["found"]),
        },
        "cases": cases,
    }
    (output_dir / "batch-results.json").write_text(json.dumps(batch, ensure_ascii=False, indent=2), encoding="utf-8")
    write_markdown(batch, output_dir / "batch-summary.md")
    print(json.dumps(batch["totals"], ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
