#!/usr/bin/env python3
"""plot_results.py — figure for the headless modeling eval.

Two rows, because the full sample dilutes the effect: in 81.6% of
case x persona-pair runs the two sides' optimal models already predict the
same class, and no mechanism can improve on agreement that is already there.

  Row 1  all runs
  Row 2  conflicting runs only — the two sides' own optima disagree, which is
         where reconciliation is the thing under test

  Left   grouped bars: mean Self / Other / Joint utility of the deployed model
  Right  consensus rate (both sides end standing behind the same prediction)

Palette (validated: CVD dE 24.7, normal dE 33.6, all >= 3:1 on #fcfcfb):
  Self #2a78d6   Other #eb6834   Joint #4a3aa7   Consensus #1baf7a
"""

import csv
import json
import sys
from collections import Counter, defaultdict
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

REPO = Path(__file__).resolve().parent.parent
RESULTS = REPO / "eval" / "results"
OUT = RESULTS / "modeling_eval.png"

CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"]
COND_LABELS = ["Ignore", "Self-\nOptimal", "Multi-\nOptimal", "Aggregate", "Negotiate"]
METRICS = (
    "self_u", "other_u", "joint_mean", "joint_min",
    "self_n", "other_n", "joint_n", "band_self",
    "consensus", "settled",
)

SURFACE = "#fcfcfb"
TEXT_PRIMARY = "#0b0b0b"
TEXT_SECONDARY = "#52514e"
GRID = "#e6e5e2"
C_SELF, C_OTHER, C_JOINT, C_CONSENSUS = "#2a78d6", "#eb6834", "#4a3aa7", "#1baf7a"


def aggregate(rows):
    totals = defaultdict(lambda: defaultdict(float))
    n = Counter()
    for r in rows:
        c = r["condition"]
        n[c] += 1
        for k in METRICS:
            totals[c][k] += float(r[k] or 0)
    return {c: {k: totals[c][k] / n[c] for k in METRICS} | {"n": n[c]} for c in CONDITIONS}


def draw_row(ax_u, ax_c, agg, row_title, note, show_legend):
    for ax in (ax_u, ax_c):
        ax.set_facecolor(SURFACE)
        for side in ("top", "right", "left"):
            ax.spines[side].set_visible(False)
        ax.spines["bottom"].set_color(GRID)
        ax.tick_params(colors=TEXT_SECONDARY, labelsize=9, length=0)
        ax.yaxis.grid(True, color=GRID, linewidth=0.8)
        ax.set_axisbelow(True)

    x = list(range(len(CONDITIONS)))
    w = 0.26
    for i, (label, color, key) in enumerate(
        [("Self utility", C_SELF, "self_n"), ("Other utility", C_OTHER, "other_n"), ("Joint utility", C_JOINT, "joint_n")]
    ):
        ax_u.bar(
            [xi + (i - 1) * (w + 0.02) for xi in x],
            [agg[c][key] for c in CONDITIONS],
            width=w,
            color=color,
            label=label,
            edgecolor=SURFACE,
            linewidth=1.0,
            zorder=3,
        )
    ax_u.set_xticks(x)
    ax_u.set_xticklabels(COND_LABELS, color=TEXT_PRIMARY, fontsize=9.5)
    ax_u.set_ylim(0, 1.0)
    ax_u.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
    ax_u.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax_u.set_title(
        f"{row_title} — utility captured, as a share of what the case could deliver",
        color=TEXT_PRIMARY, fontsize=10.5, loc="left", pad=26 if show_legend else 10,
    )
    if show_legend:
        ax_u.legend(
            loc="lower left", bbox_to_anchor=(0, 1.005), ncol=3, frameon=False,
            fontsize=8.5, labelcolor=TEXT_SECONDARY, handlelength=1.1,
            handleheight=1.1, borderaxespad=0, columnspacing=1.2,
        )

    consensus = [agg[c]["consensus"] for c in CONDITIONS]
    ax_c.bar(x, consensus, width=0.66, color=C_CONSENSUS, edgecolor=SURFACE, linewidth=1.0, zorder=3)
    for xi, v in zip(x, consensus):
        ax_c.text(xi, v + 0.025, f"{v * 100:.0f}%", ha="center", va="bottom", fontsize=9, color=TEXT_PRIMARY)
    settle = agg["negotiatev2"]["settled"]
    if consensus[-1] > 0.3:
        ax_c.text(x[-1], consensus[-1] / 2, f"settled\n{settle * 100:.0f}%", ha="center", va="center", fontsize=7, color=SURFACE, linespacing=1.4)
    ax_c.set_xticks(x)
    ax_c.set_xticklabels(COND_LABELS, color=TEXT_PRIMARY, fontsize=9.5)
    ax_c.set_ylim(0, 1.0)
    ax_c.set_yticks([0, 0.25, 0.5, 0.75, 1.0])
    ax_c.set_yticklabels(["0%", "25%", "50%", "75%", "100%"])
    ax_c.set_title(
        f"{row_title} — both sides behind the same prediction",
        color=TEXT_PRIMARY, fontsize=10.5, loc="left", pad=26 if show_legend else 10,
    )
    ax_c.text(
        0.0, -0.19, note, transform=ax_c.transAxes, fontsize=7.5, color=TEXT_SECONDARY, va="top",
    )


def table(title, agg):
    band = agg["single"]["band_self"]
    lines = [
        f"\n== {title}   (n = {agg[CONDITIONS[0]]['n']:,} per condition; "
        f"mean achievable band {band:.3f} wide)",
        f"{'':<15}{'--- raw utility ---':>25}   {'--- share of band ---':>23}",
        f"{'condition':<15}{'self':>8}{'other':>8}{'joint':>9}   {'self':>7}{'other':>8}{'joint':>8}{'consensus':>12}",
    ]
    for c, label in zip(CONDITIONS, ["Ignore", "Self-Optimal", "Multi-Optimal", "Aggregate", "Negotiate"]):
        s = agg[c]
        lines.append(
            f"{label:<15}{s['self_u']:8.3f}{s['other_u']:8.3f}{s['joint_mean']:9.3f}   "
            f"{s['self_n'] * 100:6.1f}%{s['other_n'] * 100:7.1f}%{s['joint_n'] * 100:7.1f}%{s['consensus'] * 100:11.1f}%"
        )
    return "\n".join(lines)


def main():
    # --dataset X restricts the figure to one dataset. Runs are independent per
    # case, so filtering the pooled CSV is identical to re-running the sweep
    # with --datasets X, without paying for it again.
    only = None
    if "--dataset" in sys.argv:
        only = sys.argv[sys.argv.index("--dataset") + 1]

    rows = list(csv.DictReader((RESULTS / "runs.csv").open()))
    meta = json.loads((RESULTS / "summary.json").read_text())
    if only:
        rows = [r for r in rows if r["dataset"] == only]
        if not rows:
            sys.exit(f"no runs for dataset {only!r}; have: {sorted({r['dataset'] for r in rows})}")
        meta["datasets"] = [only]

    # A run "conflicts" when the two sides' own optimal models predict different
    # classes — a per (dataset, case, self, other) property, condition-independent.
    rid = lambda r: (r["dataset"], r["case"], r["self"], r["other"])
    conflicted = {rid(r) for r in rows if r["condition"] == "singleoptimal" and r["consensus"] == "0"}
    conflict_rows = [r for r in rows if rid(r) in conflicted]

    agg_all = aggregate(rows)
    agg_conflict = aggregate(conflict_rows)
    share = len(conflicted) / (len(rows) / len(CONDITIONS))

    fig, axes = plt.subplots(2, 2, figsize=(12.8, 8.4), dpi=200, width_ratios=[1.35, 1.0])
    fig.patch.set_facecolor(SURFACE)
    draw_row(
        axes[0][0], axes[0][1], agg_all, "All runs",
        f"n = {agg_all['single']['n']:,} per condition · every test case × every ordered persona pair",
        show_legend=True,
    )
    draw_row(
        axes[1][0], axes[1][1], agg_conflict, "Conflicting runs",
        f"n = {agg_conflict['single']['n']:,} per condition ({share * 100:.1f}% of runs) · "
        "the two sides' own optimal models predict different classes",
        show_legend=False,
    )
    fig.text(
        0.008, 0.012,
        f"Datasets: {', '.join(meta['datasets'])} · utility = the app's weighted-criteria utility, normalized per case "
        f"(0% = worst model available, 100% = best for that side; mean band {agg_all['single']['band_self']:.3f} wide) · "
        "no LLM: both negotiators are the production engine's policy",
        fontsize=7.5, color=TEXT_SECONDARY,
    )
    fig.tight_layout(rect=(0, 0.03, 1, 1), h_pad=3.4)
    out = OUT.with_name(f"modeling_eval_{only}.png") if only else OUT
    fig.savefig(out, facecolor=SURFACE, bbox_inches="tight")
    print(f"wrote {out}")

    scope = f" [{only} only]" if only else ""
    print(table(f"ALL RUNS{scope}", agg_all))
    print(table(f"CONFLICTING RUNS ({share * 100:.1f}% of runs){scope}", agg_conflict))
    (RESULTS / f"summary_subgroups{'_' + only if only else ''}.json").write_text(
        json.dumps({"dataset": only or "pooled", "conflict_share": share, "all": agg_all, "conflict": agg_conflict}, indent=2)
    )


if __name__ == "__main__":
    sys.exit(main())
