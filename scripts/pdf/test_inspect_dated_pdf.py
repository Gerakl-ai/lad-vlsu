import unittest

from inspect_dated_pdf import exclude_white_body_text


class Page:
    def __init__(self, objects):
        self.objects = objects

    def filter(self, predicate):
        return Page([item for item in self.objects if predicate(item)])


class InspectionTests(unittest.TestCase):
    def test_white_text_is_never_removed_without_explicit_body_review(self):
        page = Page([{"object_type": "char", "text": "M", "non_stroking_color": (1.0, 1.0, 1.0)}])
        self.assertIs(exclude_white_body_text(page, False), page)

    def test_opt_in_retains_grid_geometry_and_all_non_white_text(self):
        objects = [{"object_type": "rect", "non_stroking_color": (1.0, 1.0, 1.0)},
                   {"object_type": "char", "text": "M", "non_stroking_color": (1.0, 1.0, 1.0)},
                   {"object_type": "char", "text": "А", "non_stroking_color": (0.0, .502, 0.0)},
                   {"object_type": "char", "text": "Б", "non_stroking_color": (0.0, 0.0, 0.0)}]
        self.assertEqual(exclude_white_body_text(Page(objects), True).objects, [objects[0], objects[2], objects[3]])


if __name__ == '__main__':
    unittest.main()
