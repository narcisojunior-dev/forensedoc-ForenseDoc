import unittest

from document_selector import derive_case_context, evaluate_document, select_native_document, strip_pje_footer


class DocumentSelectorTests(unittest.TestCase):
    def test_pje_footer_is_removed_without_touching_legitimate_signature(self):
        text = "\n".join([
            "Assinado eletronicamente por: MARIA CLIENTE",
            "Assinado eletronicamente por: ADVOGADO - 12/02/2026 09:18:37",
            "Num. 90576750 - Pág. 8",
        ])
        result = strip_pje_footer(text)
        self.assertIn("MARIA CLIENTE", result["text"])
        self.assertNotIn("ADVOGADO", result["text"])
        self.assertEqual(len(result["removed"]), 2)
    def test_case_context_uses_only_valid_plaintiff_name_for_demonstrated_link(self):
        context = derive_case_context([], dados={
            "autor": "MARIA DAS DORES SILVA",
            "re": "BANCO PAN S.A.",
        })
        self.assertEqual(context["partyNames"], ["MARIA DAS DORES SILVA"])
        self.assertEqual(context["counterpartyNames"], ["BANCO PAN S.A"])
        linked = evaluate_document({
            "id": "contrato", "path": "/tmp/contrato.pdf", "pages": 2,
            "predictedType": "contrato",
            "text": "Dossiê Comprobatório de MARIA DAS DORES SILVA. CCB nº 99999.",
        }, context=context)
        self.assertEqual(linked["linkStatus"], "demonstrated")

    def test_counterparty_name_does_not_demonstrate_case_link(self):
        context = derive_case_context([], dados={"autor": "MARIA DAS DORES SILVA", "re": "BANCO PAN S.A."})
        evaluated = evaluate_document({
            "id": "regulamento", "path": "/tmp/regulamento.pdf", "pages": 2,
            "predictedType": "contrato", "text": "Regulamento do cartão BANCO PAN S.A.",
        }, context=context)
        self.assertEqual(evaluated["linkStatus"], "not-demonstrated")

    def test_rejects_contaminated_or_malformed_party_names(self):
        for name in (
            "MARIA", "AUTORA 123", "ADVOGADO OAB PI", 
            "Assinado eletronicamente por ADVOGADO DO BANCO",
            "MARIA SILVA 12/02/2026 09:18",
        ):
            with self.subTest(name=name):
                context = derive_case_context([], dados={"autor": name})
                self.assertEqual(context["partyNames"], [])
    def test_contestation_never_becomes_contract_by_vocabulary(self):
        text = (
            "AO JUÍZO DA 2ª VARA CÍVEL. BANCO S.A. apresenta CONTESTAÇÃO. "
            "CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 12345, custo efetivo total, "
            "taxa de juros e valor liberado. Assinado eletronicamente por: "
            "ADVOGADO TESTE OAB/PI 1234."
        )
        result = evaluate_document({"id": "defesa", "text": text, "predictedType": "contrato", "path": "/tmp/defesa.pdf"})
        self.assertFalse(result["eligible"])
        self.assertIn("JUDICIAL_ADDRESSING", {item["code"] for item in result["hardExclusions"]})

    def test_known_replica_is_a_hard_exclusion(self):
        text = "Dossiê Comprobatório. CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 99999."
        result = evaluate_document(
            {"id": "replica-1", "text": text, "predictedType": "contrato", "path": "/tmp/replica.pdf"},
            known_judicial_ids={"replica-1"},
        )
        self.assertFalse(result["eligible"])
        self.assertIn("KNOWN_JUDICIAL_DOCUMENT", {item["code"] for item in result["hardExclusions"]})

    def test_specific_signed_term_beats_generic_conditions(self):
        documents = [
            {
                "id": "generic",
                "path": "/tmp/generic.pdf",
                "pages": 20,
                "predictedType": "contrato",
                "text": "CONDIÇÕES GERAIS. REGULAMENTO DO CARTÃO.",
            },
            {
                "id": "signed-term",
                "path": "/tmp/signed.pdf",
                "pages": 5,
                "predictedType": "contrato",
                "text": (
                    "CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 88830806. "
                    "IDENTIFICADOR PROCESSO 123e4567-e89b-12d3-a456-426614174000. "
                    "DATA E HORA DE ENVIO (UTC)."
                ),
            },
        ]
        result = select_native_document(documents)
        self.assertEqual(result["selected"]["id"], "signed-term")

    def test_no_positive_native_signal_means_safe_refusal(self):
        result = select_native_document([
            {"id": "unknown", "path": "/tmp/unknown.pdf", "text": "Documento sem identificação técnica.", "predictedType": "indefinido"},
        ])
        self.assertEqual(result["status"], "no-eligible-document")
        self.assertIsNone(result["selected"])

    def test_equal_unlinked_candidates_are_refused_as_ambiguous(self):
        text = "CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 123456. Assinatura eletrônica."
        result = select_native_document([
            {"id": "one", "path": "/tmp/one.pdf", "text": text, "predictedType": "contrato"},
            {"id": "two", "path": "/tmp/two.pdf", "text": text, "predictedType": "contrato"},
        ])
        self.assertEqual(result["status"], "ambiguous-native-documents")
        self.assertIsNone(result["selected"])

    def test_case_link_is_recorded_and_rewards_candidate(self):
        context = {"contractNumbers": ["123456"], "partyCpfs": ["111.222.333-44"]}
        result = evaluate_document({
            "id": "ccb", "path": "/tmp/ccb.pdf", "predictedType": "contrato",
            "text": "CÉDULA DE CRÉDITO BANCÁRIO CCB Nº 123456. CPF 111.222.333-44. Assinatura eletrônica por biometria facial.",
        }, context=context)
        self.assertTrue(result["eligible"])
        self.assertEqual(result["linkStatus"], "demonstrated")
        self.assertEqual({item["type"] for item in result["caseLinks"]}, {"cpf", "contract"})
        self.assertTrue(result["electronic"])


if __name__ == "__main__":
    unittest.main()
