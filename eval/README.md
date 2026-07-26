# Headless modeling evaluation

Runs the five study conditions over every test case with no human and no LLM,
to check that the information each condition provides is *sufficient* — i.e.
that a rational participant using it as designed would land where the design
predicts.

```
node eval/run_modeling_eval.mjs            # full sweep, ~all cases × 12 pairs × 5 conditions
python3 eval/plot_results.py               # figure + table from eval/results/
python3 eval/plot_results.py --dataset compas   # same, restricted to one dataset
```

`--dataset` filters the pooled `runs.csv` rather than re-running: runs are
independent per case, so it is identical to sweeping that dataset alone.

Flags: `--datasets compas,loan` · `--limit N` (cases per dataset) ·
`--epsilon 0.02` (multioptimal adoption tolerance) · `--opener self|other`
(who opens the negotiation) · `--out DIR`.

## What is real and what is modeled

**Real (production code, evaluated in a sandbox):** `config-state.js`
(persona weights, criteria, thresholds), `utils-salience.js`,
`summary-guards.js` (criterion extraction, Pareto filter, weighted utility with
per-case active-criteria renormalization), `profiles-stakes.js`, and the whole
nv2 engine sliced from `negotiation-ui.js` (reservation schedule, offer search,
reciprocity, acceptance rule). If the app's math changes, the eval changes with
it — nothing is reimplemented.

**Modeled (the assumptions):**

1. **Roles** — every ordered pair of the four personas, which is the
   expectation over "draw 2 roles at random". Self is the decision-maker.
2. **Weights** — persona ideal weights, normalized; the elicitation stage is
   assumed to recover them exactly.
3. **Simulated Self in `negotiatev2`** — plays the engine's own negotiator
   (`nv2AutoMove` / `nv2AcceptanceDecision`), i.e. reciprocal concessions under
   the Boulware reservation schedule, symmetric with the automated Other-party.
   After the rounds run out, the standing final offer is judged once more with
   the same acceptance rule (the app's "Accept their final model" affordance).
   On impasse Self deploys its own final position.
4. **`multioptimal` decision rule** — seeing both optima, a side adopts the
   other side's optimum iff that costs it at most ε = 0.02 of its own utility;
   Self's adopted model is deployed.
5. **`aggregate`** — the app's `aggregateRecommendation`: importance (0.5) ×
   reliability weights over the two optima; utilities are computed on the
   criteria-blended package (utility is linear, so this equals the blended
   utilities); the prediction is the blended P(high) ≥ 0.5.
6. **`single`** — the app's pinned model (`SINGLE_MODEL_SEED_BY_DATASET`).

## Metrics

### What utility is (and is not)

`modelWeightedUtility(deployed, side weights)` — the weighted sum of the
*deployed model's* five criteria values, under one side's elicited weights:

```
U(model, side) = Σ_k  effectiveWeight_k(side) × criterionValue_k(model)
```

So utility answers **"how good is the model we ended up standing behind, judged
by my own priorities"**. It is *not* about the predicted label: `pred_class`
never enters it. Whether the final decision lines up between the two sides is
the separate **consensus** metric. The two axes are deliberately different — a
condition can deliver a model both sides rate highly and still leave them
predicting opposite classes, or vice versa.

### Raw vs. normalized

Raw utility is not comparable across cases and badly understates the differences
between conditions. Each case has its own achievable band — over compas the gap
between the best and worst available model, for a given persona, averages only
**0.195** (median 0.183) and sits high (≈0.6–0.8), because a five-criterion
weighted sum averages out per-criterion differences that are individually large
(local TPR spreads 0.73 across the frontier, TNR 0.65, but accuracy only 0.14
and individual fairness a median of 0.00).

The consequence: a 0.10 raw gap between two conditions looks tiny on a 0–1 axis
while actually being *half of everything that was on offer*. So every run also
records the **share of the achievable band captured**:

```
share = (U(deployed) − U_worst) / (U_best − U_worst)
```

where best/worst range over all models in that case for that side. 0% = the
worst model available, 100% = that side's best. This is the figure's default
view; raw means stay in the tables and `summary.json`.

- **self / other utility** — raw (`self_u`, `other_u`) and normalized
  (`self_n`, `other_n`).
- **joint** — mean of the two (min and Nash product are in the CSV).
- **consensus** — whether the two sides *end the process standing behind the
  same prediction*. Ignore, Self-Optimal and Aggregate never move either
  side's position, so they share the latent agreement rate of the two optima
  by construction; Multi-Optimal moves positions via cheap adoption;
  Negotiate via the protocol (a settlement is consensus by definition).
- **settled** — negotiate only: protocol ended in an explicit agreement.

Outputs: `results/runs.csv` (one row per dataset × case × pair × condition),
`results/summary.json`, `results/summary_subgroups.json`, `results/modeling_eval.png`.

## Results — compas (1,235 cases, 14,820 runs per condition)

`modeling_eval_compas.png`. Share of the achievable band captured, with raw
utility in parentheses. All runs (mean band 0.241 wide):

| condition | self | other | joint | consensus |
|---|---|---|---|---|
| Ignore | 57.1% (0.698) | 57.1% (0.698) | 57.1% | 69.5% |
| Self-Optimal | **100.0%** (0.798) | 73.9% (0.736) | 87.0% | 69.5% |
| Multi-Optimal | 98.5% (0.796) | 76.8% (0.742) | 87.7% | 74.5% |
| Aggregate | 87.0% (0.767) | 87.0% (0.767) | 87.0% | 69.5% |
| Negotiate | 90.9% (0.775) | **90.0%** (0.773) | **90.4%** | **92.5%** |

Conflicting runs only — 4,514 per condition (30.5%), the two sides' own optima
predict different classes. This is where reconciliation is the thing under test:

| condition | self | other | joint | consensus |
|---|---|---|---|---|
| Ignore | 56.2% (0.694) | 56.2% (0.694) | 56.2% | 0% |
| Self-Optimal | **100.0%** (0.792) | 57.4% (0.691) | 78.7% | 0% |
| Multi-Optimal | 99.1% (0.791) | 59.9% (0.695) | 79.5% | 16.2% |
| Aggregate | 78.7% (0.741) | 78.7% (0.741) | 78.7% | 0% |
| Negotiate | 84.9% (0.753) | **83.0%** (0.750) | **84.0%** | **75.8%** |

### Why compas, and not compas + loan

loan is near-degenerate for this question: its models disagree on only **1.0%**
of runs (22 cases), versus 30.5% for compas, and every condition lands within
0.002 of every other. Pooling the two therefore dilutes the whole effect toward
loan's null — pooled conflict share drops to 18.4% and pooled Negotiate consensus
looks inflated (95.6%) because 99% of loan runs agree before anything happens.
The pooled tables are in `summary_subgroups.json`; compas is the dataset where
multiplicity actually bites.

Reading (conflicting runs, the diagnostic subset):

- **Self-Optimal is the self-interested ceiling and the other-party floor.** It
  takes 100% of Self's achievable range and leaves Other at 57.4% — barely above
  the 56.2% an *arbitrary* model delivers. Optimizing hard for one role buys the
  other party almost nothing over ignoring preferences altogether.
- **Aggregate buys symmetry by capping both sides** (78.7% / 78.7%): equal, but
  below what Negotiate gives each of them.
- **Negotiate is the only condition that raises joint utility and consensus at
  once** (84.0% joint, 75.8% consensus). Self gives up 15 points of its range to
  move Other up 26 — the trade is positive-sum, which is the integrative claim
  the interface is built on.
- **Only the interactive conditions move positions at all.** Ignore /
  Self-Optimal / Aggregate leave both sides' stances untouched, so their
  consensus is by construction the latent agreement rate.
- Negotiation dynamics are non-degenerate: 61% / 27% / 12% of runs end in 1 / 2
  / 3 rounds, and on conflicting runs outcomes split 38% other-accepts, 37%
  self-accepts, 25% impasse.
