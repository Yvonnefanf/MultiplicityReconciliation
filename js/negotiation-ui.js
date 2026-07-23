/* negotiation-ui.js — stage flow, composer, opening/response acts, offer-control rendering
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function showStage(stage, { syncUrl = true } = {}) {
      activeStage = stage;
      if (syncUrl) replaceUrlParams({ stage: stageToUrlValue(stage) });
      saveElicitationState();
      wizardPanel.classList.toggle("hidden", stage === "reconcile");
      wizardPanel.classList.toggle("persona-mode", stage === "persona");
      wizardPanel.classList.toggle("elicitation-mode", stage === "preference");
      reconciliationGrid.classList.toggle("hidden", stage !== "reconcile");
      topToolbar.classList.add("hidden");
      document.body.classList.toggle("reconcile-mode", stage === "reconcile");
      personaStage.classList.toggle("hidden", stage !== "persona");
      preferenceStage.classList.toggle("hidden", stage !== "preference");
      if (stage === "persona") {
        wizardKicker.textContent = "Stage 1 of 3";
        wizardTitle.textContent = "Read the stakeholder persona";
        wizardSubtitle.textContent = "Read the study scenario and step into the stakeholder persona. The next page will ask concrete preference questions before reconciliation begins.";
        wizardProgress.textContent = "Persona";
      } else if (stage === "preference") {
        wizardKicker.textContent = "Stage 2 of 3";
        wizardTitle.textContent = "Compare criteria importance";
        wizardSubtitle.textContent = "Rank criteria, then compare adjacent pairs to set your priority baseline before reconciliation begins.";
        wizardProgress.textContent = "Pairwise elicitation";
        renderPreferenceElicitation();
      }
    }

    function startReconciliationFromElicitation() {
      if (!activeData) return;
      updateElicitedWeights();
      if (answeredPairCount() < pairwiseAnswers.length) return;
      stakeholderSalienceParams = defaultSalienceParams();
      calibrationFitted = false;
      elicitedFloor = null;
      applySalienceParamsToCurrentPersona();
      if (studyCondition() === "informed") {
        proxyPersona = makeProxyPersonaPreference(currentPersona?.key);
        if (currentPersona?.key && proxyPersona?.key === currentPersona.key) {
          proxyPersona = makeProxyPersonaPreference(currentPersona.key);
        }
        proxyWeights = normalizeWeights(proxyPersona.weights || weights);
      } else if (showsProxyWeights()) {
        ensureConflictingProxyPersona(elicitedWeights);
      } else {
        proxyPersona = null;
        proxyWeights = normalizeWeights(activeData.reconciliation.proxy_weights || weights);
      }
      if (showsNegotiationPanel()) {
        resetNegotiationState("Start from your elicited preference. Choose an opening negotiation move, then send your first package offer.");
      } else {
        negotiationEvents = [];
        pendingProxyCounter = null;
        pendingProxyResponse = null;
        composerLocked = true;
        composerNote = "";
      }
      if (isNegotiateV2Condition()) {
        userWeights = normalizeWeights(elicitedWeights || userWeights || weights);
        weights = { ...userWeights };
        proxyWeights = normalizeWeights(proxyWeights || proxyIdealWeights());
        resetNegotiateV2State();
      }
      if (features) {
        features.innerHTML = renderFeatureExplanation(activeData.dataset || datasetSelect.value, selectedDefaultModel());
      }
      showStage("reconcile");
      if (isNegotiateV2Condition()) {
        composerLocked = false;
        composerNote = "Select criteria each side can sacrifice, then generate the next acceptable model version.";
        renderOfferControls();
        renderSummary();
        renderReconciliation();
        renderFinalDecisionOptions();
      } else {
        beginUserOpeningOffer(elicitedWeights, "Elicited preference baseline");
      }
      renderPersonaCard();
      /* addHistory(
        "system",
        "Persona read",
        `${escapeHtml(personaTitle(currentPersona))} frames Self's decision concerns.`,
        null
      );
      
      addHistory(
        "system",
        "Preference elicited",
        "The answers from Stage 2 are translated into Self's baseline criteria weights for reconciliation.",
        elicitedWeights
      );
      addHistory(
        "system",
        "Other-party stakeholder assigned",
        `The Other-party represents ${escapeHtml(personaTitle(proxyPersona))}, a different stakeholder position from Self.`,
        proxyIdealWeights()
      );*/
    }

    function initializePersonaPreference({ newPersona = true, announce = false, preserveElicitation = false } = {}) {
      if (!activeData) return;
      const savedPreference = preserveElicitation && elicitedWeights ? {
        rankedCriteria: [...rankedCriteria],
        pairwiseAnswers: [...pairwiseAnswers],
        pairwiseIndex,
        elicitedWeights: { ...elicitedWeights },

      } : null;
      currentPersona = makePersonaPreference();
      stakeholderSalienceParams = defaultSalienceParams();
      calibrationFitted = false;
      elicitedFloor = null;
      currentPersona.salienceParams = currentSalienceParams();
      applySalienceParamsToCurrentPersona();
      proxyPersona = makeProxyPersonaPreference(currentPersona.key);
      personaInitialWeights = normalizeWeights(currentPersona.weights);
      resetPairwiseState();
      resetNegotiationState("Complete ranking and adjacent comparisons to start reconciliation.");
      resetPersonaConsent();
      if (savedPreference) {
        rankedCriteria = savedPreference.rankedCriteria;
        pairwiseAnswers = savedPreference.pairwiseAnswers;
        pairwiseIndex = savedPreference.pairwiseIndex;
        elicitedWeights = savedPreference.elicitedWeights;
        calibrationOrder = [];
        calibrationAnswers = [];
        calibrationIndex = 0;
        stakeholderSalienceParams = defaultSalienceParams();
        calibrationFitted = false;
        elicitedFloor = null;
        applySalienceParamsToCurrentPersona();
        if (personaConsentCheckbox && personaNextButton) {
          personaConsentCheckbox.checked = true;
          personaNextButton.disabled = false;
        }
      } else {
        restoreElicitationState();
      }
      setWeights(elicitedWeights, "Elicited initial offer");
      renderPersonaCard();
      if (activeStage === "preference") renderPreferenceElicitation();
      if (announce) showStage("persona");
    }

    function addHistory(role, title, text, eventWeights = weights, extra = {}) {
      negotiationEvents.push({ role, title, text, weights: eventWeights ? { ...eventWeights } : null, ...extra });
      renderHistory();
    }

    function scrollHistoryToBottom() {
      if (!negotiationHistory) return;
      const scroll = () => {
        negotiationHistory.scrollTop = negotiationHistory.scrollHeight;
      };
      requestAnimationFrame(() => {
        scroll();
        setTimeout(scroll, 40);
      });
    }

    function renderHistory() {
      if (!negotiationHistory) return;
      if (!negotiationEvents.length) {
        negotiationHistory.innerHTML = `<div class="empty-history">No history</div>`;
        scrollHistoryToBottom();
        return;
      }
      negotiationHistory.innerHTML = negotiationEvents.map((event, index) => `
        <div class="history-item ${event.role}${event.actionable ? " actionable" : ""}">
          <div class="history-title">${index + 1}. ${event.title}</div>
          <div>${event.text}</div>
          ${event.weights ? `<div class="history-weights">${shortWeights(event.weights)}</div>` : ""}
        </div>
      `).join("");
      scrollHistoryToBottom();
    }

    function showProxyThinking() {
      negotiationEvents.push({ role: "thinking", title: "Other-party is thinking", text: `<span class="thinking-dots">Reviewing offer</span>`, weights: null });
      renderHistory();
    }

    function removeProxyThinking() {
      negotiationEvents = negotiationEvents.filter((event) => event.role !== "thinking");
      renderHistory();
    }

    function rerenderFeatureExplanationForCurrentWeights() {
      if (!features || !activeData || activeStage !== "reconcile") return;
      features.innerHTML = renderFeatureExplanation(activeData.dataset || datasetSelect.value, selectedDefaultModel());
    }

    function setWeights(nextWeights, source = "Self offer") {
      userWeights = normalizeWeights(nextWeights);
      weights = { ...userWeights };
      initializeComposerAdjustments(userWeights);
      offerSource = source;
      renderOfferControls();
      renderSummary();
      renderReconciliation();
      rerenderFeatureExplanationForCurrentWeights();
      renderFinalDecisionOptions();
    }

    function setProxyWeights(nextWeights) {
      proxyWeights = normalizeWeights(nextWeights);
      renderSummary();
      renderReconciliation();
      rerenderFeatureExplanationForCurrentWeights();
      renderFinalDecisionOptions();
    }

    function renderSliders() {
      renderOfferControls();
      renderSummary();
    }

    function initializeComposerAdjustments(baseWeights = composerWeights) {
      composerBaseWeights = normalizeWeights(baseWeights);
      composerWeights = { ...composerBaseWeights };
      composerAdjustments = {};
      criteriaOrder.forEach((key) => { composerAdjustments[key] = "keep"; });
    }

    function computeWeightsFromAdjustments() {
      const raw = {};
      criteriaOrder.forEach((key) => {
        if (isInactiveCriterion(key)) {
          raw[key] = composerBaseWeights[key] || 0;
          return;
        }
        const option = degreeAdjustmentOptions.find((item) => item.key === composerAdjustments[key]) || degreeAdjustmentOptions[1];
        raw[key] = Math.max(0, (composerBaseWeights[key] || 0) + option.delta);
      });
      return normalizeWeights(raw);
    }

    function adjustmentSummary() {
      const changed = criteriaOrder
        .filter((key) => !isInactiveCriterion(key))
        .map((key) => ({ key, option: degreeAdjustmentOptions.find((item) => item.key === composerAdjustments[key]) || degreeAdjustmentOptions[1] }))
        .filter((item) => item.option.key !== "keep");
      if (!changed.length) {
        return hasSubmittedUserOffer() ? "Self keeps the Other-party offer about the same." : "Self keeps the elicited preference about the same.";
      }
      return `Self ${changed.map((item) => `${item.option.phrase} ${criteriaLabels[item.key]}`).join(", ")}.`;
    }

    function conflictFocus() {
      const user = decisionEffectiveWeights(userWeights || composerBaseWeights || weights);
      const proxy = decisionEffectiveWeights(proxyWeights || proxyIdealWeights());
      const ranked = activeCriteria()
        .map((key) => ({
          key,
          label: criteriaLabels[key],
          user: user[key] || 0,
          proxy: proxy[key] || 0,
          gap: (proxy[key] || 0) - (user[key] || 0),
        }))
        .sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));
      const focus = ranked[0];
      if (!focus || Math.abs(focus.gap) < 0.01) return null;
      const proxyName = personaTitle(proxyPersona || { label: "the other stakeholder" });
      const proxyPriority = proxyPersona?.priority || criteriaDescriptions[focus.key] || focus.label;
      const userPct = Math.round(focus.user * 100);
      const proxyPct = Math.round(focus.proxy * 100);
      const directionText = focus.gap >= 0
        ? `${proxyName} places more weight on ${focus.label}.`
        : `You place more weight on ${focus.label}.`;
      return {
        ...focus,
        userPct,
        proxyPct,
        text: `${directionText} Other-party ${proxyPct}% vs you ${userPct}% after inactive criteria are redistributed. Other-party priority: ${proxyPriority}.`,
      };
    }
    function openingActOptions() {
      return [
        { key: "state_core", label: "State core" },
        { key: "offer_tradeoff", label: "Offer tradeoff" },
        { key: "small_concession", label: "Small concession" },
        { key: "ask_proxy_open", label: "Let Other-party open" },
      ];
    }

    function openingBaselineWeights() {
      return decisionEffectiveWeights(elicitedWeights || userWeights || composerBaseWeights || weights);
    }

    function openingProxyTargetWeights() {
      return decisionEffectiveWeights(proxyIdealWeights());
    }

    function openingProtectKey() {
      return openingActState.protectKey || highestUserIssue();
    }

    function openingAskKey(protectKey = openingProtectKey()) {
      const user = openingBaselineWeights();
      const proxy = openingProxyTargetWeights();
      const { proxyProfile } = buildNegotiationContext(user);
      return activeCriteria()
        .filter((key) => key !== protectKey)
        .map((key) => {
          const stake = caseCriterionStake(proxyProfile, key, proxy);
          return { key, gap: (proxy[key] || 0) - (user[key] || 0), stake };
        })
        .sort((a, b) => b.stake.salience - a.stake.salience || b.gap - a.gap || b.stake.leverage - a.stake.leverage)[0]?.key || activeCriteria().find((key) => key !== protectKey) || activeCriteria()[0] || criteriaOrder[0];
    }

    function openingBudgetOptions(protectKey = openingProtectKey()) {
      const user = openingBaselineWeights();
      const askKey = openingAskKey(protectKey);
      const { userProfile, proxyProfile } = buildNegotiationContext(user);
      return activeCriteria()
        .filter((key) => key !== askKey && key !== protectKey)
        .map((key) => {
          const userStake = caseCriterionStake(userProfile, key, user);
          const proxyStake = caseCriterionStake(proxyProfile, key, user);
          const floorRisk = userStake.floor_risk || proxyStake.floor_risk || userStake.all_below_floor || proxyStake.all_below_floor;
          const jointSalience = userStake.salience + proxyStake.salience;
          return { key, label: issueOptionLabel(key), score: jointSalience + (floorRisk ? 1 : 0), jointSalience, leverage: Math.max(userStake.leverage, proxyStake.leverage), floorRisk };
        })
        .sort((a, b) => a.score - b.score || a.leverage - b.leverage);
    }

    function resetOpeningActState() {
      const protectKey = highestUserIssue();
      const budgetKey = openingBudgetOptions(protectKey)[0]?.key || activeCriteria().find((key) => key !== protectKey) || activeCriteria()[0] || criteriaOrder[0];
      openingActState = {
        type: "offer_tradeoff",
        concessionScale: "small",
        protectKey,
        budgetKey,
      };
    }

    function openingScaleValue() {
      return (responseScaleOptions().find((item) => item.key === openingActState.concessionScale) || responseScaleOptions()[0]).value;
    }

    function decreaseBudgetFromOpening(next, amount, primaryBudgetKey, protectedKeys = []) {
      let remaining = Math.max(0, amount);
      const floor = 0.01;
      const candidates = [
        primaryBudgetKey,
        ...openingBudgetOptions(protectedKeys[0]).map((item) => item.key),
        ...activeCriteria(),
      ].filter((key, index, list) => key && !protectedKeys.includes(key) && list.indexOf(key) === index);
      candidates.forEach((key) => {
        if (remaining <= 0) return;
        const available = Math.max(0, (next[key] || 0) - floor);
        const take = Math.min(available, remaining);
        next[key] = Math.max(floor, (next[key] || 0) - take);
        remaining -= take;
      });
      return remaining;
    }

    function computeWeightsFromOpeningAct() {
      const baseline = openingBaselineWeights();
      if (openingActState.type === "ask_proxy_open") return expandEffectiveWeights(baseline, userWeights || weights);
      const proxy = openingProxyTargetWeights();
      const protectKey = openingProtectKey();
      const askKey = openingAskKey(protectKey);
      const budgetKey = openingActState.budgetKey || openingBudgetOptions(protectKey)[0]?.key;
      const scaleByAct = {
        state_core: 0,
        offer_tradeoff: Math.max(openingScaleValue(), 0.35),
        small_concession: 0.18,
      };
      const scale = scaleByAct[openingActState.type] ?? openingScaleValue();
      const next = { ...baseline };
      const beforeTotal = activeCriteria().reduce((sum, key) => sum + (next[key] || 0), 0);
      if (askKey && scale > 0) {
        const askGap = Math.max(0, (proxy[askKey] || 0) - (baseline[askKey] || 0));
        const askDelta = impactBoundedDelta(askKey, askGap * scale);
        next[askKey] = (baseline[askKey] || 0) + askDelta;
      }
      if (protectKey) next[protectKey] = Math.max(baseline[protectKey] || 0, next[protectKey] || 0);
      const afterIncrease = activeCriteria().reduce((sum, key) => sum + (next[key] || 0), 0);
      decreaseBudgetFromOpening(next, Math.max(0, afterIncrease - beforeTotal), budgetKey, [askKey, protectKey].filter(Boolean));
      return expandEffectiveWeights(normalizeWeights(next), userWeights || weights);
    }

    function openingActSummary() {
      const protectKey = openingProtectKey();
      const askKey = openingAskKey(protectKey);
      const budgetKey = openingActState.budgetKey || openingBudgetOptions(protectKey)[0]?.key;
      if (openingActState.type === "ask_proxy_open") return "Self asks the Other-party to make the first package offer before changing the criteria contract.";
      if (openingActState.type === "state_core") return `Self opens by stating ${criteriaLabels[protectKey] || protectKey} as the core interest to protect.`;
      if (openingActState.type === "small_concession") return `Self opens with a small concession on ${criteriaLabels[askKey] || askKey} while protecting ${criteriaLabels[protectKey] || protectKey}.`;
      return `Self opens with a criteria-contract package: protect ${criteriaLabels[protectKey] || protectKey}, give bounded room on ${criteriaLabels[askKey] || askKey}, and fund it from lower-stakes ${criteriaLabels[budgetKey] || budgetKey}.`;
    }

    function openingPackageRowsHtml() {
      const protectKey = openingProtectKey();
      const askKey = openingAskKey(protectKey);
      const budgetKey = openingActState.budgetKey || openingBudgetOptions(protectKey)[0]?.key;
      const baseline = openingBaselineWeights();
      const next = decisionEffectiveWeights(composerWeights);
      const rows = [{ role: "Protect", issue: criteriaLabels[protectKey] || protectKey, value: `${fmtPct(baseline[protectKey] || 0)} -> ${fmtPct(next[protectKey] || 0)}` }];
      if (openingActState.type === "ask_proxy_open") {
        return `<div class="response-package-row"><span class="response-package-role">Protocol</span><span class="response-package-issue">Ask Other-party to make the opening package</span><span class="response-package-value">No Self change</span></div>`;
      }
      if (openingActState.type !== "state_core") {
        rows.push(
          { role: "Give room", issue: criteriaLabels[askKey] || askKey, value: `${fmtPct(baseline[askKey] || 0)} -> ${fmtPct(next[askKey] || 0)}` },
          { role: "Budget from", issue: criteriaLabels[budgetKey] || budgetKey, value: `${fmtPct(baseline[budgetKey] || 0)} -> ${fmtPct(next[budgetKey] || 0)}` },
        );
      }
      return rows.map((row) => `
        <div class="response-package-row">
          <span class="response-package-role">${escapeHtml(row.role)}</span>
          <span class="response-package-issue">${escapeHtml(row.issue)}</span>
          <span class="response-package-value">${escapeHtml(row.value)}</span>
        </div>
      `).join("");
    }

    function renderOpeningOfferControls(lockedAttr) {
      composerWeights = composerLocked ? normalizeWeights(composerWeights) : computeWeightsFromOpeningAct();
      const protectOptions = activeCriteria().map((key) => `<option value="${key}" ${openingActState.protectKey === key ? "selected" : ""}>${escapeHtml(issueOptionLabel(key))}</option>`).join("");
      const budgetOptions = openingBudgetOptions(openingActState.protectKey);
      const budgetHtml = (budgetOptions.length ? budgetOptions : activeCriteria().map((key) => ({ key, label: issueOptionLabel(key) })))
        .map((item) => `<option value="${item.key}" ${openingActState.budgetKey === item.key ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
      const showScale = openingActState.type === "offer_tradeoff";
      const showCore = openingActState.type !== "ask_proxy_open";
      const showBudget = openingActState.type === "offer_tradeoff" || openingActState.type === "small_concession";
      const configFields = [
        showScale ? `
          <div class="response-field">
            <label for="openingScaleSelect">Concession size</label>
            <select id="openingScaleSelect" ${lockedAttr}>
              ${responseScaleOptions().map((option) => `<option value="${option.key}" ${openingActState.concessionScale === option.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
            </select>
          </div>` : "",
        showCore ? `
          <div class="response-field">
            <label for="openingProtectSelect">Core issue</label>
            <select id="openingProtectSelect" ${lockedAttr}>${protectOptions}</select>
          </div>` : "",
        showBudget ? `
          <div class="response-field">
            <label for="openingBudgetSelect">Budget source</label>
            <select id="openingBudgetSelect" ${lockedAttr}>${budgetHtml}</select>
          </div>` : "",
      ].filter(Boolean).join("");
      return `
        <div class="composer-bubble">
          <div class="composer-title">
            <span class="composer-help" tabindex="0" aria-label="Composer help">?
              <span class="composer-help-text">${escapeHtml(composerNote)}</span>
            </span>
          </div>
          <div class="foresight-prompt">Opening move</div>
          <div class="response-protocol">
            <div class="response-package">${openingPackageRowsHtml()}</div>
            <div class="response-act-grid opening-act-grid">
              ${openingActOptions().map((option) => `
                <label class="response-act-chip" title="${escapeHtml(option.label)}">
                  <input type="radio" name="opening-act" value="${option.key}" class="opening-act-input" ${openingActState.type === option.key ? "checked" : ""} ${lockedAttr}>
                  ${escapeHtml(option.label)}
                </label>
              `).join("")}
            </div>
            ${configFields ? `<div class="response-config">${configFields}</div>` : ""}
            <div class="response-preview">${responsePreviewHtml()}</div>
          </div>
          <div class="composer-send-row">
            <div class="degree-summary"><div>${escapeHtml(openingActSummary())}</div></div>
            <div class="composer-actions"><button type="button" id="sendOfferButton" class="primary-button" ${lockedAttr}>${openingActState.type === "ask_proxy_open" ? "Ask Other-party to open" : "Send opening"}</button></div>
          </div>
        </div>
      `;
    }

    function responseActOptions() {
      return [
        { key: "smaller_concession", label: "Smaller concession" },
        { key: "protect_core", label: "Protect core" },
        { key: "change_budget", label: "Change budget" },
        { key: "justify", label: "Ask why" },
        { key: "accept_package", label: "Accept package" },
      ];
    }

    function responseScaleOptions() {
      return [
        { key: "small", label: "Small", value: 0.25 },
        { key: "medium", label: "Medium", value: 0.45 },
        { key: "large", label: "Large", value: 0.65 },
      ];
    }

    function responseScaleValue() {
      return (responseScaleOptions().find((item) => item.key === responseActState.concessionScale) || responseScaleOptions()[0]).value;
    }

    function activeProxyProposal() {
      return pendingProxyResponse?.structuredProposal || null;
    }

    function issueOptionLabel(key) {
      return criteriaShortLabels[key] || criteriaLabels[key] || key;
    }

    function highestUserIssue() {
      const user = decisionEffectiveWeights(userWeights || weights);
      const { userProfile } = buildNegotiationContext(userWeights || weights);
      return activeCriteria()
        .map((key) => ({ key, stake: caseCriterionStake(userProfile, key, user), weight: user[key] || 0 }))
        .sort((a, b) => b.stake.salience - a.stake.salience || b.weight - a.weight || b.stake.leverage - a.stake.leverage)[0]?.key || activeCriteria()[0] || criteriaOrder[0];
    }

    function largestProxyAskKey() {
      const user = decisionEffectiveWeights(userWeights || weights);
      const proxy = decisionEffectiveWeights(pendingProxyCounter || proxyWeights || proxyIdealWeights());
      const { proxyProfile } = buildNegotiationContext(userWeights || weights);
      return activeCriteria()
        .map((key) => {
          const stake = caseCriterionStake(proxyProfile, key, proxy);
          return { key, gap: (proxy[key] || 0) - (user[key] || 0), stake };
        })
        .sort((a, b) => b.stake.salience - a.stake.salience || b.gap - a.gap || b.stake.leverage - a.stake.leverage)[0]?.key || activeCriteria()[0] || criteriaOrder[0];
    }

    function budgetSourceOptions(protectKey = null) {
      const user = decisionEffectiveWeights(userWeights || weights);
      const askKey = activeProxyProposal()?.ask?.key || largestProxyAskKey();
      const { userProfile, proxyProfile } = buildNegotiationContext(userWeights || weights);
      return activeCriteria()
        .filter((key) => key !== askKey && key !== protectKey)
        .map((key) => {
          const userStake = caseCriterionStake(userProfile, key, user);
          const proxyStake = caseCriterionStake(proxyProfile, key, user);
          const floorRisk = userStake.floor_risk || proxyStake.floor_risk || userStake.all_below_floor || proxyStake.all_below_floor;
          const jointSalience = userStake.salience + proxyStake.salience;
          return { key, label: issueOptionLabel(key), score: jointSalience + (floorRisk ? 1 : 0), jointSalience, leverage: Math.max(userStake.leverage, proxyStake.leverage), floorRisk };
        })
        .sort((a, b) => a.score - b.score || a.leverage - b.leverage);
    }

    function resetResponseActState(response = null) {
      const proposal = response?.structuredProposal || pendingProxyResponse?.structuredProposal || null;
      const protectKey = proposal?.concession?.key || highestUserIssue();
      const budgetKey = proposal?.budget_source?.key || budgetSourceOptions(protectKey)[0]?.key || activeCriteria().find((key) => key !== protectKey) || activeCriteria()[0] || criteriaOrder[0];
      responseActState = {
        type: "smaller_concession",
        concessionScale: "small",
        protectKey,
        budgetKey,
      };
    }

    function decreaseBudgetForResponse(next, amount, primaryBudgetKey, protectedKeys = []) {
      let remaining = Math.max(0, amount);
      const floor = 0.01;
      const candidates = [
        primaryBudgetKey,
        ...budgetSourceOptions(protectedKeys[0]).map((item) => item.key),
        ...activeCriteria(),
      ].filter((key, index, list) => key && !protectedKeys.includes(key) && list.indexOf(key) === index);
      candidates.forEach((key) => {
        if (remaining <= 0) return;
        const available = Math.max(0, (next[key] || 0) - floor);
        const take = Math.min(available, remaining);
        next[key] = Math.max(floor, (next[key] || 0) - take);
        remaining -= take;
      });
      return remaining;
    }

    function computeWeightsFromResponseAct() {
      if (!pendingProxyCounter || !pendingProxyResponse || responseActState.type === "justify") {
        return normalizeWeights(userWeights || composerBaseWeights || weights);
      }
      const userAnchor = decisionEffectiveWeights(userWeights || weights);
      const proxyOffer = decisionEffectiveWeights(pendingProxyCounter || composerBaseWeights);
      const proposal = activeProxyProposal();
      const askKey = proposal?.ask?.key || largestProxyAskKey();
      const protectKey = responseActState.protectKey || proposal?.concession?.key || highestUserIssue();
      const budgetKey = responseActState.budgetKey || proposal?.budget_source?.key || budgetSourceOptions(protectKey)[0]?.key;
      const scaleByAct = {
        smaller_concession: responseScaleValue(),
        protect_core: Math.min(responseScaleValue(), 0.35),
        change_budget: Math.max(responseScaleValue(), 0.45),
      };
      const scale = scaleByAct[responseActState.type] || responseScaleValue();
      const next = { ...userAnchor };
      const beforeTotal = activeCriteria().reduce((sum, key) => sum + (next[key] || 0), 0);

      if (askKey) {
        const askGap = Math.max(0, (proxyOffer[askKey] || 0) - (userAnchor[askKey] || 0));
        const askDelta = impactBoundedDelta(askKey, askGap * scale);
        next[askKey] = (userAnchor[askKey] || 0) + askDelta;
      }

      if (responseActState.type === "accept_package") {
        activeCriteria().forEach((key) => {
          next[key] = proxyOffer[key] || 0;
        });
      } else if (protectKey) {
        next[protectKey] = Math.max(userAnchor[protectKey] || 0, next[protectKey] || 0);
      }

      const afterIncrease = activeCriteria().reduce((sum, key) => sum + (next[key] || 0), 0);
      const protectedKeys = [askKey, protectKey].filter(Boolean);
      decreaseBudgetForResponse(next, Math.max(0, afterIncrease - beforeTotal), budgetKey, protectedKeys);
      return expandEffectiveWeights(normalizeWeights(next), userWeights || weights);
    }

    function responseActSummary() {
      const proposal = activeProxyProposal();
      const askKey = proposal?.ask?.key || largestProxyAskKey();
      const protectKey = responseActState.protectKey || proposal?.concession?.key || highestUserIssue();
      const budgetKey = responseActState.budgetKey || proposal?.budget_source?.key;
      if (responseActState.type === "justify") return "Self asks the Other-party to justify this package before changing the criteria contract.";
      if (responseActState.type === "accept_package") return "Self accepts the Other-party package as the negotiated criteria contract.";
      if (responseActState.type === "protect_core") return `Self protects ${criteriaLabels[protectKey] || protectKey}, gives a small concession on ${criteriaLabels[askKey] || askKey}, and funds it from ${criteriaLabels[budgetKey] || budgetKey}.`;
      if (responseActState.type === "change_budget") return `Self keeps the package structure but changes the budget source to ${criteriaLabels[budgetKey] || budgetKey}.`;
      return `Self makes a smaller concession on ${criteriaLabels[askKey] || askKey} and funds it from ${criteriaLabels[budgetKey] || budgetKey}.`;
    }

    function structuredJustificationText(response) {
      const proposal = response?.structuredProposal;
      const { proxyProfile } = buildNegotiationContext(userWeights || weights);
      const rows = [];
      if (proposal?.ask) rows.push(`My ask on ${escapeHtml(proposal.ask.label)} is tied to this role's stated issue rationale: ${escapeHtml(issueData(proxyProfile, proposal.ask.key).public_reason || "it is a high-priority issue for this stakeholder.")} ${escapeHtml(proposal.ask.rationale || "")}`.trim());
      if (proposal?.concession) rows.push(`My concession on ${escapeHtml(proposal.concession.label)} keeps one of your stronger case-specific stakes visible instead of forcing a single-issue compromise. ${escapeHtml(proposal.concession.rationale || "")}`.trim());
      if (proposal?.budget_source) rows.push(`I use ${escapeHtml(proposal.budget_source.label)} as the budget source because the package needs a fixed total and this issue is lower-stakes for the current case. ${escapeHtml(proposal.budget_source.rationale || "")}`.trim());
      rows.push("The interaction is a structured speech-act protocol: you can accept, counter with a smaller concession, protect a core issue, change the budget source, or ask for justification. The weights are a case-specific criteria contract, not free-form value editing or evidence that your underlying values changed.");
      return rows.join("<br><br>");
    }

    function packageRowsHtml(response) {
      const proposal = response?.structuredProposal;
      const rows = [];
      if (proposal?.ask) rows.push({ role: "Other-party asks", issue: proposal.ask.label, value: `${fmtPct(proposal.ask.from)} -> ${fmtPct(proposal.ask.to)}` });
      if (proposal?.concession) rows.push({ role: "Other-party concedes", issue: proposal.concession.label, value: `${fmtPct(proposal.concession.from)} -> ${fmtPct(proposal.concession.to)}` });
      if (proposal?.budget_source) rows.push({ role: "Budget from", issue: proposal.budget_source.label, value: `${fmtPct(proposal.budget_source.from)} -> ${fmtPct(proposal.budget_source.to)}` });
      if (!rows.length && response?.moves?.length) {
        response.moves.slice(0, 3).forEach((move) => rows.push({ role: move.delta >= 0 ? "Increase" : "Decrease", issue: move.label, value: `${fmtPct(move.from)} -> ${fmtPct(move.to)}` }));
      }
      if (!rows.length) rows.push({ role: "Package", issue: "Bounded counter-offer", value: "No large movement" });
      return rows.map((row) => `
        <div class="response-package-row">
          <span class="response-package-role">${escapeHtml(row.role)}</span>
          <span class="response-package-issue">${escapeHtml(row.issue)}</span>
          <span class="response-package-value">${escapeHtml(row.value)}</span>
        </div>
      `).join("");
    }

    function responsePreviewHtml() {
      const effective = decisionEffectiveWeights(composerWeights);
      return activeCriteria().map((key) => `
        <span><strong>${escapeHtml(issueOptionLabel(key))}</strong> ${Math.round((effective[key] || 0) * 100)}%</span>
      `).join("");
    }

    function renderStructuredResponseControls(lockedAttr) {
      const response = pendingProxyResponse;
      const locked = Boolean(lockedAttr);
      composerWeights = locked ? normalizeWeights(composerWeights) : computeWeightsFromResponseAct();
      const protectOptions = activeCriteria().map((key) => `<option value="${key}" ${responseActState.protectKey === key ? "selected" : ""}>${escapeHtml(issueOptionLabel(key))}</option>`).join("");
      const budgetOptions = budgetSourceOptions(responseActState.protectKey);
      const budgetHtml = (budgetOptions.length ? budgetOptions : activeCriteria().map((key) => ({ key, label: issueOptionLabel(key) })))
        .map((item) => `<option value="${item.key}" ${responseActState.budgetKey === item.key ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("");
      return `
        <div class="composer-bubble">
          <div class="composer-title">
            <span class="composer-help" tabindex="0" aria-label="Composer help">?
              <span class="composer-help-text">${escapeHtml(composerNote)}</span>
            </span>
          </div>
          <div class="foresight-prompt">Response move</div>
          <div class="response-protocol">
            <div class="response-package">${packageRowsHtml(response)}</div>
            <div class="response-act-grid">
              ${responseActOptions().map((option) => `
                <label class="response-act-chip" title="${escapeHtml(option.label)}">
                  <input type="radio" name="response-act" value="${option.key}" class="response-act-input" ${responseActState.type === option.key ? "checked" : ""} ${lockedAttr}>
                  ${escapeHtml(option.label)}
                </label>
              `).join("")}
            </div>
            <div class="response-config">
              <div class="response-field">
                <label for="responseScaleSelect">Concession size</label>
                <select id="responseScaleSelect" ${lockedAttr || responseActState.type === "justify" ? "disabled" : ""}>
                  ${responseScaleOptions().map((option) => `<option value="${option.key}" ${responseActState.concessionScale === option.key ? "selected" : ""}>${escapeHtml(option.label)}</option>`).join("")}
                </select>
              </div>
              <div class="response-field">
                <label for="responseProtectSelect">Protected issue</label>
                <select id="responseProtectSelect" ${lockedAttr || responseActState.type === "justify" || responseActState.type === "accept_package" ? "disabled" : ""}>${protectOptions}</select>
              </div>
              <div class="response-field">
                <label for="responseBudgetSelect">Budget source</label>
                <select id="responseBudgetSelect" ${lockedAttr || responseActState.type === "justify" || responseActState.type === "accept_package" ? "disabled" : ""}>${budgetHtml}</select>
              </div>
            </div>
            <div class="response-preview">${responsePreviewHtml()}</div>
          </div>
          <div class="composer-send-row">
            <div class="degree-summary"><div>${escapeHtml(responseActSummary())}</div></div>
            <div class="composer-actions"><button type="button" id="sendOfferButton" class="primary-button" ${lockedAttr}>${responseActState.type === "justify" ? "Ask for reason" : responseActState.type === "accept_package" ? "Accept package" : "Send response"}</button></div>
          </div>
        </div>
      `;
    }

    function renderDegreeOfferControls(lockedAttr) {
      return `
        <div class="composer-bubble">
          <div class="composer-title">
            <span class="composer-help" tabindex="0" aria-label="Composer help">?
              <span class="composer-help-text">${escapeHtml(composerNote)}</span>
            </span>
          </div>
          <div class="foresight-prompt">For each active criterion, should this offer keep it the same or adjust it?</div>
          <div class="foresight-list">
            ${activeCriteria().map((key) => {
              const disabledAttr = lockedAttr;
              const effectiveBase = decisionEffectiveWeights(composerBaseWeights)[key] || 0;
              const effectiveOffer = decisionEffectiveWeights(composerWeights)[key] || 0;
              const criterionTitle = `${criteriaFullLabels[key] || criteriaLabels[key]}: ${criteriaDescriptions[key] || ""}`;
              const shortName = criteriaShortLabels[key] || criteriaLabels[key];
              return `
                <div class="foresight-card" title="${escapeHtml(criterionTitle)}">
                  <div class="foresight-question">
                    <span class="foresight-key">${escapeHtml(shortName)}</span>
                    <span class="foresight-copy">Change?</span>
                    <span class="foresight-meta">B ${Math.round(effectiveBase * 100)}% · O ${Math.round(effectiveOffer * 100)}%</span>
                  </div>
                  <div class="foresight-options">
                    ${degreeAdjustmentOptions.map((option) => `
                      <label class="foresight-chip" title="${escapeHtml(criterionTitle)}: ${escapeHtml(option.label)}">
                        <input type="radio" name="degree-${key}" value="${option.key}" data-criterion="${key}" ${composerAdjustments[key] === option.key ? "checked" : ""} ${disabledAttr}>
                        ${escapeHtml(option.key === "keep" ? "Keep" : option.key === "decrease" ? "Decrease" : `+${option.shortLabel || option.label}`)}
                      </label>
                    `).join("")}
                  </div>
                  <span class="foresight-offer">${Math.round(effectiveOffer * 100)}%</span>
                </div>
              `;
            }).join("")}
          </div>
          <div class="composer-send-row">
            <div class="degree-summary"><div>${escapeHtml(adjustmentSummary())}</div></div>
            <div class="composer-actions"><button type="button" id="sendOfferButton" class="primary-button" ${lockedAttr}>Send response</button></div>
          </div>
        </div>
      `;
    }


    function sendStructuredJustificationRequest() {
      const response = pendingProxyResponse;
      addHistory("user", "Ask Other-party to justify", responseActSummary(), userWeights);
      addHistory("proxy", "Package justification", structuredJustificationText(response), response?.counterWeights || proxyWeights);
      composerNote = "The Other-party justified the package. Choose a structured response move when ready.";
      renderOfferControls();
    }


    function negotiateV2ModelBySeed(seed) {
      return (activeData?.models || []).find((model) => String(model.seed) === String(seed)) || null;
    }

    function negotiateV2CurrentVersion() {
      return negotiateV2Versions[negotiateV2VersionIndex] || null;
    }

    function negotiateV2SelectedItems() {
      const current = negotiateV2CurrentVersion();
      if (current) {
        return [
          { role: "self", roleLabel: "Self optimal", model: negotiateV2ModelBySeed(current.selfModelSeed) },
          { role: "other", roleLabel: "Other-party optimal", model: negotiateV2ModelBySeed(current.otherModelSeed) },
        ];
      }
      ensureDifferentProxyPersona();
      return [
        { role: "self", roleLabel: "Self optimal", model: selectedSingleOptimalModel(userWeights) },
        { role: "other", roleLabel: "Other-party optimal", model: selectedSingleOptimalModel(proxyWeights || proxyIdealWeights()) },
      ];
    }

    function negotiateV2RedistributeWeights(baseWeights, sacrificeKey, receiveKey, step = 0.1) {
      const base = normalizeWeights(baseWeights || weights);
      if (!sacrificeKey || !criteriaOrder.includes(sacrificeKey)) return base;
      const next = { ...base };
      const available = Math.max(0, (next[sacrificeKey] || 0) - 0.01);
      const give = Math.min(Math.max(0, Number(step) || 0), available);
      next[sacrificeKey] = Math.max(0.01, (next[sacrificeKey] || 0) - give);
      const receiver = receiveKey && receiveKey !== sacrificeKey ? receiveKey : criteriaOrder.find((key) => key !== sacrificeKey) || criteriaOrder[0];
      next[receiver] = (next[receiver] || 0) + give;
      return normalizeWeights(next);
    }

    function negotiateV2Reliability(model, rowWeights) {
      return model ? modelWeightedUtility(model, rowWeights) : 0;
    }

    function negotiateV2ParetoCandidates() {
      const frontier = paretoOptimalModels(activeData?.models || []);
      return frontier.length ? frontier : (activeData?.models || []);
    }

    function negotiateV2BestModel(rowWeights, candidates = negotiateV2ParetoCandidates()) {
      return candidates.slice().sort((a, b) => {
        const utilityDelta = negotiateV2Reliability(b, rowWeights) - negotiateV2Reliability(a, rowWeights);
        if (Math.abs(utilityDelta) > 0.000001) return utilityDelta;
        return Number(b.pred_prob || 0) - Number(a.pred_prob || 0);
      })[0] || null;
    }

    function negotiateV2ModelDistance(a, b) {
      if (!a || !b) return 1;
      const metricDistance = criteriaOrder.reduce((total, key) => {
        const av = modelCriterionValue(a, key);
        const bv = modelCriterionValue(b, key);
        if (!Number.isFinite(av) || !Number.isFinite(bv)) return total;
        return total + Math.abs(av - bv);
      }, 0) / Math.max(1, criteriaOrder.length);
      const probDistance = Math.abs(Number(a.pred_prob || 0) - Number(b.pred_prob || 0));
      const classPenalty = Number(a.pred_class) === Number(b.pred_class) ? 0 : 0.18;
      return metricDistance + 0.35 * probDistance + classPenalty;
    }

    function negotiateV2IssueRow(profile, key, rowWeights) {
      const stake = caseCriterionStake(profile, key, rowWeights);
      return {
        key,
        label: criteriaLabels[key] || key,
        stake,
        rank: issueRank(profile, key),
        rigidity: issueRigidity(profile, key),
        negotiability: stakeNegotiabilityScore(stake),
        floorRisk: Boolean(stake.floor_risk || stake.all_below_floor),
        isCore: key === primaryCriterionKeyForProfile(profile),
      };
    }

    function negotiateV2AutomaticCounterMove(base, selfSacrifice, step = 0.1) {
      const baseSelfWeights = normalizeWeights(base?.selfWeights || userWeights || weights);
      const baseOtherWeights = normalizeWeights(base?.otherWeights || proxyWeights || proxyIdealWeights());
      const { userProfile, proxyProfile } = buildNegotiationContext(baseSelfWeights);
      const selfReceive = topMetricKeyForWeights(baseOtherWeights);
      const otherReceive = topMetricKeyForWeights(baseSelfWeights);
      const nextSelfWeights = negotiateV2RedistributeWeights(baseSelfWeights, selfSacrifice, selfReceive, step);
      const baseChoice = negotiateV2ChooseModels(baseSelfWeights, baseOtherWeights, { allowShared: false });
      const baseDistance = negotiateV2ModelDistance(baseChoice.selfModel, baseChoice.otherModel);
      const activeKeys = activeCriteria().length ? activeCriteria() : criteriaOrder;
      const candidates = activeKeys
        .filter((key) => key !== otherReceive)
        .map((key) => {
          const issue = negotiateV2IssueRow(proxyProfile, key, baseOtherWeights);
          const userIssue = negotiateV2IssueRow(userProfile, key, baseSelfWeights);
          const nextOtherWeights = negotiateV2RedistributeWeights(baseOtherWeights, key, otherReceive, step);
          const choice = negotiateV2ChooseModels(nextSelfWeights, nextOtherWeights, { allowShared: true });
          const nextDistance = negotiateV2ModelDistance(choice.selfModel, choice.otherModel);
          const otherLoss = Math.max(0, (baseOtherWeights[key] || 0) - (nextOtherWeights[key] || 0));
          const selfGain = Math.max(0, (nextOtherWeights[otherReceive] || 0) - (baseOtherWeights[otherReceive] || 0));
          const consensusBonus = choice.shared ? 2.8 : choice.consensusClass ? 1.7 : 0;
          const distanceGain = Math.max(0, baseDistance - nextDistance);
          const profileCost = (issue.isCore ? 1.4 : 0) + (issue.floorRisk ? 2.5 : 0) + issue.rigidity * 0.45 + (issue.stake?.salience || 0) * 3.2;
          const modelSpaceGain = consensusBonus + distanceGain * 3.5 + selfGain * 0.4;
          const score = modelSpaceGain + issue.negotiability * 0.8 + (userIssue.stake?.salience || 0) * 0.6 - profileCost - otherLoss * 0.3;
          return {
            key,
            receiveKey: otherReceive,
            nextOtherWeights,
            nextSelfWeights,
            choice,
            score,
            issue,
            userIssue,
            distanceGain,
            consensusBonus,
          };
        })
        .sort((a, b) => b.score - a.score || b.consensusBonus - a.consensusBonus || b.issue.negotiability - a.issue.negotiability);
      const selected = candidates[0] || {
        key: activeKeys.find((key) => key !== otherReceive) || activeKeys[0] || criteriaOrder[0],
        receiveKey: otherReceive,
        nextOtherWeights: baseOtherWeights,
        nextSelfWeights,
        choice: negotiateV2ChooseModels(nextSelfWeights, baseOtherWeights, { allowShared: true }),
        score: 0,
        issue: null,
        userIssue: null,
        distanceGain: 0,
        consensusBonus: 0,
      };
      return {
        ...selected,
        selfReceive,
        nextSelfWeights,
        rationale: selected.issue
          ? `Other-party proposes giving room on ${criteriaLabels[selected.key]} because it is relatively negotiable for its profile and moves the available model options closer to both sides.`
          : "Other-party keeps its profile weights because no useful concession direction was available in the current model set.",
      };
    }

    function negotiateV2ChooseModels(selfWeights, otherWeights, options = {}) {
      const candidates = negotiateV2ParetoCandidates();
      const selfBest = negotiateV2BestModel(selfWeights, candidates);
      const otherBest = negotiateV2BestModel(otherWeights, candidates);
      const selfBestScore = negotiateV2Reliability(selfBest, selfWeights);
      const otherBestScore = negotiateV2Reliability(otherBest, otherWeights);
      if (options.allowShared !== false) {
        const minSelf = selfBestScore * 0.94;
        const minOther = otherBestScore * 0.94;
        const shared = candidates
          .map((model) => ({
            model,
            selfScore: negotiateV2Reliability(model, selfWeights),
            otherScore: negotiateV2Reliability(model, otherWeights),
          }))
          .filter((row) => row.selfScore >= minSelf && row.otherScore >= minOther)
          .sort((a, b) => (b.selfScore + b.otherScore) - (a.selfScore + a.otherScore) || Math.abs(0.5 - Number(a.model.pred_prob || 0)) - Math.abs(0.5 - Number(b.model.pred_prob || 0)))[0];
        if (shared) return { selfModel: shared.model, otherModel: shared.model, shared: true };
      }
      const consensusClass = selfBest && otherBest && Number(selfBest.pred_class) === Number(otherBest.pred_class);
      return { selfModel: selfBest, otherModel: otherBest, shared: false, consensusClass };
    }

    function negotiateV2CreateVersion({ selfWeights, otherWeights, selfSacrifice = null, otherSacrifice = null, selfReceive = null, otherReceive = null, note = "Initial multi-optimal state", rationale = "", allowShared = true }) {
      const choice = negotiateV2ChooseModels(selfWeights, otherWeights, { allowShared });
      const id = negotiateV2Versions.length;
      const selfLabel = activeData?.label_names?.[choice.selfModel?.pred_class] || `Class ${choice.selfModel?.pred_class}`;
      const otherLabel = activeData?.label_names?.[choice.otherModel?.pred_class] || `Class ${choice.otherModel?.pred_class}`;
      return {
        id,
        label: `v${id}`,
        selfWeights: normalizeWeights(selfWeights),
        otherWeights: normalizeWeights(otherWeights),
        selfSacrifice,
        otherSacrifice,
        selfReceive,
        otherReceive,
        rationale,
        selfModelSeed: choice.selfModel?.seed,
        otherModelSeed: choice.otherModel?.seed,
        consensus: Boolean(choice.selfModel && choice.otherModel && Number(choice.selfModel.pred_class) === Number(choice.otherModel.pred_class)),
        shared: Boolean(choice.shared),
        note,
        summary: choice.shared
          ? `v${id}: shared model #${choice.selfModel?.seed} predicts ${selfLabel}.`
          : `v${id}: Self model #${choice.selfModel?.seed} predicts ${selfLabel}; Other-party model #${choice.otherModel?.seed} predicts ${otherLabel}.`,
      };
    }

    function resetNegotiateV2State() {
      if (!activeData) return;
      const initialSelf = normalizeWeights(userWeights || elicitedWeights || weights);
      const initialOther = normalizeWeights(proxyWeights || proxyIdealWeights());
      negotiateV2Versions = [negotiateV2CreateVersion({ selfWeights: initialSelf, otherWeights: initialOther, allowShared: false })];
      negotiateV2VersionIndex = 0;
      negotiateV2Draft = {
        selfSacrifice: criteriaOrder.find((key) => key !== rankedCriteria?.[0]) || criteriaOrder[0],
        otherSacrifice: null,
        step: 0.1,
      };
      renderNegotiateV2History();
    }

    function negotiateV2AdvanceVersion() {
      const current = negotiateV2CurrentVersion();
      if (!current) resetNegotiateV2State();
      const base = negotiateV2CurrentVersion();
      const move = negotiateV2AutomaticCounterMove(base, negotiateV2Draft.selfSacrifice, negotiateV2Draft.step);
      const nextSelfWeights = move.nextSelfWeights;
      const nextOtherWeights = move.nextOtherWeights;
      negotiateV2Draft.otherSacrifice = move.key;
      const note = `Self gives room on ${criteriaLabels[negotiateV2Draft.selfSacrifice]} toward ${criteriaLabels[move.selfReceive]}; Other-party proposes giving room on ${criteriaLabels[move.key]} toward ${criteriaLabels[move.receiveKey]}.`;
      const version = negotiateV2CreateVersion({
        selfWeights: nextSelfWeights,
        otherWeights: nextOtherWeights,
        selfSacrifice: negotiateV2Draft.selfSacrifice,
        otherSacrifice: move.key,
        selfReceive: move.selfReceive,
        otherReceive: move.receiveKey,
        rationale: move.rationale,
        note,
      });
      negotiateV2Versions.push(version);
      negotiateV2VersionIndex = negotiateV2Versions.length - 1;
      userWeights = normalizeWeights(nextSelfWeights);
      weights = { ...userWeights };
      proxyWeights = normalizeWeights(nextOtherWeights);
      renderNegotiateV2History();
      renderOfferControls();
      renderSummary();
      renderReconciliation();
      rerenderFeatureExplanationForCurrentWeights();
      renderFinalDecisionOptions();
    }

    function renderNegotiateV2History() {
      if (!negotiationHistory || !isNegotiateV2Condition()) return;
      if (!negotiateV2Versions.length) {
        negotiationHistory.innerHTML = `<div class="empty-history">No versions yet</div>`;
        return;
      }
      negotiationHistory.innerHTML = negotiateV2Versions.map((version) => `
        <div class="history-item ${version.id === negotiateV2VersionIndex ? "proxy" : "system"}">
          <div class="history-title">${escapeHtml(version.label)} ${version.id === negotiateV2VersionIndex ? "(current)" : ""}</div>
          <div>${escapeHtml(version.summary)}</div>
          <div class="history-weights">${escapeHtml(version.note)}</div>
          ${version.rationale ? `<div class="history-weights">${escapeHtml(version.rationale)}</div>` : ""}
        </div>
      `).join("");
      scrollHistoryToBottom();
    }

    function renderNegotiateV2Controls() {
      if (!offerComposer) return;
      if (!negotiateV2Versions.length) resetNegotiateV2State();
      const current = negotiateV2CurrentVersion();
      const optionHtml = criteriaOrder.map((key) => `<option value="${key}">${escapeHtml(criteriaLabels[key])}</option>`).join("");
      const previewMove = current ? negotiateV2AutomaticCounterMove(current, negotiateV2Draft.selfSacrifice || criteriaOrder[0], negotiateV2Draft.step || 0.1) : null;
      const proposedOther = previewMove?.key ? `${criteriaLabels[previewMove.key]} -> ${criteriaLabels[previewMove.receiveKey]}` : "No useful counter-move available";
      offerComposer.classList.remove("locked");
      offerComposer.innerHTML = `
        <div class="composer-bubble negotiate-v2-composer">
          <div class="composer-title">Negotiate acceptable models</div>
          <div class="foresight-prompt">Current version: <strong>${escapeHtml(current?.label || "v0")}</strong></div>
          <div class="response-config">
            <div class="response-field">
              <label for="negotiateV2VersionSelect">Version history</label>
              <select id="negotiateV2VersionSelect">
                ${negotiateV2Versions.map((version, index) => `<option value="${index}" ${index === negotiateV2VersionIndex ? "selected" : ""}>${escapeHtml(version.label)}${version.consensus ? " - consensus" : ""}</option>`).join("")}
              </select>
            </div>
            <div class="response-field">
              <label for="negotiateV2SelfSacrifice">Self can sacrifice</label>
              <select id="negotiateV2SelfSacrifice">${optionHtml}</select>
            </div>
            <div class="response-field negotiate-v2-proposal-field">
              <label>System-proposed Other-party move</label>
              <div class="negotiate-v2-proposal" title="${escapeHtml(previewMove?.rationale || "Other-party move is computed from its profile and the available Rashomon model options.")}">${escapeHtml(proposedOther)}</div>
            </div>
            <div class="response-field">
              <label for="negotiateV2Step">Concession size</label>
              <select id="negotiateV2Step">
                <option value="0.05">Small</option>
                <option value="0.1">Medium</option>
                <option value="0.16">Large</option>
              </select>
            </div>
          </div>
          <div class="response-preview">${escapeHtml(current?.summary || "Initial multi-optimal state")}<br>${escapeHtml(previewMove?.rationale || "")}</div>
          <div class="composer-send-row">
            <div class="degree-summary"><div>Pick Self's concession; the system proposes the Other-party counter-move from its profile and model-space directions.</div></div>
            <div class="composer-actions"><button type="button" id="negotiateV2AdvanceButton" class="primary-button">Generate next version</button></div>
          </div>
        </div>
      `;
      const selfSelect = document.getElementById("negotiateV2SelfSacrifice");
      const stepSelect = document.getElementById("negotiateV2Step");
      const versionSelect = document.getElementById("negotiateV2VersionSelect");
      if (selfSelect) selfSelect.value = negotiateV2Draft.selfSacrifice || criteriaOrder[0];
      if (stepSelect) stepSelect.value = String(negotiateV2Draft.step || 0.1);
      if (versionSelect) {
        versionSelect.addEventListener("change", (event) => {
          negotiateV2VersionIndex = Math.max(0, Math.min(negotiateV2Versions.length - 1, Number(event.target.value) || 0));
          const version = negotiateV2CurrentVersion();
          if (version) {
            userWeights = normalizeWeights(version.selfWeights);
            weights = { ...userWeights };
            proxyWeights = normalizeWeights(version.otherWeights);
          }
          renderNegotiateV2History();
          renderOfferControls();
          renderSummary();
          renderReconciliation();
          rerenderFeatureExplanationForCurrentWeights();
          renderFinalDecisionOptions();
        });
      }
      if (selfSelect) selfSelect.addEventListener("change", (event) => {
        negotiateV2Draft.selfSacrifice = event.target.value;
        renderOfferControls();
      });
      if (stepSelect) stepSelect.addEventListener("change", (event) => {
        negotiateV2Draft.step = Number(event.target.value) || 0.1;
        renderOfferControls();
      });
      const advanceButton = document.getElementById("negotiateV2AdvanceButton");
      if (advanceButton) advanceButton.addEventListener("click", negotiateV2AdvanceVersion);
    }

    function renderOfferControls() {
      if (!offerComposer) return;
      if (isNegotiateV2Condition()) {
        renderNegotiateV2Controls();
        return;
      }
      if (!showsNegotiationPanel()) {
        offerComposer.innerHTML = "";
        offerComposer.classList.remove("locked");
        return;
      }
      const lockedAttr = composerLocked ? "disabled" : "";
      const useStructuredResponse = Boolean(pendingProxyCounter && pendingProxyResponse);
      const useOpeningProtocol = !useStructuredResponse && !hasSubmittedUserOffer();
      if (!useStructuredResponse && !useOpeningProtocol) {
        composerWeights = composerLocked ? normalizeWeights(composerWeights) : computeWeightsFromAdjustments();
      }
      offerComposer.classList.toggle("locked", composerLocked);
      offerComposer.innerHTML = useStructuredResponse
        ? renderStructuredResponseControls(lockedAttr)
        : useOpeningProtocol
          ? renderOpeningOfferControls(lockedAttr)
          : renderDegreeOfferControls(lockedAttr);

      offerComposer.querySelectorAll("input[type='radio'][data-criterion]").forEach((input) => {
        input.addEventListener("change", (event) => {
          const key = event.target.dataset.criterion;
          composerAdjustments[key] = event.target.value;
          composerWeights = computeWeightsFromAdjustments();
          composerNote = hasSubmittedUserOffer()
            ? "Editing a degree-based response. Send it to update the Self row and ask for the Other-party's reply."
            : "Editing your opening offer. Send it when these degree changes express your position.";
          renderOfferControls();
        });
      });
      offerComposer.querySelectorAll(".opening-act-input").forEach((input) => {
        input.addEventListener("change", (event) => {
          openingActState.type = event.target.value;
          composerWeights = computeWeightsFromOpeningAct();
          composerNote = "Editing your structured opening move. Send it as your first package offer.";
          renderOfferControls();
        });
      });
      const openingScaleSelect = document.getElementById("openingScaleSelect");
      if (openingScaleSelect) {
        openingScaleSelect.addEventListener("change", (event) => {
          openingActState.concessionScale = event.target.value;
          composerWeights = computeWeightsFromOpeningAct();
          renderOfferControls();
        });
      }
      const openingProtectSelect = document.getElementById("openingProtectSelect");
      if (openingProtectSelect) {
        openingProtectSelect.addEventListener("change", (event) => {
          openingActState.protectKey = event.target.value;
          if (openingActState.budgetKey === openingActState.protectKey) {
            openingActState.budgetKey = openingBudgetOptions(openingActState.protectKey)[0]?.key || openingActState.budgetKey;
          }
          composerWeights = computeWeightsFromOpeningAct();
          renderOfferControls();
        });
      }
      const openingBudgetSelect = document.getElementById("openingBudgetSelect");
      if (openingBudgetSelect) {
        openingBudgetSelect.addEventListener("change", (event) => {
          openingActState.budgetKey = event.target.value;
          composerWeights = computeWeightsFromOpeningAct();
          renderOfferControls();
        });
      }
      offerComposer.querySelectorAll(".response-act-input").forEach((input) => {
        input.addEventListener("change", (event) => {
          responseActState.type = event.target.value;
          composerWeights = computeWeightsFromResponseAct();
          composerNote = "Editing a structured negotiation move. Send it as your next counter-offer.";
          renderOfferControls();
        });
      });
      const scaleSelect = document.getElementById("responseScaleSelect");
      if (scaleSelect) {
        scaleSelect.addEventListener("change", (event) => {
          responseActState.concessionScale = event.target.value;
          composerWeights = computeWeightsFromResponseAct();
          renderOfferControls();
        });
      }
      const protectSelect = document.getElementById("responseProtectSelect");
      if (protectSelect) {
        protectSelect.addEventListener("change", (event) => {
          responseActState.protectKey = event.target.value;
          if (responseActState.budgetKey === responseActState.protectKey) {
            responseActState.budgetKey = budgetSourceOptions(responseActState.protectKey)[0]?.key || responseActState.budgetKey;
          }
          composerWeights = computeWeightsFromResponseAct();
          renderOfferControls();
        });
      }
      const budgetSelect = document.getElementById("responseBudgetSelect");
      if (budgetSelect) {
        budgetSelect.addEventListener("change", (event) => {
          responseActState.budgetKey = event.target.value;
          composerWeights = computeWeightsFromResponseAct();
          renderOfferControls();
        });
      }
      const sendButton = document.getElementById("sendOfferButton");
      if (sendButton) {
        sendButton.addEventListener("click", () => {
          if (useStructuredResponse && responseActState.type === "justify") {
            sendStructuredJustificationRequest();
            return;
          }
          if (useStructuredResponse && responseActState.type === "accept_package") {
            const acceptedWeights = normalizeWeights(pendingProxyCounter || composerWeights);
            deactivateChatActions();
            composerLocked = true;
            composerNote = "Accepted. The negotiated criteria contract is locked in the composer.";
            setWeights(acceptedWeights, "Accepted Other-party package");
            setProxyWeights(acceptedWeights);
            addHistory("user", "Accepted Other-party package", "Self accepts the Other-party package as the negotiated criteria contract.", acceptedWeights);
            addHistory("proxy", "Consensus confirmed", "Great. The shared criteria contract now determines the reliability table and final decision chain.", acceptedWeights);
            pendingProxyCounter = null;
            pendingProxyResponse = null;
            renderOfferControls();
            return;
          }
          if (useOpeningProtocol && openingActState.type === "ask_proxy_open") {
            deactivateChatActions();
            addHistory("user", "Ask Other-party to open", openingActSummary(), userWeights);
            openWithProxyOffer();
            return;
          }
          userWeights = normalizeWeights(composerWeights);
          weights = { ...userWeights };
          offerSource = hasSubmittedUserOffer() ? "Self counter-offer" : "Self initial offer";
          pendingProxyCounter = null;
          pendingProxyResponse = null;
          deactivateChatActions();
          addHistory("user", offerSource, useStructuredResponse ? responseActSummary() : useOpeningProtocol ? openingActSummary() : adjustmentSummary(), userWeights);
          renderSummary();
          renderReconciliation();
          renderProxyBox("ask", { skipUserHistory: true });
        });
      }
    }

