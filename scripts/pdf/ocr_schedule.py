"""OCR one verified official PDF column into an auditable draft schedule."""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import subprocess
import zipfile
from datetime import datetime
from pathlib import Path

import pymupdf
from PIL import Image

from stage_pdf import PAIR_LABEL, detect_day_bounds, detect_group_headers, source_hash

DAY_NAMES = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота"]
DATE = re.compile(r"\b\d{2}\.\d{2}\.\d{4}\b")


def pair_labels(rail_text: str) -> list[int]:
    labels = [int(value) for value in PAIR_LABEL.findall(rail_text)]
    if not labels or labels != list(range(labels[0], labels[0] + len(labels))) \
            or labels[0] < 1 or labels[-1] > 7:
        raise ValueError(f"Cannot verify pair labels in time rail: {labels}")
    return labels


def column_period(text: str) -> tuple[str, str]:
    dates = DATE.findall(text)
    if len(dates) != 2:
        raise ValueError(f"Cannot verify column validity dates: {dates}")
    start, end = (datetime.strptime(value, "%d.%m.%Y").date().isoformat() for value in dates)
    if start > end:
        raise ValueError(f"Column validity dates are reversed: {dates}")
    return start, end


def period_for_column(page: pymupdf.Page, header: pymupdf.Rect,
                      first_day_top: float, nrec: str,
                      drawings: list[dict] | None = None) -> tuple[str, str]:
    # The printed date often belongs to one merged cell spanning several groups.
    date_cells = [drawing["rect"] for drawing in (drawings if drawings is not None else page.get_drawings())
                  if drawing["type"] == "s"
                  and header.y1 - 2 <= drawing["rect"].y0 < first_day_top
                  and drawing["rect"].y1 <= first_day_top + 1
                  and drawing["rect"].x0 <= header.x0 + 1
                  and drawing["rect"].x1 >= header.x1 - 1]
    for cell in sorted(date_cells, key=lambda rect: rect.width):
        try:
            return column_period(page.get_textbox(cell))
        except ValueError:
            continue
    date_spans = [span for block in page.get_text("dict")["blocks"]
                  for line in block.get("lines", [])
                  for span in line.get("spans", [])
                  if header.y1 - 1 <= span["bbox"][1] < first_day_top
                  and DATE.search(span["text"])]
    anchored_spans = [span["text"] for span in date_spans
                      if header.x0 <= span["bbox"][0] < header.x1]
    overlapping_spans = [span["text"] for span in date_spans
                         if min(header.x1, span["bbox"][2])
                         - max(header.x0, span["bbox"][0]) >= header.width * 0.45]
    regions = [
        pymupdf.Rect(header.x0, header.y1, header.x1, first_day_top),
        pymupdf.Rect(header.x0, 0, header.x1, header.y0),
        pymupdf.Rect(0, 0, page.rect.width, header.y0),
        pymupdf.Rect(0, header.y1, page.rect.width, first_day_top),
    ]
    periods = set()
    if anchored_spans:
        try:
            periods.add(column_period(" ".join(anchored_spans)))
        except ValueError:
            pass
    if overlapping_spans:
        try:
            periods.add(column_period(" ".join(overlapping_spans)))
        except ValueError:
            pass
    for region in regions:
        try:
            periods.add(column_period(page.get_textbox(region)))
        except ValueError:
            pass
    if len(periods) != 1:
        raise ValueError(f"Cannot verify one validity period for {nrec}: {periods}")
    return next(iter(periods))


def visible_content(page: pymupdf.Page, rect: pymupdf.Rect) -> bool:
    for block in page.get_text("dict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                bounds = pymupdf.Rect(span["bbox"])
                if span.get("size", 0) >= 3 and span.get("alpha", 255) > 0 and span.get("text", "").strip() \
                        and rect.x0 <= bounds.x0 < rect.x1 and rect.y0 <= bounds.y0 < rect.y1:
                    return True
    return False


def ocr_cell(page: pymupdf.Page, rect: pymupdf.Rect, tesseract: Path) -> str:
    clip = pymupdf.Rect(rect.x0 + 0.5, rect.y0 + 0.5, rect.x1 - 0.5, rect.y1 - 0.5)
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(3, 3), clip=clip, alpha=False)
    image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
    padded = Image.new("RGB", (image.width + 24, image.height + 24), "white")
    padded.paste(image, (12, 12))
    source = io.BytesIO()
    padded.save(source, "PNG")
    image_bytes = source.getvalue()
    for page_mode in (6, 11, 3):
        result = subprocess.run([str(tesseract), "stdin", "stdout", "-l", "rus+eng", "--psm", str(page_mode)],
                                input=image_bytes, capture_output=True, timeout=15, check=True)
        text = " ".join(result.stdout.decode("utf-8").split())
        if text:
            return text
    return ""


def candidate_rectangles(page: pymupdf.Page, group: pymupdf.Rect,
                         day_top: float, day_bottom: float, pair_count: int) -> list[pymupdf.Rect]:
    pair_height = (day_bottom - day_top) / pair_count
    found = {}
    for drawing in page.get_drawings():
        if drawing["type"] != "s":
            continue
        rect = drawing["rect"]
        overlap = min(group.x1, rect.x1) - max(group.x0, rect.x0)
        if overlap < group.width * 0.4 or rect.y0 < day_top - 1 or rect.y1 > day_bottom + 1:
            continue
        if not (pair_height * 0.42 <= rect.height <= pair_height * 1.05):
            continue
        if rect.width < group.width * 0.4:
            continue
        key = tuple(round(value, 1) for value in rect)
        found[key] = rect
    return sorted(found.values(), key=lambda rect: (rect.y0, rect.x0))


def extract(index: dict, archive: Path, nrec: str, tesseract: Path) -> dict:
    location = index["groups"][nrec]
    source = index["sources"][location["sourceId"]]
    if source_hash(archive) != source["sha256"]:
        raise ValueError("Official ZIP hash mismatch")
    with zipfile.ZipFile(archive) as zipped:
        content = zipped.read(zipped.infolist()[location["member"]])
    if hashlib.sha256(content).hexdigest() != location["pdfSha256"]:
        raise ValueError("PDF member hash mismatch")
    document = pymupdf.open(stream=content, filetype="pdf")
    try:
        page = document[location["page"] - 1]
        drawings = page.get_drawings()
        headers = detect_group_headers(drawings, page.rect.width,
                                       lambda rect: page.get_textbox(pymupdf.Rect(*rect)))
        header = pymupdf.Rect(headers[location["column"] - 1])
        name = " ".join(page.get_textbox(header).split())
        if name != location.get("columnHeader", location["groupName"]):
            raise ValueError("PDF group column does not match index")
        days = detect_day_bounds(drawings, page.rect.width, header.y1)
        valid_from, valid_through = period_for_column(page, header, days[0][0], nrec, drawings)
        schedule = []
        report = []
        for day_index, (top, bottom) in enumerate(days, start=1):
            labels = pair_labels(page.get_textbox(pymupdf.Rect(30, top, headers[0][0], bottom)))
            pair_count = len(labels)
            pair_height = (bottom - top) / pair_count
            slots = {f"{mode}{pair}": [] for mode in ("n", "z") for pair in range(1, 8)}
            for rect in candidate_rectangles(page, header, top, bottom, pair_count):
                if not visible_content(page, rect):
                    continue
                text = ocr_cell(page, rect, tesseract)
                position = min(pair_count - 1, max(0, int(((rect.y0 + rect.y1) / 2 - top) / pair_height)))
                pair = labels[position]
                midpoint = top + (position + 0.5) * pair_height
                modes = ["n", "z"] if rect.y0 < midpoint - pair_height * 0.2 \
                    and rect.y1 > midpoint + pair_height * 0.2 else \
                    ["n" if (rect.y0 + rect.y1) / 2 < midpoint else "z"]
                warnings = []
                if not text:
                    warnings.append("visible-text-ocr-empty")
                if rect.x0 < header.x0 - 1 or rect.x1 > header.x1 + 1:
                    warnings.append("shared-or-overflow-column")
                for mode in modes:
                    if text:
                        slots[f"{mode}{pair}"].append((rect.x0, text))
                report.append({"dayIndex": day_index, "pair": pair, "modes": modes,
                               "bounds": [round(value, 2) for value in rect],
                               "rawText": text, "warnings": warnings})
            item = {"name": DAY_NAMES[day_index - 1], "type": "Lessons", "pairLabels": labels}
            item.update({key: "\n".join(text for _, text in sorted(values)) for key, values in slots.items()})
            schedule.append(item)
        return {"schemaVersion": 1, "purpose": "ocr-draft-not-reviewed",
                "groupNrec": nrec, "sourcePdfSha256": location["pdfSha256"],
                "validFrom": valid_from, "validThrough": valid_through,
                "schedule": schedule, "cells": report}
    finally:
        document.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("public/data/document-index.json"))
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--group", required=True)
    parser.add_argument("--tesseract", type=Path, default=Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"))
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    result = extract(json.loads(args.index.read_text(encoding="utf-8")),
                     args.archive, args.group, args.tesseract)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"OCR draft: {len(result['cells'])} visible cells, {args.out}")


if __name__ == "__main__":
    main()
