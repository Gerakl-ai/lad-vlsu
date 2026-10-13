"""Extract a dated digital PDF grid for review; never publish automatically."""

import argparse
import hashlib
import json
import re
from contextlib import closing
from datetime import date
from pathlib import Path

CLOCK = r"(?:[01]?\d|2[0-3]):[0-5]\d"
INTERVAL = re.compile(rf"^\s*({CLOCK})\s*[-\u2013\u2014]\s*({CLOCK})\s*$")
WEEKDAYS = ["понедельник", "вторник", "среда", "четверг", "пятница", "суббота", "воскресенье"]
TEACHER = r"[А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s*[А-ЯЁ][а-яё]?\s*\.\s*[А-ЯЁ][а-яё]?\s*\."
ROOM = r"(?:\d{1,4}-СК\d{1,2}|\d{1,4}(?:\s+[а-яё])?-\d{1,2}|[А-ЯЁ]-\d{1,2})"
VARIANT = re.compile(
    rf"(?P<subject>.+?)\s+(?P<kind>зач\s*\.\s*диф\s*\.|зач\.?|экз\.?|переат|лб\.?|лк\.?|пр\.?)\s+"
    rf"(?P<room>{ROOM})\s+(?P<teacher>{TEACHER})"
    r"(?:\s*(?P<language>англ\.|нем\.))?(?:\s*(?P<annotation>(?:\+\s*)?п\s*/\s*а))?\s*"
)


def printed_period(text):
    stamps = re.findall(r"(?<!\d)(\d{2})\.(\d{2})\.(20\d{2})(?!\d)", text)
    if len(stamps) != 2:
        raise ValueError(f"Ambiguous group period: {text}")
    start, through = [date(int(y), int(m), int(d)) for d, m, y in stamps]
    if start > through:
        raise ValueError("Reversed group period")
    return start, through


def printed_date(text, start, through):
    match = re.fullmatch(r"\s*([А-Яа-яЁё]+)\s+(\d{2})\.(\d{2})\s*", text)
    if not match or match[1].lower() not in WEEKDAYS:
        raise ValueError(f"Ambiguous dated day: {text}")
    candidates = []
    for year in range(start.year, through.year + 1):
        try:
            stamp = date(year, int(match[3]), int(match[2]))
        except ValueError:
            continue
        if start <= stamp <= through:
            candidates.append(stamp)
    if len(candidates) != 1 or candidates[0].weekday() != WEEKDAYS.index(match[1].lower()):
        raise ValueError(f"Day or year disagrees with the source period: {text}")
    return candidates[0].isoformat()


def printed_interval(text):
    match = INTERVAL.fullmatch(text)
    if not match:
        raise ValueError(f"No exact printed interval: {text}")
    result = tuple(f"{int(value.split(':')[0]):02}:{value.split(':')[1]}" for value in match.groups())
    if result[0] >= result[1]:
        raise ValueError(f"Reversed printed interval: {text}")
    return result


def lesson_metadata(raw):
    text = re.sub(r"\s+", " ", raw).strip()
    meeting = re.fullmatch(rf"(?P<room>{ROOM})\s+ОРГАНИЗАЦИОНН(?:ОЕ|ЫЕ) СОБРАНИЕ", text)
    if meeting:
        return f"{meeting['room']}, собрание, , Организационное собрание", "classes"
    entries = []
    offset = 0
    kinds = set()
    for match in VARIANT.finditer(text):
        if match.start() != offset:
            raise ValueError("Unparsed source text between lesson variants")
        subject = match["subject"].strip()
        # Reject additional unparsed metadata rather than accepting it as a title.
        if re.search(r"(?<!\w)(?:лб|экз|зач|переат)(?!\w)", subject, re.I):
            raise ValueError("Unparsed metadata inside subject")
        teacher = re.sub(r"\s*\.\s*", ".", match["teacher"])
        teacher = re.sub(r"(?<=[а-яё])(?=[А-ЯЁ]\.)", " ", teacher)
        room = re.sub(r"\s+", " ", match["room"])
        kind = re.sub(r"\s+", "", match["kind"]).rstrip(".")
        if match["language"]:
            subject += f" ({match['language']})"
        if match["annotation"]:
            kind += " " + re.sub(r"\s+", "", match["annotation"])
        kinds.add("exam" if kind.startswith(("зач", "экз", "переат")) else "classes")
        entries.append(f"{room}, {kind}, {teacher}, {subject}")
        offset = match.end()
    if not entries or offset != len(text) or len(kinds) != 1:
        raise ValueError("Subject, room, kind or teacher requires source review")
    return "\n".join(entries), kinds.pop()


def contains(box, x, y):
    return box and box[0] < x < box[2] and box[1] < y < box[3]


def group_cells(cells, group_box, y):
    return sorted((box for box in cells if box and box[1] < y < box[3]
                   and min(box[2], group_box[2]) - max(box[0], group_box[0]) > 0.1), key=lambda box: box[0])


def reviewed_metadata(corrections, stamp, interval, evidence):
    for correction in corrections:
        if (correction["date"], correction["start"], correction["end"], correction["page"]) != (stamp, *interval, evidence["page"]):
            continue
        if correction["expectedRawText"] != evidence["rawText"] or tuple(correction["lessonBox"]) != tuple(evidence["lessonBox"]):
            raise ValueError(f"Reviewed source cell changed: {correction['id']}")
        if correction["scheduleKind"] not in ["classes", "exam"] or not correction["reason"].strip():
            raise ValueError("Invalid reviewed metadata")
        lines = correction["name"].splitlines()
        if not lines or any(len(line.split(',')) < 4 or not line.split(',')[3].strip() for line in lines):
            raise ValueError("Invalid reviewed lesson transcription")
        return correction["name"], correction["scheduleKind"], correction["id"]
    return None


def stage(source, group_name, source_url, metadata_review=None):
    import pdfplumber
    import pypdfium2 as pdfium

    lessons, errors, locations = [], [], []
    source_hash = hashlib.sha256(Path(source).read_bytes()).hexdigest()
    corrections = [entry for entry in (metadata_review or {}).get("corrections", []) if entry["groupName"] == group_name]
    if any(entry["sourceSha256"] != source_hash for entry in corrections):
        raise ValueError("Reviewed metadata source hash changed")
    correction_ids = [entry["id"] for entry in corrections]
    if len(set(correction_ids)) != len(correction_ids):
        raise ValueError("Duplicate reviewed metadata IDs")
    applied = set()
    with pdfplumber.open(source) as geometry, pdfium.PdfDocument(str(source)) as document:
        for page_index, page in enumerate(geometry.pages):
            with closing(document[page_index]) as pdf_page, closing(pdf_page.get_textpage()) as textpage:
                def read(box):
                    return textpage.get_text_bounded(box[0], page.height - box[3], box[2], page.height - box[1]).strip() if box else ""

                for table_index, table in enumerate(page.find_tables()):
                    headers = [(index, box) for index, row in enumerate(table.rows) for box in row.cells if read(box) == group_name]
                    if not headers:
                        continue
                    if len(headers) != 1:
                        raise ValueError("More than one group column in a table")
                    header_index, header_box = headers[0]
                    group_x = (header_box[0] + header_box[2]) / 2
                    period_box = next((box for box in table.rows[header_index + 1].cells if box and box[0] < group_x < box[2]), None)
                    period_text = read(period_box)
                    start, through = printed_period(period_text)
                    locations.append({"page": page_index + 1, "table": table_index + 1,
                                      "headerBox": header_box, "headerText": read(header_box), "periodBox": period_box,
                                      "periodText": period_text, "validFrom": start.isoformat(), "validThrough": through.isoformat()})
                    covered = set()
                    body_top = period_box[3]
                    for row_index, row in enumerate(table.rows[header_index + 2:], header_index + 2):
                        time_box = row.cells[1] if len(row.cells) > 1 else None
                        time_text = read(time_box)
                        if not INTERVAL.fullmatch(time_text):
                            continue
                        time_y = (time_box[1] + time_box[3]) / 2
                        source_cells = [(box, read(box)) for box in group_cells(table.cells, header_box, time_y) if read(box)]
                        if not source_cells:
                            continue
                        lesson_box = source_cells[0][0]
                        raw = "\n".join(value for _, value in source_cells)
                        covered.update(tuple(box) for box, _ in source_cells)
                        day_box = next((box for box in table.cells if contains(box, table.bbox[0] + (time_box[0] - table.bbox[0]) / 2, time_y)), None)
                        try:
                            day_text = read(day_box)
                            stamp = printed_date(day_text, start, through)
                            interval = printed_interval(time_text)
                            evidence = {"page": page_index + 1, "table": table_index + 1, "row": row_index + 1,
                                                         "lessonBox": lesson_box, "rawText": raw, "timeBox": time_box, "timeText": time_text,
                                                         "dayBox": day_box, "dayText": day_text, "headerBox": header_box, "headerText": group_name,
                                                         "printedInterval": interval,
                                                         **({"lessonBoxes": [box for box, _ in source_cells], "rawTexts": [value for _, value in source_cells]}
                                                            if len(source_cells) > 1 else {})}
                            reviewed = reviewed_metadata(corrections, stamp, interval, evidence)
                            if reviewed:
                                name, kind, correction_id = reviewed
                                evidence["metadataReviewId"] = correction_id
                                applied.add(correction_id)
                            else:
                                name, kind = lesson_metadata(raw)
                            lessons.append({"date": stamp, "start": interval[0], "end": interval[1], "name": name, "scheduleKind": kind,
                                            "evidence": evidence})
                        except ValueError as error:
                            errors.append({"page": page_index + 1, "row": row_index + 1, "rawText": raw, "message": str(error)})
                    for box in table.cells:
                        if box and box[1] >= body_top and min(box[2], header_box[2]) - max(box[0], header_box[0]) > 0.1 and read(box) and tuple(box) not in covered:
                            errors.append({"page": page_index + 1, "lessonBox": box, "rawText": read(box), "message": "Nonempty cell has no fully parsed interval"})
    if not locations or not lessons and not errors:
        raise ValueError("No matching dated group timetable")
    if applied != set(correction_ids):
        raise ValueError(f"Reviewed metadata was not applied: {sorted(set(correction_ids) - applied)}")
    periods = {(entry["validFrom"], entry["validThrough"]) for entry in locations}
    if len(periods) != 1:
        raise ValueError("Multiple group periods require separate source review")
    valid_from, valid_through = periods.pop()
    lessons.sort(key=lambda entry: (entry["date"], entry["start"], entry["name"]))
    return {"schemaVersion": 1, "purpose": "dated-pdf-grid-staging", "groupName": group_name, "sheet": "PDF",
            "source": {"url": source_url, "sha256": source_hash,
                       "validFrom": valid_from, "validThrough": valid_through, "locations": locations},
            "lessons": lessons, "errors": errors}


def main():
    parser = argparse.ArgumentParser()
    for name in ["source", "group", "source-url", "out"]:
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--metadata-review")
    args = parser.parse_args()
    metadata_review = json.loads(Path(args.metadata_review).read_text(encoding="utf-8")) if args.metadata_review else None
    result = stage(args.source, args.group, args.source_url, metadata_review)
    Path(args.out).write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"group": args.group, "lessons": len(result["lessons"]), "errors": result["errors"]}, ensure_ascii=False))
    if result["errors"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
