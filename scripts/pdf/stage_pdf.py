"""Create reviewable image crops from an official timetable PDF.

This tool deliberately does not OCR or publish schedule data. Every group
column still needs a human-reviewed transcription before it can be imported.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from typing import Any, Callable


GROUP_CODE = re.compile(r"-\d{3}(?:\b|$)")


def detect_group_headers(
    drawings: list[dict[str, Any]],
    page_width: float,
    text_for_rect: Callable[[tuple[float, float, float, float]], str] | None = None,
) -> list[tuple[float, float, float, float]]:
    candidates: dict[int, list[tuple[float, float, float, float]]] = {}
    for drawing in drawings:
        rect = drawing["rect"]
        x0, y0, x1, y1 = rect
        if drawing["type"] != "f" or not (140 < y0 < 310 and 35 < y1 - y0 < 50):
            continue
        if x0 < 100 or x1 - x0 < 100:
            continue
        candidates.setdefault(round(y0), []).append((x0, y0, x1, y1))

    if not candidates:
        raise ValueError("No filled group header row found")
    if text_for_rect is None:
        row = max(candidates.values(), key=len)
    else:
        scored = [(sum(bool(GROUP_CODE.search(text_for_rect(rect))) for rect in rects), rects)
                  for rects in candidates.values()]
        count, row = max(scored, key=lambda item: (item[0], len(item[1])))
        if count < 1:
            raise ValueError("No group-code header row found")
    row = sorted(row, key=lambda rect: rect[0])
    if (len(row) < (1 if text_for_rect is not None else 2)
            or row[-1][2] - row[0][0] < page_width * 0.7):
        raise ValueError("Group header row is incomplete")
    if any(abs(left[2] - right[0]) > 2 for left, right in zip(row, row[1:])):
        raise ValueError("Group header columns are not contiguous")
    return row


def detect_day_bounds(drawings: list[dict[str, Any]], page_width: float, header_bottom: float) -> list[tuple[float, float]]:
    lines = sorted({round(drawing["rect"][1]) for drawing in drawings
                    if drawing["type"] == "s"
                    and drawing["rect"][2] - drawing["rect"][0] > page_width * 0.88
                    and drawing["rect"][3] - drawing["rect"][1] < 2
                    and drawing["rect"][1] > header_bottom + 20})
    if not 2 <= len(lines) <= 8:
        raise ValueError(f"Expected day separator lines, found {len(lines)}")
    if any(end - start < 100 for start, end in zip(lines, lines[1:])):
        raise ValueError("Day separators are too close together")
    return list(zip(lines, lines[1:]))


def source_hash(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare timetable PDF crops for human review")
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--sha256", required=True, help="Expected SHA-256 of the verified source PDF")
    parser.add_argument("--out", type=Path, default=Path("artifacts/pdf-staging"))
    parser.add_argument("--page", type=int, help="One-based page number")
    parser.add_argument("--column", type=int, help="One-based group column, requires --page")
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()
    if args.column is not None and args.page is None:
        parser.error("--column requires --page")
    if args.scale < 1 or args.scale > 4:
        parser.error("--scale must be between 1 and 4")
    if not args.source.is_file():
        parser.error("Source PDF does not exist")
    actual_hash = source_hash(args.source)
    if actual_hash.lower() != args.sha256.lower():
        parser.error(f"Source SHA-256 mismatch: {actual_hash}")

    try:
        import pymupdf
    except ImportError as error:
        raise SystemExit("Install PyMuPDF first: python -m pip install pymupdf") from error

    document = pymupdf.open(args.source)
    pages = [args.page] if args.page is not None else list(range(1, len(document) + 1))
    if any(page < 1 or page > len(document) for page in pages):
        parser.error(f"Page must be between 1 and {len(document)}")

    output = args.out / actual_hash[:12]
    manifest_path = output / "manifest.json"
    previous = None
    if manifest_path.exists():
        previous = json.loads(manifest_path.read_text(encoding="utf-8"))
        if previous.get("source", {}).get("sha256") != actual_hash:
            parser.error("Output already belongs to a different source")
        if previous.get("scale") != args.scale:
            parser.error("Output already uses another render scale")

    def render(page: Any, bounds: tuple[float, float, float, float], path: Path) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        clip = pymupdf.Rect(*bounds) & page.rect
        if clip.is_empty:
            raise ValueError(f"Empty crop: {bounds}")
        page.get_pixmap(matrix=pymupdf.Matrix(args.scale, args.scale), clip=clip, alpha=False).save(path)

    entries = []
    for page_number in pages:
        page = document[page_number - 1]
        drawings = page.get_drawings()
        headers = detect_group_headers(drawings, page.rect.width,
                                       lambda rect: page.get_textbox(pymupdf.Rect(*rect)))
        days = detect_day_bounds(drawings, page.rect.width, headers[0][3])
        page_header_image = f"page-{page_number:02d}/source-heading.png"
        render(page, (headers[0][0], 110, headers[-1][2], days[0][0]), output / page_header_image)
        columns = [args.column] if args.column is not None else list(range(1, len(headers) + 1))
        if any(column < 1 or column > len(headers) for column in columns):
            parser.error(f"Page {page_number} has {len(headers)} group columns")
        for column_number in columns:
            x0, y0, x1, _ = headers[column_number - 1]
            name = f"page-{page_number:02d}/group-{column_number:02d}"
            header_image = f"{name}/header.png"
            render(page, (x0, y0, x1, headers[column_number - 1][3]), output / header_image)
            day_images = []
            for day_number, (top, bottom) in enumerate(days, start=1):
                group_image = f"{name}/day-{day_number:02d}.png"
                context_image = f"{name}/day-{day_number:02d}-context.png"
                rail_image = f"page-{page_number:02d}/time-rail-{day_number:02d}.png"
                render(page, (x0, top, x1, bottom), output / group_image)
                bleed = (x1 - x0) * 0.65
                render(page, (max(headers[0][0], x0 - bleed), top,
                              min(headers[-1][2], x1 + bleed), bottom), output / context_image)
                if not (output / rail_image).exists():
                    render(page, (30, top, headers[0][0], bottom), output / rail_image)
                day_images.append({"day": day_number, "groupImage": group_image,
                                   "contextImage": context_image, "timeRailImage": rail_image,
                                   "bounds": [x0, top, x1, bottom]})
            entries.append({"id": f"p{page_number:02d}-g{column_number:02d}",
                            "page": page_number, "column": column_number,
                            "groupName": None, "groupNrec": None, "reviewStatus": "needs-review",
                            "pageHeaderImage": page_header_image,
                            "headerImage": header_image, "days": day_images})

    combined = {entry["id"]: entry for entry in previous.get("groups", [])} if previous else {}
    combined.update({entry["id"]: entry for entry in entries})
    manifest = {"schemaVersion": 1,
                "source": {"filename": args.source.name, "sha256": actual_hash, "pageCount": len(document)},
                "purpose": "human-review-only", "scale": args.scale,
                "groups": [combined[key] for key in sorted(combined)]}
    output.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Staged {len(entries)} group columns in {output}")


if __name__ == "__main__":
    main()
