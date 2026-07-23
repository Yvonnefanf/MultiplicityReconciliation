/* main.js — dataset/case loading, loadDistribution, event bindings and bootstrap
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    async function loadDatasets() {
      datasetMeta = await fetchJson("/api/datasets");
      datasetSelect.innerHTML = datasetMeta.map((d) => `<option value="${d.key}">${d.label}</option>`).join("");
      const requestedDataset = getUrlParams().get("dataset");
      datasetSelect.value = datasetMeta.some((d) => d.key === requestedDataset) ? requestedDataset : "compas";
      replaceUrlParams({ dataset: datasetSelect.value });
      await loadCases();
    }

    async function loadCases() {
      const dataset = datasetSelect.value;
      setLoading("Loading cases...");
      const cases = await fetchJson(`/api/${dataset}/cases`);
      modelGlobalMetrics = await fetchJson(`/api/${dataset}/model-global-metrics`).catch(() => null);
      datasetCaseList = cases;
      caseSelect.innerHTML = cases.map((c) => {
        const flag = c.high_disagreement ? " • disagreement" : "";
        return `<option value="${c.test_case_index}">Case ${c.test_case_index}${flag}</option>`;
      }).join("");
      const requestedCase = getUrlParams().get("case");
      if (requestedCase && Array.from(caseSelect.options).some((option) => option.value === requestedCase)) {
        caseSelect.value = requestedCase;
      }
      replaceUrlParams({ dataset, case: caseSelect.value });
      const meta = datasetMeta.find((d) => d.key === dataset);
      datasetHint.textContent = `${meta.label}: ${meta.case_count} test cases, ${meta.model_count} selected models`;
      await loadDistribution();
    }

    async function prepareCalibrationCaseData() {
      calibrationCaseData = [];
    }

    function exposureHighlightOptions() {
      const userKey = rankedCriteria[0] || criteriaOrder[0];
      return { highlight: { userKey } };
    }

    function ensureDifferentProxyPersona() {
      if (!proxyPersona || (currentPersona?.key && proxyPersona?.key === currentPersona.key)) {
        proxyPersona = makeProxyPersonaPreference(currentPersona?.key);
      }
      return proxyPersona;
    }

    function informedExposureOptions() {
      ensureDifferentProxyPersona();
      const userKey = rankedCriteria[0] || criteriaOrder[0];
      const otherKey = topMetricKeyForWeights(proxyPersona?.weights || {});
      return {
        highlight: { userKey, otherKey },
      };
    }

    function negotiationExposureOptions() {
      return {
        ...informedExposureOptions(),
        showNegotiationWeights: true,
        userWeights,
        proxyWeights: proxyWeights || proxyIdealWeights(),
      };
    }


    function modelWithGlobalMetrics(model) {
      if (!model) return model;
      const globalRow = (modelGlobalMetrics?.models || []).find((item) => String(item.seed) === String(model.seed));
      return globalRow ? { ...model, ...globalRow, seed: model.seed, label: model.label } : model;
    }

    function renderFeatureExplanation(dataset, selectedModel) {
      if (isSingleCondition()) {
        const displayModel = isSingleOptimalCondition() ? selectedSingleOptimalModel(userWeights) : selectedModel;
        const singleOptions = isSingleOptimalCondition()
          ? {
              mode: "singleOptimal",
              baselineModels: activeData.models || [],
              baselineLabel: "all models subgroup/local average",
              modelLabel: "Optimal Model",
              helpText: '<span class="better">Green</span> bars mean the selected model\'s subgroup/local score is higher than the average subgroup/local score across all candidate models for this case; <span class="worse">red</span> bars mean it is lower. The number after each bar is selected subgroup/local score minus all-model subgroup/local average. Hover for exact values. Full bar = 100%.',
              useModelMetricFallback: false,
            }
          : {};
        return renderSingleCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, modelWithGlobalMetrics(displayModel), activeData.summary, singleOptions);
      }
      if (isMultiOptimalCondition()) {
        ensureDifferentProxyPersona();
        const selectedItems = isNegotiateV2Condition()
          ? negotiateV2SelectedItems()
          : (() => {
              const otherWeights = proxyWeights || proxyPersona?.weights || proxyIdealWeights();
              return [
                { role: "self", roleLabel: "Self optimal", model: selectedSingleOptimalModel(userWeights) },
                { role: "other", roleLabel: "Other-party optimal", model: selectedSingleOptimalModel(otherWeights) },
              ];
            })();
        return renderMultiOptimalCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.models, selectedItems);
      }
      if (studyCondition() === "exposure") {
        return renderExposureCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.summary, activeData.models, activeData.reconciliation.groups, exposureHighlightOptions());
      }
      if (studyCondition() === "informed") {
        return renderExposureCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.summary, activeData.models, activeData.reconciliation.groups, informedExposureOptions());
      }
      if (studyCondition() === "negotiation") {
        return renderExposureCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.summary, activeData.models, activeData.reconciliation.groups, negotiationExposureOptions());
      }
      return renderCaseFeaturePatterns(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.summary);
    }

    async function loadDistribution({ preservePreference = false, forceReconcile = false } = {}) {
      const dataset = datasetSelect.value;
      const caseIndex = caseSelect.value;
      if (caseIndex === "") return;
      setLoading("Loading model predictions...");
      activeData = await fetchJson(`/api/${dataset}/cases/${caseIndex}`);
      resetFinalDecision();
      currentPersona = null;
      proxyPersona = null;
      personaInitialWeights = null;
      proxyWeights = normalizeWeights(activeData.reconciliation.proxy_weights);
      initializePersonaPreference({ newPersona: true, announce: false, preserveElicitation: preservePreference });
      offerSource = "Elicited initial offer";
      replaceUrlParams({ dataset, case: caseIndex });
      const selectedModel = selectedDefaultModel();
      features.innerHTML = renderFeatureExplanation(dataset, selectedModel);

      if (modelRows) {
        modelRows.innerHTML = activeData.models.map((row) => {
          const label = activeData.label_names[row.pred_class] || `Class ${row.pred_class}`;
          return `
            <tr>
              <td>${row.label}</td>
              <td><span class="badge class-${row.pred_class}">${label}</span></td>
              <td>${fmtProb(row.pred_prob)}</td>
              <td>${fmtPct(row.local_consistency)}</td>
              <td>${fmtPct(row.counterfactual_fairness)}</td>
              <td>${fmtPct(row.race_counterfactual_fairness)}</td>
              <td>${fmtPct(row.gender_counterfactual_fairness)}</td>
              <td>${fmtPct(row.sensitive_counterfactual_fairness)}</td>
              <td>${fmtPct(row.tpr)}</td>
              <td>${fmtPct(row.tnr)}</td>
            </tr>
          `;
        }).join("");
      }

      const requestedStage = forceReconcile ? "reconcile" : stageFromUrl();
      if (requestedStage === "reconcile" && answeredPairCount() === pairwiseAnswers.length) {
        startReconciliationFromElicitation();
      } else if (requestedStage === "preference") {
        showStage("preference");
      } else {
        showStage("persona");
      }
    }

    if (personaConsentCheckbox && personaNextButton) {
      personaConsentCheckbox.addEventListener("change", () => {
        personaNextButton.disabled = !personaConsentCheckbox.checked;
        saveElicitationState();
      });
    }
    if (personaNextButton) {
      personaNextButton.addEventListener("click", () => showStage("preference"));
    }
    if (preferenceBackButton) {
      preferenceBackButton.addEventListener("click", () => {
        if (pairwiseIndex < 0) {
          showStage("persona");
        } else {
          pairwiseIndex -= 1;
          saveElicitationState();
          renderPreferenceElicitation();
        }
      });
    }
    if (pairwiseNextButton) {
      pairwiseNextButton.addEventListener("click", () => {
        if (pairwiseIndex < 0) {
          pairwiseIndex = 0;
        } else if (pairwiseIndex >= pairwiseAnswers.length) {
          pairwiseIndex = 0;
        } else if (pairwiseAnswers[pairwiseIndex] !== null) {
          pairwiseIndex += 1;
        }
        saveElicitationState();
        renderPreferenceElicitation();
      });
    }
    if (startReconciliationButton) {
      startReconciliationButton.addEventListener("click", () => {
        if (pairwiseIndex < 0) {
          pairwiseIndex = 0;
          renderPreferenceElicitation();
        } else if (pairwiseIndex >= pairwiseAnswers.length) {
          startReconciliationFromElicitation();
        }
      });
    }
    if (datasetSelect) {
      datasetSelect.addEventListener("change", () => {
        replaceUrlParams({ dataset: datasetSelect.value, case: null, stage: "1" });
        loadCases();
      });
    }
    if (caseSelect) {
      caseSelect.addEventListener("change", () => {
        const preservePreference = hasCompleteElicitedPreference();
        replaceUrlParams({ dataset: datasetSelect.value, case: caseSelect.value, stage: preservePreference ? "3" : "1" });
        loadDistribution({ preservePreference, forceReconcile: preservePreference });
      });
    }
    if (nextCaseButton) {
      nextCaseButton.addEventListener("click", () => {
        if (finalDecision == null || !caseSelect || !caseSelect.options.length) return;
        const nextIndex = (caseSelect.selectedIndex + 1) % caseSelect.options.length;
        caseSelect.selectedIndex = nextIndex;
        caseSelect.dispatchEvent(new Event("change"));
      });
    }

    if (toggleDetailsButton) {
      toggleDetailsButton.addEventListener("click", (event) => {
        event.preventDefault();
      });
    }

    loadDatasets().catch((error) => {
      datasetHint.textContent = `Error: ${error.message}`;
      setLoading("Failed to load data.");
      console.error(error);
    });
