import unittest
import pymupdf

from ocr_schedule import column_period, pair_labels, period_for_column


class PairLabelsTests(unittest.TestCase):
    def test_full_time_starts_with_first_pair(self):
        self.assertEqual(pair_labels("1-я пара\n2-я пара\n3-я пара"), [1, 2, 3])

    def test_evening_starts_with_fifth_pair(self):
        self.assertEqual(pair_labels("5-я пара\n6-я пара\n7-я пара"), [5, 6, 7])

    def test_rejects_missing_pair(self):
        with self.assertRaises(ValueError):
            pair_labels("5-я пара\n7-я пара")

    def test_rejects_unsupported_pair(self):
        with self.assertRaises(ValueError):
            pair_labels("8-я пара")

    def test_period_is_taken_from_the_group_column(self):
        self.assertEqual(column_period("c 01.09.2026 г. по\n23.11.2026 г."),
                         ("2026-09-01", "2026-11-23"))

    def test_period_rejects_missing_or_reversed_dates(self):
        with self.assertRaises(ValueError):
            column_period("01.09.2026")
        with self.assertRaises(ValueError):
            column_period("23.11.2026 01.09.2026")

    def test_merged_date_cell_applies_to_each_group_inside_it(self):
        class Page:
            def get_drawings(self):
                return [{"type": "s", "rect": pymupdf.Rect(100, 200, 700, 245)}]

            def get_textbox(self, rect):
                return "c 01.09.2026 г. по 30.12.2026 г."

        for left in (100, 300, 500):
            with self.subTest(left=left):
                self.assertEqual(period_for_column(Page(), pymupdf.Rect(left, 160, left + 200, 200),
                                                   250, "group"), ("2026-09-01", "2026-12-30"))


if __name__ == "__main__":
    unittest.main()
