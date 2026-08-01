#!/usr/bin/env python3
"""Build the fixed study assignment under ``exp_data/``.

    exp_data/<dataset>/<user_role>/<case_id>.json     case_id = 0 .. 17

Each file is one case a participant in that role will see, copied whole out of
``data/<dataset>/cases/<i>.json`` and carrying an extra ``assignment`` block. The
point is to take the randomness out of the study: the participant's role and the
case id are the only things in the URL, and everything else -- which underlying
case, who the other stakeholder is, what weights that stakeholder holds -- is
fixed here and read back from the file.

What is guaranteed per role, per dataset:

  * 18 distinct cases, ids 0..17.
  * The other stakeholder is one of the three roles the participant is not, six
    cases each, and their weights are that role's fixed persona weights.
  * Exactly 3 of the 18 agree (both sides' optimal model predicts the same
    class); the other 15 conflict. One agreement per opponent.
  * The agreement/conflict verdict survives the participant's weights being a
    little different from their role template, which is what ?..._weight= in the
    URL does. Every case is checked against a neighbourhood of the role weights
    (WEIGHT_NUDGES points moved between each pair of criteria) and only kept if
    the participant's optimal model predicts the same class throughout.

The other side needs no such check: their weights are pinned to the persona
template, so their optimal model is a single deterministic answer.

    python3 scripts/build_exp_data.py --dataset compas
    python3 scripts/build_exp_data.py --dataset compas --dry-run   # report only
"""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
EXP = ROOT / "exp_data"

CASES_PER_ROLE = 18
AGREEMENTS_PER_ROLE = 3
# Where the three agreeing cases sit, the same for every role and dataset.
AGREEMENT_CASE_IDS = (4, 10, 16)
# Percentage points shifted between each ordered pair of criteria to build the
# neighbourhood the verdict has to survive.
WEIGHT_NUDGES = (5, 10, 15)

CRITERIA = ["accuracy", "tpr", "tnr", "local_consistency"]
# Mirrors modelCriterionValue() in js/summary-guards.js.
METRIC_KEYS = {
    "accuracy": ["subgroup_accuracy", "local_accuracy"],
    "tpr": ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"],
    "tnr": ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"],
    "local_consistency": ["local_consistency"],
}
# personaTypes / personaRankDefaults in js/config-state.js. These weights are the
# fixed profile the other stakeholder always holds.
PERSONAS = {
    "judges": ({"accuracy": 65, "tpr": 20, "tnr": 10, "local_consistency": 5},
               ["accuracy", "tpr", "tnr", "local_consistency"]),
    "defendants": ({"accuracy": 10, "tpr": 5, "tnr": 65, "local_consistency": 20},
                   ["tnr", "local_consistency", "accuracy", "tpr"]),
    "community_members": ({"accuracy": 10, "tpr": 65, "tnr": 5, "local_consistency": 20},
                          ["tpr", "local_consistency", "accuracy", "tnr"]),
    "fairness_advocates": ({"accuracy": 10, "tpr": 5, "tnr": 20, "local_consistency": 65},
                           ["local_consistency", "tnr", "accuracy", "tpr"]),
}
ROLES = list(PERSONAS)


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
    """selectedSingleOptimalModel() from js/summary-guards.js."""
    effective = normalize(raw_weights)

    def rank(model):
        utility = sum(effective[k] * (criterion_value(model, k) or 0.0) for k in CRITERIA)
        return (-utility, -(criterion_value(model, priority_key) or 0.0), -float(model.get("pred_prob") or 0))

    return sorted(frontier, key=rank)[0]


def weight_neighbourhood(base):
    """The role's weights plus every small shift of points between two criteria.
    The participant's real weights arrive from the URL near, not exactly on, the
    template, so a case only counts if the verdict holds across all of these."""
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
    """Per role: the class that role's optimal model predicts, and whether that
    survives the weight neighbourhood."""
    data = json.loads(path.read_text())
    frontier = pareto_frontier(data["models"])
    if len({int(m["pred_class"]) for m in frontier}) < 2:
        return None  # unanimous frontier: no opponent pairing could ever conflict

    picks = {}
    for role, (weights, ranking) in PERSONAS.items():
        model = select(frontier, weights, ranking[0])
        stable = all(
            int(select(frontier, nudged, ranking[0])["pred_class"]) == int(model["pred_class"])
            for nudged in weight_neighbourhood(weights)
        )
        picks[role] = {"seed": int(model["seed"]), "pred_class": int(model["pred_class"]), "stable": stable}

    class1 = sum(1 for m in data["models"] if int(m["pred_class"]) == 1)
    return {
        "test_case_index": int(data["case"]["test_case_index"]),
        "picks": picks,
        # How split the 100 models are; a case nobody disagrees about teaches
        # nothing, so ties are broken toward the genuinely multiple ones.
        "multiplicity": min(class1, 100 - class1),
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


def assign(rows, user_role):
    """Pick this role's 18 cases: 15 conflicts and 3 agreements, spread over the
    three opponents as evenly as the data allows.

    An even six-per-opponent split is not always available. In acs_coverage the
    defendants and fairness_advocates optima land on the same class in all but
    one case, so demanding five conflicts from that pairing would fail. The
    conflict budget is therefore water-filled: opponents are served scarcest pool
    first, each taking an equal share of what is left, so a thin pairing is used
    up to its limit and the slack goes to the pairings that can carry it. The
    15/3 split itself is exact -- that is the number the study is designed on.

    Cases are taken most-multiple first, so the study runs where the model set
    genuinely splits, and no case is used twice within a role."""
    opponents = [r for r in ROLES if r != user_role]
    # Only cases whose verdict is stable for this participant are eligible.
    eligible = [r for r in rows if r["picks"][user_role]["stable"]]
    eligible.sort(key=lambda r: (-r["multiplicity"], r["test_case_index"]))

    def agrees_with(row, opponent):
        return row["picks"][user_role]["pred_class"] == row["picks"][opponent]["pred_class"]

    def pool(opponent, want_agreement, used):
        return [r for r in eligible
                if r["test_case_index"] not in used and agrees_with(r, opponent) == want_agreement]

    used = set()
    picked = []

    def take(opponent, want_agreement, count):
        taken = 0
        for row in pool(opponent, want_agreement, used):
            if taken == count:
                break
            used.add(row["test_case_index"])
            picked.append((row, opponent, want_agreement))
            taken += 1
        return taken

    # Conflicts first, scarcest pairing first so an overlapping case is never
    # spent on a pairing that had alternatives.
    conflict_budget = CASES_PER_ROLE - AGREEMENTS_PER_ROLE
    order = sorted(opponents, key=lambda o: len(pool(o, False, used)))
    conflicts = {}
    for position, opponent in enumerate(order):
        share = -(-conflict_budget // (len(order) - position))  # ceil
        conflicts[opponent] = take(opponent, False, min(share, len(pool(opponent, False, used))))
        conflict_budget -= conflicts[opponent]
    if conflict_budget:
        raise SystemExit(
            f"{user_role}: {conflict_budget} conflicting cases short; "
            f"pools were {[(o, len(pool(o, False, set()))) for o in opponents]}"
        )

    # Agreements go to whoever has the fewest cases so far, which keeps every
    # opponent present even when their conflict pool was thin.
    for _ in range(AGREEMENTS_PER_ROLE):
        counts = {o: sum(1 for _, op, _ in picked if op == o) for o in opponents}
        for opponent in sorted(opponents, key=lambda o: (counts[o], o)):
            if take(opponent, True, 1):
                break
        else:
            raise SystemExit(f"{user_role}: no agreeing case left for any opponent")

    # The three agreements sit at the same case ids for every role and dataset,
    # spread through the run rather than clustered: a participant does not meet
    # one first and does not meet all three at the end, and analysis can find
    # them without reading the files. Conflicts round-robin the opponents so no
    # opponent holds a contiguous block. All deterministic: nothing is shuffled.
    picked.sort(key=lambda item: (item[0]["multiplicity"], item[0]["test_case_index"]))
    queues = {o: [p for p in picked if p[1] == o and not p[2]] for o in opponents}
    agreements = [p for p in picked if p[2]]

    ordered = []
    for case_id in range(CASES_PER_ROLE):
        if case_id in AGREEMENT_CASE_IDS and agreements:
            ordered.append(agreements.pop(0))
            continue
        # Longest queue first, so the leftovers cannot pile up at the end.
        opponent = max(opponents, key=lambda o: (len(queues[o]), o))
        ordered.append(queues[opponent].pop(0))
    return ordered


def write_role(dataset, user_role, ordered, dry_run):
    target_dir = EXP / dataset / user_role
    if not dry_run:
        if target_dir.exists():
            shutil.rmtree(target_dir)
        target_dir.mkdir(parents=True)

    summary = []
    for case_id, (row, opponent, agrees) in enumerate(ordered):
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
            # The other side's profile is pinned here, so nothing downstream has
            # to draw it or read it out of the URL.
            "other_weights": normalize(PERSONAS[opponent][0]),
            "other_rank_order": PERSONAS[opponent][1],
            "expected": {
                "agreement": agrees,
                "user_model_seed": user_pick["seed"],
                "user_pred_class": user_pick["pred_class"],
                "other_model_seed": other_pick["seed"],
                "other_pred_class": other_pick["pred_class"],
                "user_verdict_stable_under_weight_nudges": user_pick["stable"],
            },
        }
        if not dry_run:
            (target_dir / f"{case_id}.json").write_text(json.dumps(payload))
        summary.append({
            "case_id": case_id,
            "test_case_index": row["test_case_index"],
            "other_role": opponent,
            "agreement": agrees,
            "user_pred_class": user_pick["pred_class"],
            "other_pred_class": other_pick["pred_class"],
            "multiplicity": row["multiplicity"],
        })

    if not dry_run:
        # Read by the app to build the case list without fetching all 18 files.
        (target_dir / "index.json").write_text(json.dumps({
            "dataset": dataset,
            "user_role": user_role,
            "case_count": len(summary),
            "agreement_count": sum(1 for s in summary if s["agreement"]),
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
        agree = sum(1 for s in summary if s["agreement"])
        stable = all(r["picks"][user_role]["stable"] for r, _, _ in ordered)
        per_opponent = {o: sum(1 for s in summary if s["other_role"] == o) for o in ROLES if o != user_role}
        print(f"  {user_role:20s} {len(summary)} cases, {agree} agree, "
              f"opponents {per_opponent}, all verdicts stable: {stable}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dataset", choices=["compas", "acs_coverage"], required=True)
    parser.add_argument("--dry-run", action="store_true", help="report the assignment without writing files")
    args = parser.parse_args()
    build(args.dataset, args.dry_run)
