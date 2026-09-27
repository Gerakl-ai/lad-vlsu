import tempfile
import unittest
from pathlib import Path

from inventory_archive import catalog_index, inventory, match_group, normalized_name


class CatalogMatchTests(unittest.TestCase):
    def setUp(self):
        self.index = catalog_index({"institutes": [
            {"id": "one", "name": "Первый", "groups": [
                {"name": "ПИ-124", "nrec": "a"},
                {"name": "ОБ-126", "nrec": "b"},
            ]},
            {"id": "two", "name": "Второй", "groups": [
                {"name": "ОБ-126", "nrec": "c"},
            ]},
        ]})

    def test_normalizes_dashes_and_nonbreaking_spaces(self):
        self.assertEqual(normalized_name(" ПИ‑124\u00a0"), "пи-124")

    def test_unique_match_is_only_a_candidate_for_review(self):
        result = match_group("ПИ-124", self.index)
        self.assertEqual(result["status"], "unique-catalog-name")
        self.assertEqual(result["candidate"]["nrec"], "a")

    def test_ambiguous_name_is_not_assigned_a_group(self):
        result = match_group("ОБ-126", self.index)
        self.assertEqual(result["status"], "ambiguous-catalog-name")
        self.assertNotIn("candidate", result)
        self.assertEqual(len(result["candidates"]), 2)

    def test_unknown_name_is_not_guessed(self):
        self.assertEqual(match_group("НЕ-126", self.index), {"status": "not-in-catalog"})

    def test_shared_column_keeps_both_groups_as_review_candidates(self):
        result = match_group("ПИ-124 ОБ-126", self.index)
        self.assertEqual(result["status"], "unresolved-multi-group")
        self.assertEqual(result["parts"][0]["candidates"][0]["nrec"], "a")
        self.assertEqual(len(result["parts"][1]["candidates"]), 2)

    def test_shared_column_with_unique_names_is_explicit(self):
        index = catalog_index({"institutes": [{"id": "one", "groups": [
            {"name": "ПИ-124", "nrec": "a"}, {"name": "ПИ-125", "nrec": "b"}
        ]}]})
        result = match_group("ПИ-124 ПИ-125", index)
        self.assertEqual(result["status"], "multi-group-column")
        self.assertEqual([item["nrec"] for item in result["candidates"]], ["a", "b"])

    def test_wrong_archive_hash_stops_before_reading_pdf(self):
        with tempfile.TemporaryDirectory() as directory:
            archive = Path(directory) / "source.zip"
            archive.write_bytes(b"not a schedule archive")
            with self.assertRaisesRegex(ValueError, "SHA-256 mismatch"):
                inventory(archive, "0" * 64, {"institutes": []})


if __name__ == "__main__":
    unittest.main()
