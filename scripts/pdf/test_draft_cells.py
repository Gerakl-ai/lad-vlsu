import unittest

from draft_cells import candidate_blocks


DAY = {"bounds": [100, 0, 200, 140], "pairCount": 7}


def span(text, x0, y0, x1, y1, alpha=255, size=9):
    return {"text": text, "bbox": [x0, y0, x1, y1], "alpha": alpha, "size": size}


class CandidateTests(unittest.TestCase):
    def test_hidden_pdf_identifiers_are_not_lessons(self):
        blocks = [{"lines": [{"spans": [span("hidden-123", 101, 2, 140, 8, alpha=0)]}]},
                  {"lines": [{"spans": [span("Базы данных", 101, 12, 170, 18)]}]}]
        result = candidate_blocks(blocks, DAY)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["rawTextHint"], "Базы данных")
        self.assertEqual((result[0]["modeHint"], result[0]["pairIndexHint"]), ("z", 1))

    def test_merged_and_overflowing_text_is_flagged(self):
        blocks = [{"lines": [
            {"spans": [span("Основы", 101, 62, 220, 68)]},
            {"spans": [span("искусственного интеллекта", 101, 72, 190, 78)]},
        ]}]
        result = candidate_blocks(blocks, DAY)
        self.assertEqual(result[0]["rawTextHint"], "Основы искусственного интеллекта")
        self.assertIn("crosses-half-row", result[0]["warnings"])
        self.assertIn("crosses-column-boundary", result[0]["warnings"])
        self.assertNotIn("crosses-pair-boundary", result[0]["warnings"])

    def test_text_from_neighbor_column_is_ignored(self):
        blocks = [{"lines": [{"spans": [span("Соседи", 205, 2, 250, 8),
                                         span("Моя пара", 101, 2, 160, 8)]}]}]
        self.assertEqual(candidate_blocks(blocks, DAY)[0]["rawTextHint"], "Моя пара")

    def test_two_subgroups_in_one_half_row_are_flagged(self):
        blocks = [{"lines": [{"spans": [span("Подгруппа 1", 101, 2, 145, 8)]}]},
                  {"lines": [{"spans": [span("Подгруппа 2", 151, 2, 190, 8)]}]}]
        result = candidate_blocks(blocks, DAY)
        self.assertEqual(len(result), 2)
        self.assertTrue(all("multiple-blocks-in-half-row" in item["warnings"] for item in result))

    def test_six_pair_page_uses_twelve_half_rows(self):
        day = {"bounds": [100, 0, 200, 120], "pairCount": 6}
        result = candidate_blocks([{"lines": [{"spans": [span("Третья пара", 101, 42, 170, 48)]}]}], day)
        self.assertEqual((result[0]["modeHint"], result[0]["pairIndexHint"]), ("n", 3))

    def test_old_staging_without_pair_count_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "verified pair count"):
            candidate_blocks([], {"bounds": [100, 0, 200, 140]})


if __name__ == "__main__":
    unittest.main()
