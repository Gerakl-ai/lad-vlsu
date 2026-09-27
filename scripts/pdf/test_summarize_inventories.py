import unittest

from summarize_inventories import summarize


def report(source, matches):
    return {"purpose": "review-planning-only", "source": {"sha256": source},
            "documents": [{"member": 1, "groupColumns": [
                {"page": 1, "column": index, "header": header, "match": match}
                for index, (header, match) in enumerate(matches, start=1)
            ]}]}


class SummaryTests(unittest.TestCase):
    def test_shared_column_and_cross_source_conflict_are_distinct(self):
        first = report("archive-one", [("A-126 B-126", {
            "status": "multi-group-column",
            "candidates": [{"name": "A-126", "nrec": "a"}, {"name": "B-126", "nrec": "b"}],
        })])
        second = report("archive-two", [("A-126", {
            "status": "unique-catalog-name", "candidate": {"name": "A-126", "nrec": "a"},
        }), ("C-126", {"status": "not-in-catalog"})])
        result = summarize([first, second])
        self.assertEqual(result["uniqueCatalogGroups"], 2)
        self.assertEqual(result["groupColumns"], 3)
        self.assertEqual(result["crossSourceConflicts"][0]["nrec"], "a")
        self.assertEqual(result["unresolvedColumns"][0]["header"], "C-126")

    def test_rejects_non_inventory_input(self):
        with self.assertRaisesRegex(ValueError, "review-only"):
            summarize([{"source": {"sha256": "hash"}}])


if __name__ == "__main__":
    unittest.main()
