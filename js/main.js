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

    // The criterion the other stakeholder cares most about. Every
    // multi-stakeholder condition highlights this one, and the reconcile banner
    // names it in prose, so both read it from here rather than deriving it
    // separately and risking two different answers on screen at once.
    function otherStakeholderTopCriterion() {
      const other = proxyPersona || ensureDifferentProxyPersona();
      return window.primaryCriterionKeyForPersona?.(other)
        || topMetricKeyForWeights(other?.weights || proxyWeights || {});
    }

    function informedExposureOptions() {
      ensureDifferentProxyPersona();
      const userKey = rankedCriteria[0] || criteriaOrder[0];
      return {
        highlight: { userKey, otherKey: otherStakeholderTopCriterion() },
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
              helpText: 'Each number is the selected model\'s subgroup/local score on that criterion, as a percentage (100% is perfect). Hover any number for the average subgroup/local score across all candidate models and how far this model sits from it.',
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
                { role: "self", roleLabel: "My model", model: selectedSingleOptimalModel(userWeights) },
                { role: "other", roleLabel: "Other model", model: selectedSingleOptimalModel(otherWeights) },
              ];
            })();
        // multioptimal, aggregate and negotiatev2 all put a second stakeholder
        // on screen, so they get the same "what the other side cares about"
        // highlight that informed has, plus the participant's own top criterion
        // so both sides' markers are readable side by side.
        const multiHighlight = {
          highlight: {
            userKey: rankedCriteria[0] || criteriaOrder[0],
            otherKey: otherStakeholderTopCriterion(),
          },
        };
        const multiOptions = isNegotiateV2Condition()
          ? { ...multiHighlight, versionTag: true, versionsByRole: negotiateV2VersionsByRole(), versionIndexByRole: negotiateV2VersionIndexByRole() }
          : multiHighlight;
        return renderMultiOptimalCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, activeData.models, selectedItems, multiOptions);
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
    function renderConditionSwitcher() {
      if (!conditionSelect) return;
      const optionHtml = (option) =>
        `<option value="${escapeHtml(option.key)}" ${option.key === activeStudyCondition ? "selected" : ""}>${escapeHtml(option.label)}</option>`;
      const groups = STUDY_CONDITION_GROUPS.map((group) =>
        `<optgroup label="${escapeHtml(group.label)}">${group.options.map(optionHtml).join("")}</optgroup>`
      );
      // A condition reached by URL but not offered here still has to be shown,
      // otherwise the switcher would silently mislabel the page it is on.
      if (!STUDY_CONDITION_OPTIONS.some((option) => option.key === activeStudyCondition)) {
        groups.push(`<optgroup label="Legacy">${optionHtml({ key: activeStudyCondition, label: `${activeStudyCondition} (legacy)` })}</optgroup>`);
      }
      conditionSelect.innerHTML = groups.join("");
      conditionSelect.addEventListener("change", () => {
        if (conditionSelect.value === activeStudyCondition) return;
        // The condition is read once at load: it sets a body class, the proxy
        // persona, the composer and the per-condition state. Re-rendering in
        // place would leave half of that stale, so switch by reloading.
        // Keep stage, dataset, case and persona. The elicitation is stored in
        // sessionStorage under a key that has no condition in it, so it
        // survives the reload and stage 3 lands back on reconcile.
        const params = new URLSearchParams(window.location.search);
        params.set("condition", conditionSelect.value);
        window.location.search = params.toString();
      });
    }
    renderConditionSwitcher();

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

    if (features) {
      features.addEventListener("change", (event) => {
        const versionSelect = event.target.closest && event.target.closest(".negotiate-v2-model-version-select");
        if (versionSelect && isNegotiateV2Condition()) {
          applyNegotiateV2Version(versionSelect.dataset.role, versionSelect.value);
        }
      });
    }

    loadDatasets().catch((error) => {
      datasetHint.textContent = `Error: ${error.message}`;
      setLoading("Failed to load data.");
      console.error(error);
    });
