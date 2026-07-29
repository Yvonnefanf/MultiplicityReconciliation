#!/usr/bin/env python3
"""Export the Flask case-distribution API into the static ``data/`` tree.

The app in this repo is a pure static site: ``js/utils-salience.js`` rewrites
every ``/api/...`` call onto a file under ``data/``. This script drives the
Flask app in the Reconcilable-XAI repo through its test client and writes those
files:

    data/datasets.json                        <- /api/datasets
    data/<key>/cases.json                     <- /api/<key>/cases
    data/<key>/cases/<i>.json                 <- /api/<key>/cases/<i>
    data/<key>/model_global_metrics.json      <- per-seed means over all cases
    data/<key>/test_labels.json               <- ground-truth test labels

``model_global_metrics.json`` has no route in the Flask app -- it is derived
here by averaging each model's per-case metrics over every exported case.

Run the post-processing scripts afterwards, in this order:

    python3 scripts/add_model_shap.py --dataset <key>
    python3 scripts/add_subgroup_metrics.py --dataset <key>
    python3 scripts/recompute_local_consistency.py --dataset <key>
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from statistics import fmean

REPO = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_REPO = Path("/home/yifan/UbiComp/git-space/Reconcilable-XAI")

# per-case model field -> key in model_global_metrics.json
GLOBAL_METRIC_FIELDS = {
    "local_consistency": "global_consistency",
    "counterfactual_fairness": "global_counterfactual_fairness",
    "gender_counterfactual_fairness": "global_gender_counterfactual_fairness",
    "local_accuracy": "global_local_accuracy",
    "race_counterfactual_fairness": "global_race_counterfactual_fairness",
    "sensitive_counterfactual_fairness": "global_sensitive_counterfactual_fairness",
    "test_accuracy": "test_accuracy",
    "tnr": "tnr",
    "tpr": "tpr",
}


def write_json(path: Path, payload) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(payload, f, separators=(",", ":"), sort_keys=True)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--datasets",
        default="acs_coverage",
        help="Comma-separated dataset keys to (re-)export. Re-exporting a dataset "
             "overwrites its case files, so the post-processing scripts must be re-run for it.",
    )
    parser.add_argument(
        "--manifest",
        default="compas,acs_coverage",
        help="Comma-separated dataset keys listed in data/datasets.json (the app's dataset picker).",
    )
    parser.add_argument("--source-repo", type=Path, default=DEFAULT_SOURCE_REPO)
    parser.add_argument("--data-dir", type=Path, default=REPO / "data")
    args = parser.parse_args()

    sys.path.insert(0, str(args.source_repo))
    import case_distribution_app as cda  # noqa: E402

    keys = [k.strip() for k in args.datasets.split(",") if k.strip()]
    manifest_keys = [k.strip() for k in args.manifest.split(",") if k.strip()]
    unknown = [k for k in set(keys) | set(manifest_keys) if k not in cda.DATASETS]
    if unknown:
        raise SystemExit(
            f"Unknown dataset key(s) {sorted(unknown)}; the app defines {sorted(cda.DATASETS)}"
        )

    client = cda.app.test_client()

    all_datasets = client.get("/api/datasets").get_json()
    kept = [row for row in all_datasets if row["key"] in manifest_keys]
    write_json(args.data_dir / "datasets.json", kept)
    print(f"datasets.json -> {[row['key'] for row in kept]}")

    for key in keys:
        out_dir = args.data_dir / key
        case_dir = out_dir / "cases"
        case_dir.mkdir(parents=True, exist_ok=True)
        for stale in case_dir.glob("*.json"):
            stale.unlink()

        cases = client.get(f"/api/{key}/cases").get_json()
        write_json(out_dir / "cases.json", cases)

        totals: dict[int, dict[str, list[float]]] = {}
        labels_by_seed: dict[int, str] = {}
        for case in cases:
            idx = int(case["test_case_index"])
            payload = client.get(f"/api/{key}/cases/{idx}").get_json()
            write_json(case_dir / f"{idx}.json", payload)
            for model in payload["models"]:
                seed = int(model["seed"])
                labels_by_seed[seed] = model.get("label", f"Model {seed}")
                bucket = totals.setdefault(seed, {field: [] for field in GLOBAL_METRIC_FIELDS})
                for field in GLOBAL_METRIC_FIELDS:
                    value = model.get(field)
                    if isinstance(value, (int, float)) and value == value:
                        bucket[field].append(float(value))

        models = []
        for seed in sorted(totals):
            row = {"seed": seed, "label": labels_by_seed[seed], "case_count": len(cases)}
            for field, out_key in GLOBAL_METRIC_FIELDS.items():
                values = totals[seed][field]
                row[out_key] = fmean(values) if values else None
            models.append(row)
        write_json(
            out_dir / "model_global_metrics.json",
            {
                "dataset": key,
                "metric_scope": "global mean over all exported cases for each model seed",
                "models": models,
            },
        )

        write_json(
            out_dir / "test_labels.json",
            {"dataset": key, "labels": cda._load_test_labels(key)},
        )
        print(f"{key}: {len(cases)} cases, {len(models)} models")


if __name__ == "__main__":
    main()
