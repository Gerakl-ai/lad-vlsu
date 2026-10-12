import unittest

from stage_dated import dated_label, intervals, lesson_text, period


class DatedSourceTests(unittest.TestCase):
    def test_declared_spring_year(self):
        start, end, years = period('в период с "2.02" по "08.06" 2025 - 2026 уч. года')
        self.assertEqual((start.isoformat(), end.isoformat(), years), ("2026-02-02", "2026-06-08", (2025, 2026)))

    def test_rejects_missing_or_reversed_period(self):
        for text in ['2.02-08.06', '08.06-2.02 2025-2026', '2.02-08.06 2025-2027']:
            with self.assertRaises(ValueError):
                period(text)

    def test_day_and_date_must_agree(self):
        self.assertEqual(dated_label('СУББОТА 07.02', (2025, 2026)).isoformat(), "2026-02-07")
        for text in ['ВТОРНИК 07.02', '07.02', 'СУББОТА 07.02, 14.02']:
            with self.assertRaises(ValueError):
                dated_label(text, (2025, 2026))

    def test_long_and_evening_intervals_are_not_standardized(self):
        self.assertEqual(intervals('15.50-19.10'), [("15:50", "19:10")])
        self.assertEqual(intervals('17:40-21:00'), [("17:40", "21:00")])
        with self.assertRaises(ValueError):
            intervals('19.10-15.50')

    def test_wrapped_surname_and_initials(self):
        self.assertEqual(lesson_text('15.50-17.20\nлк\nТекст предмета 223-3 проф. Блино\nва Е. Е.'),
                         '223-3, лк, Блинова Е.Е., Текст предмета')

    def test_absent_type_stays_absent(self):
        self.assertEqual(lesson_text('Текст предмета 148-4 Рева Д.В.'), '148-4, , Рева Д.В., Текст предмета')

    def test_combined_type_is_not_a_subgroup_alternative(self):
        self.assertEqual(lesson_text('лк,пр Текст предмета 513-3 доц Писненко А.Г.'),
                         '513-3, лк/пр, Писненко А.Г., Текст предмета')

    def test_ambiguous_metadata_needs_review(self):
        with self.assertRaises(ValueError):
            lesson_text('Текст предмета 148-4 223-3 Рева Д.В.')


if __name__ == '__main__':
    unittest.main()
