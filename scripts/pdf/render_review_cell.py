"""Render an indexed OCR cell for transcription review, checking source hashes."""
import argparse
import hashlib
import json
from pathlib import Path
import zipfile

import pymupdf

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--group", required=True)
parser.add_argument("--day", type=int, required=True)
parser.add_argument("--pair", type=int, required=True)
parser.add_argument("--mode", choices=["n", "z"], required=True)
parser.add_argument("--archive", type=Path, required=True)
parser.add_argument("--index", type=Path, default=Path("public/data/document-index.json"))
parser.add_argument("--drafts", type=Path, default=Path("artifacts/pdf-staging/bulk"))
parser.add_argument("--out", type=Path, default=Path("artifacts/pdf-staging/verification"))
parser.add_argument("--cell-index", type=int, help="Zero-based cell within a subgroup slot")
args = parser.parse_args()
index = json.loads(args.index.read_text(encoding="utf-8"))
location = index["groups"][args.group]
draft = json.loads((args.drafts / f"{args.group}.json").read_text(encoding="utf-8"))
assert hashlib.sha256(args.archive.read_bytes()).hexdigest() == index["sources"][location["sourceId"]]["sha256"]
with zipfile.ZipFile(args.archive) as archive:
    content = archive.read(archive.infolist()[location["member"]])
assert hashlib.sha256(content).hexdigest() == draft["sourcePdfSha256"] == location["pdfSha256"]
cells = [cell for cell in draft["cells"] if cell["dayIndex"] == args.day
         and cell["pair"] == args.pair and args.mode in cell["modes"]]
assert cells, "No source cell"
if args.cell_index is None:
    assert len(cells) == 1, "Multiple subgroup cells: specify --cell-index"
    selected = 0
else:
    assert 0 <= args.cell_index < len(cells), "Cell index outside slot"
    selected = args.cell_index
with pymupdf.open(stream=content, filetype="pdf") as document:
    page = document[location["page"] - 1]
    cell = pymupdf.Rect(cells[selected]["bounds"])
    # Text in a merged cell may sit outside the selected group's narrow column.
    spans = [pymupdf.Rect(span["bbox"]) for block in page.get_text("dict")["blocks"]
             for line in block.get("lines", []) for span in line.get("spans", [])
             if span.get("size", 0) >= 3 and span.get("alpha", 255) > 0
             and cell.contains(pymupdf.Point(span["bbox"][0], span["bbox"][1]))]
    assert spans, "No visible source text"
    text_right = min(cell.x1, max(span.x1 for span in spans) + 2)
    clip = pymupdf.Rect(cell.x0, cell.y0, text_right, cell.y1)
    suffix = f"-cell{selected}" if len(cells) > 1 else ""
    target = args.out / f"{args.group}-{args.day}-{args.mode}{args.pair}{suffix}.png"
    target.parent.mkdir(parents=True, exist_ok=True)
    page.get_pixmap(matrix=pymupdf.Matrix(6, 6), clip=clip, alpha=False).save(target)
    print(target)
