/* config-state.js — DOM element refs, config constants, persona data, shared mutable state
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    const datasetSelect = document.getElementById("datasetSelect");
    const caseSelect = document.getElementById("caseSelect");
    const datasetHint = document.getElementById("datasetHint");
    const topToolbar = document.getElementById("topToolbar");
    const features = document.getElementById("features");
    const finalDecisionOptions = document.getElementById("finalDecisionOptions");
    const finalDecisionStatusBanner = document.getElementById("finalDecisionStatusBanner");
    const nextCaseButton = document.getElementById("nextCaseButton");
    const summaryTableWrap = document.getElementById("summaryTableWrap");
    const modelRows = document.getElementById("modelRows");
    const decisionLabel = document.getElementById("decisionLabel");
    const decisionReason = document.getElementById("decisionReason");
    const consensusHint = document.getElementById("consensusHint");
    const offerComposer = document.getElementById("offerComposer");
    const negotiationHistory = document.getElementById("negotiationHistory");
    const chatWindow = document.querySelector(".chat-window");
    const toggleDetailsButton = document.getElementById("toggleDetailsButton");
    const modelDetailsWrap = document.getElementById("modelDetailsWrap");
    const wizardPanel = document.getElementById("wizardPanel");
    const wizardKicker = document.getElementById("wizardKicker");
    const wizardTitle = document.getElementById("wizardTitle");
    const wizardSubtitle = document.getElementById("wizardSubtitle");
    const wizardProgress = document.getElementById("wizardProgress");
    const personaStage = document.getElementById("personaStage");
    const preferenceStage = document.getElementById("preferenceStage");
    const reconciliationGrid = document.getElementById("reconciliationGrid");
    const reconcileIdentityBanner = document.getElementById("reconcileIdentityBanner");
    const personaCard = document.getElementById("personaCard");
    const pairwiseTitle = document.getElementById("pairwiseTitle");
    const pairwiseSubtitle = document.getElementById("pairwiseSubtitle");
    const pairwiseProgress = document.getElementById("pairwiseProgress");
    const pairwiseContent = document.getElementById("pairwiseContent");
    const pairwiseNav = document.querySelector(".pairwise-nav");
    const pairwiseCounter = document.getElementById("pairwiseCounter");
    const pairwiseNextButton = document.getElementById("pairwiseNextButton");
    const personaNextButton = document.getElementById("personaNextButton");
    const personaConsentCheckbox = document.getElementById("personaConsentCheckbox");
    const preferenceBackButton = document.getElementById("preferenceBackButton");
    const startReconciliationButton = document.getElementById("startReconciliationButton");

    const criteriaOrder = ["accuracy", "tpr", "tnr", "local_consistency", "counterfactual_fairness"];
    const criteriaLabels = {
      accuracy: "Accuracy",
      tpr: "Catch Truly High-Risk",
      tnr: "Avoid False High-Risk",
      local_consistency: "Individual Fairness",
      counterfactual_fairness: "CF Fairness"
    };
    // Single condition pins ONE fixed model per dataset (model 0; loan has no
    // seed 0 so it uses its first model, seed 1). Its real per-case SHAP is stored
    // in the case JSON at shap_patterns.by_model[seed]. Re-run
    // scratchpad/inject_single_shap.py if this seed changes.
    const SINGLE_MODEL_SEED_BY_DATASET = { compas: 0, loan: 1 };
    function singleModelSeed() {
      const dataset = activeData?.dataset ?? datasetSelect?.value;
      return SINGLE_MODEL_SEED_BY_DATASET[dataset] ?? null;
    }
    const STUDY_CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2", "exposure", "informed", "negotiation"];
    const DEFAULT_STUDY_CONDITION = "negotiation";
    const configuredStudyCondition = String(new URLSearchParams(window.location.search).get("condition") || "").toLowerCase().replace(/[-_\s]/g, "");
    const activeStudyCondition = STUDY_CONDITIONS.includes(configuredStudyCondition) ? configuredStudyCondition : DEFAULT_STUDY_CONDITION;
    document.body.classList.add(`condition-${activeStudyCondition}`);

    function studyCondition() {
      return activeStudyCondition;
    }

    function isSingleCondition() {
      return studyCondition() === "single" || studyCondition() === "singleoptimal";
    }

    function isAggregateCondition() {
      return studyCondition() === "aggregate";
    }

    function isNegotiateV2Condition() {
      return studyCondition() === "negotiatev2";
    }

    function isMultiOptimalCondition() {
      return studyCondition() === "multioptimal" || isAggregateCondition() || isNegotiateV2Condition();
    }

    function isSingleOptimalCondition() {
      return studyCondition() === "singleoptimal";
    }

    function showsProxyWeights() {
      return studyCondition() === "informed" || studyCondition() === "negotiation" || isMultiOptimalCondition();
    }

    function showsNegotiationPanel() {
      return studyCondition() === "negotiation" || isNegotiateV2Condition();
    }

    const DEFAULT_OPENAI_PROXY_URL = "https://multiplicity-reconciliation-proxy.yifan-multiplicity.workers.dev/negotiate";
    const OPENAI_PROXY_URL_STORAGE_KEY = "OPENAI_PROXY_URL";
    const configuredProxyUrl = new URLSearchParams(window.location.search).get("proxy");
    if (configuredProxyUrl) {
      localStorage.setItem(OPENAI_PROXY_URL_STORAGE_KEY, configuredProxyUrl);
    }
    const OPENAI_PROXY_URL = window.OPENAI_PROXY_URL || configuredProxyUrl || localStorage.getItem(OPENAI_PROXY_URL_STORAGE_KEY) || DEFAULT_OPENAI_PROXY_URL;
    const criteriaShortLabels = {
      accuracy: "Accuracy",
      tpr: "Local TPR",
      tnr: "Local TNR",
      local_consistency: "Individual fairness",
      counterfactual_fairness: "CF fairness"
    };
    const criteriaFullLabels = {
      accuracy: "Overall Accuracy / Correct Predictions Across All Test Cases",
      tpr: "Local True Positive Rate / Catch Truly High-Risk Cases in the 30-neighbor local region",
      tnr: "Local True Negative Rate / Avoid False High-Risk Labels in the 30-neighbor local region",
      local_consistency: "Individual Fairness",
      counterfactual_fairness: "CF Fairness"
    };
    let datasetMeta = [];
    let activeData = null;
    let modelGlobalMetrics = null;
    let weights = { accuracy: 1/5, tpr: 1/5, tnr: 1/5, local_consistency: 1/5, counterfactual_fairness: 1/5 };
    let userWeights = { ...weights };
    let proxyWeights = { ...weights };
    let composerWeights = { ...weights };
    let composerBaseWeights = { ...weights };
    let composerAdjustments = {};
    let composerLocked = false;
    let composerNote = "Adjust the weights, then send the offer.";
    let offerSource = "Self offer";
    let negotiationEvents = [];
    let pendingProxyCounter = null;
    let pendingProxyResponse = null;
    let responseActState = { type: "smaller_concession", concessionScale: "small", protectKey: null, budgetKey: null };
    let openingActState = { type: "offer_tradeoff", concessionScale: "small", protectKey: null, budgetKey: null };
    let actionCounter = 0;
    let negotiationRound = 0;
    let currentPersona = null;
    let proxyPersona = null;
    let personaInitialWeights = null;
    let rankedCriteria = [];
    let pairwiseAnswers = [];
    let pairwiseIndex = -1;
    let elicitedWeights = null;
    let datasetCaseList = [];
    let calibrationCaseData = [];
    let calibrationOrder = [];
    let calibrationAnswers = [];
    let calibrationIndex = 0;
    let stakeholderSalienceParams = null;
    let calibrationFitted = false;
    let elicitedFloor = null;
    let floorLadder = null;
    let activeStage = "persona";
    let finalDecision = null;
    let aggregateSelfShare = 0.5;
    let negotiateV2Versions = [];
    let negotiateV2VersionIndex = 0;
    let negotiateV2Draft = { selfSacrifice: null, otherSacrifice: null, step: 0.1 };

    const SAME_CRITERIA_THRESHOLD = 0.02;
    const NEGOTIATION_STEP = 0.025;
    const OPENING_NEGOTIATION_STEP = 0.025;
    const MAX_COUNTER_MOVE = 0.06;
    const MIN_ROUNDS_BEFORE_RESULT_CONSENSUS = 2;
    // Case-stakes salience is a *derived* quantity, so we only fit one identifiable
    // sensitivity scalar `s` (alpha=beta=s). The floor-risk term is kept fixed
    // (gamma=1) because a hard-floor violation is non-compensatory by definition.
    const SALIENCE_SCALAR_DEFAULT = 1.0;
    const SALIENCE_SCALAR_MIN = 0.2;
    const SALIENCE_SCALAR_MAX = 2.0;
    const SALIENCE_SCALAR_GRID = [0.4, 0.7, 1.0, 1.3, 1.6];
    // Adaptive example-comparison elicitation: fit `s` while predicting, and stop
    // once the user's choices are predictable (or the cap is reached).
    const CALIBRATION_POOL_SIZE = 10;
    const CALIBRATION_MIN_QUESTIONS = 3;
    const CALIBRATION_MAX_QUESTIONS = 8;
    const CALIBRATION_STOP_STREAK = 3;
    // Floor (reservation) elicitation for the user's top-priority criterion.
    const FLOOR_LADDER_MAX_QUESTIONS = 4;
    const HIGH_LEVERAGE_THRESHOLD = 0.08;
    const LOW_LEVERAGE_THRESHOLD = 0.035;
    const HIGH_SALIENCE_THRESHOLD = 0.035;
    const LOW_JOINT_SALIENCE_THRESHOLD = 0.035;
    const MAX_COUNTER_IMPACT = 0.008;
    const fmtPct = (value) => value == null ? "-" : `${(value * 100).toFixed(1)}%`;
    const fmtProb = (value) => value == null ? "-" : Number(value).toFixed(3);

    const degreeAdjustmentOptions = [
      { key: "decrease", label: "Decrease", shortLabel: "Dec", delta: -0.06, phrase: "decreases" },
      { key: "keep", label: "Keep same", shortLabel: "Same", delta: 0, phrase: "keeps" },
      { key: "slightly", label: "Slightly increase", shortLabel: "Slight", delta: 0.03, phrase: "slightly increases" },
      { key: "moderately", label: "Moderately increase", shortLabel: "Mod", delta: 0.06, phrase: "moderately increases" },
      { key: "strongly", label: "Strongly increase", shortLabel: "Strong", delta: 0.10, phrase: "strongly increases" }
    ];

    const personaTypes = {
      judges: {
        key: "judges",
        label: "Judges",
        role: "Judges",
        priority: "increasing overall Accuracy",
        metricLabel: "Accuracy",
        context: "Judges might want to prioritize overall accuracy when considering the design of a recidivism prediction system.",
        concern: "They are responsible for weighing evidence and may prefer a decision rule that is correct as often as possible across cases.",
        boundary: "Accuracy matters most for this role, while local error asymmetry and fairness should still be considered during deliberation.",
        positionExample: "I want the decision to follow the most accurate model group.",
        interests: [{ key: "accuracy", label: "Overall accuracy", rationale: "Judges need a decision process that is correct as often as possible across cases." }],
        preferenceKey: "local_error_balance",
        defaultSelections: { harm: "overall", fairness: "mixed", tradeoff: "performance_guardrail" },
        weights: { accuracy: 36, tpr: 20, tnr: 20, local_consistency: 12, counterfactual_fairness: 12 }
      },
      defendants: {
        key: "defendants",
        label: "Defendants",
        role: "Defendants",
        priority: "decreasing False Positive Rate (Specificity)",
        metricLabel: "False Positive Rate (Specificity)",
        context: "Defendants might want to prioritize decreasing False Positive Rate (Specificity) because they are worried about being falsely predicted as will offend again.",
        concern: "They are most concerned about being incorrectly assigned a high-risk label when they would not offend again.",
        boundary: "Local specificity and false-positive protection matter most for this role, while local sensitivity and fairness should still be discussed.",
        positionExample: "I do not want this person to be labeled high risk unless the evidence is reliable.",
        interests: [{ key: "tnr", label: "False-positive harm protection", rationale: "Defendants are harmed when a low-risk person is incorrectly labeled high risk." }],
        preferenceKey: "tnr_protection",
        defaultSelections: { harm: "false_positive", fairness: "local", tradeoff: "moderate" },
        weights: { accuracy: 12, tpr: 10, tnr: 36, local_consistency: 18, counterfactual_fairness: 24 }
      },
      community_members: {
        key: "community_members",
        label: "Community Members",
        role: "Community Members",
        priority: "decreasing False Negative Rate (Sensitivity)",
        metricLabel: "False Negative Rate (Sensitivity)",
        context: "Community Members might want to prioritize decreasing False Negative Rate (Sensitivity) because they are mostly concerned about the safety of the community.",
        concern: "They are most concerned about missing people who may truly require intervention.",
        boundary: "Sensitivity and community safety matter most for this role, while false-positive harm and fairness should still be respected.",
        positionExample: "I want the decision process to avoid missing people who may require intervention.",
        interests: [{ key: "tpr", label: "False-negative harm protection", rationale: "Community members are harmed when a truly high-risk case is missed." }],
        preferenceKey: "sensitivity_protection",
        defaultSelections: { harm: "false_negative", fairness: "mixed", tradeoff: "moderate" },
        weights: { accuracy: 12, tpr: 36, tnr: 12, local_consistency: 18, counterfactual_fairness: 22 }
      },
      fairness_advocates: {
        key: "fairness_advocates",
        label: "Fairness Advocates",
        role: "Fairness Advocates",
        priority: "increasing CF Fairness",
        metricLabel: "CF Fairness",
        context: "Fairness Advocates might want to prioritize CF fairness, meaning predictions should stay stable when race or gender information changes.",
        concern: "They are most concerned about unequal treatment tied to protected attributes and inconsistent treatment of similar people.",
        boundary: "CF fairness and individual fairness matter most for this role, while predictive performance and safety concerns should still be part of the negotiation.",
        positionExample: "I want the decision to avoid relying on models whose predictions shift with protected attributes.",
        interests: [{ key: "counterfactual_fairness", label: "Protected-attribute fairness", rationale: "Fairness advocates are concerned when race or gender changes would alter the prediction." }],
        preferenceKey: "fairness_guardian",
        defaultSelections: { harm: "balanced_harm", fairness: "group", tradeoff: "fairness_priority" },
        weights: { accuracy: 10, tpr: 12, tnr: 18, local_consistency: 28, counterfactual_fairness: 32 }
      }
    };
    const personaKeys = Object.keys(personaTypes);

    const preferenceArchetypes = {
      local_error_balance: {
        label: "Accuracy-centered preference",
        note: "This stakeholder starts by prioritizing overall accuracy while still considering local errors and fairness.",
        weights: personaTypes.judges.weights
      },
      tnr_protection: {
        label: "False-positive harm protection",
        note: "This stakeholder is especially cautious about being falsely labeled high risk.",
        weights: personaTypes.defendants.weights
      },
      sensitivity_protection: {
        label: "False-negative harm protection",
        note: "This stakeholder is especially concerned about missed high-risk cases.",
        weights: personaTypes.community_members.weights
      },
      fairness_guardian: {
        label: "Fairness-oriented preference",
        note: "This stakeholder gives more room to individual fairness and CF fairness.",
        weights: personaTypes.fairness_advocates.weights
      }
    };

    const LOCAL_SCOPE_SIZE = 30;
    const criteriaDescriptions = {
      accuracy: "Accuracy: overall share of test cases the model classifies correctly.",
      tpr: "Local TPR: within the 30 nearest similar cases, correctly identify people who are likely to re-offend.",
      tnr: "Local TNR: within the 30 nearest similar cases, protect low-risk people from being wrongly labeled as high risk.",
      local_consistency: "Individual fairness: similar nearby cases should receive the same kind of prediction.",
      counterfactual_fairness: "CF fairness: the prediction changes little when race or gender information is switched."
    };

    const personaRankDefaults = {
      judges: ["accuracy", "tpr", "tnr", "local_consistency", "counterfactual_fairness"],
      defendants: ["tnr", "counterfactual_fairness", "local_consistency", "accuracy", "tpr"],
      community_members: ["tpr", "counterfactual_fairness", "local_consistency", "accuracy", "tnr"],
      fairness_advocates: ["counterfactual_fairness", "local_consistency", "tnr", "accuracy", "tpr"]
    };

    function primaryCriterionKeyForPersona(persona) {
      if (!persona) return null;
      const interestKey = persona.interests?.find((item) => criteriaOrder.includes(item?.key))?.key;
      if (interestKey) return interestKey;
      const rankKey = (personaRankDefaults[persona.key] || []).find((key) => criteriaOrder.includes(key));
      if (rankKey) return rankKey;
      const rowWeights = persona.weights || {};
      const hasWeights = criteriaOrder.some((key) => Number(rowWeights[key]) > 0);
      if (!hasWeights) return criteriaOrder[0];
      return criteriaOrder
        .map((key) => ({ key, value: Number(rowWeights[key]) || 0 }))
        .sort((a, b) => b.value - a.value)[0]?.key || criteriaOrder[0];
    }
    window.primaryCriterionKeyForPersona = primaryCriterionKeyForPersona;

    const intensityOptions = [
      { key: "same", label: "About the same", ratio: 1 },
      { key: "slightly", label: "Slightly more", ratio: 3 },
      { key: "moderately", label: "Moderately more", ratio: 5 },
      { key: "much", label: "Much more", ratio: 7 },
      { key: "critically", label: "Critically more", ratio: 9 }
    ];

