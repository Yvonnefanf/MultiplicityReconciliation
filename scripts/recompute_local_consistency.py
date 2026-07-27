#!/usr/bin/env python3
"""Recompute the Individual Fairness criterion (local_consistency) for COMPAS.

The shipped values were a hard-label agreement count over 15 neighbours chosen
on all features, race included.  Because identical feature vectors necessarily
get identical predictions from a deterministic model, the metric saturated: 93%
of model-case pairs sat at exactly 1.0 and it could not separate the two
prediction groups in half the cases.

This recomputes it as: of the 30 people most similar to this case on the
legitimate case features, how many does this model give the same predicted class
as it gives this case?

Similarity features (race deliberately excluded -- treating similar people
differently *because of* race is what the criterion is meant to catch):

    Prior offenses      "Number of priors"    log1p, min-max scaled to [0, 1]
    Charge severity     "Misdemeanor"         0 / 1
    Risk score factor   "Score factor"        0 / 1
    Age                 age bucket            <25 -> 0, 25-45 -> 0.5, >45 -> 1
    Sex                 "Female"              0 / 1

Distance is the sum of per-feature absolute differences (Gower-style, equal
weight per feature), so neighbours match on the categorical features first and
are then ordered by how close their prior-offence count is.  Ties at the k-th
position are broken by test_case_index, which keeps the run reproducible.

Everything is derived from data already in the case files -- the per-case
features and each model's pred_class -- so the script is idempotent and can be
re-run after the data is regenerated.

Usage:
    python3 scripts/recompute_local_consistency.py --dry-run   # report only
    python3 scripts/recompute_local_consistency.py             # write files
"""

import argparse
import glob
import json
import math
import os
import statistics
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CASES_GLOB = os.path.join(REPO, "data", "compas", "cases", "*.json")
GLOBAL_METRICS = os.path.join(REPO, "data", "compas", "model_global_metrics.json")
K_NEIGHBOURS = 30


def similarity_vector(features):
    """The five legitimate case features, each scaled to [0, 1]. Race excluded."""
    priors = float(features.get("Number of priors") or 0.0)
    age = 0.0 if features.get("Age below 25") == 1 else (1.0 if features.get("Age above 45") == 1 else 0.5)
    return [
        math.log1p(max(0.0, priors)),  # rescaled below, once the max is known
        float(features.get("Misdemeanor") or 0.0),
        float(features.get("Score factor") or 0.0),
        age,
        float(features.get("Female") or 0.0),
    ]


def load_cases():
    paths = sorted(glob.glob(CASES_GLOB), key=lambda p: int(os.path.basename(p)[:-5]))
    cases = []
    for path in paths:
        with open(path) as handle:
            data = json.load(handle)
        cases.append({"path": path, "data": data})
    return cases


def build_matrices(cases):
    vectors = [similarity_vector(case["data"]["case"]["features"]) for case in cases]
    priors_max = max(vector[0] for vector in vectors) or 1.0
    for vector in vectors:
        vector[0] /= priors_max  # log1p priors -> [0, 1], same footing as the flags

    # seed -> [pred_class per case]; the seed set is identical across cases but
    # the order is not, so index by seed rather than by position.
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
    scored.sort()  # (distance, index) -> deterministic tie-break
    picked = scored[:k]
    cut_tie = len(scored) > k and math.isclose(scored[k - 1][0], scored[k][0], abs_tol=1e-12)
    return [index for _, index in picked], cut_tie


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="report the new distribution without writing")
    args = parser.parse_args()

    cases = load_cases()
    vectors, predictions = build_matrices(cases)
    seeds = sorted(predictions)
    print(f"{len(cases)} cases x {len(seeds)} models")

    old_values, new_values, tie_cuts = [], [], 0
    per_seed_totals = defaultdict(float)

    for index, case in enumerate(cases):
        neighbour_indices, cut_tie = neighbours_for(index, vectors)
        tie_cuts += 1 if cut_tie else 0
        consistency = {}
        for seed in seeds:
            column = predictions[seed]
            own = column[index]
            agree = sum(1 for other in neighbour_indices if column[other] == own)
            value = agree / len(neighbour_indices)
            consistency[seed] = value
            per_seed_totals[seed] += value

        data = case["data"]
        for model in data["models"]:
            old_values.append(model.get("local_consistency"))
            value = consistency[model["seed"]]
            new_values.append(value)
            model["local_consistency"] = value
            if "local_fairness_pct" in model:
                model["local_fairness_pct"] = value * 100.0

        # Group- and class-level aggregates the app reads directly.
        by_class = defaultdict(list)
        for model in data["models"]:
            by_class[int(model["pred_class"])].append(consistency[model["seed"]])
        for group in data.get("reconciliation", {}).get("groups", []):
            seeds_in_group = group.get("model_seeds") or []
            values = [consistency[seed] for seed in seeds_in_group if seed in consistency]
            if not values:
                values = by_class.get(int(group.get("class_id")), [])
            if not values:
                continue
            mean = statistics.fmean(values)
            if "criteria" in group and "local_consistency" in group["criteria"]:
                group["criteria"]["local_consistency"] = mean
            if "fairness_components" in group and "local_consistency" in group["fairness_components"]:
                group["fairness_components"]["local_consistency"] = mean
        for entry in data.get("summary", []):
            values = by_class.get(int(entry.get("class_id")), [])
            if values and "avg_local_consistency" in entry:
                entry["avg_local_consistency"] = statistics.fmean(values)

    if not args.dry_run:
        for case in cases:
            with open(case["path"], "w") as handle:
                json.dump(case["data"], handle, sort_keys=True, separators=(",", ":"))

        with open(GLOBAL_METRICS) as handle:
            global_metrics = json.load(handle)
        for model in global_metrics.get("models", []):
            seed = model.get("seed")
            if seed in per_seed_totals:
                model["global_consistency"] = per_seed_totals[seed] / len(cases)
        if not args.dry_run:
            with open(GLOBAL_METRICS, "w") as handle:
                json.dump(global_metrics, handle, sort_keys=True, separators=(",", ":"))

    def describe(label, values):
        values = [v for v in values if v is not None]
        at_one = sum(1 for v in values if v >= 0.999999) / len(values)
        print(
            f"{label:>8}: mean {statistics.fmean(values):.3f}  median {statistics.median(values):.3f}  "
            f"min {min(values):.3f}  at 100% {at_one * 100:.1f}%  distinct {len(set(round(v, 6) for v in values))}"
        )

    describe("old", old_values)
    describe("new", new_values)
    print(f"cases where the 30th neighbour was cut out of a tie: {tie_cuts} / {len(cases)}")
    if args.dry_run:
        print("dry run -- nothing written")


if __name__ == "__main__":
    main()
