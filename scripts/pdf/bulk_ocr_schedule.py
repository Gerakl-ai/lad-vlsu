"""Create auditable OCR drafts for official PDF columns in bounded batches."""

from __future__ import annotations

import argparse
import json
from concurrent.futures import ProcessPoolExecutor, as_completed
from pathlib import Path

from ocr_schedule import extract


def has_current_draft(target: Path, source_pdf_sha256: str, nrec: str) -> bool:
    try:
        draft = json.loads(target.read_text(encoding="utf-8"))
        return draft.get("purpose") == "ocr-draft-not-reviewed" \
            and draft.get("groupNrec") == nrec \
            and draft.get("sourcePdfSha256") == source_pdf_sha256 \
            and isinstance(draft.get("schedule"), list) and bool(draft["schedule"])
    except (OSError, ValueError, AttributeError):
        return False


def process(index: dict, archives: dict[str, str], nrec: str, tesseract: str,
            output: str) -> dict:
    try:
        draft = extract(index, Path(archives[index["groups"][nrec]["sourceId"]]),
                        nrec, Path(tesseract))
        target = Path(output) / f"{nrec}.json"
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(json.dumps(draft, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        warnings = sum(len(cell["warnings"]) for cell in draft["cells"])
        return {"nrec": nrec, "status": "draft", "cells": len(draft["cells"]),
                "warnings": warnings}
    except Exception as error:
        return {"nrec": nrec, "status": "error", "error": str(error)}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--index", type=Path, default=Path("public/data/document-index.json"))
    for order in ("027", "028", "029", "030", "031", "032"):
        parser.add_argument(f"--archive-{order}", type=Path)
    parser.add_argument("--out", type=Path, default=Path("artifacts/pdf-staging/bulk"))
    parser.add_argument("--source", choices=("027", "028", "029", "030", "031", "032"))
    parser.add_argument("--group", action="append", help="Process only these indexed group IDs; repeatable")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--tesseract", type=Path,
                        default=Path(r"C:\Program Files\Tesseract-OCR\tesseract.exe"))
    args = parser.parse_args()
    if args.workers < 1 or args.workers > 8 or args.limit is not None and args.limit < 1:
        parser.error("Expected 1-8 workers and a positive limit")
    index = json.loads(args.index.read_text(encoding="utf-8"))
    if args.group and set(args.group) - index["groups"].keys():
        parser.error("Requested group is absent from the verified source index")
    archives = {order: str(archive) for order in index["sources"]
                if (archive := getattr(args, f"archive_{order}", None)) is not None}
    candidates = [nrec for nrec, location in sorted(index["groups"].items())
                  if (not args.source or location["sourceId"] == args.source)
                  and (not args.group or nrec in args.group)]
    if not args.force:
        candidates = [nrec for nrec in candidates if not has_current_draft(
            args.out / f"{nrec}.json", index["groups"][nrec]["pdfSha256"], nrec)]
    if args.limit:
        candidates = candidates[:args.limit]
    missing = {index["groups"][nrec]["sourceId"] for nrec in candidates} - archives.keys()
    if missing:
        parser.error(f"Missing verified archives: {', '.join(sorted(missing))}")
    results = []
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process, index, archives, nrec, str(args.tesseract), str(args.out)): nrec
                   for nrec in candidates}
        for future in as_completed(futures):
            result = future.result()
            results.append(result)
            print(f"{len(results)}/{len(candidates)} {result['nrec']} {result['status']}", flush=True)
    args.out.mkdir(parents=True, exist_ok=True)
    report = {"attempted": len(candidates), "drafts": sum(item["status"] == "draft" for item in results),
              "errors": [item for item in results if item["status"] == "error"],
              "cells": sum(item.get("cells", 0) for item in results),
              "warnings": sum(item.get("warnings", 0) for item in results)}
    (args.out / "last-run.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n",
                                            encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
