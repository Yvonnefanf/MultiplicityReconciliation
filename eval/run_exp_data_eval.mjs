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
const EPSILON = args.epsilon ? Number(args.epsilon) : 0.02; // multioptimal cheap-adoption tolerance
const OPENER = args.opener === "other" ? "other" : "self";
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

// multioptimal: both optima are on screen. A side adopts the other side's
// optimum iff that costs it at most EPSILON of its own utility (cheap
// magnanimity); Self is the decision maker, so Self's adopted model deploys.
function runMultiOptimal(S) {
  const selfW = S.weightsFor("self");
  const otherW = S.weightsFor("other");
  const selfBest = S.selectedSingleOptimalModel(selfW);
  const otherBest = S.selectedSingleOptimalModel(otherW);
  const adopt = (mineW, mine, theirs) =>
    S.utility(theirs, mineW) >= S.utility(mine, mineW) - EPSILON ? theirs : mine;
  const selfStance = adopt(selfW, selfBest, otherBest);
  const otherStance = adopt(otherW, otherBest, selfBest);
  return { deployed: selfStance, selfStance, otherStance };
}

// aggregate: the app's blend of the two optima. Utilities are computed on the
// criteria-blended package (utility is linear in criteria, so this equals the
// same blend of the two models' utilities); the prediction comes from the
// blended P(high) exactly as aggregateRecommendation() computes it.
function runAggregate(S) {
  const selfW = S.weightsFor("self");
  const otherW = S.weightsFor("other");
  const selfModel = S.selectedSingleOptimalModel(selfW);
  const otherModel = S.selectedSingleOptimalModel(otherW);
  const selfShare = 0.5; // app default aggregateSelfShare
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
  return { deployed: blended, selfStance: null, otherStance: null };
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
  // Stances that a condition never moves stay at the latent optima.
  const selfStance = outcome.selfStance || latentSelfBest;
  const otherStance = outcome.otherStance || latentOtherBest;
  return {
    self_u: selfU,
    other_u: otherU,
    joint_mean: (selfU + otherU) / 2,
    joint_min: Math.min(selfU, otherU),
    joint_nash: Math.max(0, selfU) * Math.max(0, otherU),
    self_n: selfN,
    other_n: otherN,
    joint_n: (selfN + otherN) / 2,
    band_self: bands.self.hi - bands.self.lo,
    band_other: bands.other.hi - bands.other.lo,
    consensus: predOf(selfStance) === predOf(otherStance) ? 1 : 0,
    settled: outcome.settled ? 1 : 0,
    rounds: outcome.rounds ?? "",
    how: outcome.how ?? "",
  };
}


/* ---------------- exp_data sweep ---------------- */

const S = buildSandbox();
const personaByKey = Object.fromEntries(S.personaKeys.map((k) => [k, S.personaTypes[k]]));

fs.mkdirSync(OUT_DIR, { recursive: true });
const CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"];
const rows = [];
const t0 = Date.now();

function expDataEntries(ds) {
  const out = [];
  for (const selfKey of S.personaKeys) {
    const indexPath = path.join(repo, "exp_data", ds, selfKey, "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const item of index.cases || []) {
      const casePath = path.join(repo, "exp_data", ds, selfKey, `${item.case_id}.json`);
      if (!fs.existsSync(casePath)) continue;
      const data = JSON.parse(fs.readFileSync(casePath, "utf8"));
      const otherKey = data.assignment?.other_role;
      if (!personaByKey[otherKey]) throw new Error(`unknown other role ${otherKey} in ${casePath}`);
      out.push({ ds, selfKey, otherKey, expCaseId: item.case_id, data });
    }
  }
  return out;
}

for (const ds of DATASETS) {
  const entries = expDataEntries(ds).slice(0, LIMIT);
  let done = 0;
  for (const entry of entries) {
    const { selfKey, otherKey, expCaseId, data } = entry;
    const idx = data.assignment?.test_case_index ?? data.case?.test_case_index ?? expCaseId;
    const selfP = personaByKey[selfKey];
    const otherP = personaByKey[otherKey];
    S.setCase(data);
    S.setPersonas(selfP, otherP);
    const latentSelfBest = S.selectedSingleOptimalModel(S.weightsFor("self"));
    const latentOtherBest = S.selectedSingleOptimalModel(S.weightsFor("other"));
    const bands = {
      self: achievableBand(S, data.models || [], S.weightsFor("self")),
      other: achievableBand(S, data.models || [], S.weightsFor("other")),
    };
    for (const condition of CONDITIONS) {
      const outcome =
        condition === "single" ? runSingle(S, data, ds)
        : condition === "singleoptimal" ? runSingleOptimal(S)
        : condition === "multioptimal" ? runMultiOptimal(S)
        : condition === "aggregate" ? runAggregate(S)
        : runNegotiate(S);
      const m = score(S, outcome, latentSelfBest, latentOtherBest, bands);
      rows.push({
        dataset: ds,
        exp_case_id: expCaseId,
        case: idx,
        self: selfKey,
        other: otherKey,
        role_pair: `${selfKey}->${otherKey}`,
        condition,
        ...m,
      });
    }
    done += 1;
  }
  console.log(`${ds}: ${done} assigned exp_data cases done`);
}

/* ---------------- write outputs ---------------- */

if (!rows.length) throw new Error("no exp_data rows found");
const header = Object.keys(rows[0]);
const csv = [header.join(","), ...rows.map((r) => header.map((h) => r[h]).join(","))].join("\n");
fs.writeFileSync(path.join(OUT_DIR, "runs.csv"), csv);

const SUMMARY_KEYS = [
  "self_u", "other_u", "joint_mean", "joint_min", "joint_nash",
  "self_n", "other_n", "joint_n", "band_self", "band_other",
  "consensus", "settled",
];
function emptyBucket() {
  return Object.fromEntries([["n", 0], ...SUMMARY_KEYS.map((k) => [k, 0])]);
}
function add(bucket, r) {
  bucket.n += 1;
  for (const k of SUMMARY_KEYS) bucket[k] += Number(r[k]) || 0;
}
function finish(bucket) {
  return Object.fromEntries(SUMMARY_KEYS.map((k) => [k, bucket[k] / bucket.n]).concat([["n", bucket.n]]));
}

const byCondition = {};
const byPairCondition = {};
for (const r of rows) {
  add((byCondition[r.condition] ||= emptyBucket()), r);
  add((byPairCondition[`${r.role_pair}/${r.condition}`] ||= emptyBucket()), r);
}
const summary = Object.fromEntries(CONDITIONS.map((c) => [c, finish(byCondition[c])]));
const pairSummary = {};
for (const key of Object.keys(byPairCondition).sort()) {
  const [pair, condition] = key.split("/");
  (pairSummary[pair] ||= {})[condition] = finish(byPairCondition[key]);
}
fs.writeFileSync(
  path.join(OUT_DIR, "condition_summary.json"),
  JSON.stringify({ epsilon: EPSILON, opener: OPENER, datasets: DATASETS, summary, by_role_pair: pairSummary }, null, 2)
);

console.log(`\n${rows.length} condition runs in ${((Date.now() - t0) / 1000).toFixed(1)}s -> ${path.relative(repo, OUT_DIR)}/runs.csv`);
console.log("condition        self_u  other_u  joint  | self%  other% joint% | consensus  settled");
for (const c of CONDITIONS) {
  const s = summary[c];
  const pct = (v) => `${(v * 100).toFixed(1)}%`.padStart(6);
  console.log(
    `${c.padEnd(15)} ${s.self_u.toFixed(3)}   ${s.other_u.toFixed(3)}   ${s.joint_mean.toFixed(3)}  |${pct(s.self_n)}${pct(s.other_n)}${pct(s.joint_n)} | ${pct(s.consensus)}     ${c === "negotiatev2" ? pct(s.settled) : "-"}`
  );
}
