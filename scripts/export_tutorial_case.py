#!/usr/bin/env python3
"""Write the hand-picked walkthrough case to ``data/<key>/tutorial_case.json``.

The ``*_tutorial`` conditions never read ``?case=``; they load this one file, so
the numbered callouts always describe the same screen. The case is copied
verbatim out of ``data/<key>/cases/<i>.json`` -- same shape, same fields -- so
the app can load it through the ordinary case path.

Which case, and why: the walkthrough has to end on a disagreement, because the
next screens are about reconciling one. This script scores every case the way
``js/summary-guards.js`` picks a model -- Pareto frontier, then weighted utility
with the priority-criterion tiebreak -- and prefers cases where the winning
model's predicted class flips as the weights move across the simplex. A case
with balance ~1.0 is one where roughly half of all possible weightings land on
each class, so no matter which role a participant speaks from, the other side
has a genuinely optimal model that disagrees.

    python3 scripts/export_tutorial_case.py --dataset compas
    python3 scripts/export_tutorial_case.py --dataset compas --rank   # re-score

Re-run both datasets after any change to the metrics the selection reads
(subgroup_*, local_consistency), since those move the frontier.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

# The picks, with the numbers that justified them (see --rank).
#   compas 1120       balance 0.99, 38/100 models say High Risk, roles split 2-2
#   acs_coverage 1226 balance 0.98, 48/100 models say Public Coverage, roles 2-2
TUTORIAL_CASE_INDEX = {"compas": 1120, "acs_coverage": 1226}

CRITERIA = ["accuracy", "tpr", "tnr", "local_consistency"]
# Mirrors modelCriterionValue() in js/summary-guards.js.
METRIC_KEYS = {
    "accuracy": ["subgroup_accuracy", "local_accuracy"],
    "tpr": ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"],
    "tnr": ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"],
    "local_consistency": ["local_consistency"],
}
# personaTypes in js/config-state.js, with personaRankDefaults' first entry as
# the tiebreak criterion.
PERSONAS = {
    "judges": ({"accuracy": 65, "tpr": 20, "tnr": 10, "local_consistency": 5}, "accuracy"),
    "defendants": ({"accuracy": 10, "tpr": 5, "tnr": 65, "local_consistency": 20}, "tnr"),
    "community_members": ({"accuracy": 10, "tpr": 65, "tnr": 5, "local_consistency": 20}, "tpr"),
    "fairness_advocates": ({"accuracy": 10, "tpr": 5, "tnr": 20, "local_consistency": 65}, "local_consistency"),
}


def criterion_value(model, key):
    for metric_key in METRIC_KEYS[key]:
        value = model.get(metric_key)
        if isinstance(value, (int, float)):
            return float(value)
    return None


def dominates(a, b):
    strict = False
    compared = 0
    for key in CRITERIA:
        av, bv = criterion_value(a, key), criterion_value(b, key)
        if av is None or bv is None:
            continue
        compared += 1
        if av < bv - 1e-7:
            return False
        if av > bv + 1e-7:
            strict = True
    return compared > 0 and strict


def pareto_frontier(models):
    return [m for m in models if not any(o is not m and dominates(o, m) for o in models)]


def normalize(raw):
    clipped = {k: max(0.0, float(raw.get(k, 0) or 0)) for k in CRITERIA}
    total = sum(clipped.values())
    if total <= 0:
        return {k: 0.25 for k in CRITERIA}
    return {k: v / total for k, v in clipped.items()}


def select(frontier, raw_weights, priority_key):
    effective = normalize(raw_weights)

    def rank(model):
        utility = sum(effective[k] * (criterion_value(model, k) or 0.0) for k in CRITERIA)
        return (-utility, -(criterion_value(model, priority_key) or 0.0), -float(model.get("pred_prob") or 0))

    return sorted(frontier, key=rank)[0]


def simplex(step=10):
    """Every weighting on a 10%-step simplex -- the elicitation hands over
    arbitrary weights, so the case has to hold up across the whole space."""
    n = 100 // step
    for a in range(n + 1):
        for b in range(n + 1 - a):
            for c in range(n + 1 - a - b):
                yield {"accuracy": a, "tpr": b, "tnr": c, "local_consistency": n - a - b - c}


def score_case(path):
    data = json.loads(path.read_text())
    frontier = pareto_frontier(data["models"])
    if len({int(m["pred_class"]) for m in frontier}) < 2:
        return None  # the frontier is unanimous; no weighting can disagree

    roles = {}
    for name, (weights, priority) in PERSONAS.items():
        model = select(frontier, weights, priority)
        roles[name] = (int(model["seed"]), int(model["pred_class"]))

    grid = [int(select(frontier, w, max(CRITERIA, key=lambda k: w[k]))["pred_class"]) for w in simplex()]
    share = sum(grid) / len(grid)
    return {
        "case": data["case"]["test_case_index"],
        "balance": round(1 - abs(share - 0.5) * 2, 3),
        "class1_models": sum(1 for m in data["models"] if int(m["pred_class"]) == 1),
        "roles_split": len({c for _, c in roles.values()}) > 1,
        "roles": roles,
        "labels": data["label_names"],
    }


def rank(dataset):
    scored = []
    for entry in json.loads((DATA / dataset / "cases.json").read_text()):
        path = DATA / dataset / "cases" / f"{entry['test_case_index']}.json"
        row = score_case(path) if path.exists() else None
        if row and row["roles_split"]:
            scored.append(row)
    scored.sort(key=lambda r: (-r["balance"], -min(r["class1_models"], 100 - r["class1_models"])))
    for row in scored[:12]:
        roles = " ".join(f"{k[:4]}=#{s}/{row['labels'][c]}" for k, (s, c) in row["roles"].items())
        print(f"case {row['case']:>5}  balance={row['balance']:.2f}  "
              f"{row['class1_models']:>3}/100 predict {row['labels'][1]!r}  | {roles}")


def export(dataset):
    index = TUTORIAL_CASE_INDEX[dataset]
    source = DATA / dataset / "cases" / f"{index}.json"
    target = DATA / dataset / "tutorial_case.json"
    row = score_case(source)
    if not row:
        raise SystemExit(f"{dataset} case {index} has a unanimous frontier -- it cannot show a disagreement")
    target.write_text(source.read_text())
    roles = ", ".join(f"{k}=#{s} {row['labels'][c]}" for k, (s, c) in row["roles"].items())
    print(f"wrote {target.relative_to(DATA.parent)} (case {index}, balance {row['balance']:.2f}, "
          f"{row['class1_models']}/100 predict {row['labels'][1]!r})\n  roles: {roles}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=sorted(TUTORIAL_CASE_INDEX), required=True)
    parser.add_argument("--rank", action="store_true", help="score every case instead of exporting (slow)")
    args = parser.parse_args()
    rank(args.dataset) if args.rank else export(args.dataset)
