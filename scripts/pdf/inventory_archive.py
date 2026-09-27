"""Inventory an official timetable ZIP without extracting or publishing lessons."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import unicodedata
import zipfile
from collections import defaultdict
from pathlib import Path
from typing import Any

from stage_pdf import detect_group_headers, source_hash

SOURCE_URL = "https://www.vlsu.ru/fileadmin/class-schedule/order_N029_20_20260903_VO.zip"
MAX_MEMBERS = 40
MAX_PDF_SIZE = 20 * 1024 * 1024
MAX_TOTAL_SIZE = 100 * 1024 * 1024


def normalized_name(value: str) -> str:
    value = unicodedata.normalize("NFC", value).replace("\u00a0", " ")
    value = re.sub(r"[‐‑‒–—−]", "-", value)
    return " ".join(value.split()).casefold()


def catalog_index(catalog: dict[str, Any]) -> dict[str, list[dict[str, str]]]:
    groups: dict[str, list[dict[str, str]]] = defaultdict(list)
    for institute in catalog.get("institutes", []):
        for group in institute.get("groups", []):
            if group.get("name") and group.get("nrec"):
                groups[normalized_name(group["name"])].append({
                    "name": group["name"],
                    "nrec": group["nrec"],
                    "instituteId": institute.get("id", ""),
                    "instituteName": institute.get("name", ""),
                })
    return groups


def match_group(header: str, index: dict[str, list[dict[str, str]]]) -> dict[str, Any]:
    candidates = index.get(normalized_name(header), [])
    if len(candidates) == 1:
        return {"status": "unique-catalog-name", "candidate": candidates[0]}
    if candidates:
        return {"status": "ambiguous-catalog-name", "candidates": candidates}
    codes = re.findall(r"[^\s]+-\d{3}\b", header)
    if len(codes) > 1 and normalized_name(" ".join(codes)) == normalized_name(header):
        parts = [{"header": code, "candidates": index.get(normalized_name(code), [])}
                 for code in codes]
        if all(len(part["candidates"]) == 1 for part in parts):
            return {"status": "multi-group-column",
                    "candidates": [part["candidates"][0] for part in parts]}
        return {"status": "unresolved-multi-group", "parts": parts}
    return {"status": "not-in-catalog"}


def read_catalog(args: argparse.Namespace) -> dict[str, Any]:
    if args.catalog:
        return json.loads(args.catalog.read_text(encoding="utf-8"))
    return json.loads(subprocess.check_output(
        ["git", "show", args.catalog_ref], text=True, encoding="utf-8"
    ))


def inventory(archive: Path, expected_sha256: str, catalog: dict[str, Any],
              source_url: str = SOURCE_URL) -> dict[str, Any]:
    actual_hash = source_hash(archive)
    if actual_hash.lower() != expected_sha256.lower():
        raise ValueError(f"Archive SHA-256 mismatch: {actual_hash}")

    try:
        import pymupdf
    except ImportError as error:
        raise RuntimeError("Install PyMuPDF first: python -m pip install pymupdf") from error

    index = catalog_index(catalog)
    if not index:
        raise ValueError("Catalog contains no groups")
    documents = []
    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if len(members) > MAX_MEMBERS:
            raise ValueError("Archive contains too many members")
        if sum(member.file_size for member in members) > MAX_TOTAL_SIZE:
            raise ValueError("Archive uncompressed size is too large")
        for member_number, member in enumerate(members):
            if member.is_dir():
                continue
            if member.file_size > MAX_PDF_SIZE:
                raise ValueError(f"PDF member {member_number} is too large")
            if not member.filename.lower().endswith(".pdf"):
                raise ValueError(f"Unexpected non-PDF member {member_number}")
            content = zipped.read(member)
            if not content.startswith(b"%PDF-"):
                raise ValueError(f"Member {member_number} is not a PDF")
            document = pymupdf.open(stream=content, filetype="pdf")
            try:
                if len(document) == 0:
                    raise ValueError(f"PDF member {member_number} has no pages")
                if len(document) > 100:
                    raise ValueError(f"PDF member {member_number} has too many pages")
                first_lines = [line.strip() for line in document[0].get_text().splitlines()[:14]]
                is_schedule = bool(first_lines and first_lines[0].startswith("РАСПИСАНИЕ ЗАНЯТИЙ"))
                group_columns = []
                if is_schedule:
                    for page_number, page in enumerate(document, start=1):
                        headers = detect_group_headers(
                            page.get_drawings(), page.rect.width,
                            lambda rect: page.get_textbox(pymupdf.Rect(*rect)),
                        )
                        for column_number, bounds in enumerate(headers, start=1):
                            header = " ".join(page.get_textbox(pymupdf.Rect(*bounds)).split())
                            group_columns.append({
                                "page": page_number,
                                "column": column_number,
                                "header": header,
                                "match": match_group(header, index),
                            })
                documents.append({
                    "member": member_number,
                    "kind": "schedule" if is_schedule else "other-document",
                    "pdfSha256": hashlib.sha256(content).hexdigest(),
                    "pages": len(document),
                    "heading": first_lines[:10],
                    "groupColumns": group_columns,
                })
            finally:
                document.close()

    groups = [group for document in documents for group in document["groupColumns"]]
    statuses = {status: sum(group["match"]["status"] == status for group in groups)
                for status in ("unique-catalog-name", "multi-group-column",
                               "ambiguous-catalog-name", "unresolved-multi-group", "not-in-catalog")}
    matched_ids = [candidate["nrec"] for group in groups
                   for candidate in ([group["match"]["candidate"]]
                                     if group["match"]["status"] == "unique-catalog-name"
                                     else group["match"]["candidates"]
                                     if group["match"]["status"] == "multi-group-column"
                                     else [])]
    return {
        "schemaVersion": 1,
        "purpose": "review-planning-only",
        "source": {"url": source_url, "sha256": actual_hash},
        "catalogCapturedAt": catalog.get("capturedAt"),
        "summary": {
            "scheduleDocuments": sum(document["kind"] == "schedule" for document in documents),
            "schedulePages": sum(document["pages"] for document in documents if document["kind"] == "schedule"),
            "otherDocuments": sum(document["kind"] == "other-document" for document in documents),
            "groupColumns": len(groups),
            "uniqueCatalogGroups": len(set(matched_ids)),
            "matches": statuses,
        },
        "documents": documents,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--sha256", required=True)
    parser.add_argument("--source-url", default=SOURCE_URL)
    catalog_source = parser.add_mutually_exclusive_group()
    catalog_source.add_argument("--catalog", type=Path)
    catalog_source.add_argument("--catalog-ref", default="origin/data:data/catalog.json")
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    report = inventory(args.archive, args.sha256, read_catalog(args), args.source_url)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report["summary"], ensure_ascii=False))
    print(f"Review-only inventory: {args.out}")


if __name__ == "__main__":
    main()
