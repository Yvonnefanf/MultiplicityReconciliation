#!/usr/bin/env python3
"""Copy per-model SHAP values into the app's per-case JSON files.

The exported case JSON carries only class-level SHAP aggregates; the per-model
attributions live in the generator's ``local_shap_values.json``. This folds them
in under ``shap_patterns.by_model``.

    python3 scripts/add_model_shap.py --dataset acs_coverage
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import dataset_config

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_ROOT = Path(
    "/home/yifan/UbiComp/git-space/Reconcilable-XAI/Tool/public/data/rashomon_acconly_diverse"
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="compas")
    parser.add_argument("--source", type=Path, default=None, help="Path to local_shap_values.json")
    parser.add_argument("--case-dir", type=Path, default=None)
    args = parser.parse_args()

    cfg = dataset_config.get(args.dataset)
    source = args.source or (DEFAULT_SOURCE_ROOT / cfg["source_dir"] / "local_shap_values.json")
    case_dir = args.case_dir or (REPO / "data" / args.dataset / "cases")

    with source.open() as f:
        shap_rows = json.load(f)

    by_case: dict[int, dict[str, dict]] = {}
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
    for path in sorted(case_dir.glob("*.json"), key=lambda p: int(p.stem)):
        with path.open() as f:
            case_data = json.load(f)
        case_index = int(case_data["case"]["test_case_index"])
        case_data.setdefault("shap_patterns", {}).setdefault("by_model", {}).update(
            by_case.get(case_index, {})
        )
        with path.open("w") as f:
            json.dump(case_data, f, separators=(",", ":"), sort_keys=True)
        updated += 1

    print(f"Updated per-model SHAP for {updated} {args.dataset} case files.")


if __name__ == "__main__":
    main()
