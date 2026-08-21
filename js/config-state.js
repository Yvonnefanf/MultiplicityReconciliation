/* config-state.js — DOM element refs, config constants, persona data, shared mutable state
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    const conditionSelect = document.getElementById("conditionSelect");
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
    const reconciliationGrid = document.getElementById("reconciliationGrid");
    const reconcileIdentityBanner = document.getElementById("reconcileIdentityBanner");

    const criteriaOrder = ["accuracy", "tpr", "tnr", "local_consistency"];
    // TPR/TNR mean different things to a participant depending on what the
    // positive class is, so every criterion label, description and persona below
    // is overwritten per dataset by applyDatasetCopy(). These literals are the
    // COMPAS wording and the shape the overrides must match; they are mutated in
    // place rather than replaced so the ~30 modules that close over them keep
    // reading the live values.
    const criteriaLabels = {
      accuracy: "Accuracy",
      tpr: "Catch High Risk",
      tnr: "Protect Low Risk",
      local_consistency: "Individual Fairness"
    };
    // Single condition pins ONE fixed model per dataset -- the lowest seed the
    // Rashomon set produced for it (acs_coverage has no seed 0). Its real
    // per-case SHAP is stored in the case JSON at shap_patterns.by_model[seed],
    // written by scripts/add_model_shap.py.
    const SINGLE_MODEL_SEED_BY_DATASET = { compas: 0, acs_coverage: 1 };
    function singleModelSeed() {
      const dataset = activeData?.dataset ?? datasetSelect?.value;
      return SINGLE_MODEL_SEED_BY_DATASET[dataset] ?? null;
    }
    const STUDY_CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2", "exposure", "informed", "negotiation"];
    // Selectable conditions, grouped the way they differ mechanically. `key` is
    // the internal condition name used everywhere else; `label` is display only.
    //
    // exposure and informed are NOT two aggregation methods: they run the same
    // group-level aggregation (all candidate models are clustered by predicted
    // class, each group scored as the weighted sum of its criteria) and differ
    // only in whether the other stakeholder's weights and benefits are shown.
    // That is a different aggregation from `aggregate`, which blends the two
    // selected optimal models' predicted probabilities instead.
    const STUDY_CONDITION_GROUPS = [
      {
        label: "Core conditions",
        options: [
          { key: "single", label: "1 · Ignore" },
          { key: "singleoptimal", label: "2 · Single optimal" },
          { key: "multioptimal", label: "3 · Multi optimal" },
          { key: "aggregate", label: "4 · Aggregate" },
          { key: "negotiatev2", label: "5 · Negotiation" },
        ],
      },
      {
        label: "Group-reliability conditions",
        options: [
          { key: "exposure", label: "Exposure · your weights only" },
          { key: "informed", label: "Informed · both weights shown" },
        ],
      },
    ];
    const STUDY_CONDITION_OPTIONS = STUDY_CONDITION_GROUPS.flatMap((group) => group.options);
    // `negotiation` is deliberately absent: it is a different, still-reachable
    // legacy condition, so aliasing it to negotiatev2 would silently hijack it.
    const STUDY_CONDITION_ALIASES = { ignore: "single", negotiate: "negotiatev2", nv2: "negotiatev2" };
    const DEFAULT_STUDY_CONDITION = "negotiatev2";
    const configuredCondition = String(new URLSearchParams(window.location.search).get("condition") || "").toLowerCase().replace(/[-_\s]/g, "");
    // Any condition can be opened as a walkthrough by suffixing it with
    // `_tutorial` (?condition=single_tutorial). The condition itself behaves
    // exactly as it normally does; tutorial mode only draws numbered callout
    // circles over it -- see js/tutorial.js.
    const activeTutorialMode = /tutorial$/.test(configuredCondition);
    const configuredStudyCondition = configuredCondition.replace(/tutorial$/, "");
    // The walkthrough's stages are NOT the study's conditions and do not have to
    // line up with them one-to-one: a stage names what a screen teaches, and two
    // stages teach the same interface. multiplicity_tutorial introduces the two
    // model columns as Model 1 / Model 2, with nothing on screen claiming a
    // second stakeholder; multistakeholder_tutorial then re-runs that same
    // multi-optimal screen with the stakeholder framing switched on. A stage
    // resolves to the condition it runs on plus how that condition is framed.
    const TUTORIAL_STAGES = {
      single: { condition: "single" },
      multiplicity: { condition: "multioptimal", neutralModelNames: true },
      // What this session has been opening; same screen as multiplicity.
      multioptimal: { condition: "multioptimal", neutralModelNames: true },
      multistakeholder: { condition: "multioptimal" },
      // Aggregate builds on the stakeholder comparison and introduces just one
      // new control: the importance slider that combines their two models.
      aggregate: { condition: "aggregate" },
      // The final walkthrough stage keeps the stakeholder comparison on the
      // left and introduces the negotiation workspace on the right.
      negotiatev2: { condition: "negotiatev2" },
    };
    const activeTutorialStage = activeTutorialMode && TUTORIAL_STAGES[configuredStudyCondition]
      ? configuredStudyCondition
      : null;
    // A stage picks the condition; anything else keeps working the way it did,
    // so ?condition=<any condition>_tutorial still just annotates that condition.
    const requestedStudyCondition = activeTutorialStage
      ? TUTORIAL_STAGES[activeTutorialStage].condition
      : (STUDY_CONDITION_ALIASES[configuredStudyCondition] || configuredStudyCondition);
    const activeStudyCondition = STUDY_CONDITIONS.includes(requestedStudyCondition) ? requestedStudyCondition : DEFAULT_STUDY_CONDITION;
    document.body.classList.add(`condition-${activeStudyCondition}`);
    if (activeTutorialMode) document.body.classList.add("tutorial-mode");
    // aggregate IS multioptimal plus an importance slider, so it carries the
    // multioptimal class too and inherits that condition's styling wholesale
    // rather than keeping a parallel copy that can drift.
    if (activeStudyCondition === "aggregate") document.body.classList.add("condition-multioptimal");

    function studyCondition() {
      return activeStudyCondition;
    }

    function isTutorialMode() {
      return activeTutorialMode;
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

    // The walkthrough always runs on one hand-picked case per dataset, never on
    // ?case=, so every numbered callout describes the same screen. The case is
    // chosen for disagreement -- see scripts/export_tutorial_case.py -- and is
    // served from its own file rather than cases/<i>.json so re-exporting the
    // case tree cannot quietly move the tutorial onto a different case.
    const TUTORIAL_CASE_INDEX_BY_DATASET = { compas: 1120, acs_coverage: 1226 };
    function tutorialCaseIndex(dataset) {
      return TUTORIAL_CASE_INDEX_BY_DATASET[dataset ?? (activeData?.dataset || datasetSelect?.value)] ?? null;
    }

    function tutorialStage() {
      return activeTutorialStage;
    }

    // "My model" / "Other model" only mean something once the walkthrough has
    // introduced the second stakeholder, and the multiplicity stage runs before
    // it does. There the columns are Model 1 / Model 2, the other side's
    // criterion highlight is off (see renderFeatureExplanation) and no banner
    // names their role -- everything on that screen is about the two models
    // disagreeing, not about who stands behind them.
    function usesNeutralModelNames() {
      return Boolean(activeTutorialStage && TUTORIAL_STAGES[activeTutorialStage].neutralModelNames);
    }

    function modelRoleLabel(role, fallback) {
      if (!usesNeutralModelNames()) return fallback;
      return role === "self" ? "Model 1" : "Model 2";
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
      local_consistency: "Individual fairness"
    };
    // Used where the criterion column has to stay narrow (the multi-model
    // conditions sit beside the negotiation window). Always paired with the full
    // label on hover, so nothing is only ever shown abbreviated.
    const criteriaAbbrLabels = {
      accuracy: "Accuracy",
      tpr: "Catch High Risk",
      tnr: "Protect Low Risk",
      local_consistency: "Fairness"
    };
    const criteriaFullLabels = {
      accuracy: "Overall Accuracy / Correct Predictions Across All Test Cases",
      tpr: "Local True Positive Rate / Catch High-Risk Cases in the 30-neighbor local region",
      tnr: "Local True Negative Rate / Protect Innocents from False High-Risk Labels in the 30-neighbor local region",
      local_consistency: "Individual Fairness"
    };
    let datasetMeta = [];
    let activeData = null;
    // The participant's fixed assignment for this dataset: which cases they
    // see, and who the other stakeholder is on each. Null when no assignment
    // exists for their role, in which case the app browses the full case tree.
    // Built by eval/build_final_summative_study.py.
    let experimentIndex = null;
    let modelGlobalMetrics = null;
    let weights = { accuracy: 1/4, tpr: 1/4, tnr: 1/4, local_consistency: 1/4 };
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
    // Ordered highest-weight-first, derived from the selected role's defaults; the
    // app reads rankedCriteria[0] wherever it marks "the criterion you care
    // most about".
    let rankedCriteria = [];
    let elicitedWeights = null;
    let datasetCaseList = [];
    let finalDecision = null;
    let aggregateSelfShare = 0.5;
    // negotiatev2 model-space negotiation state; see negotiation-ui.js.
    // Both sides' weights live inside nv2.weights and stay fixed for the whole
    // negotiation — only the model each side stands behind moves.
    let nv2 = null;
    let negotiateV2Busy = false;      // true while a turn is mid-flight (Self offered, awaiting Other-party LLM)

    const SAME_CRITERIA_THRESHOLD = 0.02;
    const NEGOTIATION_STEP = 0.025;
    const OPENING_NEGOTIATION_STEP = 0.025;
    const MAX_COUNTER_MOVE = 0.06;
    const MIN_ROUNDS_BEFORE_RESULT_CONSENSUS = 2;
    // Case-stakes salience has one free sensitivity scalar `s` (alpha=beta=s);
    // the floor-risk term is fixed at gamma=1 because a hard-floor violation is
    // non-compensatory by definition. `s` used to be fitted from in-app
    // comparison questions; with elicitation moved off this page it stays at the
    // theory prior below.
    const SALIENCE_SCALAR_DEFAULT = 1.0;
    const SALIENCE_SCALAR_MIN = 0.2;
    const SALIENCE_SCALAR_MAX = 2.0;
    const HIGH_LEVERAGE_THRESHOLD = 0.08;
    const LOW_LEVERAGE_THRESHOLD = 0.035;
    const HIGH_SALIENCE_THRESHOLD = 0.035;
    const LOW_JOINT_SALIENCE_THRESHOLD = 0.035;
    const MAX_COUNTER_IMPACT = 0.008;
    const fmtPct = (value) => value == null ? "-" : `${(value * 100).toFixed(1)}%`;
    // Criterion performance is presented as an easy-to-scan whole percent in
    // every UI surface. Calculations still use the original unrounded values.
    const fmtPerformancePct = (value) => value == null || !Number.isFinite(Number(value))
      ? "-"
      : `${Math.round(Number(value) * 100)}%`;
    const fmtProb = (value) => value == null ? "-" : Number(value).toFixed(3);

    const degreeAdjustmentOptions = [
      { key: "decrease", label: "Decrease", shortLabel: "Dec", delta: -0.06, phrase: "decreases" },
      { key: "keep", label: "Keep same", shortLabel: "Same", delta: 0, phrase: "keeps" },
      { key: "slightly", label: "Slightly increase", shortLabel: "Slight", delta: 0.03, phrase: "slightly increases" },
      { key: "moderately", label: "Moderately increase", shortLabel: "Mod", delta: 0.06, phrase: "moderately increases" },
      { key: "strongly", label: "Strongly increase", shortLabel: "Strong", delta: 0.10, phrase: "strongly increases" }
    ];

    // Persona weights are intentionally face-valid and extreme: each role puts
    // 70% on its core criterion and 10% on each remaining criterion. This makes
    // Self/Other optima visibly different while preserving small side-payments
    // for joint-utility-improving compromise models. The same weights live in
    // eval/build_final_summative_study.py; regenerate Final_summative_study
    // whenever these change.
    const personaTypes = {
      judges: {
        key: "judges",
        label: "Judges",
        role: "Judges",
        rolePhrase: "judge",
        priority: "increasing overall Accuracy",
        metricLabel: "Accuracy",
        context: "Judges might want to prioritize overall accuracy when considering the design of a recidivism prediction system.",
        concern: "They are responsible for weighing evidence and may prefer a decision rule that is correct as often as possible across cases.",
        boundary: "Accuracy matters most for this role, while local error asymmetry and fairness should still be considered during deliberation.",
        positionExample: "I want the decision to follow the most accurate model group.",
        interests: [{ key: "accuracy", label: "Overall accuracy", rationale: "Judges need a decision process that is correct as often as possible across cases." }],
        weights: { accuracy: 70, tpr: 10, tnr: 10, local_consistency: 10 }
      },
      defendants: {
        key: "defendants",
        label: "Defendants",
        role: "Defendants",
        rolePhrase: "defendant",
        priority: "decreasing False Positive Rate (Specificity)",
        metricLabel: "False Positive Rate (Specificity)",
        context: "Defendants might want to prioritize decreasing False Positive Rate (Specificity) because they are worried about being falsely predicted as will offend again.",
        concern: "They are most concerned about being incorrectly assigned a high-risk label when they would not offend again.",
        boundary: "Local specificity and false-positive protection matter most for this role, while local sensitivity and fairness should still be discussed.",
        positionExample: "I do not want this person to be labeled high risk unless the evidence is reliable.",
        interests: [{ key: "tnr", label: "False-positive harm protection", rationale: "Defendants are harmed when a low-risk person is incorrectly labeled high risk." }],
        weights: { accuracy: 10, tpr: 10, tnr: 70, local_consistency: 10 }
      },
      community_members: {
        key: "community_members",
        label: "Community Members",
        role: "Community Members",
        rolePhrase: "community member",
        priority: "decreasing False Negative Rate (Sensitivity)",
        metricLabel: "False Negative Rate (Sensitivity)",
        context: "Community Members might prioritize correctly identifying people who are likely to reoffend because they are primarily concerned about community safety.",
        concern: "They are most concerned about missing people who may truly require intervention.",
        boundary: "Sensitivity and community safety matter most for this role, while false-positive harm and fairness should still be respected.",
        positionExample: "I want the decision process to avoid missing people who may require intervention.",
        interests: [{ key: "tpr", label: "False-negative harm protection", rationale: "Community members are harmed when a truly high-risk case is missed." }],
        weights: { accuracy: 10, tpr: 70, tnr: 10, local_consistency: 10 }
      },
      fairness_advocates: {
        key: "fairness_advocates",
        label: "Fairness Advocates",
        role: "Fairness Advocates",
        rolePhrase: "fairness advocate",
        priority: "increasing Individual Fairness",
        metricLabel: "Individual Fairness",
        context: "Fairness Advocates might want to prioritize individual fairness, meaning people with similar backgrounds and circumstances should receive similar predictions.",
        concern: "They are most concerned about inconsistent treatment of similar people.",
        boundary: "Individual fairness matters most for this role, while predictive performance and safety concerns should still be part of the negotiation.",
        positionExample: "I want the decision to avoid relying on models that treat similar people differently.",
        interests: [{ key: "local_consistency", label: "Consistent treatment of similar people", rationale: "Fairness advocates are concerned when people with similar backgrounds receive different predictions." }],
        weights: { accuracy: 10, tpr: 10, tnr: 10, local_consistency: 70 }
      }
    };
    const personaKeys = Object.keys(personaTypes);
    // The role a participant speaks from when the URL names no persona.
    const DEFAULT_PERSONA_KEY = "community_members";

    const LOCAL_SCOPE_SIZE = 30;
    const criteriaDescriptions = {
      accuracy: "How often the AI makes the correct prediction across all cases.",
      tpr: "Correctly identify people who are likely to re-offend.",
      tnr: "Protect low-risk people from being wrongly labeled as high risk.",
      local_consistency: "People with similar backgrounds and circumstances should receive similar predictions."
    };

    const personaRankDefaults = {
      judges: ["accuracy", "tpr", "tnr", "local_consistency"],
      defendants: ["tnr", "local_consistency", "accuracy", "tpr"],
      community_members: ["tpr", "local_consistency", "accuracy", "tnr"],
      fairness_advocates: ["local_consistency", "tnr", "accuracy", "tpr"]
    };

    // ---- Per-dataset study copy -------------------------------------------
    //
    // Only wording changes between datasets. The four persona *keys* and their
    // criterion weights stay fixed, so personaRankDefaults, saved participant
    // records and the negotiation engine all keep working untouched;
    // `judges` is the accuracy slot, `defendants` the TNR slot,
    // `community_members` the TPR slot, `fairness_advocates` the consistency slot.
    //
    // For acs_coverage the positive class is now framed as "should receive public coverage".
    // That makes the model output an allocation recommendation rather than a record
    // of existing coverage:
    //   TPR -- correctly recommending coverage for someone who should receive it,
    //          so this is the applicants' protection (the community slot).
    //   TNR -- correctly withholding coverage when it is not needed, so this is
    //          the budget office's protection (the defendants slot).
    const DATASET_COPY = {
      compas: {
        datasetLabel: "COMPAS",
        labelNames: ["Low Risk", "High Risk"],
        criteriaLabels: {
          accuracy: "Accuracy",
          tpr: "Catch High-Risk",
          tnr: "Protect Low-Risk",
          local_consistency: "Individual Fairness"
        },
        criteriaShortLabels: {
          accuracy: "Accuracy",
          tpr: "Local TPR",
          tnr: "Local TNR",
          local_consistency: "Individual fairness"
        },
        criteriaAbbrLabels: {
          accuracy: "Accuracy",
          tpr: "Catch High Risk",
          tnr: "Protect Low Risk",
          local_consistency: "Fairness"
        },
        criteriaFullLabels: {
          accuracy: "Overall Accuracy / Correct Predictions Across All Test Cases",
          tpr: "Local True Positive Rate / Catch High-Risk Cases in the 30-neighbor local region",
          tnr: "Local True Negative Rate / Protect Innocents from False High-Risk Labels in the 30-neighbor local region",
          local_consistency: "Individual Fairness"
        },
        criteriaDescriptions: {
          accuracy: "How often the AI makes the correct prediction across all cases.",
          tpr: "Correctly identify people who are likely to re-offend.",
          tnr: "Protect low-risk people from being wrongly labeled as high risk.",
          local_consistency: "People with similar backgrounds and circumstances should receive similar predictions."
        },
        personas: {
          judges: {
            label: "Judges",
            role: "Judges",
            rolePhrase: "judge",
            priority: "increasing overall Accuracy",
            metricLabel: "Accuracy",
            context: "Judges might want to prioritize overall accuracy when considering the design of a recidivism prediction system.",
            concern: "They are responsible for weighing evidence and may prefer a decision rule that is correct as often as possible across cases.",
            boundary: "Accuracy matters most for this role, while local error asymmetry and fairness should still be considered during deliberation.",
            positionExample: "I want the decision to follow the most accurate model group.",
            interests: [{ key: "accuracy", label: "Overall accuracy", rationale: "Judges need a decision process that is correct as often as possible across cases." }]
          },
          defendants: {
            label: "Defendants",
            role: "Defendants",
            rolePhrase: "defendant",
            priority: "decreasing False Positive Rate (Specificity)",
            metricLabel: "False Positive Rate (Specificity)",
            context: "Defendants might want to prioritize decreasing False Positive Rate (Specificity) because they are worried about being falsely predicted as will offend again.",
            concern: "They are most concerned about being incorrectly assigned a high-risk label when they would not offend again.",
            boundary: "Local specificity and false-positive protection matter most for this role, while local sensitivity and fairness should still be discussed.",
            positionExample: "I do not want this person to be labeled high risk unless the evidence is reliable.",
            interests: [{ key: "tnr", label: "False-positive harm protection", rationale: "Defendants are harmed when a low-risk person is incorrectly labeled high risk." }]
          },
          community_members: {
            label: "Community Members",
            role: "Community Members",
            rolePhrase: "community member",
            priority: "decreasing False Negative Rate (Sensitivity)",
            metricLabel: "False Negative Rate (Sensitivity)",
            context: "Community Members might prioritize correctly identifying people who are likely to reoffend because they are primarily concerned about community safety.",
            concern: "They are most concerned about missing people who may truly require intervention.",
            boundary: "Sensitivity and community safety matter most for this role, while false-positive harm and fairness should still be respected.",
            positionExample: "I want the decision process to avoid missing people who may require intervention.",
            interests: [{ key: "tpr", label: "False-negative harm protection", rationale: "Community members are harmed when a truly high-risk case is missed." }]
          },
          fairness_advocates: {
            label: "Fairness Advocates",
            role: "Fairness Advocates",
            rolePhrase: "fairness advocate",
            priority: "increasing Individual Fairness",
            metricLabel: "Individual Fairness",
            context: "Fairness Advocates might want to prioritize individual fairness, meaning people with similar backgrounds and circumstances should receive similar predictions.",
            concern: "They are most concerned about inconsistent treatment of similar people.",
            boundary: "Individual fairness matters most for this role, while predictive performance and safety concerns should still be part of the negotiation.",
            positionExample: "I want the decision to avoid relying on models that treat similar people differently.",
            interests: [{ key: "local_consistency", label: "Consistent treatment of similar people", rationale: "Fairness advocates are concerned when people with similar backgrounds receive different predictions." }]
          }
        }
      },
      acs_coverage: {
        datasetLabel: "Welfare Allocation",
        labelNames: ["No Need Cover", "Should Cover"],
        criteriaLabels: {
          accuracy: "Accuracy",
          tpr: "Cover Need",
          tnr: "Avoid Extra",
          local_consistency: "Individual Fairness"
        },
        criteriaShortLabels: {
          accuracy: "Accuracy",
          tpr: "Local TPR",
          tnr: "Local TNR",
          local_consistency: "Individual fairness"
        },
        criteriaAbbrLabels: {
          accuracy: "Accuracy",
          tpr: "Cover Need",
          tnr: "Avoid Extra",
          local_consistency: "Fairness"
        },
        criteriaFullLabels: {
          accuracy: "Overall Accuracy / Correct Predictions Across All Test Cases",
          tpr: "Local True Positive Rate / Correctly Recommend Should Cover, in the 30-neighbor local region",
          tnr: "Local True Negative Rate / Correctly Recommend No Need Cover, in the 30-neighbor local region",
          local_consistency: "Individual Fairness"
        },
        criteriaDescriptions: {
          accuracy: "How often the AI makes the correct prediction across all cases.",
          tpr: "Correctly recommend public coverage for people who should receive it.",
          tnr: "Avoid assigning public coverage to people who do not need it.",
          local_consistency: "People with similar backgrounds and circumstances should receive similar predictions."
        },
        personas: {
          judges: {
            label: "Program Administrators",
            role: "Program Administrators",
            rolePhrase: "program administrator",
            priority: "increasing overall Accuracy",
            metricLabel: "Accuracy",
            context: "Program Administrators might want to prioritize overall accuracy when considering the design of a public coverage allocation system.",
            concern: "They are accountable for the program as a whole and may prefer a decision rule that is correct as often as possible across applicants.",
            boundary: "Accuracy matters most for this role, while local error asymmetry and fairness should still be considered during deliberation.",
            positionExample: "I want the decision to follow the most accurate model group.",
            interests: [{ key: "accuracy", label: "Overall accuracy", rationale: "Administrators need an allocation process that is correct as often as possible across applicants." }]
          },
          defendants: {
            label: "Public Budget Office",
            role: "Public Budget Office",
            rolePhrase: "budget officer",
            priority: "avoiding unnecessary coverage allocations",
            metricLabel: "Avoid Unneeded Coverage",
            context: "The Public Budget Office might want to prioritize avoiding unnecessary public coverage allocations because it is responsible for preserving limited program funds for people who need them.",
            concern: "They are most concerned about assigning coverage to someone who does not need public coverage, so limited funds are spent where they are not needed.",
            boundary: "Avoiding unneeded coverage matters most for this role, while coverage access and fairness should still be discussed.",
            positionExample: "I do not want public coverage assigned unless this person should receive it.",
            interests: [{ key: "tnr", label: "Avoid unneeded coverage", rationale: "The budget office is harmed when limited coverage funds are assigned to someone who does not need them." }]
          },
          community_members: {
            label: "Applicants",
            role: "Applicants",
            rolePhrase: "applicant",
            priority: "avoiding missed coverage for people who should receive it",
            metricLabel: "Cover Those in Need",
            context: "Applicants might want to prioritize correctly recommending public coverage for people who should receive it because they are worried about being passed over for assistance.",
            concern: "They are most concerned about someone who should receive public coverage being marked as no need cover.",
            boundary: "Coverage access matters most for this role, while avoiding unneeded allocations and fairness should still be discussed.",
            positionExample: "I want this person covered if they should receive public coverage.",
            interests: [{ key: "tpr", label: "Coverage access for people in need", rationale: "Applicants are harmed when someone who should receive public coverage is marked no need cover." }]
          },
          fairness_advocates: {
            label: "Fairness Advocates",
            role: "Fairness Advocates",
            rolePhrase: "fairness advocate",
            priority: "increasing Individual Fairness",
            metricLabel: "Individual Fairness",
            context: "Fairness Advocates might want to prioritize individual fairness, meaning people with similar backgrounds and circumstances should receive similar predictions.",
            concern: "They are most concerned about inconsistent treatment of similar applicants.",
            boundary: "Individual fairness matters most for this role, while predictive performance and budget concerns should still be part of the negotiation.",
            positionExample: "I want the decision to avoid relying on models that treat similar people differently.",
            interests: [{ key: "local_consistency", label: "Consistent treatment of similar people", rationale: "Fairness advocates are concerned when people with similar backgrounds receive different predictions." }]
          }
        }
      }
    };

    let activeDatasetCopyKey = null;

    // Overwrite the shared copy objects in place. Called before any render once
    // the dataset is known; falls back to the COMPAS wording for a dataset with
    // no entry, so adding data for a new dataset never leaves the UI blank.
    function applyDatasetCopy(dataset) {
      const copy = DATASET_COPY[dataset] || DATASET_COPY.compas;
      activeDatasetCopyKey = DATASET_COPY[dataset] ? dataset : "compas";
      Object.assign(criteriaLabels, copy.criteriaLabels);
      Object.assign(criteriaShortLabels, copy.criteriaShortLabels);
      Object.assign(criteriaAbbrLabels, copy.criteriaAbbrLabels);
      Object.assign(criteriaFullLabels, copy.criteriaFullLabels);
      Object.assign(criteriaDescriptions, copy.criteriaDescriptions);
      Object.entries(copy.personas).forEach(([key, persona]) => {
        if (personaTypes[key]) Object.assign(personaTypes[key], persona);
      });
      return activeDatasetCopyKey;
    }

    function applyDatasetFramingToCaseData(dataset, caseData) {
      const labelNames = DATASET_COPY[dataset]?.labelNames;
      if (!caseData || !labelNames) return caseData;
      const labelFor = (classId, fallback = null) => {
        const index = Number(classId);
        return Number.isFinite(index) && labelNames[index] ? labelNames[index] : fallback;
      };
      caseData.label_names = labelNames.slice();
      if (DATASET_COPY[dataset]?.datasetLabel) caseData.dataset_label = DATASET_COPY[dataset].datasetLabel;
      const relabelByClass = (item) => {
        if (!item || item.class_id == null) return;
        const label = labelFor(item.class_id, item.label);
        if (label) item.label = label;
      };
      (caseData.summary || []).forEach(relabelByClass);
      (caseData.reconciliation?.groups || []).forEach(relabelByClass);
      Object.entries(caseData.shap_patterns?.by_class || {}).forEach(([classId, pattern]) => {
        const label = labelFor(classId, pattern?.label);
        if (pattern && label) pattern.label = label;
      });
      return caseData;
    }

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
