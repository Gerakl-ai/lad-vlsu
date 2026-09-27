import hashlib
import tempfile
import unittest
import zipfile
from pathlib import Path

from extract_pdf_member import verified_member_bytes
from stage_pdf import source_hash


class ExtractTests(unittest.TestCase):
    def test_extracts_only_verified_schedule_member(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "schedule.zip"
            content = b"%PDF-1.4\nsynthetic test bytes"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("schedule.pdf", content)
            inventory = {"source": {"sha256": source_hash(archive)}, "documents": [
                {"member": 0, "kind": "schedule", "pdfSha256": hashlib.sha256(content).hexdigest()}
            ]}
            self.assertEqual(verified_member_bytes(archive, inventory, 0), content)
            inventory["documents"][0]["pdfSha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "PDF SHA-256"):
                verified_member_bytes(archive, inventory, 0)
            inventory["source"]["sha256"] = "0" * 64
            with self.assertRaisesRegex(ValueError, "ZIP SHA-256"):
                verified_member_bytes(archive, inventory, 0)

    def test_refuses_non_schedule_document(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "schedule.zip"
            with zipfile.ZipFile(archive, "w") as zipped:
                zipped.writestr("order.pdf", b"%PDF-1.4")
            inventory = {"source": {"sha256": source_hash(archive)}, "documents": [
                {"member": 0, "kind": "other-document", "pdfSha256": "0" * 64}
            ]}
            with self.assertRaisesRegex(ValueError, "not an inventoried schedule"):
                verified_member_bytes(archive, inventory, 0)


if __name__ == "__main__":
    unittest.main()
