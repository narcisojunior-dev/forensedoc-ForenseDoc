import tempfile
from pathlib import Path
import sys
import unittest


VENDOR = Path(__file__).resolve().parent / "vendor"
sys.path.insert(0, str(VENDOR))
import leitor  # noqa: E402


class TextPageTest(unittest.TestCase):
    def test_form_feed_preserves_derived_page_boundaries(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "documento-pje.txt"
            path.write_text("primeira página\fsegunda página", encoding="utf-8")
            document = leitor.ler_documento(str(path), usar_ocr=False)
        self.assertEqual(len(document.paginas), 2)
        self.assertEqual(document.paginas[0].n, 1)
        self.assertEqual(document.paginas[1].texto, "segunda página")


if __name__ == "__main__":
    unittest.main()
