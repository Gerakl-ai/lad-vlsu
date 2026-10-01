"""Render official timetable columns as offline-capable WebP day images.

The images are a visual fallback, not a machine transcription. Source ZIP and
member hashes are checked against the published document index before rendering.
"""

from __future__ import annotations

import argparse
import hashlib
import io
import json
import zipfile
from collections import defaultdict
from pathlib import Path

import pymupdf
from PIL import Image

from stage_pdf import detect_day_bounds, detect_group_headers, source_hash


def render(index_path: Path, archives: dict[str, Path], out: Path,
           only_group: str | None = None, scale: float = 2.0,
           skip_groups: set[str] | None = None) -> dict:
    index = json.loads(index_path.read_text(encoding="utf-8"))
    if index.get("schemaVersion") != 1:
        raise ValueError("Unknown document index schema")
    groups = index["groups"]
    if only_group:
        if only_group not in groups:
            raise ValueError("Group has no official document locator")
        groups = {only_group: groups[only_group]}
    if skip_groups:
        groups = {nrec: location for nrec, location in groups.items() if nrec not in skip_groups}

    by_member = defaultdict(list)
    for nrec, location in groups.items():
        by_member[(location["sourceId"], location["member"])].append((nrec, location))

    output = {"schemaVersion": 1, "groups": {}, "sourceHashes": {}}
    for source_id in sorted({source_id for source_id, _ in by_member}):
        archive = archives.get(source_id)
        if not archive or not archive.is_file():
            raise ValueError(f"Missing ZIP for source {source_id}")
        expected = index["sources"][source_id]["sha256"]
        actual = source_hash(archive)
        if actual != expected:
            raise ValueError(f"ZIP hash mismatch for source {source_id}: {actual}")
        output["sourceHashes"][source_id] = actual

        with zipfile.ZipFile(archive) as zipped:
            members = zipped.infolist()
            for member_number in sorted(member for sid, member in by_member if sid == source_id):
                member = members[member_number]
                if member.file_size > 20 * 1024 * 1024 or not member.filename.lower().endswith(".pdf"):
                    raise ValueError(f"Unexpected ZIP member {source_id}/{member_number}")
                content = zipped.read(member)
                expected_pdf = by_member[(source_id, member_number)][0][1]["pdfSha256"]
                if hashlib.sha256(content).hexdigest() != expected_pdf:
                    raise ValueError(f"PDF hash mismatch for {source_id}/{member_number}")
                document = pymupdf.open(stream=content, filetype="pdf")
                try:
                    by_page = defaultdict(list)
                    for nrec, location in by_member[(source_id, member_number)]:
                        if location["pdfSha256"] != expected_pdf:
                            raise ValueError("Inconsistent PDF hash in index")
                        by_page[location["page"]].append((nrec, location))

                    for page_number, page_groups in sorted(by_page.items()):
                        page = document[page_number - 1]
                        drawings = page.get_drawings()
                        headers = detect_group_headers(drawings, page.rect.width,
                            lambda rect: page.get_textbox(pymupdf.Rect(*rect)))
                        days = detect_day_bounds(drawings, page.rect.width, headers[0][3])
                        if len(days) not in (5, 6):
                            raise ValueError(f"Expected five or six days in {source_id}/{member_number}/{page_number}")

                        page_dir = out / "pages"
                        page_dir.mkdir(parents=True, exist_ok=True)
                        page_target = page_dir / f"{source_id}-{member_number}-{page_number}.webp"
                        page_scale = max(1.5, scale * 0.75)
                        if not page_target.exists():
                            page_pixmap = page.get_pixmap(matrix=pymupdf.Matrix(page_scale, page_scale), alpha=False)
                            page_image = Image.open(io.BytesIO(page_pixmap.tobytes("png"))).convert("RGB")
                            page_image.save(page_target, "WEBP", quality=76, method=5)

                        for nrec, location in page_groups:
                            column = location["column"]
                            if column < 1 or column > len(headers):
                                raise ValueError(f"Column outside PDF: {nrec}")
                            x0, y0, x1, y1 = headers[column - 1]
                            header = " ".join(page.get_textbox(pymupdf.Rect(x0, y0, x1, y1)).split())
                            if header != location.get("columnHeader", location["groupName"]):
                                raise ValueError(f"Group header mismatch: {nrec}: {header!r}")

                            group_dir = out / nrec
                            group_dir.mkdir(parents=True, exist_ok=True)
                            sizes = []
                            for day_number, (top, bottom) in enumerate(days, start=1):
                                clip = pymupdf.Rect(x0, top, x1, bottom) & page.rect
                                pixmap = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale),
                                                         clip=clip, alpha=False)
                                image = Image.open(io.BytesIO(pixmap.tobytes("png"))).convert("RGB")
                                target = group_dir / f"day-{day_number}.webp"
                                image.save(target, "WEBP", quality=78, method=5)
                                sizes.append(target.stat().st_size)
                            output["groups"][nrec] = {
                                "sourceId": source_id, "member": member_number,
                                "page": page_number, "column": column,
                                "days": len(days), "bytes": sum(sizes),
                                "columnLeft": x0, "pageWidth": page.rect.width,
                            }
                finally:
                    document.close()

    return output


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("public/data/document-index.json"))
    parser.add_argument("--archive-029", type=Path, required=True)
    parser.add_argument("--archive-028", type=Path, required=True)
    parser.add_argument("--archive-027", type=Path, required=True)
    parser.add_argument("--out", type=Path, default=Path("artifacts/pdf-staging/review-images"))
    parser.add_argument("--group", help="Render one group for QA")
    parser.add_argument("--missing-only", action="store_true",
                        help="Add groups absent from an existing matching manifest")
    parser.add_argument("--scale", type=float, default=2.0)
    args = parser.parse_args()
    if args.scale < 1.5 or args.scale > 3:
        parser.error("Scale must be between 1.5 and 3")
    previous = None
    if args.missing_only and (args.out / "index.json").is_file():
        previous = json.loads((args.out / "index.json").read_text(encoding="utf-8"))
        source_index = json.loads(args.index.read_text(encoding="utf-8"))
        for source_id, digest in previous.get("sourceHashes", {}).items():
            if source_index["sources"][source_id]["sha256"] != digest:
                raise ValueError("Existing images come from a different archive; run a full render")
    result = render(args.index,
                    {"029": args.archive_029, "028": args.archive_028, "027": args.archive_027},
                    args.out, args.group, args.scale,
                    set(previous["groups"]) if previous else None)
    if not args.group:
        if previous:
            result["groups"] = {**previous["groups"], **result["groups"]}
            result["sourceHashes"] = {**previous["sourceHashes"], **result["sourceHashes"]}
        (args.out / "index.json").write_text(
            json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    size = sum(group["bytes"] for group in result["groups"].values())
    print(f"Rendered {len(result['groups'])} groups, {size / 1024 / 1024:.1f} MiB")


if __name__ == "__main__":
    main()
