#!/usr/bin/env python3
"""Build the fixed study assignment under ``exp_data/``.

    exp_data/<dataset>/<user_role>/<case_id>.json     case_id = 0 .. 19

Each file is one case a participant in that role will see, copied whole out of
``data/<dataset>/cases/<i>.json`` and carrying an extra ``assignment`` block. The
participant's role and the case id are the only things the study URL needs; the
opponent role, opponent weights, and expected optimal models are pinned here.

Current selection target, per dataset and user role:

  * 20 distinct cases, ids 0..19.
  * Every case is a Self/Other conflict: the Self-optimal model and the
    Other-optimal model predict different classes.
  * The joint-optimal model maximises Self utility + Other utility over the
    Pareto frontier, and is neither side's individual optimum.
  * In 10 cases the joint-optimal prediction matches Self's optimum; in 10 it
    matches Other's optimum. The opponent role is embedded per case and kept
    roughly balanced across the three possible opponents when the pools allow it.

    python3 scripts/build_exp_data.py --dataset compas
    python3 scripts/build_exp_data.py --dataset compas --dry-run
"""

from __future__ import annotations

import argparse
import json
import shutil
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXP = ROOT / "exp_data"

CASES_PER_ROLE = 20
ALIGN_PER_SIDE = CASES_PER_ROLE // 2
WEIGHT_NUDGES = (5, 10, 15)

CRITERIA = ["accuracy", "tpr", "tnr", "local_consistency"]
METRIC_KEYS = {
    "accuracy": ["subgroup_accuracy", "local_accuracy"],
    "tpr": ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"],
    "tnr": ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"],
    "local_consistency": ["local_consistency"],
}
PERSONAS = {
    "judges": ({"accuracy": 85, "tpr": 5, "tnr": 5, "local_consistency": 5},
               ["accuracy", "tpr", "tnr", "local_consistency"]),
    "defendants": ({"accuracy": 5, "tpr": 5, "tnr": 85, "local_consistency": 5},
                   ["tnr", "local_consistency", "accuracy", "tpr"]),
    "community_members": ({"accuracy": 5, "tpr": 85, "tnr": 5, "local_consistency": 5},
                          ["tpr", "local_consistency", "accuracy", "tnr"]),
    "fairness_advocates": ({"accuracy": 5, "tpr": 5, "tnr": 5, "local_consistency": 85},
                           ["local_consistency", "tnr", "accuracy", "tpr"]),
}
ROLES = list(PERSONAS)


def criterion_value(model, key):
    for metric_key in METRIC_KEYS[key]:
        value = model.get(metric_key)
        if isinstance(value, (int, float)):
            return float(value)
    fnr = model.get("local_fnr", model.get("local_false_negative_rate"))
    if key == "tpr" and isinstance(fnr, (int, float)):
        return 1.0 - float(fnr)
    fpr = model.get("local_fpr", model.get("local_false_positive_rate"))
    if key == "tnr" and isinstance(fpr, (int, float)):
        return 1.0 - float(fpr)
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


def utility(model, raw_weights):
    effective = normalize(raw_weights)
    return sum(effective[k] * (criterion_value(model, k) or 0.0) for k in CRITERIA)


def select(frontier, raw_weights, priority_key):
    """selectedSingleOptimalModel() from js/summary-guards.js."""
    def rank(model):
        return (-utility(model, raw_weights), -(criterion_value(model, priority_key) or 0.0), -float(model.get("pred_prob") or 0))

    return sorted(frontier, key=rank)[0]


def select_joint(frontier, self_weights, other_weights):
    def rank(model):
        self_u = utility(model, self_weights)
        other_u = utility(model, other_weights)
        return (-(self_u + other_u), -min(self_u, other_u), -self_u, -other_u, -float(model.get("pred_prob") or 0))

    return sorted(frontier, key=rank)[0]


def weight_neighbourhood(base):
    yield dict(base)
    for source in CRITERIA:
        for target in CRITERIA:
            if source == target:
                continue
            for points in WEIGHT_NUDGES:
                moved = min(points, base[source])
                if moved <= 0:
                    continue
                nudged = dict(base)
                nudged[source] -= moved
                nudged[target] += moved
                yield nudged


def analyse_case(path):
    data = json.loads(path.read_text())
    frontier = pareto_frontier(data["models"])
    if len(frontier) < 3 or len({int(m["pred_class"]) for m in frontier}) < 2:
        return None

    picks = {}
    for role, (weights, ranking) in PERSONAS.items():
        model = select(frontier, weights, ranking[0])
        stable = all(
            int(select(frontier, nudged, ranking[0])["pred_class"]) == int(model["pred_class"])
            for nudged in weight_neighbourhood(weights)
        )
        picks[role] = {
            "seed": int(model["seed"]),
            "pred_class": int(model["pred_class"]),
            "stable": stable,
            "utility": utility(model, weights),
        }

    class1 = sum(1 for m in data["models"] if int(m["pred_class"]) == 1)
    return {
        "test_case_index": int(data["case"]["test_case_index"]),
        "frontier": frontier,
        "picks": picks,
        "multiplicity": min(class1, len(data["models"]) - class1),
        "labels": data["label_names"],
    }


def scan(dataset):
    rows = []
    for entry in json.loads((DATA / dataset / "cases.json").read_text()):
        path = DATA / dataset / "cases" / f"{entry['test_case_index']}.json"
        if not path.exists():
            continue
        row = analyse_case(path)
        if row:
            rows.append(row)
    return rows


def candidate_for(row, user_role, opponent):
    user_weights, user_rank = PERSONAS[user_role]
    other_weights, _ = PERSONAS[opponent]
    user_pick = row["picks"][user_role]
    other_pick = row["picks"][opponent]
    if user_pick["pred_class"] == other_pick["pred_class"]:
        return None

    joint_model = select_joint(row["frontier"], user_weights, other_weights)
    joint_seed = int(joint_model["seed"])
    if joint_seed in {user_pick["seed"], other_pick["seed"]}:
        return None
    joint_pred = int(joint_model["pred_class"])
    if joint_pred == user_pick["pred_class"]:
        joint_alignment = "self"
    elif joint_pred == other_pick["pred_class"]:
        joint_alignment = "other"
    else:
        return None

    self_at_self = utility(joint_model, user_weights)
    other_at_joint = utility(joint_model, other_weights)
    self_model = next(m for m in row["frontier"] if int(m["seed"]) == user_pick["seed"])
    other_model = next(m for m in row["frontier"] if int(m["seed"]) == other_pick["seed"])
    self_loss_at_other = utility(self_model, user_weights) - utility(other_model, user_weights)
    other_loss_at_self = utility(other_model, other_weights) - utility(self_model, other_weights)
    conflict_score = self_loss_at_other + other_loss_at_self
    joint_utility = self_at_self + other_at_joint
    individual_joint_best = user_pick["utility"] + other_pick["utility"]

    return {
        "row": row,
        "opponent": opponent,
        "joint_alignment": joint_alignment,
        "joint_model_seed": joint_seed,
        "joint_pred_class": joint_pred,
        "joint_utility": joint_utility,
        "joint_gap_from_individual_bests": individual_joint_best - joint_utility,
        "conflict_score": conflict_score,
        "multiplicity": row["multiplicity"],
        "user_priority_value": criterion_value(self_model, user_rank[0]) or 0.0,
    }


def assign(rows, user_role):
    opponents = [r for r in ROLES if r != user_role]
    candidates = []
    for row in rows:
        for opponent in opponents:
            candidate = candidate_for(row, user_role, opponent)
            if candidate:
                candidates.append(candidate)

    def rank(candidate):
        return (
            -candidate["conflict_score"],
            -candidate["multiplicity"],
            candidate["joint_gap_from_individual_bests"],
            -candidate["joint_utility"],
            -candidate["user_priority_value"],
            candidate["row"]["test_case_index"],
            candidate["opponent"],
        )

    selected = []
    used_cases = set()
    opponent_counts = Counter()
    opponents = [r for r in ROLES if r != user_role]
    opponent_quota = {opponent: CASES_PER_ROLE // len(opponents) for opponent in opponents}
    for opponent in opponents[:CASES_PER_ROLE % len(opponents)]:
        opponent_quota[opponent] += 1

    def take_one(alignment):
        pool = sorted((c for c in candidates if c["joint_alignment"] == alignment), key=rank)
        available = [c for c in pool if c["row"]["test_case_index"] not in used_cases]
        under_quota = [c for c in available if opponent_counts[c["opponent"]] < opponent_quota[c["opponent"]]]
        chosen_pool = under_quota or available
        if not chosen_pool:
            return None
        # Keep conflict score primary, but when two candidates are close, spend
        # the next slot on the opponent seen least often so the embedded other
        # role does not collapse to one persona.
        return sorted(chosen_pool, key=lambda c: (opponent_counts[c["opponent"]],) + rank(c))[0]

    alignment_counts = Counter()
    for _ in range(ALIGN_PER_SIDE):
        for alignment in ("self", "other"):
            candidate = take_one(alignment)
            if not candidate:
                counts = {a: sum(1 for c in candidates if c["joint_alignment"] == a) for a in ("self", "other")}
                raise SystemExit(
                    f"{user_role}: need {ALIGN_PER_SIDE} joint-{alignment} cases, "
                    f"found {alignment_counts[alignment]} after de-dup; candidate counts before de-dup {counts}"
                )
            selected.append(candidate)
            used_cases.add(candidate["row"]["test_case_index"])
            opponent_counts[candidate["opponent"]] += 1
            alignment_counts[alignment] += 1

    return selected


def write_role(dataset, user_role, ordered, dry_run):
    target_dir = EXP / dataset / user_role
    if not dry_run:
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True)

    summary = []
    for case_id, candidate in enumerate(ordered):
        row = candidate["row"]
        opponent = candidate["opponent"]
        source = DATA / dataset / "cases" / f"{row['test_case_index']}.json"
        payload = json.loads(source.read_text())
        user_pick = row["picks"][user_role]
        other_pick = row["picks"][opponent]
        payload["assignment"] = {
            "dataset": dataset,
            "user_role": user_role,
            "case_id": case_id,
            "test_case_index": row["test_case_index"],
            "other_role": opponent,
            "other_weights": normalize(PERSONAS[opponent][0]),
            "other_rank_order": PERSONAS[opponent][1],
            "expected": {
                "agreement": False,
                "user_model_seed": user_pick["seed"],
                "user_pred_class": user_pick["pred_class"],
                "other_model_seed": other_pick["seed"],
                "other_pred_class": other_pick["pred_class"],
                "joint_model_seed": candidate["joint_model_seed"],
                "joint_pred_class": candidate["joint_pred_class"],
                "joint_alignment": candidate["joint_alignment"],
                "joint_utility": candidate["joint_utility"],
                "conflict_score": candidate["conflict_score"],
                "user_verdict_stable_under_weight_nudges": user_pick["stable"],
            },
        }
        if not dry_run:
            (target_dir / f"{case_id}.json").write_text(json.dumps(payload))
        summary.append({
            "case_id": case_id,
            "test_case_index": row["test_case_index"],
            "other_role": opponent,
            "agreement": False,
            "user_pred_class": user_pick["pred_class"],
            "other_pred_class": other_pick["pred_class"],
            "joint_model_seed": candidate["joint_model_seed"],
            "joint_pred_class": candidate["joint_pred_class"],
            "joint_alignment": candidate["joint_alignment"],
            "multiplicity": row["multiplicity"],
            "conflict_score": candidate["conflict_score"],
        })

    if not dry_run:
        (target_dir / "index.json").write_text(json.dumps({
            "dataset": dataset,
            "user_role": user_role,
            "case_count": len(summary),
            "agreement_count": 0,
            "joint_alignment_counts": {
                "self": sum(1 for s in summary if s["joint_alignment"] == "self"),
                "other": sum(1 for s in summary if s["joint_alignment"] == "other"),
            },
            "cases": summary,
        }, indent=1))
    return summary


def build(dataset, dry_run):
    print(f"scanning {dataset} ...")
    rows = scan(dataset)
    print(f"  {len(rows)} cases with a split Pareto frontier")
    for user_role in ROLES:
        ordered = assign(rows, user_role)
        summary = write_role(dataset, user_role, ordered, dry_run)
        align = {side: sum(1 for s in summary if s["joint_alignment"] == side) for side in ("self", "other")}
        per_opponent = {o: sum(1 for s in summary if s["other_role"] == o) for o in ROLES if o != user_role}
        avg_conflict = sum(s["conflict_score"] for s in summary) / len(summary)
        print(f"  {user_role:20s} {len(summary)} conflicts, joint align {align}, "
              f"opponents {per_opponent}, avg conflict {avg_conflict:.4f}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=["compas", "acs_coverage"], required=True)
    parser.add_argument("--dry-run", action="store_true", help="report the assignment without writing files")
    args = parser.parse_args()
    build(args.dataset, args.dry_run)
