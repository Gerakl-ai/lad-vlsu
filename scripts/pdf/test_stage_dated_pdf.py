import unittest
from datetime import date
from pathlib import Path
from tempfile import TemporaryDirectory

from stage_dated_pdf import group_cells, lesson_metadata, printed_date, printed_interval, printed_period, printed_start, room_first_metadata, reviewed_metadata, reviewed_timing, stage


class DatedPdfTests(unittest.TestCase):
    def test_full_printed_year_must_agree_with_period_and_weekday(self):
        self.assertEqual(printed_date("Среда 21.01.2026", date(2026, 1, 19), date(2026, 1, 24)), "2026-01-21")
        with self.assertRaises(ValueError):
            printed_date("Среда 21.01.2025", date(2026, 1, 19), date(2026, 1, 24))

    def test_room_first_layout_preserves_teacher_and_parenthetical_reassessment(self):
        self.assertEqual(room_first_metadata("408-1, переат, Математика (Кастэн Ю.А.)"), ("408-1, переат, Кастэн Ю.А., Математика", "exam"))
        self.assertEqual(room_first_metadata("213-6, зач.диф., Кравцова Е.Р., Предпринимательство"), ("213-6, зач.диф, Кравцова Е.Р., Предпринимательство", "exam"))
        self.assertEqual(room_first_metadata("214-6, экз, Казурова О.А., Предмет (+п/а)"), ("214-6, экз +п/а, Казурова О.А., Предмет", "exam"))
        self.assertEqual(room_first_metadata("107-6, (ОРГАНИЗАЦИОННЫЕ СОБРАНИЕ)"), ("107-6, собрание, , Организационное собрание", "classes"))
        for raw in ["101-СК1, Репникова Е.А., Физическая культура и спорт", "101-6, зач, Предмет", "101-6, зач, Примеров А.А., Предмет 102-6, экз, Другой"]:
            with self.assertRaises(ValueError):
                room_first_metadata(raw)

    def test_explicit_start_is_not_converted_into_an_invented_end(self):
        self.assertEqual(printed_start("8:30 101-6, зач, Subject"), ("08:30", "101-6, зач, Subject"))
        evidence = {"page": 1, "lessonBox": [1, 2, 3, 4], "rawText": "16:00 Subject", "visibleText": "16:00 Subject"}
        correction = {"id": "start", "date": "2026-01-21", "gridStart": "15:50", "gridEnd": "17:20", "page": 1,
                      "lessonBox": evidence["lessonBox"], "expectedRawText": evidence["rawText"], "expectedVisibleText": evidence["visibleText"],
                      "printedStart": "16:00", "reason": "Checked", "mode": "printed-start"}
        self.assertEqual(reviewed_timing([correction], "2026-01-21", ("15:50", "17:20"), evidence, "16:00"), correction)
        with self.assertRaises(ValueError):
            reviewed_timing([], "2026-01-21", ("15:50", "17:20"), evidence, "16:00")
        with self.assertRaises(ValueError):
            reviewed_timing([correction], "2026-01-21", ("15:50", "17:20"), {**evidence, "visibleText": "Changed"}, "16:00")
        outside = {**correction, "gridStart": "12:10", "gridEnd": "13:40", "mode": "unconfirmed", "conflict": "outside-grid"}
        self.assertEqual(reviewed_timing([outside], "2026-01-21", ("12:10", "13:40"), evidence, "16:00"), outside)
        with self.assertRaises(ValueError):
            reviewed_timing([{**outside, "conflict": "coincident-start"}], "2026-01-21", ("12:10", "13:40"), evidence, "16:00")
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

    def test_numeric_meeting_and_printed_initials_are_preserved(self):
        self.assertEqual(lesson_metadata("426-1 ОРГАНИЗАЦИОННЫЕ СОБРАНИЕ"),
                         ("426-1, собрание, , Организационное собрание", "classes"))
        self.assertEqual(lesson_metadata("Физкультура переат 517-3 Денисов Ил.В."),
                         ("517-3, переат, Денисов Ил.В., Физкультура", "exam"))
        self.assertEqual(lesson_metadata("Математика экз 425-1 Петренко И.А. п/а"),
                         ("425-1, экз п/а, Петренко И.А., Математика", "exam"))

    def test_reviewed_incomplete_metadata_is_bound_to_raw_text_geometry_and_time(self):
        evidence = {"page": 1, "lessonBox": (1, 2, 3, 4), "rawText": "Source with missing teacher"}
        correction = {"id": "review", "page": 1, "date": "2026-01-21", "start": "15:50", "end": "17:20",
                      "lessonBox": [1, 2, 3, 4], "expectedRawText": evidence["rawText"], "reason": "Checked image",
                      "name": ", переат, , Subject", "scheduleKind": "exam"}
        self.assertEqual(reviewed_metadata([correction], "2026-01-21", ("15:50", "17:20"), evidence),
                         (", переат, , Subject", "exam", "review"))
        self.assertIsNone(reviewed_metadata([correction], "2026-01-22", ("15:50", "17:20"), evidence))
        for change in [{"rawText": "Changed source"}, {"lessonBox": [1, 2, 3, 5]}]:
            with self.assertRaises(ValueError):
                reviewed_metadata([correction], "2026-01-21", ("15:50", "17:20"), {**evidence, **change})

    def test_bad_transcription_remains_blocked(self):
        evidence = {"page": 1, "lessonBox": [1, 2, 3, 4], "rawText": "Source"}
        correction = {"id": "review", "page": 1, "date": "2026-01-21", "start": "15:50", "end": "17:20",
                      "lessonBox": [1, 2, 3, 4], "expectedRawText": "Source", "reason": "Checked",
                      "name": ", переат, , Subject", "scheduleKind": "exam"}
        for change in [{"reason": ""}, {"scheduleKind": "unknown"}, {"name": "Subject"}, {"name": ", переат, , "}]:
            with self.assertRaises(ValueError):
                reviewed_metadata([{**correction, **change}], "2026-01-21", ("15:50", "17:20"), evidence)

    def test_correction_cannot_be_applied_to_a_different_source_hash(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / 'changed.pdf'
            source.write_bytes(b'Changed official PDF')
            with self.assertRaisesRegex(ValueError, 'source hash changed'):
                stage(source, 'Group', 'https://www.vlsu.ru/file.pdf', {"corrections": [
                    {"id": "checked", "groupName": "Group", "sourceSha256": 'a' * 64}]})


if __name__ == '__main__':
    unittest.main()
