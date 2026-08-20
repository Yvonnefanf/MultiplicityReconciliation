#!/usr/bin/env node
/* Generate a label-utility evaluation CSV.
 *
 * Label utility follows the study definition:
 *   utility(label) = sum(normalized criterion weight * label performance)
 * where accuracy is correctness (0/1), TPR is 1 for label 1, TNR is 1 for
 * label 0, and fairness is the label group's local consistency.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(repo, rel), "utf8");
const argv = process.argv.slice(2);
const outIndex = argv.indexOf("--out");
const outputRelative = outIndex >= 0 && argv[outIndex + 1]
  ? argv[outIndex + 1]
  : "exp_data/utility_eval_by_label.csv";
const policyIndex = argv.indexOf("--negotiate-policy");
const negotiatePolicy = policyIndex >= 0 && argv[policyIndex + 1]
  ? argv[policyIndex + 1]
  : "auto";
if (!new Set(["auto", "ui-first"]).has(negotiatePolicy)) {
  throw new Error(`unknown --negotiate-policy ${negotiatePolicy}; expected auto or ui-first`);
}
const outputPath = path.resolve(repo, outputRelative);
const SAME_CRITERIA_THRESHOLD = 0.02;
const AGGREGATE_SELF_SHARE = 0.8;
const OPENER = "self";

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
    sliceBetween(caseFeaturesSrc, "function topMetricKeyForWeights", "function exposureMetricHighlightClass", "topMetricKeyForWeights"),
    sliceBetween(uiSrc, "const NV2_MAX_VERSION", "function nv2StatusLine", "nv2 engine"),
  ].join("\n\n");

  const prelude = `
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
      criteriaOrder, personaTypes, personaKeys, SINGLE_MODEL_SEED_BY_DATASET,
      normalizeWeights, modelCriterionValue,
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
        rankedCriteria = criteriaOrder.slice().sort((a, b) => userWeights[b] - userWeights[a] || criteriaOrder.indexOf(a) - criteriaOrder.indexOf(b));
      },
      weightsFor(side) { return side === "self" ? userWeights : proxyWeights; },
      resetNV2() { nv2 = null; resetNegotiateV2State(); return nv2; },
      nv2State: () => nv2,
      nv2Utility: (m, side) => nv2Utility(m, side),
      nv2AutoMove: (side, incoming, v, gain) => nv2AutoMove(side, incoming, v, gain),
      nv2Acceptance: (side, offer, v, gain) => nv2AcceptanceDecision(side, offer, v, gain),
      nv2OfferCandidates: () => nv2OfferCandidates(),
      nv2Push: (side, entry) => nv2PushPosition(side, entry),
      nv2Position: (side) => nv2Position(side),
      NV2_MAX_VERSION,
    };
  `;

  return new Function(prelude + "\n" + sources + "\n" + epilogue)();
}

const predOf = (model) => Number(model?.pred_class);

function runSingle(S, data, dataset) {
  const seed = S.SINGLE_MODEL_SEED_BY_DATASET[dataset];
  return (data.models || []).find((model) => Number(model.seed) === Number(seed)) || data.models[0];
}

function runSelfOptimal(S) {
  return S.selectedSingleOptimalModel(S.weightsFor("self"));
}

function runMultiOptimal(S) {
  const selfWeights = S.weightsFor("self");
  const otherWeights = S.weightsFor("other");
  const selfModel = S.selectedSingleOptimalModel(selfWeights);
  const otherModel = S.selectedSingleOptimalModel(otherWeights);
  const selfTopCriterion = S.criteriaOrder
    .slice()
    .sort((a, b) => selfWeights[b] - selfWeights[a] || S.criteriaOrder.indexOf(a) - S.criteriaOrder.indexOf(b))[0];
  const selfPerformance = S.modelCriterionValue(selfModel, selfTopCriterion);
  const otherPerformance = S.modelCriterionValue(otherModel, selfTopCriterion);
  const comparable = Number.isFinite(selfPerformance) && Number.isFinite(otherPerformance);
  const similarForSelf = comparable && otherPerformance >= selfPerformance - SAME_CRITERIA_THRESHOLD;
  const betterForOther = S.utility(otherModel, otherWeights) > S.utility(selfModel, otherWeights) + 1e-9;
  return similarForSelf && betterForOther ? otherModel : selfModel;
}

function runAggregate(S) {
  const selfModel = S.selectedSingleOptimalModel(S.weightsFor("self"));
  const otherModel = S.selectedSingleOptimalModel(S.weightsFor("other"));
  const highProbability = AGGREGATE_SELF_SHARE * Number(selfModel.pred_prob)
    + (1 - AGGREGATE_SELF_SHARE) * Number(otherModel.pred_prob);
  return { pred_class: highProbability >= 0.5 ? 1 : 0, pred_prob: highProbability };
}

function runNegotiate(S, policy = "auto") {
  S.resetNV2();
  const selfV0 = S.nv2Position("self").model;
  const otherV0 = S.nv2Position("other").model;
  const maxVersion = S.NV2_MAX_VERSION;
  let mutualHolds = 0;
  let pending = null;
  let gainToSelf = null;
  let agreed = null;

  if (OPENER === "other") {
    const anchor = S.nv2Position("self").model;
    const previous = S.nv2Position("other").model;
    const move = S.nv2AutoMove("other", anchor, 1, null);
    const model = move.model || previous;
    S.nv2Push("other", { version: 1, model, act: "open_offer" });
    pending = model;
    gainToSelf = S.nv2Utility(model, "self") - S.nv2Utility(previous, "self");
  }

  for (let version = 1; version <= maxVersion && !agreed; version += 1) {
    const selfPrevious = S.nv2Position("self").model;
    const otherPrevious = S.nv2Position("other").model;
    let plan;
    if (pending) {
      const decision = S.nv2Acceptance("self", pending, version, gainToSelf);
      if (decision.accept) {
        agreed = pending;
        break;
      }
      plan = policy === "ui-first"
        ? S.nv2OfferCandidates()[0] || { model: selfPrevious, held: true, stonewalled: true }
        : decision.plan;
    } else {
      plan = policy === "ui-first"
        ? S.nv2OfferCandidates()[0] || { model: selfPrevious, held: true, stonewalled: true }
        : S.nv2AutoMove("self", otherPrevious, version, gainToSelf);
    }

    const selfOffer = plan.model || selfPrevious;
    const selfHeld = Boolean(plan.stonewalled || plan.held);
    S.nv2Push("self", { version, model: selfOffer, act: selfHeld ? "hold" : "offer" });
    const delivered = S.nv2Utility(selfOffer, "other") - S.nv2Utility(selfPrevious, "other");
    const response = S.nv2Acceptance("other", selfOffer, version, delivered);
    if (response.accept) {
      agreed = selfOffer;
      break;
    }
    const move = response.plan;
    const otherOffer = move.model || otherPrevious;
    S.nv2Push("other", {
      version: S.nv2State().other.track.length,
      model: otherOffer,
      act: move.stonewalled ? "hold" : "counter",
    });
    pending = otherOffer;
    gainToSelf = S.nv2Utility(otherOffer, "self") - S.nv2Utility(otherPrevious, "self");
    mutualHolds = selfHeld && move.stonewalled ? mutualHolds + 1 : 0;
    if (mutualHolds >= 2) break;
  }

  if (!agreed && pending) {
    const finalDecision = S.nv2Acceptance("self", pending, maxVersion, gainToSelf);
    if (finalDecision.accept) agreed = pending;
  }
  return {
    model: agreed || S.nv2Position("self").model,
    selfV0,
    otherV0,
    settled: Boolean(agreed),
    expectedDecision: S.nv2State()?.decisionDirection?.preferredLabel ?? "",
  };
}

function labelFairness(data, label) {
  const group = (data.reconciliation?.groups || []).find((item) => Number(item.class_id) === Number(label));
  const summary = (Array.isArray(data.summary) ? data.summary : []).find((item) => Number(item.class_id) === Number(label));
  for (const value of [
    group?.criteria?.local_consistency,
    group?.fairness_components?.local_consistency,
    summary?.avg_local_consistency,
    summary?.avg_similar_100_case_fairness,
  ]) {
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  throw new Error(`missing local consistency for ${data.dataset} case ${data.case?.test_case_index} label ${label}`);
}

function labelPerformance(data, label, trueLabel) {
  return {
    accuracy: Number(label) === Number(trueLabel) ? 1 : 0,
    tpr: Number(label) === 1 ? 1 : 0,
    tnr: Number(label) === 0 ? 1 : 0,
    local_consistency: labelFairness(data, label),
  };
}

function labelUtility(performance, weights, criteriaOrder) {
  return criteriaOrder.reduce((sum, criterion) => sum + weights[criterion] * performance[criterion], 0);
}

const csvEscape = (value) => {
  const string = String(value ?? "");
  return /[",\n\r]/.test(string) ? `"${string.replaceAll('"', '""')}"` : string;
};

const S = buildSandbox();
const personaByKey = Object.fromEntries(S.personaKeys.map((key) => [key, S.personaTypes[key]]));
const datasets = fs.readdirSync(path.join(repo, "exp_data"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();
const trueLabels = Object.fromEntries(datasets.map((dataset) => [
  dataset,
  JSON.parse(read(`data/${dataset}/test_labels.json`)).labels || [],
]));

const headers = [
  "dataset",
  "Condition",
  "Self_role",
  "Other_role",
  "self_weight",
  "other_weight",
  "caseID",
  "Self_utility_label_0",
  "self_utility_label_1",
  "Other_utility_label_0",
  "other_utility_label_1",
  "joint_utility_label_0",
  "joint_utility_label_1",
  "final_decision",
  "self_utility",
  "other utility",
  "joint_utility",
  "oracle_joint_utility",
  "joint_regret",
  "expected_joint_decision",
  "direction_matches_final",
  "selected_model_seed",
  "model_self_utility",
  "model_other_utility",
  "self_v0_model_seed",
  "other_v0_model_seed",
  "self_v0_model_utility",
  "final_model_self_sacrifice",
  "negotiate_alignment",
  "flag",
];
const conditions = ["single", "self_optimal", "multi_optimal", "aggregate", "negotiate"];
const rows = [];

for (const dataset of datasets) {
  for (const selfRole of S.personaKeys) {
    const roleDir = path.join(repo, "exp_data", dataset, selfRole);
    const indexPath = path.join(roleDir, "index.json");
    if (!fs.existsSync(indexPath)) continue;
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    for (const item of index.cases || []) {
      const data = JSON.parse(fs.readFileSync(path.join(roleDir, `${item.case_id}.json`), "utf8"));
      const otherRole = data.assignment?.other_role;
      if (!personaByKey[otherRole]) throw new Error(`unknown Other role ${otherRole}`);
      S.setCase(data);
      S.setPersonas(personaByKey[selfRole], personaByKey[otherRole]);
      const selfWeights = S.weightsFor("self");
      const otherWeights = S.weightsFor("other");
      const testCaseIndex = data.assignment?.test_case_index ?? data.case?.test_case_index;
      const trueLabel = trueLabels[dataset]?.[testCaseIndex];
      if (!Number.isFinite(Number(trueLabel))) throw new Error(`missing true label for ${dataset} test case ${testCaseIndex}`);

      const performance0 = labelPerformance(data, 0, trueLabel);
      const performance1 = labelPerformance(data, 1, trueLabel);
      const selfUtility0 = labelUtility(performance0, selfWeights, S.criteriaOrder);
      const selfUtility1 = labelUtility(performance1, selfWeights, S.criteriaOrder);
      const otherUtility0 = labelUtility(performance0, otherWeights, S.criteriaOrder);
      const otherUtility1 = labelUtility(performance1, otherWeights, S.criteriaOrder);
      const jointUtility0 = (selfUtility0 + otherUtility0) / 2;
      const jointUtility1 = (selfUtility1 + otherUtility1) / 2;
      const selectedModels = {
        single: () => runSingle(S, data, dataset),
        self_optimal: () => runSelfOptimal(S),
        multi_optimal: () => runMultiOptimal(S),
        aggregate: () => runAggregate(S),
        negotiate: () => runNegotiate(S, negotiatePolicy),
      };

      for (const condition of conditions) {
        const selected = selectedModels[condition]();
        const selectedModel = condition === "negotiate" ? selected.model : selected;
        const finalDecision = predOf(selectedModel);
        if (finalDecision !== 0 && finalDecision !== 1) throw new Error(`invalid final decision ${finalDecision}`);
        const selfUtility = finalDecision === 0 ? selfUtility0 : selfUtility1;
        const otherUtility = finalDecision === 0 ? otherUtility0 : otherUtility1;
        const jointUtility = (selfUtility + otherUtility) / 2;
        const oracleJointUtility = Math.max(jointUtility0, jointUtility1);
        const expectedJointDecision = condition === "negotiate" ? selected.expectedDecision : "";
        const modelSelfUtility = condition === "aggregate" ? "" : S.utility(selectedModel, selfWeights);
        const modelOtherUtility = condition === "aggregate" ? "" : S.utility(selectedModel, otherWeights);
        const selfV0ModelUtility = condition === "negotiate" ? S.utility(selected.selfV0, selfWeights) : "";
        const finalModelSelfSacrifice = condition === "negotiate"
          ? Math.max(0, selfV0ModelUtility - modelSelfUtility)
          : "";
        const negotiateAlignment = condition === "negotiate"
          ? Number(selectedModel.pred_class) === Number(selected.selfV0.pred_class) ? "self" : "other"
          : "";
        rows.push({
          dataset,
          Condition: condition,
          Self_role: selfRole,
          Other_role: otherRole,
          self_weight: JSON.stringify(selfWeights),
          other_weight: JSON.stringify(otherWeights),
          caseID: data.assignment?.case_id ?? item.case_id,
          Self_utility_label_0: selfUtility0,
          self_utility_label_1: selfUtility1,
          Other_utility_label_0: otherUtility0,
          other_utility_label_1: otherUtility1,
          joint_utility_label_0: jointUtility0,
          joint_utility_label_1: jointUtility1,
          final_decision: finalDecision,
          self_utility: selfUtility,
          "other utility": otherUtility,
          joint_utility: jointUtility,
          oracle_joint_utility: oracleJointUtility,
          joint_regret: oracleJointUtility - jointUtility,
          expected_joint_decision: expectedJointDecision,
          direction_matches_final: expectedJointDecision === "" ? "" : Number(expectedJointDecision) === finalDecision ? 1 : 0,
          selected_model_seed: selectedModel?.seed ?? "",
          model_self_utility: modelSelfUtility,
          model_other_utility: modelOtherUtility,
          self_v0_model_seed: condition === "negotiate" ? selected.selfV0?.seed ?? "" : "",
          other_v0_model_seed: condition === "negotiate" ? selected.otherV0?.seed ?? "" : "",
          self_v0_model_utility: selfV0ModelUtility,
          final_model_self_sacrifice: finalModelSelfSacrifice,
          negotiate_alignment: negotiateAlignment,
          flag: condition === "negotiate" && !selected.settled ? "not reach" : "",
        });
      }
    }
  }
}

if (!rows.length) throw new Error("no exp_data rows found");
const csv = [
  headers.join(","),
  ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(",")),
].join("\n") + "\n";
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, csv);
console.log(JSON.stringify({ output: path.relative(repo, outputPath), rows: rows.length, datasets, conditions, negotiatePolicy }, null, 2));
