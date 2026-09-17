#!/usr/bin/env python3
"""Ponte JSON entre o backend do ForenseDoc e o Motor de Réplicas."""

import hashlib
import json
from pathlib import Path
import re
import runpy
import sys
from types import SimpleNamespace


VENDOR = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))

import forense  # noqa: E402
import leitor  # noqa: E402
from document_selector import derive_case_context, hard_exclusions, select_native_document  # noqa: E402

_modules = {"forense": forense, "leitor": leitor}
processual = SimpleNamespace(**runpy.run_path(
    str(VENDOR / "processual.py"), init_globals={"_MOD": _modules}
))
_modules["processual"] = processual
motor_replicas = SimpleNamespace(**runpy.run_path(
    str(VENDOR / "motor_replicas.py"),
    init_globals={
        "_MOD": _modules,
        "_CADERNO_TEXTO": (VENDOR / "caderno.json").read_text(encoding="utf-8"),
    },
))


def caderno_version():
    digest = hashlib.sha256((VENDOR / "caderno.json").read_bytes()).hexdigest()
    return {"edicao": "2ª edição", "sha256": digest}


def analyze(payload):
    paths = [str(Path(item).resolve()) for item in payload.get("paths", [])]
    proveniencias = {
        str(Path(item["path"]).resolve()): item.get("provenance") or {}
        for item in payload.get("documents", []) if item.get("path")
    }
    leitura = leitor.ler_autos(paths, usar_ocr=payload.get("ocr", True))
    sinais = processual.analisar(leitura) + forense.periciar(
        leitura, proveniencias=proveniencias
    )
    sinais.sort(key=lambda item: (-forense.GRAVIDADE.get(item.gravidade, 0), item.codigo))
    leitura_json = leitura.js()
    selector_documents = [{
        "id": document.nome,
        "path": document.caminho,
        "pages": len(document.paginas),
        "text": document.texto,
        "predictedType": document.tipo,
    } for document in leitura.documentos]
    known_judicial_ids = {
        item["id"] for item in selector_documents
        if item["predictedType"] in {
            "inicial", "contestacao", "replica", "jurisprudencia", "decisao",
            "sentenca", "acordao", "despacho",
        }
    }
    selector_context = derive_case_context(
        selector_documents,
        leitura_json.get("dados", {}).get("processo"),
        dados=leitura_json.get("dados", {}),
    )
    native_selection = select_native_document(
        selector_documents,
        context=selector_context,
        known_judicial_ids=known_judicial_ids,
    )
    nomes_permitidos = {
        item["id"] for item in selector_documents
        if not hard_exclusions(
            item,
            case_number=selector_context.get("caseNumber"),
            known_judicial_ids=known_judicial_ids,
        )
    }
    nomes_defesa = {
        item["id"] for item in selector_documents
        if item["predictedType"] == "contestacao"
    }
    leitor.avaliar_contratacao(leitura, nomes_permitidos, nomes_defesa)
    leitura_json = leitura.js()
    respostas = motor_replicas.filtrar_respostas(leitura_json["achados"])
    candidatos = motor_replicas.diagnosticar(respostas, [item.js() for item in sinais])
    baixa = [key for key, value in leitura_json["achados"].items()
             if value.get("confianca") == "baixa"]
    return {
        "engine": {"name": "Motor de Réplicas", "caderno": caderno_version()},
        "analysis": leitura_json,
        "signals": [item.js() for item in sinais],
        "summary": forense.resumo(sinais),
        "suppressedChecks": forense.checagens_suprimidas(leitura, proveniencias),
        "candidates": candidatos,
        "nativeDocumentSelection": native_selection,
        "answers": respostas,
        "review": {
            "status": "pending",
            "required": True,
            "lowConfidenceFields": baixa,
            "checklist": [
                "Conferir cada evidência no arquivo e na página indicados.",
                "Validar manualmente valores, datas e texto obtido por OCR.",
                "Reler a contestação antes de alegar ausência de impugnação específica.",
                "Resolver os campos entre colchetes antes do protocolo.",
            ],
        },
    }


def draft(payload):
    if payload.get("reviewConfirmed") is not True:
        raise ValueError("A confirmação de revisão humana é obrigatória para montar a minuta.")
    letter = str(payload.get("letter", "")).upper()
    if letter not in motor_replicas.C["replicas"]:
        raise ValueError("Cenário de réplica inválido.")
    paragraphs = motor_replicas.montar_peca(
        payload.get("analysis") or {},
        letter,
        payload.get("caseData", {}),
        set(payload.get("preliminaries", [])),
        payload.get("transplant") or None,
        payload.get("conformity") or [],
    )
    pending = sum(len(re.findall(r"\[[^\]]{1,90}\]", item["t"])) for item in paragraphs)
    return {
        "engine": {"name": "Motor de Réplicas", "caderno": caderno_version()},
        "status": "draft",
        "readyForFiling": False,
        "paragraphs": paragraphs,
        "pendingPlaceholders": pending,
        "warning": "Minuta gerada para revisão profissional; não está liberada para protocolo.",
    }


def scenarios(_payload):
    return {
        "engine": {"name": "Motor de Réplicas", "caderno": caderno_version()},
        "scenarios": [
            {"letra": letra, "titulo": item.get("titulo")}
            for letra, item in sorted(motor_replicas.C["replicas"].items())
        ],
    }


def main():
    if len(sys.argv) > 1:
        request = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    else:
        request = json.load(sys.stdin)
    command = request.get("command")
    handlers = {"analyze": analyze, "draft": draft, "scenarios": scenarios}
    result = handlers[command](request) if command in handlers else None
    if result is None:
        raise ValueError("Comando desconhecido.")
    json.dump(result, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        json.dump({"error": str(exc)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
