"""Inspect a digital grid without producing an importable timetable."""

import argparse
import hashlib
import json
import re
from contextlib import closing
from pathlib import Path

from stage_dated_pdf import CLOCK, INTERVAL, contains, exclude_white_body_text, group_cells, printed_date, printed_interval, printed_period


def inspect(source, groups, source_url, white_body=False):
    import pdfplumber
    import pypdfium2 as pdfium

    result = {name: {"groupName": name, "locations": [], "cells": [], "errors": []} for name in groups}
    styles = []
    with pdfplumber.open(source) as geometry, pdfium.PdfDocument(str(source)) as document:
        for page_index, page in enumerate(geometry.pages):
            body = exclude_white_body_text(page, white_body)
            styles.append({"page": page_index + 1, "ignoredWhiteCharacters": len(page.chars) - len(body.chars),
                           "whiteBodyAssumption": white_body})
            with closing(document[page_index]) as pdf_page, closing(pdf_page.get_textpage()) as textpage:
                def read(box):
                    return textpage.get_text_bounded(box[0], page.height - box[3], box[2], page.height - box[1]).strip() if box else ""

                def visible(box):
                    return (body.crop(box, strict=False).extract_text() or "").strip() if white_body else read(box)

                for table_index, table in enumerate(page.find_tables()):
                    for name in groups:
                        headers = [(index, box) for index, row in enumerate(table.rows) for box in row.cells if read(box) == name]
                        if not headers:
                            continue
                        if len(headers) != 1:
                            raise ValueError("Multiple group headers require review")
                        header_index, header_box = headers[0]
                        group_x = (header_box[0] + header_box[2]) / 2
                        period_box = next((box for box in table.rows[header_index + 1].cells if box and box[0] < group_x < box[2]), None)
                        start, through = printed_period(read(period_box))
                        output = result[name]
                        output["locations"].append({"page": page_index + 1, "table": table_index + 1,
                                                    "headerBox": header_box, "periodBox": period_box,
                                                    "periodText": read(period_box), "validFrom": start.isoformat(), "validThrough": through.isoformat()})
                        covered = set()
                        for row_index, row in enumerate(table.rows[header_index + 2:], header_index + 2):
                            time_box = row.cells[1] if len(row.cells) > 1 else None
                            time_text = read(time_box)
                            if not INTERVAL.fullmatch(time_text):
                                continue
                            y = (time_box[1] + time_box[3]) / 2
                            day_box = next((box for box in table.cells if contains(box, table.bbox[0] + (time_box[0] - table.bbox[0]) / 2, y)), None)
                            day_text = read(day_box)
                            year = re.search(r"\.(20\d{2})$", day_text)
                            label = day_text[:year.start()] if year else day_text
                            stamp = printed_date(label, start, through)
                            if year and stamp[:4] != year[1]:
                                raise ValueError("Printed year disagrees with group period")
                            interval = printed_interval(time_text)
                            for box in group_cells(table.cells, header_box, y):
                                text = visible(box)
                                if not text:
                                    continue
                                covered.add(tuple(box))
                                prefix = re.match(rf"^({CLOCK})\s+", text)
                                output["cells"].append({"date": stamp, "gridStart": interval[0], "gridEnd": interval[1],
                                                        "explicitStart": prefix[1] if prefix else None,
                                                        "visibleText": text, "rawText": read(box), "lessonBox": box,
                                                        "timeText": time_text, "timeBox": time_box, "dayText": day_text,
                                                        "dayBox": day_box, "page": page_index + 1, "table": table_index + 1, "row": row_index + 1})
                        for box in table.cells:
                            if box and box[1] >= period_box[3] and min(box[2], header_box[2]) - max(box[0], header_box[0]) > .1 and visible(box) and tuple(box) not in covered:
                                output["errors"].append({"page": page_index + 1, "lessonBox": box, "visibleText": visible(box),
                                                         "reason": "Visible cell has no inspected printed interval"})
    if any(not output["locations"] for output in result.values()):
        raise ValueError("Some requested group headers were not found")
    return {"schemaVersion": 1, "purpose": "inspection-only", "source": {"url": source_url,
            "sha256": hashlib.sha256(Path(source).read_bytes()).hexdigest(), "styles": styles}, "groups": list(result.values())}


def main():
    parser = argparse.ArgumentParser()
    for name in ["source", "source-url", "out"]:
        parser.add_argument(f"--{name}", required=True)
    parser.add_argument("--groups", nargs="+", required=True)
    parser.add_argument("--white-body-background", action="store_true")
    args = parser.parse_args()
    report = inspect(args.source, args.groups, args.source_url, args.white_body_background)
    Path(args.out).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    for group in report["groups"]:
        conflicts = [cell for cell in group["cells"] if cell["explicitStart"] and cell["explicitStart"] != cell["gridStart"]]
        print(json.dumps({"group": group["groupName"], "intervals": len(group["cells"]), "startConflicts": len(conflicts),
                          "errors": len(group["errors"])}, ensure_ascii=False))


if __name__ == '__main__':
    main()
