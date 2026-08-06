#!/usr/bin/env python3
"""Add a 100-neighbour Individual Fairness metric to exported case data.

This mirrors ``recompute_local_consistency.py`` but keeps the shipped
``local_consistency`` field untouched. For every case/model pair:

    similar_100_case_fairness =
        fraction of the 100 most similar test cases that receive the same
        predicted class as the current case from the same model.

Similarity uses the legitimate case features declared in ``dataset_config.py``.
Race indicators are excluded, matching the existing Individual Fairness metric.

Usage:
    python3 scripts/add_similar_100_case_fairness.py --dataset compas
    python3 scripts/add_similar_100_case_fairness.py --dataset acs_coverage
"""

from __future__ import annotations

import argparse
import glob
import json
import math
import os
import statistics
from collections import defaultdict

import dataset_config

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
K_NEIGHBOURS = 100
METRIC_KEY = "similar_100_case_fairness"
PCT_KEY = "similar_100_case_fairness_pct"
GLOBAL_KEY = "global_similar_100_case_fairness"
SUMMARY_KEY = "avg_similar_100_case_fairness"


def similarity_vector(features, cfg):
    vector = [math.log1p(max(0.0, float(features.get(name) or 0.0))) for name in cfg["similarity_numeric"]]
    if cfg.get("similarity_age_buckets"):
        below, above = cfg["similarity_age_buckets"]
        vector.append(0.0 if features.get(below) == 1 else (1.0 if features.get(above) == 1 else 0.5))
    vector.extend(float(features.get(name) or 0.0) for name in cfg["similarity_binary"])
    return vector


def load_cases(cases_glob):
    paths = sorted(glob.glob(cases_glob), key=lambda p: int(os.path.basename(p)[:-5]))
    if not paths:
        raise SystemExit(f"no case files matched {cases_glob}")
    cases = []
    for path in paths:
        with open(path) as handle:
            cases.append({"path": path, "data": json.load(handle)})
    return cases


def build_matrices(cases, cfg):
    vectors = [similarity_vector(case["data"]["case"]["features"], cfg) for case in cases]
    for j in range(len(cfg["similarity_numeric"])):
        column = [vector[j] for vector in vectors]
        lo, hi = min(column), max(column)
        span = (hi - lo) or 1.0
        for vector in vectors:
            vector[j] = (vector[j] - lo) / span

    predictions = defaultdict(list)
    for case in cases:
        by_seed = {model["seed"]: int(model["pred_class"]) for model in case["data"]["models"]}
        for seed, pred in by_seed.items():
            predictions[seed].append(pred)
    counts = {len(values) for values in predictions.values()}
    if counts != {len(cases)}:
        raise SystemExit(f"models are not present in every case: sizes {sorted(counts)}")
    return vectors, dict(predictions)


def neighbours_for(index, vectors, k=K_NEIGHBOURS):
    own = vectors[index]
    scored = []
    for other, vector in enumerate(vectors):
        if other == index:
            continue
        distance = sum(abs(a - b) for a, b in zip(own, vector))
        scored.append((distance, other))
    scored.sort()
    picked = scored[:k]
    cut_tie = len(scored) > k and math.isclose(scored[k - 1][0], scored[k][0], abs_tol=1e-12)
    return [index for _, index in picked], cut_tie


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", default="compas")
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    cfg = dataset_config.get(args.dataset)
    cases_glob = os.path.join(REPO, "data", args.dataset, "cases", "*.json")
    global_metrics_path = os.path.join(REPO, "data", args.dataset, "model_global_metrics.json")

    cases = load_cases(cases_glob)
    vectors, predictions = build_matrices(cases, cfg)
    seeds = sorted(predictions)
    per_seed_totals = defaultdict(float)
    all_values = []
    tie_cuts = 0

    for index, case in enumerate(cases):
        neighbour_indices, cut_tie = neighbours_for(index, vectors)
        tie_cuts += 1 if cut_tie else 0
        values_by_seed = {}
        for seed in seeds:
            column = predictions[seed]
            own = column[index]
            agree = sum(1 for other in neighbour_indices if column[other] == own)
            value = agree / len(neighbour_indices)
            values_by_seed[seed] = value
            per_seed_totals[seed] += value
            all_values.append(value)

        data = case["data"]
        by_class = defaultdict(list)
        for model in data["models"]:
            value = values_by_seed[model["seed"]]
            model[METRIC_KEY] = value
            model[PCT_KEY] = value * 100.0
            by_class[int(model["pred_class"])].append(value)

        for entry in data.get("summary", []):
            values = by_class.get(int(entry.get("class_id")), [])
            if values:
                entry[SUMMARY_KEY] = statistics.fmean(values)

    if not args.dry_run:
        for case in cases:
            with open(case["path"], "w") as handle:
                json.dump(case["data"], handle, sort_keys=True, separators=(",", ":"))

        with open(global_metrics_path) as handle:
            global_metrics = json.load(handle)
        for model in global_metrics.get("models", []):
            seed = model.get("seed")
            if seed in per_seed_totals:
                model[GLOBAL_KEY] = per_seed_totals[seed] / len(cases)
        with open(global_metrics_path, "w") as handle:
            json.dump(global_metrics, handle, sort_keys=True, separators=(",", ":"))

    print(f"{args.dataset}: {len(cases)} cases x {len(seeds)} models")
    print(
        f"{METRIC_KEY}: mean {statistics.fmean(all_values):.3f}, "
        f"median {statistics.median(all_values):.3f}, min {min(all_values):.3f}, "
        f"max {max(all_values):.3f}"
    )
    print(f"cases where the {K_NEIGHBOURS}th neighbour was cut out of a tie: {tie_cuts} / {len(cases)}")
    if args.dry_run:
        print("dry run -- nothing written")


if __name__ == "__main__":
    main()
