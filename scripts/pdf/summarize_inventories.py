"""Summarize review-only PDF inventories and expose cross-source conflicts."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from typing import Any


def summarize(reports: list[dict[str, Any]]) -> dict[str, Any]:
    occurrences: dict[str, list[dict[str, Any]]] = defaultdict(list)
    unresolved = []
    columns = 0
    for report in reports:
        source = report.get("source", {})
        if report.get("purpose") != "review-planning-only" or not source.get("sha256"):
            raise ValueError("Expected a review-only inventory with a source SHA-256")
        for document in report.get("documents", []):
            for column in document.get("groupColumns", []):
                columns += 1
                match = column["match"]
                location = {"sourceSha256": source["sha256"], "member": document["member"],
                            "page": column["page"], "column": column["column"],
                            "header": column["header"]}
                if match["status"] == "unique-catalog-name":
                    candidates = [match["candidate"]]
                elif match["status"] == "multi-group-column":
                    candidates = match["candidates"]
                else:
                    unresolved.append({**location, "status": match["status"]})
                    continue
                for candidate in candidates:
                    occurrences[candidate["nrec"]].append({**location, "groupName": candidate["name"]})

    conflicts = [{"nrec": nrec, "locations": locations}
                 for nrec, locations in sorted(occurrences.items())
                 if len({location["sourceSha256"] for location in locations}) > 1]
    return {
        "sources": len(reports),
        "groupColumns": columns,
        "uniqueCatalogGroups": len(occurrences),
        "crossSourceConflicts": conflicts,
        "unresolvedColumns": unresolved,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("reports", nargs="+", type=Path)
    args = parser.parse_args()
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in args.reports]
    print(json.dumps(summarize(reports), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
