#!/usr/bin/env python3
"""Add COMPAS race+sex subgroup metrics to the app case JSON files.

The source Rashomon export contains per-model predictions and KNN-style local
accuracy, but it does not include subgroup TPR/TNR. This script uses the
project-local test labels plus the case JSON predictions to compute per-model
metrics for each test case's race+sex subgroup. It can also read the original
external export for validation or backfill.
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path
from statistics import mean

import pandas as pd
from sklearn.model_selection import train_test_split


FEATURE_DISPLAY = {
    "Number_of_Priors": "Number of priors",
    "score_factor": "Score factor",
    "Age_Above_FourtyFive": "Age above 45",
    "Age_Below_TwentyFive": "Age below 25",
    "African_American": "African American",
    "Asian": "Asian",
    "Hispanic": "Hispanic",
    "Native_American": "Native American",
    "Other": "Other race",
    "Female": "Female",
    "Misdemeanor": "Misdemeanor",
}

RACE_FEATURES = [
    ("African American", "African American"),
    ("Asian", "Asian"),
    ("Hispanic", "Hispanic"),
    ("Native American", "Native American"),
    ("Other race", "Other race"),
]


def finite_number(value):
    return isinstance(value, (int, float)) and value == value


def subgroup_key(features):
    race = "White"
    for key, label in RACE_FEATURES:
        if float(features.get(key, 0) or 0) >= 0.5:
            race = label
            break
    sex = "Female" if float(features.get("Female", 0) or 0) >= 0.5 else "Male"
    return f"{race}|{sex}", race, sex


def load_test_labels(dataset_csv: Path):
    df = pd.read_csv(dataset_csv)
    df.columns = df.columns.str.strip()
    y = pd.to_numeric(df["Two_yr_Recidivism"], errors="coerce").fillna(0).astype("int32")
    x_df = df.drop(columns=["Two_yr_Recidivism"]).apply(pd.to_numeric, errors="coerce").fillna(0)
    _, x_test, _, y_test = train_test_split(
        x_df,
        y,
        test_size=0.2,
        random_state=42,
    )
    display_rows = []
    for _, row in x_test.iterrows():
        display_rows.append({FEATURE_DISPLAY[col]: float(row[col]) for col in x_df.columns})
    return display_rows, [int(v) for v in y_test.to_numpy()]


def load_project_test_labels(test_labels_path: Path):
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
        case_records.append({
            "test_case_index": case_idx,
            "features": case["features"],
        })
        for model in case_data.get("models", []):
            local_rows.append({
                "seed": int(model["seed"]),
                "test_case_index": case_idx,
                "pred_class": int(model["pred_class"]),
            })
    return case_records, local_rows


def compute_subgroup_metrics(test_cases, y_test, local_rows):
    by_seed = defaultdict(dict)
    for row in local_rows:
        by_seed[int(row["seed"])][int(row["test_case_index"])] = int(row["pred_class"])

    subgroup_cases = defaultdict(list)
    subgroup_info_by_case = {}
    for case in test_cases:
        idx = int(case["test_case_index"])
        key, race, sex = subgroup_key(case["features"])
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


def update_group_summaries(case_data):
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--source-dir",
        type=Path,
        default=Path("/home/yifan/UbiComp/git-space/Reconcilable-XAI/Tool/public/data/rashomon_acconly_diverse/compas"),
    )
    parser.add_argument(
        "--dataset-csv",
        type=Path,
        default=Path("/home/yifan/UbiComp/git-space/Reconcilable-XAI/Datasets/COMPAS/propublica_data_for_fairml.csv"),
    )
    parser.add_argument("--test-labels", type=Path, default=Path("data/compas/test_labels.json"))
    parser.add_argument("--case-dir", type=Path, default=Path("data/compas/cases"))
    args = parser.parse_args()

    test_cases, local_rows = load_cases_from_project(args.case_dir)
    if args.test_labels.exists():
        y_test = load_project_test_labels(args.test_labels)
    else:
        display_rows, y_test = load_test_labels(args.dataset_csv)
        if len(display_rows) != len(test_cases):
            raise RuntimeError(f"Test case count mismatch: {len(display_rows)} vs {len(test_cases)}")
        for idx, (generated, project_case) in enumerate(zip(display_rows, test_cases)):
            if generated != project_case["features"]:
                raise RuntimeError(f"Feature mismatch at test case {idx}: {generated} != {project_case['features']}")

    source_test_cases = args.source_dir / "test_cases.json"
    if source_test_cases.exists():
        with source_test_cases.open() as f:
            exported_cases = json.load(f)
        for idx, (project_case, exported_case) in enumerate(zip(test_cases, exported_cases)):
            if project_case["features"] != exported_case["features"]:
                raise RuntimeError(f"External export mismatch at test case {idx}")

    metrics_by_seed_case = compute_subgroup_metrics(test_cases, y_test, local_rows)
    updated_files = 0
    updated_models = 0
    for path in sorted(args.case_dir.glob("*.json"), key=lambda p: int(p.stem)):
        with path.open() as f:
            case_data = json.load(f)
        case_idx = int(case_data["case"]["test_case_index"])
        for model in case_data.get("models", []):
            metrics = metrics_by_seed_case[int(model["seed"])][case_idx]
            model.update(metrics)
            updated_models += 1
        update_group_summaries(case_data)
        with path.open("w") as f:
            json.dump(case_data, f, separators=(",", ":"), sort_keys=True)
        updated_files += 1

    print(f"Updated {updated_models} model rows across {updated_files} COMPAS case files.")


if __name__ == "__main__":
    main()
