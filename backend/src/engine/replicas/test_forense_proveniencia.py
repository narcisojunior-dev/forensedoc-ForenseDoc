from pathlib import Path
from types import SimpleNamespace
import sys
import tempfile
import unittest


VENDOR = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))
import forense  # noqa: E402
import leitor  # noqa: E402


class ForenseProvenanceTest(unittest.TestCase):
    def _reading(self, directory):
        contract_path = Path(directory) / "contrato.txt"
        contract_path.write_text(
            "CÉDULA DE CRÉDITO BANCÁRIO. Instrumento de crédito consignado. "
            "Valor liberado R$ 1.000,00 em 01/01/2024.", encoding="utf-8"
        )
        log_path = Path(directory) / "log.txt"
        log_path.write_text("LOG DA JORNADA SHA-256 " + "a" * 64, encoding="utf-8")
        contract = leitor.ler_documento(str(contract_path), usar_ocr=False)
        contract.tipo = "contrato"
        log = leitor.ler_documento(str(log_path), usar_ocr=False)
        log.tipo = "log"
        return SimpleNamespace(documentos=[contract, log]), contract, log

    def test_derived_documents_suppress_file_level_conclusions_and_report_them(self):
        with tempfile.TemporaryDirectory() as directory:
            reading, contract, log = self._reading(directory)
            provenance = {
                str(Path(contract.caminho).resolve()): {
                    "kind": "pje-text-split", "derived": True,
                    "nativeMetadataAssessable": False,
                    "cryptographicSignatureAssessable": False,
                },
                str(Path(log.caminho).resolve()): {
                    "kind": "pje-text-split", "derived": True,
                    "nativeMetadataAssessable": False,
                    "cryptographicSignatureAssessable": False,
                },
            }
            signals = forense.periciar(reading, proveniencias=provenance)
            codes = {item.codigo for item in signals}
            suppressed = forense.checagens_suprimidas(reading, provenance)

        forbidden = {code for values in forense.CHECAGENS_POR_CAPACIDADE.values() for code in values}
        self.assertTrue(codes.isdisjoint(forbidden))
        self.assertEqual({item["codigo"] for item in suppressed}, forbidden)
        self.assertTrue(all(item["arquivos"] and item["motivo"] for item in suppressed))

    def test_missing_provenance_preserves_native_behavior(self):
        with tempfile.TemporaryDirectory() as directory:
            reading, _, _ = self._reading(directory)
            without_argument = [item.js() for item in forense.periciar(reading)]
            with_empty_map = [item.js() for item in forense.periciar(reading, proveniencias={})]
        self.assertEqual(without_argument, with_empty_map)
        self.assertIn("SIG-01", {item["codigo"] for item in without_argument})
        self.assertIn("HSH-01", {item["codigo"] for item in without_argument})


if __name__ == "__main__":
    unittest.main()
