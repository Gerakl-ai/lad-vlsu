"""Extract visible PDF text as review candidates, never as an approved timetable."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter
from pathlib import Path
from typing import Any

from stage_pdf import source_hash


def candidate_blocks(blocks: list[dict[str, Any]], day: dict[str, Any]) -> list[dict[str, Any]]:
    left, top, right, bottom = day["bounds"]
    pair_count = day.get("pairCount")
    if not isinstance(pair_count, int) or not 1 <= pair_count <= 10:
        raise ValueError("Day needs a verified pair count from the PDF time rail")
    half_row_height = (bottom - top) / (2 * pair_count)
    suggestions = []
    for block in blocks:
        visible = []
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                x0, y0, x1, y1 = span["bbox"]
                if (span.get("alpha", 255) == 0 or span.get("size", 0) < 1
                        or not span.get("text", "").strip()):
                    continue
                if left - 1 <= x0 < right and top <= y0 < bottom:
                    row = min(2 * pair_count - 1,
                              max(0, math.floor(((y0 + y1) / 2 - top) / half_row_height)))
                    visible.append({"text": span["text"].strip(), "bbox": [x0, y0, x1, y1],
                                    "halfRow": row})
        if not visible:
            continue

        visible.sort(key=lambda item: (item["bbox"][1], item["bbox"][0]))
        rows = {item["halfRow"] for item in visible}
        first_row = min(rows)
        warnings = []
        if len(rows) > 1:
            warnings.append("crosses-half-row")
        if len({row // 2 for row in rows}) > 1:
            warnings.append("crosses-pair-boundary")
        if any(item["bbox"][2] > right + 1 for item in visible):
            warnings.append("crosses-column-boundary")
        if any(item["bbox"][3] > bottom + 1 for item in visible):
            warnings.append("crosses-day-boundary")
        suggestions.append({
            "modeHint": "n" if first_row % 2 == 0 else "z",
            "pairIndexHint": first_row // 2 + 1,
            "rawTextHint": " ".join(item["text"] for item in visible),
            "pageBounds": [min(item["bbox"][0] for item in visible),
                           min(item["bbox"][1] for item in visible),
                           max(item["bbox"][2] for item in visible),
                           max(item["bbox"][3] for item in visible)],
            "warnings": warnings,
            "spans": visible,
        })
    half_rows = Counter((item["pairIndexHint"], item["modeHint"]) for item in suggestions)
    for item in suggestions:
        if half_rows[item["pairIndexHint"], item["modeHint"]] > 1:
            item["warnings"].append("multiple-blocks-in-half-row")
    return sorted(suggestions, key=lambda item: (item["pairIndexHint"], item["modeHint"],
                                                 item["pageBounds"][0], item["pageBounds"][1]))


def draft(source: Path, expected_sha256: str, staging: dict[str, Any],
          page_number: int, column_number: int) -> dict[str, Any]:
    actual_hash = source_hash(source)
    if actual_hash.lower() != expected_sha256.lower() or actual_hash != staging.get("source", {}).get("sha256"):
        raise ValueError("PDF SHA-256 does not match the verified staging source")
    group = next((item for item in staging.get("groups", [])
                  if item.get("page") == page_number and item.get("column") == column_number), None)
    if not group or len(group.get("days", [])) != 5:
        raise ValueError("Group column is missing or incomplete in staging")

    try:
        import pymupdf
    except ImportError as error:
        raise RuntimeError("Install PyMuPDF first: python -m pip install pymupdf") from error

    document = pymupdf.open(source)
    try:
        if not 1 <= page_number <= len(document):
            raise ValueError("Page is outside the verified PDF")
        page = document[page_number - 1]
        blocks = page.get_text("dict")["blocks"]
        days = [{"dayIndex": day["day"], "sourceImage": day["groupImage"],
                 "contextImage": day["contextImage"],
                 "pairCount": day["pairCount"],
                 "suggestions": candidate_blocks(blocks, day)}
                for day in group["days"]]
        all_suggestions = [suggestion for day in days for suggestion in day["suggestions"]]
        return {
            "schemaVersion": 1,
            "purpose": "draft-transcription-only",
            "source": {"pdfSha256": actual_hash},
            "group": {"page": page_number, "column": column_number,
                      "headerImage": group["headerImage"]},
            "summary": {"textBlocks": len(all_suggestions),
                        "flaggedBlocks": sum(bool(item["warnings"]) for item in all_suggestions)},
            "days": days,
        }
    finally:
        document.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--staging", type=Path, required=True)
    parser.add_argument("--page", type=int, required=True)
    parser.add_argument("--column", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    staging = json.loads(args.staging.read_text(encoding="utf-8"))
    result = draft(args.source, args.sha256, staging, args.page, args.column)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Drafted {result['summary']['textBlocks']} text blocks, "
          f"{result['summary']['flaggedBlocks']} flagged for human review: {args.out}")


if __name__ == "__main__":
    main()
