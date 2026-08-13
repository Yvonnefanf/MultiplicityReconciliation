#!/usr/bin/env python3
"""plot_results.py — figures for the headless conflict-only modelling eval.

The modelling CSV is restricted to runs where Self's optimal model and Other's
optimal model recommend different labels. The figure shows all five conditions
and all core evaluation metrics with 95% CI error bars.
"""

import csv
import json
import math
import sys
from collections import defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO = Path(__file__).resolve().parent.parent
RESULTS = REPO / "eval" / "results"

CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"]
COND_LABELS = ["Ignore", "Self\nOptimal", "Multi\nOptimal", "Aggregate", "Negotiate"]
COND_COLORS = ["#69707a", "#2a78d6", "#7b61b8", "#e18b2d", "#1baf7a"]

BASE_METRICS = [
    ("self_utility", "Self Utility", "normalized utility of final selected model for Self", "higher"),
    ("other_utility", "Other Utility", "normalized utility of final selected model for Other", "higher"),
    ("total_utility_0_100", "Total Utility", "mean of normalized Self and Other utility", "higher"),
    ("worst_stakeholder_utility_0_100", "Worst-Stakeholder Utility", "lower of normalized Self/Other utility", "higher"),
    ("utility_variance_0_100", "Stakeholder Utility Variance", "variance of normalized Self/Other utility", "lower"),
    ("consensus", "Consensus Rate", "same final prediction/stance", "higher"),
]

BY_LABEL_METRICS = [
    ("self_utility_by_label", "Self Utility By Label", "normalized utility of final decision label for Self", "higher"),
    ("other_utility_by_label", "Other Utility By Label", "normalized utility of final decision label for Other", "higher"),
    ("total_utility_0_100_by_label", "Total Utility By Label", "mean of normalized Self and Other label utility", "higher"),
    ("worst_stakeholder_utility_0_100_by_label", "Worst-Stakeholder Utility By Label", "lower of normalized Self/Other label utility", "higher"),
    ("utility_variance_0_100_by_label", "Stakeholder Utility Variance By Label", "variance of normalized Self/Other label utility", "lower"),
    ("consensus", "Consensus Rate", "same final prediction/stance", "higher"),
]

METRICS = BASE_METRICS

SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e5e2"


def parse_args():
    only = None
    out_name = None
    by_label = "--by-label" in sys.argv or "--by_label" in sys.argv
    if "--dataset" in sys.argv:
        only = sys.argv[sys.argv.index("--dataset") + 1]
    if "--out" in sys.argv:
        out_name = sys.argv[sys.argv.index("--out") + 1]
    return only, out_name, by_label


def mean_ci(values):
    vals = [float(v) for v in values]
    n = len(vals)
    if n == 0:
        return {"mean": 0.0, "ci95": 0.0, "sd": 0.0, "n": 0}
    mean = sum(vals) / n
    if n == 1:
        return {"mean": mean, "ci95": 0.0, "sd": 0.0, "n": 1}
    var = sum((v - mean) ** 2 for v in vals) / (n - 1)
    sd = math.sqrt(var)
    return {"mean": mean, "ci95": 1.96 * sd / math.sqrt(n), "sd": sd, "n": n}


def aggregate(rows):
    grouped = defaultdict(list)
    for r in rows:
        for key, *_ in METRICS:
            grouped[(r["condition"], key)].append(r[key])
    return {c: {key: mean_ci(grouped[(c, key)]) for key, *_ in METRICS} for c in CONDITIONS}


def style_axis(ax):
    ax.set_facecolor(SURFACE)
    for side in ("top", "right", "left"):
        ax.spines[side].set_visible(False)
    ax.spines["bottom"].set_color(GRID)
    ax.tick_params(colors=TEXT_SECONDARY, labelsize=8.5, length=0)
    ax.yaxis.grid(True, color=GRID, linewidth=0.8)
    ax.set_axisbelow(True)


def draw_metric(ax, stats, metric):
    key, title, subtitle, direction = metric
    style_axis(ax)
    x = list(range(len(CONDITIONS)))
    means = [stats[c][key]["mean"] for c in CONDITIONS]
    cis = [stats[c][key]["ci95"] for c in CONDITIONS]
    ax.bar(
        x,
        means,
        yerr=cis,
        capsize=3.2,
        width=0.68,
        color=COND_COLORS,
        edgecolor=SURFACE,
        linewidth=1.0,
        error_kw={"elinewidth": 1.0, "ecolor": TEXT_PRIMARY, "capthick": 1.0},
        zorder=3,
    )
    ax.set_xticks(x)
    ax.set_xticklabels(COND_LABELS, color=TEXT_PRIMARY, fontsize=8.8)
    ax.set_title(title, color=TEXT_PRIMARY, fontsize=10.5, loc="left", pad=17)
    ax.text(0, 1.02, subtitle, transform=ax.transAxes, fontsize=7.5, color=TEXT_SECONDARY, va="bottom")

    top = max((m + ci for m, ci in zip(means, cis)), default=1)
    bottom = min((m - ci for m, ci in zip(means, cis)), default=0)
    if key == "consensus":
        ax.set_ylim(0, 1.0)
        ax.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
        ax.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
        for xi, v in zip(x, means):
            ax.text(xi, min(v + 0.035, 0.98), f"{v * 100:.1f}%", ha="center", va="bottom", fontsize=7.2, color=TEXT_PRIMARY)
    else:
        pad = (top - bottom) * 0.18 if top > bottom else 0.05
        ax.set_ylim(max(0, bottom - pad), top + pad)
        for xi, v in zip(x, means):
            is_utility_100 = key.endswith("_0_100") or key.endswith("_0_100_by_label") or key in ("self_utility", "other_utility", "self_utility_by_label", "other_utility_by_label")
            label = f"{v:.1f}" if is_utility_100 else f"{v:.3f}"
            ax.text(xi, v + pad * 0.14, label, ha="center", va="bottom", fontsize=6.8, color=TEXT_PRIMARY)
    utility_keys = (
        "self_utility", "other_utility", "total_utility_0_100", "worst_stakeholder_utility_0_100",
        "self_utility_by_label", "other_utility_by_label", "total_utility_0_100_by_label", "worst_stakeholder_utility_0_100_by_label",
    )
    if key in utility_keys:
        ax.set_ylabel("0-100 normalized utility", fontsize=8, color=TEXT_SECONDARY)
    if direction == "lower":
        ax.text(0.995, 1.02, "lower is better", transform=ax.transAxes, fontsize=7.2, color=TEXT_SECONDARY, ha="right", va="bottom")


def write_metric_summary(stats, path, dataset_label):
    fields = ["dataset", "condition", "metric", "mean", "ci95", "sd", "n"]
    with path.open("w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(fields)
        for c in CONDITIONS:
            for key, *_ in METRICS:
                s = stats[c][key]
                writer.writerow([dataset_label, c, key, s["mean"], s["ci95"], s["sd"], s["n"]])


def table(stats, dataset_label, by_label=False):
    label_note = " BY FINAL LABEL" if by_label else ""
    lines = [f"\n== CONFLICTING-LABEL MODELLING METRICS{label_note} [{dataset_label}] =="]
    lines.append(f"{'condition':<15}{'self':>9}{'other':>9}{'total':>10}{'worst':>10}{'variance':>12}{'consensus':>12}{'n':>9}")
    labels = ["Ignore", "Self-Optimal", "Multi-Optimal", "Aggregate", "Negotiate"]
    keys = {
        "self": "self_utility_by_label" if by_label else "self_utility",
        "other": "other_utility_by_label" if by_label else "other_utility",
        "total": "total_utility_0_100_by_label" if by_label else "total_utility_0_100",
        "worst": "worst_stakeholder_utility_0_100_by_label" if by_label else "worst_stakeholder_utility_0_100",
        "var": "utility_variance_0_100_by_label" if by_label else "utility_variance_0_100",
    }
    for c, label in zip(CONDITIONS, labels):
        self_s = stats[c][keys["self"]]
        other_s = stats[c][keys["other"]]
        total = stats[c][keys["total"]]
        worst = stats[c][keys["worst"]]
        var = stats[c][keys["var"]]
        consensus = stats[c]["consensus"]
        lines.append(
            f"{label:<15}{self_s['mean']:9.3f}{other_s['mean']:9.3f}{total['mean']:10.3f}{worst['mean']:10.3f}{var['mean']:12.4f}{consensus['mean'] * 100:11.1f}%{total['n']:9,}"
        )
    return "\n".join(lines)


def main():
    global METRICS
    only, out_name, by_label = parse_args()
    METRICS = BY_LABEL_METRICS if by_label else BASE_METRICS
    rows = list(csv.DictReader((RESULTS / "runs.csv").open()))
    if only:
        rows = [r for r in rows if r["dataset"] == only]
        if not rows:
            raise SystemExit(f"no rows for dataset {only!r}")
    dataset_label = only or "pooled_conflicting_labels"
    stats = aggregate(rows)

    fig, axes = plt.subplots(2, 3, figsize=(15.2, 8.2), dpi=220)
    fig.patch.set_facecolor(SURFACE)
    for ax, metric in zip(axes.ravel(), METRICS):
        draw_metric(ax, stats, metric)

    n_per_condition = stats[CONDITIONS[0]][METRICS[0][0]]["n"]
    try:
        meta = json.loads((RESULTS / "summary.json").read_text())
        dataset_note = ", ".join(meta.get("datasets", []))
        setting_note = f"aggregate self share = {meta.get('aggregate_self_share_min', '')}-{meta.get('aggregate_self_share_max', '')}; multi-optimal Self own-model prob = {meta.get('multioptimal_self_own_prob', '')}"
    except Exception:
        dataset_note = dataset_label
        setting_note = ""
    metric_scope = "final decision label" if by_label else "final selected model"
    fig.suptitle(
        f"Modelling evaluation over conflicting self/other recommendations ({metric_scope}): {dataset_label.replace('_', ' ')}",
        x=0.01,
        ha="left",
        fontsize=14,
        color=TEXT_PRIMARY,
        fontweight="bold",
    )
    fig.text(
        0.01,
        0.014,
        f"Datasets: {dataset_note} · n = {n_per_condition:,} runs per condition · utilities normalized to 0-100 per case/persona · error bars are 95% CI · {setting_note}",
        fontsize=8,
        color=TEXT_SECONDARY,
    )
    fig.tight_layout(rect=(0, 0.045, 1, 0.93), h_pad=2.6, w_pad=2.0)

    suffix = "_by_label" if by_label else ""
    out = RESULTS / (out_name or (f"modeling_eval_{only}{suffix}.png" if only else f"modeling_eval{suffix}.png"))
    fig.savefig(out, facecolor=SURFACE, bbox_inches="tight")

    summary_csv = RESULTS / (f"modeling_metrics_summary_{only}{suffix}.csv" if only else f"modeling_metrics_summary{suffix}.csv")
    write_metric_summary(stats, summary_csv, dataset_label)
    print(f"wrote {out}")
    print(f"wrote {summary_csv}")
    print(table(stats, dataset_label, by_label))


if __name__ == "__main__":
    sys.exit(main())
