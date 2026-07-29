#!/usr/bin/env python3
"""Add race+sex subgroup metrics to the app's per-case JSON files.

The Rashomon export carries per-model predictions and KNN-style local accuracy,
but no subgroup TPR/TNR. This derives, for every test case, each model's
accuracy/TPR/TNR *on that case's race+sex subgroup*, using the project-local
test labels plus the predictions already in the case files, and rolls the
result up into the class summaries and reconciliation groups the app reads.

    python3 scripts/add_subgroup_metrics.py --dataset acs_coverage
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

import dataset_config

REPO = Path(__file__).resolve().parent.parent


def finite_number(value) -> bool:
    return isinstance(value, (int, float)) and value == value


def subgroup_key(features: dict, cfg: dict) -> tuple[str, str, str]:
    race = cfg["race_reference"]
    for key, label in cfg["race_features"]:
        if float(features.get(key, 0) or 0) >= 0.5:
            race = label
            break
    sex_feature = cfg["sex_feature"]
    sex = "Female" if float(features.get(sex_feature, 0) or 0) >= 0.5 else "Male"
    return f"{race}|{sex}", race, sex


def load_project_test_labels(test_labels_path: Path) -> list[int]:
    with test_labels_path.open() as f:
        payload = json.load(f)
    return [int(v) for v in payload["labels"]]


def load_cases_from_project(case_dir: Path):
    case_records = []
    local_rows = []
    for path in sorted(case_dir.glob("*.json"), key=lambda p: int(p.stem)):
        with path.open() as f:
            case_data = json.load(f)
        case = case_data["case"]
        case_idx = int(case["test_case_index"])
        case_records.append({"test_case_index": case_idx, "features": case["features"]})
        for model in case_data.get("models", []):
            local_rows.append({
                "seed": int(model["seed"]),
                "test_case_index": case_idx,
                "pred_class": int(model["pred_class"]),
            })
    return case_records, local_rows


def compute_subgroup_metrics(test_cases, y_test, local_rows, cfg):
    by_seed = defaultdict(dict)
    for row in local_rows:
        by_seed[int(row["seed"])][int(row["test_case_index"])] = int(row["pred_class"])

    subgroup_cases = defaultdict(list)
    subgroup_info_by_case = {}
    for case in test_cases:
        idx = int(case["test_case_index"])
        key, race, sex = subgroup_key(case["features"], cfg)
        subgroup_cases[key].append(idx)
        subgroup_info_by_case[idx] = {"key": key, "race": race, "sex": sex}

    metrics_by_seed_case = defaultdict(dict)
    for seed, preds_by_case in by_seed.items():
        for key, indices in subgroup_cases.items():
            positives = [idx for idx in indices if y_test[idx] == 1]
            negatives = [idx for idx in indices if y_test[idx] == 0]
            correct = [idx for idx in indices if preds_by_case.get(idx) == y_test[idx]]
            tp = sum(1 for idx in positives if preds_by_case.get(idx) == 1)
            tn = sum(1 for idx in negatives if preds_by_case.get(idx) == 0)
            subgroup_accuracy = len(correct) / len(indices) if indices else None
            subgroup_tpr = tp / len(positives) if positives else None
            subgroup_tnr = tn / len(negatives) if negatives else None
            for idx in indices:
                metrics_by_seed_case[seed][idx] = {
                    "subgroup_accuracy": subgroup_accuracy,
                    "subgroup_tpr": subgroup_tpr,
                    "subgroup_tnr": subgroup_tnr,
                    "local_tpr": subgroup_tpr,
                    "local_tnr": subgroup_tnr,
                    "subgroup_size": len(indices),
                    "subgroup_positive_count": len(positives),
                    "subgroup_negative_count": len(negatives),
                    "subgroup_key": key,
                    "subgroup_race": subgroup_info_by_case[idx]["race"],
                    "subgroup_sex": subgroup_info_by_case[idx]["sex"],
                }
    return metrics_by_seed_case


def average_model_metric(models, key):
    values = [model.get(key) for model in models if finite_number(model.get(key))]
    return mean(values) if values else None


def update_group_summaries(case_data) -> None:
    groups = case_data.get("reconciliation", {}).get("groups") or []
    summaries = {str(row.get("class_id")): row for row in case_data.get("summary") or []}
    for group in groups:
        class_id = group.get("class_id")
        seeds = set(group.get("model_seeds") or [])
        group_models = [model for model in case_data.get("models", []) if model.get("seed") in seeds]
        updates = {
            "accuracy": average_model_metric(group_models, "subgroup_accuracy"),
            "tpr": average_model_metric(group_models, "subgroup_tpr"),
            "tnr": average_model_metric(group_models, "subgroup_tnr"),
        }
        for key, value in updates.items():
            if value is not None:
                group.setdefault("criteria", {})[key] = value
        summary = summaries.get(str(class_id))
        if summary:
            if updates["accuracy"] is not None:
                summary["avg_subgroup_accuracy"] = updates["accuracy"]
            if updates["tpr"] is not None:
                summary["avg_subgroup_tpr"] = updates["tpr"]
                summary["avg_tpr"] = updates["tpr"]
            if updates["tnr"] is not None:
                summary["avg_subgroup_tnr"] = updates["tnr"]
                summary["avg_tnr"] = updates["tnr"]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="compas")
    parser.add_argument("--test-labels", type=Path, default=None)
    parser.add_argument("--case-dir", type=Path, default=None)
    args = parser.parse_args()

    cfg = dataset_config.get(args.dataset)
    case_dir = args.case_dir or (REPO / "data" / args.dataset / "cases")
    test_labels = args.test_labels or (REPO / "data" / args.dataset / "test_labels.json")

    test_cases, local_rows = load_cases_from_project(case_dir)
    y_test = load_project_test_labels(test_labels)
    if len(y_test) != len(test_cases):
        raise SystemExit(
            f"test label count {len(y_test)} != exported case count {len(test_cases)}"
        )

    metrics_by_seed_case = compute_subgroup_metrics(test_cases, y_test, local_rows, cfg)
    updated_files = 0
    updated_models = 0
    subgroup_sizes: dict[str, int] = {}
    for path in sorted(case_dir.glob("*.json"), key=lambda p: int(p.stem)):
        with path.open() as f:
            case_data = json.load(f)
        case_idx = int(case_data["case"]["test_case_index"])
        for model in case_data.get("models", []):
            metrics = metrics_by_seed_case[int(model["seed"])][case_idx]
            model.update(metrics)
            subgroup_sizes[metrics["subgroup_key"]] = metrics["subgroup_size"]
            updated_models += 1
        update_group_summaries(case_data)
        with path.open("w") as f:
            json.dump(case_data, f, separators=(",", ":"), sort_keys=True)
        updated_files += 1

    print(f"Updated {updated_models} model rows across {updated_files} {args.dataset} case files.")
    print("Subgroups: " + ", ".join(f"{k}={v}" for k, v in sorted(subgroup_sizes.items())))


if __name__ == "__main__":
    main()
