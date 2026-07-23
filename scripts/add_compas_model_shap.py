#!/usr/bin/env python3
"""Copy per-model SHAP values into the app's per-case JSON files."""

from __future__ import annotations

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("/home/yifan/UbiComp/git-space/Reconcilable-XAI/Tool/public/data/rashomon_acconly_diverse/compas/local_shap_values.json"),
    )
    parser.add_argument("--case-dir", type=Path, default=Path("data/compas/cases"))
    args = parser.parse_args()

    with args.source.open() as f:
        shap_rows = json.load(f)

    by_case = {}
    for row in shap_rows:
        case_index = int(row["test_case_index"])
        seed = str(int(row["seed"]))
        by_case.setdefault(case_index, {})[seed] = {
            "seed": int(seed),
            "features": {
                item["name"]: float(item["value"])
                for item in row.get("shap_values", [])
            },
        }

    updated = 0
    for path in sorted(args.case_dir.glob("*.json"), key=lambda p: int(p.stem)):
        with path.open() as f:
            case_data = json.load(f)
        case_index = int(case_data["case"]["test_case_index"])
        case_data.setdefault("shap_patterns", {}).setdefault("by_model", {}).update(by_case.get(case_index, {}))
        with path.open("w") as f:
            json.dump(case_data, f, separators=(",", ":"), sort_keys=True)
        updated += 1

    print(f"Updated per-model SHAP for {updated} case files.")


if __name__ == "__main__":
    main()
