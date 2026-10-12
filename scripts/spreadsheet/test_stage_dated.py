import unittest
import tempfile
from pathlib import Path
from unittest.mock import patch
from openpyxl.worksheet.cell_range import CellRange

from stage_dated import dated_label, intervals, lesson_text, period, stage
from read_sheet import SourceCell, SourceSheet


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

    def test_online_is_explicit_location_and_staff_role_is_not_lesson_type(self):
        self.assertEqual(lesson_text('Суд и правосудие лк. онлайн ст.пр. Гагин С.В.'),
                         'онлайн, лк, Гагин С.В., Суд и правосудие')

    def test_unknown_room_is_not_guessed(self):
        self.assertEqual(lesson_text('Суд и правосудие лк. Гагин С.В.', allow_missing_room=True),
                         ', лк, Гагин С.В., Суд и правосудие')
        with self.assertRaises(ValueError):
            lesson_text('Суд и правосудие лк. Гагин С.В.')

    def test_initials_attached_to_surname(self):
        self.assertEqual(lesson_text('История лк. 107-5 ст.пр. ОшмаринА.А.'),
                         '107-5, лк, Ошмарин А.А., История')

    def test_compact_clock_is_not_an_academic_year_range(self):
        self.assertEqual(intervals('19.30-2100'), [('19:30', '21:00')])
        self.assertEqual(intervals('2025-2026'), [])

    def test_hidden_duplicate_header_and_lesson_are_excluded(self):
        values = {(12, 1): '2.02-08.06 2025-2026', (18, 3): 'TEST-124', (18, 5): 'TEST-124',
                  (19, 2): 'часы', (20, 1): 'ПН. 02.02', (20, 2): '15.50-19.10',
                  (20, 3): 'Hidden subject лк 111-3 Пример А.Б.', (20, 5): 'Текст предмета лк 111-3 Пример А.Б.'}
        cells = {position: SourceCell(*position, value) for position, value in values.items()}
        sheet = SourceSheet(cells, 20, 5, [], set(), {3})
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.xls'
            source.write_bytes(b'read-only source fixture')
            with patch('stage_dated.read_sheet', return_value=sheet):
                result = stage(source, 'Sheet', 'TEST-124', 'https://www.vlsu.ru/source.xls')
        self.assertEqual(list(result['headers']), ['E18'])
        self.assertEqual(len(result['lessons']), 1)
        self.assertEqual(result['lessons'][0]['evidence']['lessonCell'], 'E20')

    def test_hidden_merge_anchor_remains_visible_when_it_spans_a_visible_column(self):
        values = {(12, 1): '2.02-08.06 2025-2026', (18, 3): 'TEST-124', (19, 2): 'часы',
                  (20, 1): 'ПН. 02.02', (20, 2): '15.50-19.10',
                  (20, 3): 'Текст предмета лк 111-3 Пример А.Б.'}
        cells = {position: SourceCell(*position, value) for position, value in values.items()}
        sheet = SourceSheet(cells, 21, 4, [CellRange('C18:D19'), CellRange('C20:D21'), CellRange('A20:A21'), CellRange('B20:B21')], set(), {3})
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / 'source.xls'
            source.write_bytes(b'read-only source fixture')
            with patch('stage_dated.read_sheet', return_value=sheet):
                result = stage(source, 'Sheet', 'TEST-124', 'https://www.vlsu.ru/source.xls')
        self.assertEqual(len(result['lessons']), 1)
        self.assertEqual(result['lessons'][0]['evidence']['lessonCell'], 'C20')


if __name__ == '__main__':
    unittest.main()
