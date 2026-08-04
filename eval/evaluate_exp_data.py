#!/usr/bin/env python3
"""Evaluate the fixed exp_data assignment.

Outputs under eval/results/exp_data_eval/:
  cases.csv      one row per dataset x user_role x assigned case
  summary.json   aggregate checks and means by dataset/user_role
  summary.md     compact human-readable report
  exp_data_eval.png  role-pair x condition plot
  exp_data_case_diagnostics.png  assignment diagnostics plot
"""

from __future__ import annotations

import csv
import importlib.util
import json
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO = Path(__file__).resolve().parent.parent
EXP = REPO / "exp_data"
OUT = REPO / "eval" / "results" / "exp_data_eval"
BUILD_SCRIPT = REPO / "scripts" / "build_exp_data.py"

spec = importlib.util.spec_from_file_location("build_exp_data", BUILD_SCRIPT)
build = importlib.util.module_from_spec(spec)
spec.loader.exec_module(build)

DATASETS = [p.name for p in sorted(EXP.iterdir()) if p.is_dir()]
ROLES = build.ROLES
CRITERIA = build.CRITERIA

ROLE_LABELS = {
    "judges": "Judges",
    "defendants": "Defendants",
    "community_members": "Community",
    "fairness_advocates": "Fairness",
}

SURFACE = "#fcfcfb"
TEXT = "#111111"
TEXT_MUTED = "#55524d"
GRID = "#e5e3de"
C_SELF = "#2a78d6"
C_OTHER = "#eb6834"
C_JOINT = "#4a3aa7"
C_CAND = "#1baf7a"
CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"]
CONDITION_LABELS = {
    "single": "Ignore",
    "singleoptimal": "Self\nOptimal",
    "multioptimal": "Multi\nOptimal",
    "aggregate": "Aggregate",
    "negotiatev2": "Negotiate",
}


def pct(v: float) -> str:
    return f"{v * 100:.1f}%"


def utility_band(frontier, weights):
    vals = [build.utility(m, weights) for m in frontier]
    return min(vals), max(vals), max(vals) - min(vals)


def norm_share(value, low, high):
    span = high - low
    if span <= 1e-12:
        return 1.0
    return (value - low) / span


def model_by_seed(frontier, seed):
    return next(m for m in frontier if int(m["seed"]) == int(seed))


def candidate_count(frontier, self_model, self_w, other_w):
    base_self = build.utility(self_model, self_w)
    base_other = build.utility(self_model, other_w)
    base_joint = base_self + base_other
    count = 0
    best = None
    for model in frontier:
        if int(model["seed"]) == int(self_model["seed"]):
            continue
        self_u = build.utility(model, self_w)
        other_u = build.utility(model, other_w)
        joint_u = self_u + other_u
        other_gain = other_u - base_other
        joint_gain = joint_u - base_joint
        if other_gain > 0.001 and joint_gain > 0.001:
            count += 1
            item = (self_u, joint_u, other_u, int(model["seed"]))
            if best is None or item > best:
                best = item
    return count, best


def read_rows():
    rows = []
    failures = []
    for dataset in DATASETS:
        for user_role in ROLES:
            role_dir = EXP / dataset / user_role
            index_path = role_dir / "index.json"
            if not index_path.exists():
                continue
            index = json.loads(index_path.read_text())
            for entry in index["cases"]:
                payload = json.loads((role_dir / f"{entry['case_id']}.json").read_text())
                assignment = payload["assignment"]
                expected = assignment["expected"]
                other_role = assignment["other_role"]
                frontier = build.pareto_frontier(payload["models"])
                self_w, self_rank = build.PERSONAS[user_role]
                other_w, other_rank = build.PERSONAS[other_role]
                self_model = build.select(frontier, self_w, self_rank[0])
                other_model = build.select(frontier, other_w, other_rank[0])
                joint_model = build.select_joint(frontier, self_w, other_w)

                self_low, self_high, self_band = utility_band(frontier, self_w)
                other_low, other_high, other_band = utility_band(frontier, other_w)

                self_at_self = build.utility(self_model, self_w)
                self_at_other = build.utility(other_model, self_w)
                self_at_joint = build.utility(joint_model, self_w)
                other_at_self = build.utility(self_model, other_w)
                other_at_other = build.utility(other_model, other_w)
                other_at_joint = build.utility(joint_model, other_w)
                joint_at_self = self_at_self + other_at_self
                joint_at_joint = self_at_joint + other_at_joint
                candidates, best_candidate = candidate_count(frontier, self_model, self_w, other_w)

                checks = {
                    "self_seed_match": int(self_model["seed"]) == int(expected["user_model_seed"]),
                    "other_seed_match": int(other_model["seed"]) == int(expected["other_model_seed"]),
                    "joint_seed_match": int(joint_model["seed"]) == int(expected["joint_model_seed"]),
                    "self_other_conflict": int(self_model["pred_class"]) != int(other_model["pred_class"]),
                    "joint_is_third_model": int(joint_model["seed"]) not in {int(self_model["seed"]), int(other_model["seed"])},
                    "joint_improves_over_self": joint_at_joint > joint_at_self + 1e-9,
                    "joint_improves_other_over_self": other_at_joint > other_at_self + 1e-9,
                    "dropdown_has_candidate": candidates > 0,
                }
                if not all(checks.values()):
                    failures.append({
                        "dataset": dataset,
                        "user_role": user_role,
                        "case_id": entry["case_id"],
                        "test_case_index": assignment["test_case_index"],
                        "checks": checks,
                    })

                joint_pred = int(joint_model["pred_class"])
                if joint_pred == int(self_model["pred_class"]):
                    joint_alignment = "self"
                elif joint_pred == int(other_model["pred_class"]):
                    joint_alignment = "other"
                else:
                    joint_alignment = "neither"

                rows.append({
                    "dataset": dataset,
                    "user_role": user_role,
                    "case_id": int(entry["case_id"]),
                    "test_case_index": int(assignment["test_case_index"]),
                    "other_role": other_role,
                    "self_model_seed": int(self_model["seed"]),
                    "other_model_seed": int(other_model["seed"]),
                    "joint_model_seed": int(joint_model["seed"]),
                    "self_pred": int(self_model["pred_class"]),
                    "other_pred": int(other_model["pred_class"]),
                    "joint_pred": joint_pred,
                    "joint_alignment": joint_alignment,
                    "self_at_self": self_at_self,
                    "self_at_other": self_at_other,
                    "self_at_joint": self_at_joint,
                    "other_at_self": other_at_self,
                    "other_at_other": other_at_other,
                    "other_at_joint": other_at_joint,
                    "joint_at_self": joint_at_self,
                    "joint_at_joint": joint_at_joint,
                    "self_loss_to_joint": self_at_self - self_at_joint,
                    "other_gain_from_self_to_joint": other_at_joint - other_at_self,
                    "joint_gain_from_self_to_joint": joint_at_joint - joint_at_self,
                    "self_band": self_band,
                    "other_band": other_band,
                    "self_share_at_joint": norm_share(self_at_joint, self_low, self_high),
                    "other_share_at_joint": norm_share(other_at_joint, other_low, other_high),
                    "dropdown_candidate_count": candidates,
                    "best_dropdown_model_seed": best_candidate[3] if best_candidate else "",
                    "expected_alignment": expected.get("joint_alignment", ""),
                    **{f"check_{k}": int(v) for k, v in checks.items()},
                })
    return rows, failures


def summarize(rows, failures):
    groups = defaultdict(list)
    for row in rows:
        groups[(row["dataset"], row["user_role"])].append(row)

    by_group = {}
    for (dataset, role), items in sorted(groups.items()):
        align = Counter(r["joint_alignment"] for r in items)
        opp = Counter(r["other_role"] for r in items)
        by_group[f"{dataset}/{role}"] = {
            "n": len(items),
            "self_other_conflicts": sum(r["check_self_other_conflict"] for r in items),
            "joint_third_model": sum(r["check_joint_is_third_model"] for r in items),
            "joint_improves_over_self": sum(r["check_joint_improves_over_self"] for r in items),
            "joint_improves_other_over_self": sum(r["check_joint_improves_other_over_self"] for r in items),
            "dropdown_has_candidate": sum(r["check_dropdown_has_candidate"] for r in items),
            "joint_alignment": dict(align),
            "opponents": dict(opp),
            "mean_self_loss_to_joint": sum(r["self_loss_to_joint"] for r in items) / len(items),
            "mean_other_gain_from_self_to_joint": sum(r["other_gain_from_self_to_joint"] for r in items) / len(items),
            "mean_joint_gain_from_self_to_joint": sum(r["joint_gain_from_self_to_joint"] for r in items) / len(items),
            "mean_self_share_at_joint": sum(r["self_share_at_joint"] for r in items) / len(items),
            "mean_other_share_at_joint": sum(r["other_share_at_joint"] for r in items) / len(items),
            "mean_dropdown_candidate_count": sum(r["dropdown_candidate_count"] for r in items) / len(items),
        }

    overall = {
        "n": len(rows),
        "datasets": sorted({r["dataset"] for r in rows}),
        "roles": ROLES,
        "failures": failures,
        "failure_count": len(failures),
        "checks": {
            name: sum(r[f"check_{name}"] for r in rows)
            for name in [
                "self_seed_match",
                "other_seed_match",
                "joint_seed_match",
                "self_other_conflict",
                "joint_is_third_model",
                "joint_improves_over_self",
                "joint_improves_other_over_self",
                "dropdown_has_candidate",
            ]
        },
    }
    return {"overall": overall, "by_dataset_role": by_group}


def write_csv(rows):
    OUT.mkdir(parents=True, exist_ok=True)
    fields = list(rows[0].keys()) if rows else []
    with (OUT / "cases.csv").open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def write_markdown(summary):
    lines = [
        "# exp_data_eval",
        "",
        f"Total assigned cases: {summary['overall']['n']}",
        f"Failure count: {summary['overall']['failure_count']}",
        "",
        "## Checks",
        "",
    ]
    n = summary["overall"]["n"]
    for key, value in summary["overall"]["checks"].items():
        lines.append(f"- {key}: {value}/{n}")
    lines += ["", "## Dataset x Role", ""]
    for group, stats in summary["by_dataset_role"].items():
        lines.append(
            f"- {group}: n={stats['n']}, align={stats['joint_alignment']}, opponents={stats['opponents']}, "
            f"self_loss={stats['mean_self_loss_to_joint']:.4f}, "
            f"other_gain={stats['mean_other_gain_from_self_to_joint']:.4f}, "
            f"joint_gain={stats['mean_joint_gain_from_self_to_joint']:.4f}, "
            f"dropdown_candidates={stats['mean_dropdown_candidate_count']:.1f}"
        )
    lines.append("")
    (OUT / "summary.md").write_text("\n".join(lines))


def plot_case_diagnostics(summary):
    groups = list(summary["by_dataset_role"].items())
    labels = [f"{g.split('/')[0]}\n{ROLE_LABELS.get(g.split('/')[1], g.split('/')[1])}" for g, _ in groups]
    self_loss = [stats["mean_self_loss_to_joint"] for _, stats in groups]
    other_gain = [stats["mean_other_gain_from_self_to_joint"] for _, stats in groups]
    joint_gain = [stats["mean_joint_gain_from_self_to_joint"] for _, stats in groups]
    candidates = [stats["mean_dropdown_candidate_count"] for _, stats in groups]

    fig, axes = plt.subplots(2, 1, figsize=(13.5, 8.2), dpi=180, height_ratios=[1.25, 1.0])
    fig.patch.set_facecolor(SURFACE)
    for ax in axes:
        ax.set_facecolor(SURFACE)
        ax.spines[["top", "right", "left"]].set_visible(False)
        ax.spines["bottom"].set_color(GRID)
        ax.tick_params(axis="both", colors=TEXT_MUTED, labelsize=8.5, length=0)
        ax.yaxis.grid(True, color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)

    x = list(range(len(groups)))
    w = 0.24
    axes[0].bar([i - w for i in x], self_loss, width=w, color=C_SELF, label="Self utility sacrificed")
    axes[0].bar(x, other_gain, width=w, color=C_OTHER, label="Other utility gained")
    axes[0].bar([i + w for i in x], joint_gain, width=w, color=C_JOINT, label="Joint utility gained")
    axes[0].axhline(0, color=TEXT_MUTED, linewidth=0.8)
    axes[0].set_xticks(x)
    axes[0].set_xticklabels(labels)
    axes[0].set_title("From Self optimal to joint optimal", loc="left", fontsize=11, color=TEXT, pad=22)
    axes[0].legend(loc="lower left", bbox_to_anchor=(0, 1.01), ncol=3, frameon=False, fontsize=8.5)

    axes[1].bar(x, candidates, width=0.62, color=C_CAND)
    axes[1].set_xticks(x)
    axes[1].set_xticklabels(labels)
    axes[1].set_title("Mean dropdown-eligible models per case", loc="left", fontsize=11, color=TEXT, pad=12)
    for xi, value in zip(x, candidates):
        axes[1].text(xi, value + 0.08, f"{value:.1f}", ha="center", va="bottom", fontsize=8, color=TEXT)

    fig.text(
        0.01, 0.01,
        "Eligible dropdown models: improve Other utility and joint utility relative to Self optimal. "
        "All assigned cases are required to be Self/Other prediction conflicts and to have a third joint-optimal model.",
        fontsize=7.5,
        color=TEXT_MUTED,
    )
    fig.tight_layout(rect=(0, 0.035, 1, 1), h_pad=2.2)
    fig.savefig(OUT / "exp_data_case_diagnostics.png", facecolor=SURFACE, bbox_inches="tight")


def read_condition_runs():
    path = OUT / "runs.csv"
    if not path.exists():
        return []
    with path.open() as f:
        return list(csv.DictReader(f))


def aggregate_condition_runs(runs):
    buckets = defaultdict(list)
    for row in runs:
        buckets[(row["role_pair"], row["condition"])].append(row)
    summary = {}
    for (pair, condition), items in buckets.items():
        n = len(items)
        (summary.setdefault(pair, {}))[condition] = {
            "n": n,
            "self_n": sum(float(r["self_n"] or 0) for r in items) / n,
            "other_n": sum(float(r["other_n"] or 0) for r in items) / n,
            "joint_n": sum(float(r["joint_n"] or 0) for r in items) / n,
            "consensus": sum(float(r["consensus"] or 0) for r in items) / n,
            "settled": sum(float(r["settled"] or 0) for r in items) / n,
        }
    return dict(sorted(summary.items()))


def pair_label(pair):
    self_key, other_key = pair.split("->")
    return f"{ROLE_LABELS.get(self_key, self_key)} -> {ROLE_LABELS.get(other_key, other_key)}"


def write_condition_summary(pair_summary):
    lines = ["# exp_data_eval: role pair x condition", ""]
    for pair, by_condition in pair_summary.items():
        lines.append(f"## {pair_label(pair)}")
        lines.append("")
        lines.append("| condition | n | self utility | other utility | joint utility | consensus | settled |")
        lines.append("|---|---:|---:|---:|---:|---:|---:|")
        for condition in CONDITIONS:
            stats = by_condition.get(condition)
            if not stats:
                continue
            lines.append(
                f"| {CONDITION_LABELS[condition].replace(chr(10), ' ')} | {stats['n']} | "
                f"{pct(stats['self_n'])} | {pct(stats['other_n'])} | {pct(stats['joint_n'])} | "
                f"{pct(stats['consensus'])} | {pct(stats['settled'])} |"
            )
        lines.append("")
    (OUT / "condition_summary.md").write_text("\n".join(lines))


def plot_pair_conditions(pair_summary):
    pairs = list(pair_summary)
    if not pairs:
        return
    fig, axes = plt.subplots(4, 3, figsize=(18, 18.5), dpi=170, sharey=True)
    fig.patch.set_facecolor(SURFACE)
    axes = axes.flatten()
    x = list(range(len(CONDITIONS)))
    w = 0.22
    for ax, pair in zip(axes, pairs):
        ax.set_facecolor(SURFACE)
        ax.spines[["top", "right", "left"]].set_visible(False)
        ax.spines["bottom"].set_color(GRID)
        ax.tick_params(axis="both", colors=TEXT_MUTED, labelsize=8, length=0)
        ax.yaxis.grid(True, color=GRID, linewidth=0.75)
        ax.set_axisbelow(True)
        by_condition = pair_summary[pair]
        self_vals = [by_condition[c]["self_n"] for c in CONDITIONS]
        other_vals = [by_condition[c]["other_n"] for c in CONDITIONS]
        joint_vals = [by_condition[c]["joint_n"] for c in CONDITIONS]
        consensus = [by_condition[c]["consensus"] for c in CONDITIONS]
        ax.bar([i - w for i in x], self_vals, width=w, color=C_SELF, label="Self utility")
        ax.bar(x, other_vals, width=w, color=C_OTHER, label="Other utility")
        ax.bar([i + w for i in x], joint_vals, width=w, color=C_JOINT, label="Joint utility")
        ax.plot(x, consensus, color=C_CAND, marker="o", linewidth=1.8, markersize=3.8, label="Consensus")
        for xi, v in zip(x, consensus):
            if v > 0.001:
                ax.text(xi, min(1.03, v + 0.035), f"{v * 100:.0f}%", ha="center", va="bottom", fontsize=7, color=TEXT)
        ax.set_ylim(0, 1.08)
        ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
        ax.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
        ax.set_xticks(x)
        ax.set_xticklabels([CONDITION_LABELS[c] for c in CONDITIONS], fontsize=7.5)
        ax.set_title(pair_label(pair), loc="left", fontsize=10.5, color=TEXT, pad=8)
    for ax in axes[len(pairs):]:
        ax.axis("off")
    handles, labels = axes[0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.015, 0.995), ncol=4, frameon=False, fontsize=9)
    fig.suptitle("exp_data conflicting runs — role pair x condition", x=0.015, y=0.975, ha="left", fontsize=14, color=TEXT)
    fig.text(
        0.015, 0.012,
        "Bars show mean utility captured as share of each case/side achievable band. Green line shows whether final stances satisfy both sides' own calls. "
        "Each facet is one directed Self -> Other role pair from assigned exp_data cases.",
        fontsize=8,
        color=TEXT_MUTED,
    )
    fig.tight_layout(rect=(0, 0.035, 1, 0.955), h_pad=2.6, w_pad=1.4)
    fig.savefig(OUT / "exp_data_eval.png", facecolor=SURFACE, bbox_inches="tight")


def main():
    rows, failures = read_rows()
    summary = summarize(rows, failures)
    write_csv(rows)
    (OUT / "summary.json").write_text(json.dumps(summary, indent=2))
    write_markdown(summary)
    plot_case_diagnostics(summary)
    condition_runs = read_condition_runs()
    if condition_runs:
        pair_summary = aggregate_condition_runs(condition_runs)
        (OUT / "condition_pair_summary.json").write_text(json.dumps(pair_summary, indent=2))
        write_condition_summary(pair_summary)
        plot_pair_conditions(pair_summary)
    print(f"wrote {OUT}")
    print(f"cases: {summary['overall']['n']}")
    print(f"failures: {summary['overall']['failure_count']}")
    for key, value in summary["overall"]["checks"].items():
        print(f"{key}: {value}/{summary['overall']['n']}")


if __name__ == "__main__":
    main()
