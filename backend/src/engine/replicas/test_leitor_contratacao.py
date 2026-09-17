from pathlib import Path
import sys
import unittest


VENDOR = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))
import leitor  # noqa: E402


def document(name, kind, text):
    item = leitor.Documento(name)
    item.nome = name
    item.tipo = kind
    item.paginas = [leitor.Pagina(name, 1, text, "texto")]
    return item


class ContractingEvidenceTest(unittest.TestCase):
    def test_replica_alone_cannot_define_electronic_contracting(self):
        reading = leitor.Leitura()
        reading.documentos = [document(
            "replica.txt", "replica",
            "A réplica afirma contratação por aplicativo, biometria e token.",
        )]
        leitor.avaliar_contratacao(reading, nomes_permitidos=set(), nomes_defesa=set())
        self.assertIsNone(reading.achados["contratacao"].valor)
        self.assertEqual(reading.achados["contratacao"].confianca, "baixa")
        self.assertIsNone(reading.achados["elementos_tecnicos"].valor)

    def test_defense_is_secondary_evidence_only(self):
        reading = leitor.Leitura()
        reading.documentos = [document(
            "contestacao.txt", "contestacao",
            "A ré sustenta contratação por aplicativo, assinatura eletrônica, "
            "endereço IP 10.2.3.4 e biometria.",
        )]
        leitor.avaliar_contratacao(
            reading, nomes_permitidos=set(), nomes_defesa={"contestacao.txt"}
        )
        self.assertEqual(reading.achados["contratacao"].valor, "eletronica")
        self.assertEqual(reading.achados["contratacao"].confianca, "media")
        self.assertIn("própria ré", reading.achados["contratacao"].nota)
        self.assertEqual(reading.achados["elementos_tecnicos"].confianca, "media")

    def test_non_excluded_contract_is_primary_evidence(self):
        reading = leitor.Leitura()
        reading.documentos = [document(
            "contrato.txt", "contrato",
            "Dossiê comprobatório de contratação por aplicativo com assinatura "
            "eletrônica, biometria, token, IP 10.2.3.4, geolocalização, dispositivo "
            "IMEI, carimbo 10:22:31 e SHA-256.",
        )]
        leitor.avaliar_contratacao(
            reading, nomes_permitidos={"contrato.txt"}, nomes_defesa=set()
        )
        self.assertEqual(reading.achados["contratacao"].valor, "eletronica")
        self.assertEqual(reading.achados["contratacao"].confianca, "alta")
        self.assertEqual(reading.achados["elementos_tecnicos"].valor, "completos")
        self.assertEqual(reading.achados["elementos_tecnicos"].confianca, "alta")


if __name__ == "__main__":
    unittest.main()
