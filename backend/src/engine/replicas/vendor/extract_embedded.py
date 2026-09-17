#!/usr/bin/env python3
"""Extrai as fontes verificáveis do artefato portátil sem executá-lo."""

import ast
import base64
from pathlib import Path
import zlib


HERE = Path(__file__).resolve().parent
PORTABLE = HERE / "MotorReplicas.py"
OUTPUTS = {
    "_CADERNO": "caderno.json",
    "_FONTE_FORENSE": "forense.py",
    "_FONTE_LEITOR": "leitor.py",
    "_FONTE_PROCESSUAL": "processual.py",
    "_FONTE_MOTOR_REPLICAS": "motor_replicas.py",
}


def extract() -> None:
    tree = ast.parse(PORTABLE.read_text(encoding="utf-8"), filename=str(PORTABLE))
    assignments = {}
    for node in tree.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if isinstance(target, ast.Name) and target.id in OUTPUTS:
            assignments[target.id] = ast.literal_eval(node.value)

    missing = set(OUTPUTS) - set(assignments)
    if missing:
        raise RuntimeError(f"Blocos ausentes no artefato: {sorted(missing)}")

    for variable, filename in OUTPUTS.items():
        compressed = base64.b64decode("".join(assignments[variable]))
        content = zlib.decompress(compressed).decode("utf-8")
        (HERE / filename).write_text(content, encoding="utf-8")


if __name__ == "__main__":
    extract()
