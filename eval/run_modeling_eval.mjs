#!/usr/bin/env node
/* run_modeling_eval.mjs — headless modeling evaluation of the five study conditions.
 *
 * No humans, no LLM. For every test case and every ordered pair of stakeholder
 * personas, each condition's decision policy picks the model that would be
 * deployed, and we score it three ways:
 *
 *   self utility    modelWeightedUtility(deployed, self weights)
 *   other utility   modelWeightedUtility(deployed, other weights)
 *   joint utility   mean of the two (min and Nash product also recorded)
 *   consensus       do the two sides end the process standing behind the same
 *                   *prediction*? Ignore / Single-optimal / Aggregate never move
 *                   either side's position, so their consensus is the latent
 *                   agreement of the two optima; Multi-optimal moves positions
 *                   by cheap adoption; Negotiation moves them by the protocol.
 *
 * The app's own scripts are evaluated in a sandbox (config-state, utils-salience,
 * summary-guards, profiles-stakes, and the nv2 slice of negotiation-ui), so the
 * utility function, Pareto filter, per-case active-criteria renormalization,
 * persona weights, and the whole negotiation engine are the production code, not
 * a reimplementation. The only synthetic ingredient is the automated Self in the
 * negotiate condition: it plays the same reciprocal policy the engine already
 * uses for the Other-party (nv2AutoMove / nv2AcceptanceDecision), i.e. we model
 * a rational participant who uses the interface as designed.
 *
 * Condition -> deployed model:
 *   single        the app's pinned per-dataset model (SINGLE_MODEL_SEED_BY_DATASET)
 *   singleoptimal Self's optimal model (selectedSingleOptimalModel)
 *   multioptimal  Self sees both optima and adopts the Other-party's iff it costs
 *                 Self at most EPSILON utility; deploys Self's adopted model
 *   aggregate     the app's aggregateRecommendation blend (importance x reliability
 *                 over the two optima); utilities on the criteria-blended package
 *   negotiatev2   the simulated protocol's agreed model; on impasse Self deploys
 *                 its own final position (the app leaves the decision to Self)
 *
 * Usage: node eval/run_modeling_eval.mjs [--datasets compas,acs_coverage] [--limit N]
 *        [--aggregateSelfShare 0.7] [--multioptimalSelfOwnProb 0.8]
 *        [--epsilon 0.02] [--opener self|other] [--out eval/results]
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");

/* ---------------- CLI ---------------- */
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? "true"] : null)).filter(Boolean)
);
const DATASETS = (args.datasets || "compas,acs_coverage").split(",").map((s) => s.trim()).filter(Boolean);
const LIMIT = args.limit ? Number(args.limit) : Infinity;
const EPSILON = args.epsilon ? Number(args.epsilon) : 0.02; // legacy cheap-adoption tolerance
const OPENER = args.opener === "other" ? "other" : "self";
const AGGREGATE_SELF_SHARE_MIN = args.aggregateSelfShareMin ? Number(args.aggregateSelfShareMin) : 0.6;
const AGGREGATE_SELF_SHARE_MAX = args.aggregateSelfShareMax ? Number(args.aggregateSelfShareMax) : 0.8;
const MULTIOPTIMAL_SELF_OWN_PROB = args.multioptimalSelfOwnProb ? Number(args.multioptimalSelfOwnProb) : 0.8;
const OUT_DIR = path.join(repo, args.out || "eval/results");

/* ---------------- sandbox: evaluate the app's own scripts ---------------- */

function sliceBetween(src, startMarker, endMarker, label) {
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) throw new Error(`slice markers not found for ${label}`);
  return src.slice(start, end);
}

function buildSandbox() {
  const uiSrc = read("js/negotiation-ui.js");
  const caseFeaturesSrc = read("js/case-features.js");
  const sources = [
    read("js/config-state.js"),
    read("js/utils-salience.js"),
    read("js/summary-guards.js"),
    read("js/profiles-stakes.js"),
    // the one shared helper that lives in the otherwise DOM-heavy case-features.js
    sliceBetween(caseFeaturesSrc, "function topMetricKeyForWeights", "function exposureMetricHighlightClass", "topMetricKeyForWeights"),
    // the whole nv2 engine: constants, state, search, auto-move, acceptance
    sliceBetween(uiSrc, "const NV2_MAX_VERSION", "function nv2StatusLine", "nv2 engine"),
  ].join("\n\n");

  const prelude = `
    // Browser stubs. Every DOM/storage touch in the included files is inside a
    // render function the eval never calls; these exist so top-level element
    // lookups and the condition bootstrap in config-state.js can run.
    const document = {
      getElementById: () => null,
      querySelector: () => null,
      querySelectorAll: () => [],
      body: { classList: { add() {}, remove() {}, toggle() {} } },
      addEventListener() {},
    };
    const window = { location: { search: "", protocol: "https:" } };
    const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
    const location = window.location;
    const fetch = () => { throw new Error("no network in eval sandbox"); };
    // App functions referenced by the nv2 slice but defined in files the eval
    // does not need (chat/UI layers). Labels only — no math flows through them.
    function personaTitle(p) { return p?.label || p?.role || "Stakeholder"; }
    function escapeHtml(v) { return String(v ?? ""); }
    function addHistory() {}
    function ensureDifferentProxyPersona() {}
    function showProxyThinking() {}
    function removeProxyThinking() {}
    function compactHistoryForProxy() { return []; }
    function proxyIdealWeights() { return { ...weights }; }
  `;

  const epilogue = `
    return {
      criteriaOrder, personaTypes, personaKeys,
      SINGLE_MODEL_SEED_BY_DATASET,
      normalizeWeights,
      paretoOptimalModels,
      modelCriterionValue,
      selectedSingleOptimalModel: (w) => selectedSingleOptimalModel(w),
      utility: (m, w) => modelWeightedUtility(m, w),
      setCase(data) { activeData = data; },
      setPersonas(selfPersona, otherPersona) {
        currentPersona = selfPersona;
        proxyPersona = otherPersona;
        elicitedWeights = normalizeWeights(selfPersona.weights);
        userWeights = { ...elicitedWeights };
        weights = { ...elicitedWeights };
        proxyWeights = normalizeWeights(otherPersona.weights);
      },
      weightsFor(side) { return side === "self" ? userWeights : proxyWeights; },
      resetNV2() { nv2 = null; resetNegotiateV2State(); return nv2; },
      nv2State: () => nv2,
      nv2Utility: (m, side) => nv2Utility(m, side),
      nv2AutoMove: (side, incoming, v, gain) => nv2AutoMove(side, incoming, v, gain),
      nv2Acceptance: (side, offer, v, gain) => nv2AcceptanceDecision(side, offer, v, gain),
      nv2Push: (side, entry) => nv2PushPosition(side, entry),
      nv2Position: (side) => nv2Position(side),
      NV2_MAX_VERSION,
    };
  `;

  return new Function(prelude + "\n" + sources + "\n" + epilogue)();
}

/* ---------------- condition policies ---------------- */

const predOf = (m) => Number(m?.pred_class);

function stableUnitInterval(...parts) {
  const str = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 0x100000000;
}

// single: the pinned model the Ignore condition shows.
function runSingle(S, data, ds) {
  const seed = S.SINGLE_MODEL_SEED_BY_DATASET[ds];
  const model = (data.models || []).find((m) => Number(m.seed) === Number(seed)) || data.models[0];
  return { deployed: model, selfStance: null, otherStance: null };
}

// singleoptimal: Self deploys its own optimal; positions never move.
function runSingleOptimal(S) {
  return { deployed: S.selectedSingleOptimalModel(S.weightsFor("self")), selfStance: null, otherStance: null };
}

// multioptimal: both optima are on screen. In the conflict-only modelling
// sample, Self keeps its own optimal model in 80% of runs and adopts Other's
// model in 20% of runs. The choice is deterministic per dataset/case/persona
// pair so the CSV is reproducible while matching the requested rate.
function runMultiOptimal(S, chooseSelfOwn) {
  const selfBest = S.selectedSingleOptimalModel(S.weightsFor("self"));
  const otherBest = S.selectedSingleOptimalModel(S.weightsFor("other"));
  const selfStance = chooseSelfOwn ? selfBest : otherBest;
  const otherStance = otherBest;
  return { deployed: selfStance, selfStance, otherStance };
}

// aggregate: the app's blend of the two optima. Utilities are computed on the
// criteria-blended package (utility is linear in criteria, so this equals the
// same blend of the two models' utilities); the prediction comes from the
// blended P(high) exactly as aggregateRecommendation() computes it.
function runAggregate(S, selfShare) {
  const selfW = S.weightsFor("self");
  const otherW = S.weightsFor("other");
  const selfModel = S.selectedSingleOptimalModel(selfW);
  const otherModel = S.selectedSingleOptimalModel(otherW);
  const selfWeight = selfShare * Math.max(0, S.utility(selfModel, selfW));
  const otherWeight = (1 - selfShare) * Math.max(0, S.utility(otherModel, otherW));
  const denom = selfWeight + otherWeight;
  const wS = denom > 0 ? selfWeight / denom : 0.5;
  const highProb = wS * Number(selfModel.pred_prob) + (1 - wS) * Number(otherModel.pred_prob);
  const blended = { pred_class: highProb >= 0.5 ? 1 : 0, pred_prob: highProb };
  for (const key of S.criteriaOrder) {
    const a = S.modelCriterionValue(selfModel, key);
    const b = S.modelCriterionValue(otherModel, key);
    const blend = a != null && b != null ? wS * a + (1 - wS) * b : a ?? b;
    // expose under the first key modelCriterionValue resolves for `key`
    blended[{ accuracy: "subgroup_accuracy", tpr: "subgroup_tpr", tnr: "subgroup_tnr" }[key] || key] = blend;
  }
  return { deployed: blended, selfStance: null, otherStance: null, aggregate_self_share: selfShare };
}

// negotiatev2: the protocol, both sides played by the engine's own negotiator.
function runNegotiate(S) {
  const st = S.resetNV2();
  const MAX = S.NV2_MAX_VERSION;
  let mutualHolds = 0;
  let pending = null;        // Other-party's standing offer Self must answer
  let gainToSelf = null;     // what their last move was worth to Self
  let rounds = 0;
  let agreed = null;
  let how = null;

  if (OPENER === "other") {
    // mirrors nv2RequestOtherOpening: they move first, off the Self anchor
    const anchor = S.nv2Position("self").model;
    const prev = S.nv2Position("other").model;
    const move = S.nv2AutoMove("other", anchor, 1, null);
    const model = move.model || prev;
    S.nv2Push("other", { version: 1, model, act: "open_offer" });
    pending = model;
    gainToSelf = S.nv2Utility(model, "self") - S.nv2Utility(prev, "self");
  }

  for (let v = 1; v <= MAX && !agreed; v++) {
    rounds = v;
    const selfPrev = S.nv2Position("self").model;
    const otherPrevBefore = S.nv2Position("other").model;

    // Self's turn: judge the standing offer with the same rule the engine
    // uses, then make the move that rule plans.
    let plan;
    if (pending) {
      const dec = S.nv2Acceptance("self", pending, v, gainToSelf);
      if (dec.accept) { agreed = pending; how = "self_accepts"; break; }
      plan = dec.plan;
    } else {
      plan = S.nv2AutoMove("self", otherPrevBefore, v, gainToSelf);
    }
    const selfOffer = plan.model || selfPrev;
    const selfHeld = Boolean(plan.stonewalled || plan.held);
    S.nv2Push("self", { version: v, model: selfOffer, act: selfHeld ? "hold" : "offer" });

    // Other-party's reply: identical to nv2SendSelfOffer's decision path.
    const delivered = S.nv2Utility(selfOffer, "other") - S.nv2Utility(selfPrev, "other");
    const dec = S.nv2Acceptance("other", selfOffer, v, delivered);
    if (dec.accept) { agreed = selfOffer; how = "other_accepts"; break; }
    const move = dec.plan;
    const otherOffer = move.model || otherPrevBefore;
    S.nv2Push("other", { version: S.nv2State().other.track.length, model: otherOffer, act: move.stonewalled ? "hold" : "counter" });
    pending = otherOffer;
    gainToSelf = S.nv2Utility(otherOffer, "self") - S.nv2Utility(otherPrevBefore, "self");
    mutualHolds = selfHeld && move.stonewalled ? mutualHolds + 1 : 0;
    if (mutualHolds >= 2) break;
  }

  // The app keeps the final offer on the table after the rounds run out;
  // apply the same acceptance rule once more for that final-offer decision.
  if (!agreed && pending) {
    const dec = S.nv2Acceptance("self", pending, MAX, gainToSelf);
    if (dec.accept) { agreed = pending; how = "final_offer_accepted"; }
  }

  const selfFinal = agreed || S.nv2Position("self").model;
  const otherFinal = agreed || S.nv2Position("other").model;
  return {
    deployed: selfFinal, // on impasse the decision is Self's, per the app
    selfStance: selfFinal,
    otherStance: otherFinal,
    settled: Boolean(agreed),
    how: how || "impasse",
    rounds,
  };
}

/* ---------------- metrics ---------------- */

// Raw utility is not comparable across cases: each case has its own achievable
// band, and on this data that band is narrow (mean 0.195 wide) and sits high
// (~0.6-0.8). A 0.10 difference between conditions therefore reads as "small"
// on a 0-1 axis while actually being half of everything that was on offer.
// So we also record what the case *could* have delivered each side, over the
// full model pool — the universe every condition draws from, including the
// pinned Ignore model, which need not be Pareto-optimal.
function achievableBand(S, models, w) {
  let lo = Infinity;
  let hi = -Infinity;
  for (const m of models) {
    const u = S.utility(m, w);
    if (u < lo) lo = u;
    if (u > hi) hi = u;
  }
  return { lo, hi };
}

function decisionGroupForLabel(data, label) {
  const groups = data?.reconciliation?.groups || [];
  return groups.find((g) => Number(g.class_id) === Number(label)) || null;
}

function decisionSummaryForLabel(data, label) {
  const summary = Array.isArray(data?.summary) ? data.summary : [];
  return summary.find((g) => Number(g.class_id) === Number(label)) || null;
}

function decisionFairnessForLabel(data, label) {
  const group = decisionGroupForLabel(data, label);
  const summary = decisionSummaryForLabel(data, label);
  const candidates = [
    group?.criteria?.local_consistency,
    group?.fairness_components?.local_consistency,
    summary?.avg_local_consistency,
    summary?.avg_similar_100_case_fairness,
  ];
  for (const value of candidates) {
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return 0;
}

function decisionForLabel(data, label, trueLabel) {
  const pred = Number(label);
  const truth = Number(trueLabel);
  const isCorrect = Number.isFinite(truth) && pred === truth ? 1 : 0;
  const isPositiveDecision = pred === 1 ? 1 : 0;
  const isNegativeDecision = pred === 0 ? 1 : 0;
  return {
    pred_class: pred,
    subgroup_accuracy: isCorrect,
    local_accuracy: isCorrect,
    subgroup_tpr: isPositiveDecision,
    local_tpr: isPositiveDecision,
    subgroup_tnr: isNegativeDecision,
    local_tnr: isNegativeDecision,
    local_consistency: decisionFairnessForLabel(data, pred),
  };
}

function decisionLabelOptions(data, trueLabel) {
  const labels = new Set([0, 1]);
  for (const group of data?.reconciliation?.groups || []) labels.add(Number(group.class_id));
  for (const label of data?.label_names?.keys?.() || []) labels.add(Number(label));
  return [...labels].filter((label) => Number.isFinite(label)).sort((a, b) => a - b).map((label) => decisionForLabel(data, label, trueLabel));
}

function score(S, outcome, latentSelfBest, latentOtherBest, bands) {
  const selfW = S.weightsFor("self");
  const otherW = S.weightsFor("other");
  const selfU = S.utility(outcome.deployed, selfW);
  const otherU = S.utility(outcome.deployed, otherW);
  // share of the achievable band captured: 0 = the worst model in this case for
  // that side, 1 = the best. Degenerate bands (every model identical) score 1.
  const norm = (u, b) => (b.hi - b.lo > 1e-9 ? (u - b.lo) / (b.hi - b.lo) : 1);
  const selfN = norm(selfU, bands.self);
  const otherN = norm(otherU, bands.other);
  const totalU = selfU + otherU;
  const totalN = selfN + otherN;
  const worstU = Math.min(selfU, otherU);
  const worstN = Math.min(selfN, otherN);
  const meanU = totalU / 2;
  const meanN = totalN / 2;
  const utilityVariance = ((selfU - meanU) ** 2 + (otherU - meanU) ** 2) / 2;
  const utilityVarianceN = ((selfN - meanN) ** 2 + (otherN - meanN) ** 2) / 2;
  const selfUtility100 = selfN * 100;
  const otherUtility100 = otherN * 100;
  const totalUtility100 = meanN * 100;
  const worstStakeholderUtility100 = worstN * 100;
  const utilityVariance100 = utilityVarianceN * 10000;
  // Stances that a condition never moves stay at the latent optima.
  const selfStance = outcome.selfStance || latentSelfBest;
  const otherStance = outcome.otherStance || latentOtherBest;
  return {
    self_utility: selfUtility100,
    other_utility: otherUtility100,
    total_utility_0_100: totalUtility100,
    worst_stakeholder_utility_0_100: worstStakeholderUtility100,
    utility_variance_0_100: utilityVariance100,
    self_u: selfU,
    other_u: otherU,
    total_utility: totalU,
    worst_stakeholder_utility: worstU,
    utility_variance: utilityVariance,
    joint_mean: meanU,
    joint_min: worstU,
    joint_nash: Math.max(0, selfU) * Math.max(0, otherU),
    self_n: selfN,
    other_n: otherN,
    total_utility_n: totalN,
    worst_stakeholder_utility_n: worstN,
    utility_variance_n: utilityVarianceN,
    joint_n: meanN,
    band_self: bands.self.hi - bands.self.lo,
    band_other: bands.other.hi - bands.other.lo,
    consensus: predOf(selfStance) === predOf(otherStance) ? 1 : 0,
    settled: outcome.settled ? 1 : 0,
    rounds: outcome.rounds ?? "",
    how: outcome.how ?? "",
  };
}

function scoreByLabel(S, outcome, decisionOptions, labelBands) {
  const label = predOf(outcome.deployed);
  const selfW = S.weightsFor("self");
  const otherW = S.weightsFor("other");
  const norm = (u, b) => (b.hi - b.lo > 1e-9 ? (u - b.lo) / (b.hi - b.lo) : 1);
  const scored = Object.fromEntries(decisionOptions.map((decision) => {
    const decisionLabel = predOf(decision);
    const selfUForLabel = S.utility(decision, selfW);
    const otherUForLabel = S.utility(decision, otherW);
    return [decisionLabel, {
      selfU: selfUForLabel,
      otherU: otherUForLabel,
      selfN: norm(selfUForLabel, labelBands.self),
      otherN: norm(otherUForLabel, labelBands.other),
    }];
  }));
  const chosen = scored[label] || scored[predOf(decisionOptions[0])];
  const label0 = scored[0] || { selfU: 0, otherU: 0, selfN: 0, otherN: 0 };
  const label1 = scored[1] || { selfU: 0, otherU: 0, selfN: 0, otherN: 0 };
  const selfU = chosen.selfU;
  const otherU = chosen.otherU;
  const selfN = chosen.selfN;
  const otherN = chosen.otherN;
  const totalU = selfU + otherU;
  const totalN = selfN + otherN;
  const worstU = Math.min(selfU, otherU);
  const worstN = Math.min(selfN, otherN);
  const meanU = totalU / 2;
  const meanN = totalN / 2;
  const utilityVariance = ((selfU - meanU) ** 2 + (otherU - meanU) ** 2) / 2;
  const utilityVarianceN = ((selfN - meanN) ** 2 + (otherN - meanN) ** 2) / 2;
  return {
    self_utility_by_label: selfN * 100,
    other_utility_by_label: otherN * 100,
    total_utility_0_100_by_label: meanN * 100,
    worst_stakeholder_utility_0_100_by_label: worstN * 100,
    utility_variance_0_100_by_label: utilityVarianceN * 10000,
    self_u_by_label: selfU,
    other_u_by_label: otherU,
    total_utility_by_label: totalU,
    worst_stakeholder_utility_by_label: worstU,
    utility_variance_by_label: utilityVariance,
    joint_mean_by_label: meanU,
    joint_min_by_label: worstU,
    joint_nash_by_label: Math.max(0, selfU) * Math.max(0, otherU),
    self_n_by_label: selfN,
    other_n_by_label: otherN,
    total_utility_n_by_label: totalN,
    worst_stakeholder_utility_n_by_label: worstN,
    utility_variance_n_by_label: utilityVarianceN,
    joint_n_by_label: meanN,
    band_self_by_label: labelBands.self.hi - labelBands.self.lo,
    band_other_by_label: labelBands.other.hi - labelBands.other.lo,
    self_u_label_0_by_label: label0.selfU,
    self_u_label_1_by_label: label1.selfU,
    other_u_label_0_by_label: label0.otherU,
    other_u_label_1_by_label: label1.otherU,
    self_n_label_0_by_label: label0.selfN,
    self_n_label_1_by_label: label1.selfN,
    other_n_label_0_by_label: label0.otherN,
    other_n_label_1_by_label: label1.otherN,
  };
}

/* ---------------- sweep ---------------- */

const S = buildSandbox();
const personas = S.personaKeys.map((k) => S.personaTypes[k]);
const pairs = [];
for (const a of personas) for (const b of personas) if (a.key !== b.key) pairs.push([a, b]);

fs.mkdirSync(OUT_DIR, { recursive: true });
const CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"];
const rows = [];
let skippedNonConflicting = 0;
const t0 = Date.now();

const testLabelsByDataset = Object.fromEntries(
  DATASETS.map((ds) => [ds, JSON.parse(read(`data/${ds}/test_labels.json`)).labels || []])
);

for (const ds of DATASETS) {
  const caseList = JSON.parse(read(`data/${ds}/cases.json`)).slice(0, LIMIT);
  let done = 0;
  for (const caseMeta of caseList) {
    const idx = caseMeta.test_case_index;
    let data;
    try {
      data = JSON.parse(read(`data/${ds}/cases/${idx}.json`));
    } catch {
      continue; // listed case without a detail file
    }
    S.setCase(data);
    for (const [selfP, otherP] of pairs) {
      S.setPersonas(selfP, otherP);
      const latentSelfBest = S.selectedSingleOptimalModel(S.weightsFor("self"));
      const latentOtherBest = S.selectedSingleOptimalModel(S.weightsFor("other"));
      const selfModelPred = predOf(latentSelfBest);
      const otherModelPred = predOf(latentOtherBest);
      if (selfModelPred === otherModelPred) {
        skippedNonConflicting += 1;
        continue;
      }
      const multioptimalChooseSelf = stableUnitInterval(ds, idx, selfP.key, otherP.key, "multioptimal") < MULTIOPTIMAL_SELF_OWN_PROB;
      const aggre50Label = predOf(runAggregate(S, 0.5).deployed);
      const aggre80Label = predOf(runAggregate(S, 0.8).deployed);
      const bands = {
        self: achievableBand(S, data.models || [], S.weightsFor("self")),
        other: achievableBand(S, data.models || [], S.weightsFor("other")),
      };
      const trueLabel = testLabelsByDataset[ds]?.[idx];
      const decisionOptions = decisionLabelOptions(data, trueLabel);
      const labelBands = {
        self: achievableBand(S, decisionOptions, S.weightsFor("self")),
        other: achievableBand(S, decisionOptions, S.weightsFor("other")),
      };
      for (const condition of CONDITIONS) {
        const outcome =
          condition === "single" ? runSingle(S, data, ds)
          : condition === "singleoptimal" ? runSingleOptimal(S)
          : condition === "multioptimal" ? runMultiOptimal(S, multioptimalChooseSelf)
          : condition === "aggregate" ? runAggregate(S, AGGREGATE_SELF_SHARE_MIN + stableUnitInterval(ds, idx, selfP.key, otherP.key, "aggregate") * (AGGREGATE_SELF_SHARE_MAX - AGGREGATE_SELF_SHARE_MIN))
          : runNegotiate(S);
        const m = score(S, outcome, latentSelfBest, latentOtherBest, bands);
        const labelM = scoreByLabel(S, outcome, decisionOptions, labelBands);
        rows.push({
          dataset: ds,
          case: idx,
          case_ID: `${ds}_${idx}`,
          high_disagreement: caseMeta.high_disagreement ? 1 : 0,
          self: selfP.key,
          other: otherP.key,
          self_model_pred: selfModelPred,
          other_model_pred: otherModelPred,
          condition,
          final_modelling_label: predOf(outcome.deployed),
          aggre_50: aggre50Label,
          aggre_80: aggre80Label,
          aggregate_self_share: condition === "aggregate" ? outcome.aggregate_self_share : "",
          multioptimal_self_own_prob: condition === "multioptimal" ? MULTIOPTIMAL_SELF_OWN_PROB : "",
          multioptimal_chose_self_model: condition === "multioptimal" ? (multioptimalChooseSelf ? 1 : 0) : "",
          ...m,
          ...labelM,
        });
      }
    }
    done += 1;
    if (done % 200 === 0) console.log(`  ${ds}: ${done}/${caseList.length} cases (${((Date.now() - t0) / 1000).toFixed(0)}s)`);
  }
  console.log(`${ds}: ${done} cases done`);
}

/* ---------------- write outputs ---------------- */

const header = Object.keys(rows[0]);
const csvEscape = (v) => {
  const str = String(v ?? "");
  return /[",\n\r]/.test(str) ? `"${str.replaceAll('"', '""')}"` : str;
};
const csv = [header.join(","), ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(","))].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "runs.csv"), csv);
fs.writeFileSync(path.join(OUT_DIR, "modeling_analysis_runs.csv"), csv);

const SUMMARY_KEYS = [
  "self_utility", "other_utility", "total_utility_0_100", "worst_stakeholder_utility_0_100", "utility_variance_0_100",
  "self_u", "other_u", "total_utility", "worst_stakeholder_utility", "utility_variance",
  "joint_mean", "joint_min", "joint_nash",
  "self_n", "other_n", "total_utility_n", "worst_stakeholder_utility_n", "utility_variance_n",
  "joint_n", "band_self", "band_other",
  "self_utility_by_label", "other_utility_by_label", "total_utility_0_100_by_label", "worst_stakeholder_utility_0_100_by_label", "utility_variance_0_100_by_label",
  "self_u_by_label", "other_u_by_label", "total_utility_by_label", "worst_stakeholder_utility_by_label", "utility_variance_by_label",
  "joint_mean_by_label", "joint_min_by_label", "joint_nash_by_label",
  "self_n_by_label", "other_n_by_label", "total_utility_n_by_label", "worst_stakeholder_utility_n_by_label", "utility_variance_n_by_label",
  "joint_n_by_label", "band_self_by_label", "band_other_by_label",
  "consensus", "settled",
];
const byCondition = {};
for (const r of rows) {
  const bucket = (byCondition[r.condition] ||= Object.fromEntries([["n", 0], ...SUMMARY_KEYS.map((k) => [k, 0])]));
  bucket.n += 1;
  for (const k of SUMMARY_KEYS) bucket[k] += Number(r[k]) || 0;
}
const summary = Object.fromEntries(
  CONDITIONS.map((c) => {
    const b = byCondition[c];
    return [c, Object.fromEntries(SUMMARY_KEYS.map((k) => [k, b[k] / b.n]).concat([["n", b.n]]))];
  })
);
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify({
  epsilon: EPSILON,
  opener: OPENER,
  datasets: DATASETS,
  conflict_only: true,
  skipped_non_conflicting_pairs: skippedNonConflicting,
  aggregate_self_share_min: AGGREGATE_SELF_SHARE_MIN,
  aggregate_self_share_max: AGGREGATE_SELF_SHARE_MAX,
  multioptimal_self_own_prob: MULTIOPTIMAL_SELF_OWN_PROB,
  summary,
}, null, 2));

console.log(`\n${rows.length} conflict-only runs in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.relative(repo, OUT_DIR)}/`);
console.log(`skipped ${skippedNonConflicting} non-conflicting dataset/case/persona pairs where self_model_pred === other_model_pred`);
console.log("condition        self  other  total  worst  variance | raw_self raw_other | consensus  settled");
for (const c of CONDITIONS) {
  const s = summary[c];
  const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${c.padEnd(15)} ${s.self_utility.toFixed(1).padStart(5)}  ${s.other_utility.toFixed(1).padStart(5)}  ${s.total_utility_0_100.toFixed(1).padStart(5)}  ${s.worst_stakeholder_utility_0_100.toFixed(1).padStart(5)}  ${s.utility_variance_0_100.toFixed(1).padStart(8)} | ${s.self_u.toFixed(3)}    ${s.other_u.toFixed(3)} | ${pct(s.consensus)}     ${c === "negotiatev2" ? pct(s.settled) : "-"}`
  );
}
console.log(`\nmean achievable utility band per case: self ${summary.single.band_self.toFixed(3)}, other ${summary.single.band_other.toFixed(3)}`);
console.log("self%/other%/joint% = share of that band captured (0 = worst model in the case, 1 = best)");
