import unittest
from datetime import date

from stage_dated_pdf import group_cells, lesson_metadata, printed_date, printed_interval, printed_period


class DatedPdfTests(unittest.TestCase):
    def test_exact_period_and_weekday(self):
        start, end = printed_period("c 01.12.2025 по 06.12.2025")
        self.assertEqual(printed_date("СУББОТА 06.12", start, end), "2025-12-06")
        for label in ["ПОНЕДЕЛЬНИК 06.12", "СУББОТА 13.12", "06.12", "СУББОТА 06.12 07.12"]:
            with self.assertRaises(ValueError):
                printed_date(label, start, end)

    def test_year_is_taken_from_explicit_period(self):
        self.assertEqual(printed_date("ЧЕТВЕРГ 01.01", date(2025, 12, 29), date(2026, 1, 3)), "2026-01-01")
        with self.assertRaises(ValueError):
            printed_period("c 01.12 по 06.12")

    def test_time_is_not_reversed_or_invented(self):
        self.assertEqual(printed_interval("8:30-10:00"), ("08:30", "10:00"))
        self.assertEqual(printed_interval("14:00\u201315:30"), ("14:00", "15:30"))
        for text in ["14:00", "15:30-14:00", "14:00-25:00", "14:00-15:30 15:50-17:20"]:
            with self.assertRaises(ValueError):
                printed_interval(text)

    def test_extended_room_is_kept_outside_title(self):
        name, kind = lesson_metadata("Информационные сети лб 404 а-2 Курочкин С.В.")
        self.assertEqual(name, "404 а-2, лб, Курочкин С.В., Информационные сети")
        self.assertEqual(kind, "classes")

    def test_exam_and_credit_retain_their_kind(self):
        for kind in ["экз", "зач", "зач.диф."]:
            name, classification = lesson_metadata(f"Предмет {kind} 418-2 Примеров А.А.")
            self.assertEqual(classification, "exam")
            self.assertIn(f", {kind.rstrip('.')},", name)

    def test_all_language_and_teacher_variants_are_retained(self):
        raw = "Иностранный язык экз 308-1 Михалева О.В. нем. Иностранный язык экз\n408-1 Койкова Т.И. англ. Иностранный язык экз 418-1 Морохова О.А. англ."
        name, kind = lesson_metadata(raw)
        self.assertEqual(kind, "exam")
        self.assertEqual(len(name.splitlines()), 3)
        self.assertIn("308-1, экз, Михалева О.В., Иностранный язык (нем.)", name)
        self.assertIn("418-1, экз, Морохова О.А., Иностранный язык (англ.)", name)

    def test_unknown_or_partial_metadata_is_not_silently_published(self):
        for raw in ["Предмет лб Примеров А.А.", "Предмет 418-2 Примеров А.А.",
                    "Предмет лб 418-2 Примеров А.А. неизвестно", "Предмет лб 418-2 Примеров А.А. Предмет экз 418-2 Примеров А.А."]:
            with self.assertRaises(ValueError):
                lesson_metadata(raw)

    def test_explicit_meeting_has_a_room_but_no_invented_teacher(self):
        self.assertEqual(lesson_metadata("Г-3 ОРГАНИЗАЦИОННОЕ СОБРАНИЕ"),
                         ("Г-3, собрание, , Организационное собрание", "classes"))
        with self.assertRaises(ValueError):
            lesson_metadata("ОРГАНИЗАЦИОННОЕ СОБРАНИЕ")

    def test_sports_building_and_reassessment_annotation_are_kept(self):
        name, kind = lesson_metadata("Физическая культура и спорт зач 101-СК1 Миронова Ю.А.")
        self.assertTrue(name.startswith("101-СК1, зач, Миронова Ю.А.,"))
        self.assertEqual(kind, "exam")
        name, kind = lesson_metadata("Иностранный язык зач 303 а-1 Попкова О.В. англ.+п/а")
        self.assertEqual(name, "303 а-1, зач +п/а, Попкова О.В., Иностранный язык (англ.)")
        self.assertEqual(kind, "exam")
        name, kind = lesson_metadata("Вычислительные системы переат 117-3 Лиходеев С.И.")
        self.assertIn(", переат,", name)
        self.assertEqual(kind, "exam")

    def test_split_column_keeps_both_parts_and_excludes_neighbouring_group(self):
        header = (100, 0, 200, 20)
        cells = [(0, 20, 100, 40), (100, 20, 150, 40), (150, 20, 200, 40), (200, 20, 300, 40)]
        self.assertEqual(group_cells(cells, header, 30), cells[1:3])
        self.assertEqual(group_cells([(100, 20, 300, 40)], header, 30), [(100, 20, 300, 40)])

    def test_two_source_labs_remain_two_variants_in_the_same_interval(self):
        name, kind = lesson_metadata("Физика лб 424-3 Струкова М.А.\nФизика лб 425-3 Струкова М.А.")
        self.assertEqual(kind, "classes")
        self.assertEqual(name.splitlines(), ["424-3, лб, Струкова М.А., Физика", "425-3, лб, Струкова М.А., Физика"])


if __name__ == '__main__':
    unittest.main()
