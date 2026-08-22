/* main.js — dataset/case loading, loadDistribution, event bindings and bootstrap
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    async function loadDatasets() {
      datasetMeta = await fetchJson("/api/datasets");
      datasetSelect.innerHTML = datasetMeta.map((d) => `<option value="${d.key}">${d.label}</option>`).join("");
      const requestedDataset = datasetFromUrl();
      datasetSelect.value = datasetMeta.some((d) => d.key === requestedDataset) ? requestedDataset : defaultDataset();
      // ?dataset= and ?stage= are the old spellings of this app's entry point;
      // drop them so the URL a participant carries is the one the study platform
      // hands out.
      replaceUrlParams({ appId: appIdForDataset(datasetSelect.value), dataset: null, stage: null });
      await loadCases();
    }

    // The role folder is addressed by the participant's persona key, which the
    // study platform hands over as ?persona=. A missing folder is not fatal --
    // the app falls back to the full case tree -- but it does mean the session
    // is no longer the fixed assignment, so it is worth being loud about.
    async function loadExperimentIndex(dataset) {
      if (isTutorialMode()) return null;
      const role = ensurePersonaKey();
      const index = await fetchJson(`/api/${dataset}/exp/${role}`).catch(() => null);
      if (!index?.cases?.length) {
        console.warn(`No assignment at Final_summative_study/${dataset}/${role}/ -- falling back to the full case tree.`);
        return null;
      }
      return index;
    }

    async function loadCases() {
      const dataset = datasetSelect.value;
      // Criterion labels and persona copy are dataset-specific; swap them in
      // before anything renders so no panel shows another dataset's wording.
      applyDatasetCopy(dataset);
      setLoading("Loading cases...");
      modelGlobalMetrics = await fetchJson(`/api/${dataset}/model-global-metrics`).catch(() => null);
      // The study runs off the fixed assignment: the participant's role picks
      // the folder, ?case= is the role-local case id within it, and the case list is that
      // folder's index. Only a link with no usable role falls back to browsing
      // the full case tree.
      experimentIndex = await loadExperimentIndex(dataset);
      const cases = experimentIndex ? experimentIndex.cases : await fetchJson(`/api/${dataset}/cases`);
      datasetCaseList = cases;
      caseSelect.innerHTML = experimentIndex
        ? cases.map((c) => `<option value="${c.case_id}">Case ${c.case_id + 1} of ${cases.length}</option>`).join("")
        : cases.map((c) => {
            const flag = c.high_disagreement ? " • disagreement" : "";
            return `<option value="${c.test_case_index}">Case ${c.test_case_index}${flag}</option>`;
          }).join("");
      const requestedCase = isTutorialMode() ? String(tutorialCaseIndex(dataset) ?? "") : getUrlParams().get("case");
      if (requestedCase && Array.from(caseSelect.options).some((option) => option.value === requestedCase)) {
        caseSelect.value = requestedCase;
      }
      // Nothing else should be able to move the walkthrough off its case.
      caseSelect.disabled = isTutorialMode();
      replaceUrlParams({ appId: appIdForDataset(dataset), case: caseSelect.value });
      const meta = datasetMeta.find((d) => d.key === dataset);
      datasetHint.textContent = experimentIndex
        ? `${meta.label}: ${cases.length} assigned cases for ${personaTypes[experimentIndex.user_role]?.label || experimentIndex.user_role}, ${meta.model_count} selected models`
        : `${meta.label}: ${meta.case_count} test cases, ${meta.model_count} selected models`;
      await loadDistribution();
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
    // The "O" marker on the criteria table, the identity banner and the
    // negotiation all have to point at one criterion. The live weights are what
    // the negotiation actually argues from, so they decide; the persona's
    // declared interest is only the fallback for a persona without weights.
    function otherStakeholderTopCriterion() {
      const other = proxyPersona || ensureDifferentProxyPersona();
      const running = [proxyWeights, other?.weights].find((row) => row && criteriaOrder.some((key) => Number(row[key]) > 0));
      return running
        ? topMetricKeyForWeights(running)
        : window.primaryCriterionKeyForPersona?.(other) || criteriaOrder[0];
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
        // No second stakeholder here, so only the participant's own top
        // criterion is marked -- same highlight the other conditions use.
        const singleHighlight = { highlight: { userKey: rankedCriteria[0] || criteriaOrder[0] } };
        const singleOptions = isSingleOptimalCondition()
          ? {
              ...singleHighlight,
              mode: "singleOptimal",
              baselineModels: activeData.models || [],
              baselineLabel: "all models subgroup/local average",
              modelLabel: "Optimal Model",
              helpText: 'Each number is the selected model\'s subgroup/local score on that criterion, as a percentage (100% is perfect). Hover any number for the average subgroup/local score across all candidate models and how far this model sits from it.',
              useModelMetricFallback: false,
            }
          : singleHighlight;
        return renderSingleCaseFeaturePattern(dataset, activeData.case.features, activeData.shap_patterns, activeData.label_names, modelWithGlobalMetrics(displayModel), activeData.summary, singleOptions);
      }
      if (isMultiOptimalCondition()) {
        ensureDifferentProxyPersona();
        const selectedItems = isNegotiateV2Condition()
          ? negotiateV2SelectedItems()
          : (() => {
              const pair = multiOptimalModelPair();
              return [
                { role: "self", roleLabel: modelRoleLabel("self", "My model"), model: pair.self },
                { role: "other", roleLabel: modelRoleLabel("other", "Other model"), model: pair.other },
              ];
            })();
        // multioptimal, aggregate and negotiatev2 all put a second stakeholder
        // on screen, so they get the same "what the other side cares about"
        // highlight that informed has, plus the participant's own top criterion
        // so both sides' markers are readable side by side. The multiplicity
        // stage shows this screen before the other stakeholder exists, so it
        // keeps only the participant's own marker -- see usesNeutralModelNames().
        const multiHighlight = {
          highlight: {
            userKey: rankedCriteria[0] || criteriaOrder[0],
            otherKey: usesNeutralModelNames() ? null : otherStakeholderTopCriterion(),
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

    async function loadDistribution() {
      const dataset = datasetSelect.value;
      const caseIndex = caseSelect.value;
      if (caseIndex === "") return;
      setLoading("Loading model predictions...");
      // Three sources, same shape downstream: a walkthrough's pinned case, the
      // study assignment addressed by (role, case id), or -- only when there is
      // no assignment for this role -- the raw case tree. Aggregate has its own
      // tutorial pick because the shared tutorial case flips only at an extreme
      // slider value; other walkthrough stages keep using the exported case.
      activeData = isTutorialMode()
        ? await fetchJson(tutorialStage() === "aggregate"
          ? `/api/${dataset}/cases/${tutorialCaseIndex(dataset)}`
          : `/api/${dataset}/tutorial-case`)
        : experimentIndex
          ? await fetchJson(`/api/${dataset}/exp/${experimentIndex.user_role}/${caseIndex}`)
          : await fetchJson(`/api/${dataset}/cases/${caseIndex}`);
      applyDatasetFramingToCaseData(dataset, activeData);
      resetFinalDecision();
      currentPersona = null;
      proxyPersona = null;
      releaseOtherPersonaPinOnScopeChange(`${dataset}:${caseIndex}`);
      personaInitialWeights = null;
      // The other side's weights are their role's fixed profile, stored with the
      // case. reconciliation.proxy_weights is per-case data and would otherwise
      // hand the opponent a different preference on every case, which is exactly
      // the variation the fixed assignment exists to remove.
      proxyWeights = normalizeWeights(activeData.assignment?.other_weights || activeData.reconciliation.proxy_weights);
      initializePersonaPreference();
      offerSource = "Elicited initial offer";
      // ?other= is dead once the case carries its own opponent; leaving it in the
      // URL would suggest it still decides something.
      replaceUrlParams({
        appId: appIdForDataset(dataset),
        case: caseIndex,
        ...(activeData.assignment ? { other: null } : {}),
      });
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
              <td>${fmtPerformancePct(row.local_consistency)}</td>
              <td>${fmtPerformancePct(row.race_counterfactual_fairness)}</td>
              <td>${fmtPerformancePct(row.gender_counterfactual_fairness)}</td>
              <td>${fmtPerformancePct(row.sensitive_counterfactual_fairness)}</td>
              <td>${fmtPerformancePct(row.tpr)}</td>
              <td>${fmtPerformancePct(row.tnr)}</td>
            </tr>
          `;
        }).join("");
      }

      startReconciliation();
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
        // Every other parameter is kept, so the reload lands on the same app,
        // case, persona and incoming weights.
        const params = new URLSearchParams(window.location.search);
        params.set("condition", isTutorialMode() ? `${conditionSelect.value}_tutorial` : conditionSelect.value);
        window.location.search = params.toString();
      });
    }
    renderConditionSwitcher();

    if (datasetSelect) {
      datasetSelect.addEventListener("change", () => {
        replaceUrlParams({ appId: appIdForDataset(datasetSelect.value), case: null });
        loadCases();
      });
    }
    if (caseSelect) {
      caseSelect.addEventListener("change", () => {
        replaceUrlParams({ appId: appIdForDataset(datasetSelect.value), case: caseSelect.value });
        loadDistribution();
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
