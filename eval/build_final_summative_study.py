#!/usr/bin/env python3
"""Select and materialize the final summative-study cases.

The selector uses the deterministic UI-first negotiation simulation in
exp_data/by_label_simulator.csv. It treats outcome utility (label utility) and
process sacrifice (model utility from Self's v0 to the negotiated model) as
separate quantities.
"""

from __future__ import annotations

import csv
import hashlib
import itertools
import json
import math
import random
import shutil
import statistics
from collections import Counter, defaultdict
from pathlib import Path


REPO = Path(__file__).resolve().parents[1]
SOURCE_ROOT = REPO / "exp_data"
OUTPUT_ROOT = REPO / "Final_summative_study"
SOURCE_CSV = SOURCE_ROOT / "by_label_simulator.csv"

CONDITIONS = ["single", "self_optimal", "multi_optimal", "aggregate", "negotiate"]
MIDDLE_CONDITIONS = ["self_optimal", "multi_optimal", "aggregate"]
CASES_PER_ROLE = 20
MIN_ALIGNMENT_PER_ROLE = 7
MAX_ALIGNMENT_PER_ROLE = 13
SELF_ALIGNED_PER_DATASET = 40
MIN_CASES_PER_OTHER_ROLE = 2
MAX_MODEL_SELF_SACRIFICE = 0.15
SACRIFICE_PENALTY = 0.5
INITIAL_TREND_WEIGHT = 2.0
REFINEMENT_SEEDS = tuple(range(2000, 2005))
REFINEMENT_STEPS = 70_000
REFINEMENT_TARGETS = (0.015, 0.06, 0.03, 0.015, 0.06, 0.08, 0.05, 0.12, 0.07, 0.14)
MIN_NEGOTIATE_AVG_GAP = 0.05
MIN_MIDDLE_AVG_GAP = 0.12
MIN_NEGOTIATE_NASH_GAP = 0.065
MIN_MIDDLE_NASH_GAP = 0.14
ORDER_SALT = "final-summative-v1"


def numeric_case_id(value: str):
    try:
        return (0, int(value))
    except ValueError:
        return (1, value)


def compositions(total: int, parts: int, prefix=()):
    if parts == 1:
        yield prefix + (total,)
        return
    for value in range(total + 1):
        yield from compositions(total - value, parts - 1, prefix + (value,))


def mean_sem(values):
    mean = statistics.fmean(values)
    sem = statistics.stdev(values) / math.sqrt(len(values)) if len(values) > 1 else 0.0
    return mean, sem


def load_runs():
    with SOURCE_CSV.open(newline="", encoding="utf-8") as handle:
        rows = list(csv.DictReader(handle))
    if not rows:
        raise RuntimeError(f"No rows in {SOURCE_CSV}")
    grouped = defaultdict(dict)
    for row in rows:
        key = (row["dataset"], row["Self_role"], row["Other_role"], row["caseID"])
        self_u = float(row["self_utility"])
        other_u = float(row["other utility"])
        row["avg_utility"] = (self_u + other_u) / 2
        row["Nash_utility"] = self_u * other_u
        grouped[key][row["Condition"]] = row
    incomplete = [key for key, values in grouped.items() if set(values) != set(CONDITIONS)]
    if incomplete:
        raise RuntimeError(f"Incomplete condition rows for {len(incomplete)} cases")
    return rows[0].keys(), grouped


def outcome_components(condition_rows):
    components = []
    for metric in ("avg_utility", "Nash_utility"):
        components.extend(
            condition_rows["negotiate"][metric] - condition_rows[condition][metric]
            for condition in MIDDLE_CONDITIONS
        )
        components.extend(
            condition_rows[condition][metric] - condition_rows["single"][metric]
            for condition in MIDDLE_CONDITIONS
        )
    return components


def trend_components(condition_rows):
    """Positive values reproduce the intended concession/benefit trajectory."""
    value = lambda condition, metric: float(condition_rows[condition][metric])
    return [
        value("self_optimal", "self_utility") - value("multi_optimal", "self_utility"),
        value("multi_optimal", "self_utility") - value("aggregate", "self_utility"),
        value("aggregate", "self_utility") - value("negotiate", "self_utility"),
        value("multi_optimal", "other utility") - value("self_optimal", "other utility"),
        value("aggregate", "other utility") - value("multi_optimal", "other utility"),
        value("negotiate", "other utility") - value("aggregate", "other utility"),
    ]


def build_candidates(grouped):
    candidates = defaultdict(list)
    for key, condition_rows in grouped.items():
        dataset, self_role, other_role, source_case_id = key
        negotiate = condition_rows["negotiate"]
        sacrifice = float(negotiate["final_model_self_sacrifice"])
        if negotiate["flag"] == "not reach" or sacrifice > MAX_MODEL_SELF_SACRIFICE + 1e-12:
            continue
        components = outcome_components(condition_rows)
        trends = trend_components(condition_rows)
        score = (
            statistics.fmean(components)
            + INITIAL_TREND_WEIGHT * statistics.fmean(trends)
            - SACRIFICE_PENALTY * sacrifice
        )
        values = {
            (condition, metric): float(condition_rows[condition][metric])
            for condition in CONDITIONS
            for metric in ("self_utility", "other utility", "avg_utility", "Nash_utility")
        }
        candidates[(dataset, self_role)].append(
            {
                "key": key,
                "dataset": dataset,
                "self_role": self_role,
                "other_role": other_role,
                "source_case_id": source_case_id,
                "alignment": negotiate["negotiate_alignment"],
                "model_self_sacrifice": sacrifice,
                "score": score,
                "components": components,
                "trends": trends,
                "values": values,
                "rows": condition_rows,
            }
        )
    return candidates


def best_role_option(role_candidates, self_count):
    other_roles = sorted({item["other_role"] for item in role_candidates})
    if len(other_roles) != 3:
        raise RuntimeError(f"Expected three Other roles, got {other_roles}")
    buckets = {}
    for alignment in ("self", "other"):
        for other_role in other_roles:
            bucket = [
                item for item in role_candidates
                if item["alignment"] == alignment and item["other_role"] == other_role
            ]
            buckets[(alignment, other_role)] = sorted(
                bucket,
                key=lambda item: (-item["score"], numeric_case_id(item["source_case_id"])),
            )

    best = None
    for self_counts in compositions(self_count, len(other_roles)):
        if any(
            self_counts[index] > len(buckets[("self", other_role)])
            for index, other_role in enumerate(other_roles)
        ):
            continue
        for other_counts in compositions(CASES_PER_ROLE - self_count, len(other_roles)):
            if any(
                other_counts[index] > len(buckets[("other", other_role)])
                or self_counts[index] + other_counts[index] < MIN_CASES_PER_OTHER_ROLE
                for index, other_role in enumerate(other_roles)
            ):
                continue
            selected = []
            for index, other_role in enumerate(other_roles):
                selected.extend(buckets[("self", other_role)][: self_counts[index]])
                selected.extend(buckets[("other", other_role)][: other_counts[index]])
            total_score = sum(item["score"] for item in selected)
            if best is None or total_score > best["total_score"]:
                best = {
                    "total_score": total_score,
                    "self_count": self_count,
                    "selected": selected,
                }
    return best


UTILITY_FIELDS = ("self_utility", "other utility", "avg_utility", "Nash_utility")
VALUE_KEYS = tuple((condition, metric) for condition in CONDITIONS for metric in UTILITY_FIELDS)


def selection_value_sums(selected):
    return {
        key: sum(item["values"][key] for item in selected)
        for key in VALUE_KEYS
    }


def refinement_margins(value_sums, count):
    mean = lambda condition, metric: value_sums[(condition, metric)] / count
    self_optimal = mean("self_optimal", "self_utility")
    multi_self = mean("multi_optimal", "self_utility")
    aggregate_self = mean("aggregate", "self_utility")
    negotiate_self = mean("negotiate", "self_utility")
    self_optimal_other = mean("self_optimal", "other utility")
    multi_other = mean("multi_optimal", "other utility")
    aggregate_other = mean("aggregate", "other utility")
    negotiate_other = mean("negotiate", "other utility")
    middle_avg = [mean(condition, "avg_utility") for condition in MIDDLE_CONDITIONS]
    middle_nash = [mean(condition, "Nash_utility") for condition in MIDDLE_CONDITIONS]
    return (
        self_optimal - multi_self,
        multi_self - aggregate_self,
        aggregate_self - negotiate_self,
        multi_other - self_optimal_other,
        aggregate_other - multi_other,
        negotiate_other - aggregate_other,
        mean("negotiate", "avg_utility") - max(middle_avg),
        min(middle_avg) - mean("single", "avg_utility"),
        mean("negotiate", "Nash_utility") - max(middle_nash),
        min(middle_nash) - mean("single", "Nash_utility"),
    )


def refinement_objective(margins):
    score = 0.0
    for margin, target in zip(margins, REFINEMENT_TARGETS):
        ratio = margin / target
        score += min(ratio, 1.0) - 40 * max(0.0, -ratio) ** 2 + 0.02 * ratio
    return score


def refine_dataset_selection(dataset, initial, candidates):
    """Swap only within fixed quota buckets to improve the aggregate shape.

    A swap preserves dataset, Self role, alignment direction, and Other role,
    so all balancing constraints from the initial selection remain invariant.
    """
    candidate_pools = defaultdict(list)
    for (candidate_dataset, _), items in candidates.items():
        if candidate_dataset != dataset:
            continue
        for item in items:
            bucket = (item["self_role"], item["alignment"], item["other_role"])
            candidate_pools[bucket].append(item)

    overall_best = None
    for seed in REFINEMENT_SEEDS:
        rng = random.Random(seed)
        selected_by_key = {item["key"]: item for item in initial}
        selected_buckets = defaultdict(list)
        for item in initial:
            bucket = (item["self_role"], item["alignment"], item["other_role"])
            selected_buckets[bucket].append(item)
        swappable = [
            bucket for bucket, items in selected_buckets.items()
            if items and len(candidate_pools[bucket]) > len(items)
        ]
        sums = selection_value_sums(initial)
        margins = refinement_margins(sums, len(initial))
        score = refinement_objective(margins)
        run_best = (score, margins, list(initial))

        for step in range(REFINEMENT_STEPS):
            bucket = rng.choice(swappable)
            old = rng.choice(selected_buckets[bucket])
            new = rng.choice(candidate_pools[bucket])
            if new["key"] in selected_by_key:
                continue
            for key in VALUE_KEYS:
                sums[key] += new["values"][key] - old["values"][key]
            trial_margins = refinement_margins(sums, len(initial))
            trial_score = refinement_objective(trial_margins)
            temperature = 0.03 * (1 - step / REFINEMENT_STEPS) + 0.0005
            accept = trial_score >= score or rng.random() < math.exp((trial_score - score) / temperature)
            if accept:
                del selected_by_key[old["key"]]
                selected_by_key[new["key"]] = new
                selected_buckets[bucket].remove(old)
                selected_buckets[bucket].append(new)
                score = trial_score
                margins = trial_margins
                if score > run_best[0]:
                    run_best = (score, margins, list(selected_by_key.values()))
            else:
                for key in VALUE_KEYS:
                    sums[key] += old["values"][key] - new["values"][key]

        if overall_best is None or run_best[0] > overall_best[0]:
            overall_best = run_best
    return overall_best[2]


def select_cases(candidates):
    selected = []
    datasets = sorted({dataset for dataset, _ in candidates})
    for dataset in datasets:
        roles = sorted(role for ds, role in candidates if ds == dataset)
        role_options = []
        for role in roles:
            options = []
            for self_count in range(MIN_ALIGNMENT_PER_ROLE, MAX_ALIGNMENT_PER_ROLE + 1):
                option = best_role_option(candidates[(dataset, role)], self_count)
                if option is not None:
                    options.append(option)
            if not options:
                raise RuntimeError(f"No feasible role option for {dataset}/{role}")
            role_options.append(options)

        feasible = []
        for combination in itertools.product(*role_options):
            if sum(option["self_count"] for option in combination) != SELF_ALIGNED_PER_DATASET:
                continue
            feasible.append((sum(option["total_score"] for option in combination), combination))
        if not feasible:
            raise RuntimeError(f"No balanced selection for {dataset}")
        _, best = max(feasible, key=lambda item: item[0])
        for option in best:
            selected.extend(option["selected"])

    expected_total = len(datasets) * 4 * CASES_PER_ROLE
    if len(selected) != expected_total:
        raise RuntimeError(f"Selected {len(selected)} cases, expected {expected_total}")
    refined = []
    for dataset in datasets:
        dataset_initial = [item for item in selected if item["dataset"] == dataset]
        refined.extend(refine_dataset_selection(dataset, dataset_initial, candidates))
    return refined


def stable_order(item):
    token = f"{ORDER_SALT}|{item['dataset']}|{item['self_role']}|{item['source_case_id']}"
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def write_csv(path, fieldnames, rows):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def materialize(selected, source_headers):
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    selected_by_role = defaultdict(list)
    for item in selected:
        selected_by_role[(item["dataset"], item["self_role"])].append(item)

    manifest_rows = []
    selected_run_rows = []
    for (dataset, self_role), items in sorted(selected_by_role.items()):
        items = sorted(items, key=stable_order)
        source_role_dir = SOURCE_ROOT / dataset / self_role
        output_role_dir = OUTPUT_ROOT / dataset / self_role
        output_role_dir.mkdir(parents=True, exist_ok=True)
        source_index = json.loads((source_role_dir / "index.json").read_text(encoding="utf-8"))
        source_index_cases = {str(item["case_id"]): item for item in source_index["cases"]}
        output_index_cases = []

        for new_case_id, item in enumerate(items):
            source_case_id = item["source_case_id"]
            source_case_path = source_role_dir / f"{source_case_id}.json"
            case_data = json.loads(source_case_path.read_text(encoding="utf-8"))
            case_data["assignment"]["source_case_id"] = case_data["assignment"]["case_id"]
            case_data["assignment"]["case_id"] = new_case_id
            case_data["assignment"]["selection"] = {
                "policy": "ui-first",
                "negotiate_alignment": item["alignment"],
                "model_self_sacrifice": item["model_self_sacrifice"],
                "selection_score": item["score"],
            }
            (output_role_dir / f"{new_case_id}.json").write_text(
                json.dumps(case_data, indent=2) + "\n", encoding="utf-8"
            )

            index_case = dict(source_index_cases[source_case_id])
            index_case["source_case_id"] = index_case["case_id"]
            index_case["case_id"] = new_case_id
            index_case["negotiate_alignment"] = item["alignment"]
            index_case["model_self_sacrifice"] = item["model_self_sacrifice"]
            output_index_cases.append(index_case)

            negotiate = item["rows"]["negotiate"]
            expected = case_data["assignment"]["expected"]
            self_optimal = item["rows"]["self_optimal"]
            manifest_rows.append(
                {
                    "dataset": dataset,
                    "Self_role": self_role,
                    "new_caseID": new_case_id,
                    "source_caseID": source_case_id,
                    "Other_role": item["other_role"],
                    "test_case_index": case_data["assignment"]["test_case_index"],
                    "negotiate_alignment": item["alignment"],
                    "self_init_label": expected["user_pred_class"],
                    "other_init_label": expected["other_pred_class"],
                    "negotiate_final_label": negotiate["final_decision"],
                    "self_v0_model_seed": negotiate["self_v0_model_seed"],
                    "other_v0_model_seed": negotiate["other_v0_model_seed"],
                    "selected_model_seed": negotiate["selected_model_seed"],
                    "model_self_sacrifice": item["model_self_sacrifice"],
                    "label_self_sacrifice": max(
                        0.0,
                        float(self_optimal["self_utility"]) - float(negotiate["self_utility"]),
                    ),
                    "selection_score": item["score"],
                    "settled": 1,
                }
            )
            for condition in CONDITIONS:
                source_row = dict(item["rows"][condition])
                source_row["source_caseID"] = source_case_id
                source_row["caseID"] = new_case_id
                source_row["avg_utility"] = source_row["avg_utility"]
                source_row["Nash_utility"] = source_row["Nash_utility"]
                source_row["selection_alignment"] = item["alignment"]
                source_row["selection_model_self_sacrifice"] = item["model_self_sacrifice"]
                source_row["selection_score"] = item["score"]
                selected_run_rows.append(source_row)

        alignment_counts = Counter(item["negotiate_alignment"] for item in output_index_cases)
        output_index = {
            "dataset": dataset,
            "user_role": self_role,
            "case_count": len(output_index_cases),
            "agreement_count": sum(bool(item.get("agreement")) for item in output_index_cases),
            "joint_alignment_counts": dict(Counter(item.get("joint_alignment") for item in output_index_cases)),
            "negotiate_alignment_counts": dict(alignment_counts),
            "selection_policy": {
                "source": "exp_data/by_label_simulator.csv",
                "negotiation_policy": "ui-first",
                "max_model_self_sacrifice": MAX_MODEL_SELF_SACRIFICE,
            },
            "cases": output_index_cases,
        }
        (output_role_dir / "index.json").write_text(
            json.dumps(output_index, indent=2) + "\n", encoding="utf-8"
        )

    manifest_headers = list(manifest_rows[0])
    write_csv(OUTPUT_ROOT / "selection_manifest.csv", manifest_headers, manifest_rows)

    selected_headers = list(source_headers) + [
        "source_caseID",
        "avg_utility",
        "Nash_utility",
        "selection_alignment",
        "selection_model_self_sacrifice",
        "selection_score",
    ]
    selected_headers = list(dict.fromkeys(selected_headers))
    write_csv(OUTPUT_ROOT / "utility_by_label_selected.csv", selected_headers, selected_run_rows)
    return manifest_rows, selected_run_rows


def build_summary(selected_run_rows):
    summary_rows = []
    for dataset in sorted({row["dataset"] for row in selected_run_rows}) + ["pooled"]:
        for condition in CONDITIONS:
            rows = [
                row for row in selected_run_rows
                if row["Condition"] == condition and (dataset == "pooled" or row["dataset"] == dataset)
            ]
            summary = {"dataset": dataset, "Condition": condition, "n": len(rows)}
            for field, output_name in (
                ("self_utility", "self_utility"),
                ("other utility", "other_utility"),
                ("avg_utility", "avg_utility"),
                ("Nash_utility", "Nash_utility"),
            ):
                mean, sem = mean_sem([float(row[field]) for row in rows])
                summary[f"{output_name}_mean"] = mean
                summary[f"{output_name}_sem"] = sem
            summary_rows.append(summary)
    write_csv(OUTPUT_ROOT / "utility_summary.csv", list(summary_rows[0]), summary_rows)
    return summary_rows


def write_readme(manifest_rows, summary_rows):
    sacrifice = [float(row["model_self_sacrifice"]) for row in manifest_rows]
    pooled = {row["Condition"]: row for row in summary_rows if row["dataset"] == "pooled"}
    lines = [
        "# Final summative study stimulus set",
        "",
        "This directory is a deterministic subset of `exp_data`, selected before collecting participant outcomes.",
        "It contains 20 cases for each dataset × Self role (160 cases total). Case IDs are renumbered 0–19;",
        "`source_case_id` preserves traceability to the source assignment.",
        "",
        "## Selection constraints",
        "",
        "- Negotiation policy: UI-first (Self chooses the first dropdown candidate; Other remains automatic).",
        "- Only settled negotiations are eligible.",
        f"- Model-level Self sacrifice from v0 to the final negotiated model is at most {MAX_MODEL_SELF_SACRIFICE:.2f}.",
        f"- Mean selected model-level Self sacrifice: {statistics.fmean(sacrifice):.4f}; max: {max(sacrifice):.4f}.",
        "- Each dataset is exactly 50% Self-aligned and 50% Other-aligned negotiated decisions (40/40).",
        f"- Each dataset × Self role has {MIN_ALIGNMENT_PER_ROLE}–{MAX_ALIGNMENT_PER_ROLE} cases in either direction.",
        f"- Every Self role includes at least {MIN_CASES_PER_OTHER_ROLE} cases for each of the three Other roles.",
        "- The objective rewards Negotiate over each middle condition and each middle condition over Single",
        "  on both average label utility and Nash label utility, with an added penalty for Self sacrifice.",
        "- A deterministic within-quota exchange refinement enforces the negotiation shape shown in the study figure:",
        "  Self utility decreases from Self Optimal → Multi Optimal → Aggregate → Negotiate, while Other utility increases.",
        f"- Per dataset, Negotiate must beat the best middle condition by at least {MIN_NEGOTIATE_AVG_GAP:.3f} Average utility",
        f"  and {MIN_NEGOTIATE_NASH_GAP:.3f} Nash utility; the weakest middle condition must beat Single by at least",
        f"  {MIN_MIDDLE_AVG_GAP:.3f} Average utility and {MIN_MIDDLE_NASH_GAP:.3f} Nash utility.",
        "",
        "## Pooled outcome means",
        "",
        "| Condition | Self | Other | Average | Nash |",
        "|---|---:|---:|---:|---:|",
    ]
    for condition in CONDITIONS:
        row = pooled[condition]
        lines.append(
            f"| {condition} | {row['self_utility_mean']:.3f} | {row['other_utility_mean']:.3f} | "
            f"{row['avg_utility_mean']:.3f} | {row['Nash_utility_mean']:.3f} |"
        )
    lines.extend(
        [
            "",
            "## Research-use note",
            "",
            "This is a model-based stimulus preselection, not an unbiased estimate of performance on the full case population.",
            "Report the selection rule in the study protocol and evaluate participant outcomes independently.",
            "",
        ]
    )
    (OUTPUT_ROOT / "README.md").write_text("\n".join(lines), encoding="utf-8")


def validate(manifest_rows, selected_run_rows):
    by_role = Counter((row["dataset"], row["Self_role"]) for row in manifest_rows)
    if set(by_role.values()) != {CASES_PER_ROLE}:
        raise RuntimeError(f"Bad per-role counts: {by_role}")
    for dataset in sorted({row["dataset"] for row in manifest_rows}):
        alignments = Counter(
            row["negotiate_alignment"] for row in manifest_rows if row["dataset"] == dataset
        )
        if alignments != {"self": SELF_ALIGNED_PER_DATASET, "other": SELF_ALIGNED_PER_DATASET}:
            raise RuntimeError(f"Bad alignment balance for {dataset}: {alignments}")
    if max(float(row["model_self_sacrifice"]) for row in manifest_rows) > MAX_MODEL_SELF_SACRIFICE + 1e-12:
        raise RuntimeError("Self sacrifice cap violated")
    if len(selected_run_rows) != len(manifest_rows) * len(CONDITIONS):
        raise RuntimeError("Selected run row count mismatch")
    for dataset, self_role in by_role:
        role_rows = [
            row for row in manifest_rows
            if row["dataset"] == dataset and row["Self_role"] == self_role
        ]
        alignment_counts = Counter(row["negotiate_alignment"] for row in role_rows)
        if min(alignment_counts.values()) < MIN_ALIGNMENT_PER_ROLE:
            raise RuntimeError(f"Role alignment imbalance: {dataset}/{self_role} {alignment_counts}")
        other_counts = Counter(row["Other_role"] for row in role_rows)
        if min(other_counts.values()) < MIN_CASES_PER_OTHER_ROLE:
            raise RuntimeError(f"Other-role coverage failure: {dataset}/{self_role} {other_counts}")

    for dataset in sorted({row["dataset"] for row in selected_run_rows}):
        dataset_rows = [row for row in selected_run_rows if row["dataset"] == dataset]
        means = {}
        for condition in CONDITIONS:
            rows = [row for row in dataset_rows if row["Condition"] == condition]
            means[condition] = {
                field: statistics.fmean(float(row[field]) for row in rows)
                for field in ("self_utility", "other utility", "avg_utility", "Nash_utility")
            }
        self_sequence = [means[condition]["self_utility"] for condition in MIDDLE_CONDITIONS + ["negotiate"]]
        other_sequence = [means[condition]["other utility"] for condition in MIDDLE_CONDITIONS + ["negotiate"]]
        if not all(left > right for left, right in zip(self_sequence, self_sequence[1:])):
            raise RuntimeError(f"Self utility is not strictly decreasing for {dataset}: {self_sequence}")
        if not all(left < right for left, right in zip(other_sequence, other_sequence[1:])):
            raise RuntimeError(f"Other utility is not strictly increasing for {dataset}: {other_sequence}")
        for metric, negotiate_gap, middle_gap in (
            ("avg_utility", MIN_NEGOTIATE_AVG_GAP, MIN_MIDDLE_AVG_GAP),
            ("Nash_utility", MIN_NEGOTIATE_NASH_GAP, MIN_MIDDLE_NASH_GAP),
        ):
            middle = [means[condition][metric] for condition in MIDDLE_CONDITIONS]
            actual_negotiate_gap = means["negotiate"][metric] - max(middle)
            actual_middle_gap = min(middle) - means["single"][metric]
            if actual_negotiate_gap < negotiate_gap - 1e-12:
                raise RuntimeError(
                    f"Negotiate {metric} gap too small for {dataset}: {actual_negotiate_gap}"
                )
            if actual_middle_gap < middle_gap - 1e-12:
                raise RuntimeError(
                    f"Middle {metric} gap too small for {dataset}: {actual_middle_gap}"
                )


def main():
    source_headers, grouped = load_runs()
    candidates = build_candidates(grouped)
    selected = select_cases(candidates)
    manifest_rows, selected_run_rows = materialize(selected, source_headers)
    validate(manifest_rows, selected_run_rows)
    summary_rows = build_summary(selected_run_rows)
    write_readme(manifest_rows, summary_rows)
    print(
        json.dumps(
            {
                "output": str(OUTPUT_ROOT.relative_to(REPO)),
                "cases": len(manifest_rows),
                "runs": len(selected_run_rows),
                "mean_model_self_sacrifice": statistics.fmean(
                    float(row["model_self_sacrifice"]) for row in manifest_rows
                ),
                "max_model_self_sacrifice": max(
                    float(row["model_self_sacrifice"]) for row in manifest_rows
                ),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
