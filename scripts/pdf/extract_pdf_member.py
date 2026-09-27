"""Extract one verified timetable PDF from a previously inventoried ZIP."""

from __future__ import annotations

import argparse
import hashlib
import json
import zipfile
from pathlib import Path
from typing import Any

from inventory_archive import MAX_PDF_SIZE
from stage_pdf import source_hash


def verified_member_bytes(archive: Path, inventory: dict[str, Any], member_number: int) -> bytes:
    expected_archive_hash = inventory.get("source", {}).get("sha256")
    if not expected_archive_hash or source_hash(archive) != expected_archive_hash:
        raise ValueError("ZIP SHA-256 does not match inventory")
    document = next((item for item in inventory.get("documents", [])
                     if item.get("member") == member_number), None)
    if not document or document.get("kind") != "schedule":
        raise ValueError("Member is not an inventoried schedule PDF")

    with zipfile.ZipFile(archive) as zipped:
        members = zipped.infolist()
        if not 0 <= member_number < len(members):
            raise ValueError("Member index is outside ZIP")
        member = members[member_number]
        if member.file_size > MAX_PDF_SIZE or not member.filename.lower().endswith(".pdf"):
            raise ValueError("Member is not a supported PDF")
        content = zipped.read(member)
    if not content.startswith(b"%PDF-") or hashlib.sha256(content).hexdigest() != document.get("pdfSha256"):
        raise ValueError("PDF SHA-256 does not match inventory")
    return content


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", type=Path, required=True)
    parser.add_argument("--inventory", type=Path, required=True)
    parser.add_argument("--member", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    args = parser.parse_args()
    inventory = json.loads(args.inventory.read_text(encoding="utf-8"))
    content = verified_member_bytes(args.archive, inventory, args.member)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    try:
        with args.out.open("xb") as target:
            target.write(content)
    except FileExistsError:
        if source_hash(args.out) != hashlib.sha256(content).hexdigest():
            raise ValueError("Output exists with different contents") from None
        print(f"Already verified: {args.out}")
        return
    print(f"Extracted verified PDF: {args.out} ({hashlib.sha256(content).hexdigest()})")


if __name__ == "__main__":
    main()
