import unittest

from stage_pdf import detect_day_bounds, detect_group_headers, detect_pair_count


def rect(x0, y0, x1, y1, kind):
    return {"type": kind, "rect": (x0, y0, x1, y1)}


class GeometryTests(unittest.TestCase):
    def test_header_row_requires_contiguous_group_columns(self):
        drawings = [rect(120, 243, 310, 285, "f"), rect(310, 243, 500, 285, "f"),
                    rect(500, 243, 690, 285, "f"), rect(690, 243, 880, 285, "f")]
        self.assertEqual(len(detect_group_headers(drawings, 1000)), 4)
        drawings[2] = rect(510, 243, 690, 285, "f")
        with self.assertRaisesRegex(ValueError, "not contiguous"):
            detect_group_headers(drawings, 1000)

    def test_group_codes_win_over_course_and_period_rows(self):
        drawings = [rect(100, 200, 500, 242, "f"), rect(500, 200, 900, 242, "f"),
                    rect(100, 243, 500, 285, "f"), rect(500, 243, 900, 285, "f"),
                    rect(100, 286, 900, 328, "f")]
        texts = {200: "1 курс", 243: "ПИ-124", 286: "с 01.09.2026 по 30.12.2026"}
        selected = detect_group_headers(drawings, 1000, lambda bounds: texts[bounds[1]])
        self.assertTrue(all(bounds[1] == 243 for bounds in selected))
        with self.assertRaisesRegex(ValueError, "No group-code"):
            detect_group_headers(drawings[:2], 1000, lambda bounds: texts[bounds[1]])

    def test_single_wide_group_column_requires_text_verification(self):
        drawings = [rect(100, 243, 900, 285, "f")]
        self.assertEqual(detect_group_headers(drawings, 1000, lambda _: "ВАДТ-126"),
                         [(100, 243, 900, 285)])
        with self.assertRaisesRegex(ValueError, "incomplete"):
            detect_group_headers(drawings, 1000)

    def test_pair_count_comes_from_time_rail(self):
        labels = "1-я пара\nПонедельник\n2-я пара\n3-я пара\n4-я пара\n5-я пара\n6-я пара"
        self.assertEqual(detect_pair_count(labels), 6)
        with self.assertRaisesRegex(ValueError, "Cannot verify"):
            detect_pair_count("1-я пара\n3-я пара")

    def test_day_bands_require_full_width_lines(self):
        drawings = [rect(30, 328, 970, 328, "s"), rect(30, 924, 970, 924, "s"),
                    rect(30, 1520, 970, 1520, "s"), rect(30, 700, 200, 700, "s")]
        self.assertEqual(detect_day_bounds(drawings, 1000, 285), [(328, 924), (924, 1520)])
        with self.assertRaisesRegex(ValueError, "Expected day separator"):
            detect_day_bounds(drawings[:1], 1000, 285)


if __name__ == "__main__":
    unittest.main()
