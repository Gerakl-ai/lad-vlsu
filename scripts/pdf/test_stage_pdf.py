import unittest

from stage_pdf import detect_day_bounds, detect_group_headers


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

    def test_day_bands_require_full_width_lines(self):
        drawings = [rect(30, 328, 970, 328, "s"), rect(30, 924, 970, 924, "s"),
                    rect(30, 1520, 970, 1520, "s"), rect(30, 700, 200, 700, "s")]
        self.assertEqual(detect_day_bounds(drawings, 1000, 285), [(328, 924), (924, 1520)])
        with self.assertRaisesRegex(ValueError, "Expected day separator"):
            detect_day_bounds(drawings[:1], 1000, 285)


if __name__ == "__main__":
    unittest.main()
