"""Add verified group-column validity dates to existing OCR drafts."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from collections import defaultdict
from pathlib import Path

import pymupdf

from ocr_schedule import period_for_column
from stage_pdf import detect_day_bounds, detect_group_headers, source_hash


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("public/data/document-index.json"))
    parser.add_argument("--archive-029", type=Path, required=True)
    parser.add_argument("--archive-028", type=Path, required=True)
    parser.add_argument("--archive-027", type=Path, required=True)
    parser.add_argument("--drafts", type=Path, default=Path("artifacts/pdf-staging/bulk"))
    parser.add_argument("--missing-only", action="store_true")
    args = parser.parse_args()
    index = json.loads(args.index.read_text(encoding="utf-8"))
    archives = {"029": args.archive_029, "028": args.archive_028, "027": args.archive_027}
    by_member = defaultdict(list)
    for nrec, location in index["groups"].items():
        target = args.drafts / f"{nrec}.json"
        if target.is_file():
            if args.missing_only:
                draft = json.loads(target.read_text(encoding="utf-8"))
                if draft.get("validFrom") and draft.get("validThrough"):
                    continue
            by_member[(location["sourceId"], location["member"])].append((nrec, location, target))
    report = {"updated": 0, "unchanged": 0, "errors": []}
    for source_id in sorted({key[0] for key in by_member}):
        archive = archives[source_id]
        if source_hash(archive) != index["sources"][source_id]["sha256"]:
            raise ValueError(f"Official ZIP hash mismatch: {source_id}")
        with zipfile.ZipFile(archive) as zipped:
            for member in sorted(key[1] for key in by_member if key[0] == source_id):
                groups = by_member[(source_id, member)]
                print(f"{source_id}/{member}: {len(groups)} groups", flush=True)
                content = zipped.read(zipped.infolist()[member])
                if any(hashlib.sha256(content).hexdigest() != location["pdfSha256"]
                       for _, location, _ in groups):
                    raise ValueError(f"PDF hash mismatch: {source_id}/{member}")
                document = pymupdf.open(stream=content, filetype="pdf")
                try:
                    pages = defaultdict(list)
                    for item in groups:
                        pages[item[1]["page"]].append(item)
                    for page_number, page_groups in pages.items():
                        page = document[page_number - 1]
                        drawings = page.get_drawings()
                        headers = detect_group_headers(drawings, page.rect.width,
                            lambda rect: page.get_textbox(pymupdf.Rect(*rect)))
                        days = detect_day_bounds(drawings, page.rect.width, headers[0][3])
                        for nrec, location, target in page_groups:
                            try:
                                header = pymupdf.Rect(headers[location["column"] - 1])
                                actual_header = " ".join(page.get_textbox(header).split())
                                if actual_header != location.get("columnHeader", location["groupName"]):
                                    raise ValueError("Group header mismatch")
                                draft = json.loads(target.read_text(encoding="utf-8"))
                                if draft["groupNrec"] != nrec or draft["sourcePdfSha256"] != location["pdfSha256"]:
                                    raise ValueError("Draft source mismatch")
                                start, end = period_for_column(page, header, days[0][0], nrec, drawings)
                                if draft.get("validFrom") == start and draft.get("validThrough") == end:
                                    report["unchanged"] += 1
                                    continue
                                draft["validFrom"], draft["validThrough"] = start, end
                                target.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n",
                                                  encoding="utf-8")
                                report["updated"] += 1
                            except Exception as error:
                                report["errors"].append({"nrec": nrec, "error": str(error)})
                finally:
                    document.close()
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
