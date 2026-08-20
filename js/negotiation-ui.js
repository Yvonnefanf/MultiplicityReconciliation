/* negotiation-ui.js — reconcile view setup, composer, opening/response acts, offer-control rendering
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    // Persona reading and preference elicitation happen on the external study
    // platform, so this page has a single view and nothing to navigate between.
    function enterReconcileView() {
      reconciliationGrid.classList.remove("hidden");
      topToolbar.classList.add("hidden");
      document.body.classList.add("reconcile-mode");
    }

    function startReconciliation() {
      if (!activeData) return;
      applyInitialPreference();
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
        // No second stakeholder is shown here, but the other side's weights still
        // feed the group-reliability comparison, so they stay on the assignment's
        // fixed profile rather than reverting to this case's proxy_weights.
        proxyWeights = normalizeWeights(activeData.assignment?.other_weights || activeData.reconciliation.proxy_weights || weights);
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
        if (typeof wireAggregateRecommendationSlider === "function") wireAggregateRecommendationSlider();
      }
      enterReconcileView();
      if (isNegotiateV2Condition()) {
        composerLocked = false;
        composerNote = "Say what the Other-party's model costs you and what you can give up; the system finds the model that repays them most for it.";
        nv2Rerender();
      } else {
        beginUserOpeningOffer(elicitedWeights, "Elicited preference baseline");
      }
    }

    function initializePersonaPreference() {
      if (!activeData) return;
      currentPersona = makePersonaPreference();
      currentPersona.salienceParams = currentSalienceParams();
      applyInitialPreference();
      // The participant's weights come from outside, so the role they speak from
      // carries those weights and their implied ranking rather than the role
      // template: otherwise their negotiation floors and targets would guard a
      // criterion the platform never said they cared about.
      currentPersona.weights = { ...elicitedWeights };
      currentPersona.rankOrder = [...rankedCriteria];
      applySalienceParamsToCurrentPersona();
      proxyPersona = makeProxyPersonaPreference(currentPersona.key);
      personaInitialWeights = normalizeWeights(currentPersona.weights);
      resetNegotiationState("Start from your stated preference and send your first package offer.");
      setWeights(elicitedWeights, "Elicited initial offer");
    }

    function historyTextForExport(html) {
      const element = document.createElement("div");
      element.innerHTML = html || "";
      return element.textContent.replace(/\s+/g, " ").trim();
    }

    function emitQualtricsNegotiationEvent(type, payload = {}) {
      const params = new URLSearchParams(window.location.search);
      window.parent.postMessage({
        source: "multiplicity-reconciliation",
        protocol: "negotiatev2",
        type,
        timestamp: new Date().toISOString(),
        payload: {
          caseId: params.get("case"),
          persona: params.get("persona"),
          appId: params.get("appId"),
          ...payload,
        },
      }, "*");
    }

    function addHistory(role, title, text, eventWeights = weights, extra = {}) {
      const event = { role, title, text, weights: eventWeights ? { ...eventWeights } : null, ...extra };
      negotiationEvents.push(event);
      if (isNegotiateV2Condition()) {
        emitQualtricsNegotiationEvent("history_added", {
          role,
          title,
          text: historyTextForExport(text),
          weights: event.weights,
        });
      }
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
      // Only the offers are numbered; system notes are asides, not turns.
      let turn = 0;
      negotiationHistory.innerHTML = negotiationEvents.map((event) => {
        const isSystem = event.role === "system";
        if (!isSystem) turn += 1;
        return `
        <div class="history-item ${event.role}${event.actionable ? " actionable" : ""}">
          <div class="history-title">${isSystem ? "" : `${turn}. `}${event.title}</div>
          <div>${event.text}</div>
          ${event.weights ? `<div class="history-weights">${shortWeights(event.weights)}</div>` : ""}
        </div>
      `;
      }).join("");
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
      if (!features || !activeData) return;
      features.innerHTML = renderFeatureExplanation(activeData.dataset || datasetSelect.value, selectedDefaultModel());
      if (typeof wireAggregateRecommendationSlider === "function") wireAggregateRecommendationSlider();
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


    /* ==================================================================
       negotiatev2 — model-space negotiation (core condition)

       The negotiated object is a MODEL drawn from the Pareto-optimal option
       set, never a weight vector. Each side's elicited weights stay FIXED as
       a private utility function, so "giving ground" happens in outcome
       space and never implies that a stakeholder's values changed.

       Protocol: alternating offers. Both sides open at v0 (each side's own
       utility-maximising model, normally in conflict). A move is an
       integrative package —
         model choice : pick the concrete model tradeoff you can live with
         cost         : what this model gives up on your side
         payback      : what this model improves for the other side
       — and the system lets the receiver accept or answer with its own model
       tradeoff under a time-dependent reservation level (Faratin-style
       concession tactics).
       The receiver accepts (AOP rule: the offer is at least as good as its
       own best planned counter) or counters. Capped at v3 per side; no
       agreement by then is a genuine impasse, not a forced merge.
       ================================================================== */

    const NV2_MAX_VERSION = 3;
    // The legacy give-budget bands still drive the scripted wording and the
    // automated Other-party move. The user-facing model picker hides the exact
    // amount behind hover/details and speaks in the same qualitative bands.
    const NV2_GIVE_STEPS = [
      { key: "small", label: "A little", value: 0.02 },
      { key: "medium", label: "A fair amount", value: 0.05 },
      { key: "large", label: "A lot", value: 0.09 },
    ];
    // "2 points" — the participant-facing unit for a give budget.
    const nv2Points = (value) => `${Math.round(Number(value) * 100)} point${Math.round(Number(value) * 100) === 1 ? "" : "s"}`;
    // Share of the distance from "my own best model" to "their opening model"
    // that I am willing to give up by version t. Boulware-ish: hold early,
    // concede near the deadline, never concede the whole distance.
    const NV2_CONCESSION_SCHEDULE = [0, 0.34, 0.62, 0.84];
    const NV2_DEMAND_EPSILON = 0.005;
    const NV2_ACCEPT_TOLERANCE = 0.004;
    /* ---- how movement gets said out loud ---------------------------------
       Every fact in this protocol is a share between 0 and 1, and the first
       version of the dialogue simply read them out: half a dozen percentages
       per turn, with the argument buried underneath. Nobody negotiates that
       way — a stakeholder says "I can give a little there", not "I come down
       from 81% to 76%". These bands are the entire quantitative vocabulary of
       the conversation, used by the offline wording and by the payload the LLM
       voices, so a move is sized the same way whichever path produced the text.
       The exact values are not lost: they stay in the offer breakdown behind
       the composer's "…" and in the model panels, which is where someone who
       wants to audit a number will actually look.
       ---------------------------------------------------------------------- */
    const NV2_COST_SIZE_BANDS = [
      { max: 0.03, amount: "a little", shortfall: "a little short of" },
      { max: 0.08, amount: "a fair amount", shortfall: "well short of" },
      { max: Infinity, amount: "some", shortfall: "far short of" },
    ];
    const NV2_GAIN_SIZE_BANDS = [
      { max: 0.03, amount: "a little" },
      { max: 0.08, amount: "a fair amount" },
      { max: Infinity, amount: "a lot" },
    ];

    function nv2Band(delta, bands = NV2_COST_SIZE_BANDS) {
      const size = Math.abs(Number(delta) || 0);
      return bands.find((band) => size < band.max) || bands[bands.length - 1];
    }

    // Costs sound deliberately softer than gains: "some" vs "a lot" at the top band.
    const nv2CostAmount = (delta) => nv2Band(delta, NV2_COST_SIZE_BANDS).amount;
    const nv2GainAmount = (delta) => nv2Band(delta, NV2_GAIN_SIZE_BANDS).amount;
    // "a little short of" / "well short of" / "far short of" — the size of a gap.
    const nv2Shortfall = (delta) => nv2Band(delta).shortfall;

    function nv2OtherSide(side) {
      return side === "self" ? "other" : "self";
    }

    function nv2CaseKey() {
      return `${activeData?.dataset ?? datasetSelect?.value ?? ""}:${activeData?.case?.test_case_index ?? caseSelect?.value ?? ""}`;
    }

    // A negotiation belongs to one case: its option set, anchors and offer
    // tracks are all built from that case's models. Carrying it into the next
    // case would silently negotiate over models that are no longer on screen.
    function nv2EnsureForCurrentCase() {
      if (!activeData) return null;
      if (!nv2 || nv2.caseKey !== nv2CaseKey()) resetNegotiateV2State();
      return nv2;
    }

    function nv2SideLabel(side) {
      return side === "self" ? "Self" : "Other-party";
    }

    function nv2MetricValue(model, key) {
      const value = modelCriterionValue(model, key);
      return Number.isFinite(value) ? value : null;
    }

    function nv2Utility(model, side) {
      if (!model || !nv2) return 0;
      return modelWeightedUtility(model, nv2.weights[side]);
    }

    // Estimate which final decision is better before the outcome is known.
    // The probability comes only from the current case's Rashomon predictions;
    // unlike the offline evaluator, this never reads the case's true label.
    // TPR/TNR are decision-direction benefits, and fairness is the observed
    // consistency of the models already predicting that label.
    function nv2ExpectedDecisionDirection() {
      if (!nv2 || !activeData) return null;
      const models = (activeData.models || []).filter(Boolean);
      if (!models.length) return null;
      const probabilities = models
        .map((model) => Number(model.pred_prob))
        .filter(Number.isFinite)
        .map((value) => Math.max(0, Math.min(1, value)));
      const positiveProbability = probabilities.length
        ? probabilities.reduce((total, value) => total + value, 0) / probabilities.length
        : models.filter((model) => Number(model.pred_class) === 1).length / models.length;
      const groups = activeData.reconciliation?.groups || [];
      const summaries = Array.isArray(activeData.summary) ? activeData.summary : [];
      const fairnessFor = (label) => {
        const group = groups.find((item) => Number(item.class_id) === label);
        const summary = summaries.find((item) => Number(item.class_id) === label);
        const values = [
          group?.criteria?.local_consistency,
          group?.fairness_components?.local_consistency,
          summary?.avg_local_consistency,
          summary?.avg_similar_100_case_fairness,
        ];
        const value = values.map(Number).find(Number.isFinite);
        return Number.isFinite(value) ? value : 0;
      };
      const rows = [0, 1].map((label) => {
        const performance = {
          accuracy: label === 1 ? positiveProbability : 1 - positiveProbability,
          tpr: label === 1 ? 1 : 0,
          tnr: label === 0 ? 1 : 0,
          local_consistency: fairnessFor(label),
        };
        const utilityFor = (side) => {
          // Keep this on the elicited weights themselves. The label-utility
          // evaluator uses those weights directly; redistributing an inactive
          // model criterion here would optimize a different objective.
          const rowWeights = nv2.weights[side];
          return criteriaOrder.reduce(
            (total, key) => total + (rowWeights[key] || 0) * (performance[key] || 0),
            0
          );
        };
        const selfUtility = utilityFor("self");
        const otherUtility = utilityFor("other");
        return { label, selfUtility, otherUtility, jointUtility: selfUtility + otherUtility };
      }).sort((a, b) => b.jointUtility - a.jointUtility || a.label - b.label);
      const margin = rows[0].jointUtility - rows[1].jointUtility;
      return {
        // Always take the expected-joint argmax. Even when the margin is small,
        // this guarantees that the production policy never knowingly chooses
        // a lower-scoring decision direction; exact ties resolve to label 0.
        preferredLabel: rows[0].label,
        margin,
        positiveProbability,
        byLabel: rows,
      };
    }

    // Direction is a feasibility preference, not a new hard constraint: if a
    // round has no rational offer in the preferred label, retain the original
    // feasible set rather than forcing an impossible or one-sided move.
    function nv2PreferExpectedDecision(items, modelForItem = (item) => item) {
      const preferredLabel = nv2?.decisionDirection?.preferredLabel;
      if (preferredLabel == null) return items;
      const aligned = items.filter((item) => Number(modelForItem(item)?.pred_class) === Number(preferredLabel));
      return aligned.length ? aligned : items;
    }

    function nv2FollowsExpectedDecision(model) {
      const preferredLabel = nv2?.decisionDirection?.preferredLabel;
      return preferredLabel == null || Number(model?.pred_class) === Number(preferredLabel);
    }

    function nv2ModelBySeed(seed) {
      return (activeData?.models || []).find((model) => String(model.seed) === String(seed)) || null;
    }

    function nv2BestModelFor(side, pool = nv2?.options || []) {
      return pool.slice().sort((a, b) => {
        const delta = nv2Utility(b, side) - nv2Utility(a, side);
        if (Math.abs(delta) > 0.000001) return delta;
        return Number(b.pred_prob || 0) - Number(a.pred_prob || 0);
      })[0] || null;
    }

    function nv2Track(side) {
      return nv2?.[side]?.track || [];
    }

    // The side's live bargaining position (its most recent stated model).
    function nv2Position(side) {
      const track = nv2Track(side);
      return track[track.length - 1] || null;
    }

    // The position the participant is currently *looking at* (version dropdown).
    function nv2ViewedPosition(side) {
      const track = nv2Track(side);
      if (!track.length) return null;
      const index = Math.max(0, Math.min(track.length - 1, Number(nv2[side].viewIndex) || 0));
      return track[index];
    }

    function nv2NextVersion() {
      return nv2Track("self").length;
    }

    function nv2PredictionLabel(model) {
      if (!model) return "-";
      return activeData?.label_names?.[model.pred_class] || `Class ${model.pred_class}`;
    }

    function nv2ModelTag(model) {
      return model ? `#${model.seed ?? model.id ?? "?"}` : "-";
    }

    /* The one criterion a side is publicly identified with. Every part of the
       app that names "what this role cares about most" has to agree — the
       identity banner, the M/O markers on the criteria table, the give-ground
       exclusions, the limit a side refuses to trade, and the criterion it
       argues from. They all read it from the same weights, here, so a Judges
       proxy can never be introduced as caring about Accuracy and then be heard
       arguing about something else. */
    function nv2HeadlineCriterion(side) {
      return topMetricKeyForWeights(nv2.weights[side]);
    }

    /* Beat (2) of every turn. Only the headline criterion may be spoken as the
       role's mandate — "what I have to answer for". When the other side's model
       already satisfies that criterion, the grievance moves to a secondary one,
       and saying "my role has to answer for X" there would introduce a
       stakeholder the participant was never told about. Same fact, weaker
       claim: it costs me, it is not what I am here for. */
    function nv2ComplaintLine({ modelPhrase, label, shortfall, headline, headlineLabel = "", tail = "" }) {
      if (headline) {
        return `${modelPhrase} sits ${shortfall} what I have to answer for on <strong>${escapeHtml(label)}</strong>${tail}.`;
      }
      // Off the headline criterion the sentence has to work harder: it names the
      // criterion this role IS known for and says the offer already covers it —
      // which is both true (that is why the grievance moved) and the reason this
      // side is still countering rather than accepting. Without it a Judges
      // proxy can spend a whole turn talking only about Protect Innocents.
      return headlineLabel
        ? `${modelPhrase} gets <strong>${escapeHtml(headlineLabel)}</strong> where I need it, but it still costs me on ${escapeHtml(label)}, ${shortfall} where mine sits${tail}.`
        : `${modelPhrase} also costs me on ${escapeHtml(label)}, ${shortfall} where mine sits${tail}.`;
    }

    // How much criterion `key` costs `side` when it looks at `targetModel`
    // instead of its own current position: the complaint ranking.
    function nv2Complaints(side, targetModel) {
      const own = nv2Position(side)?.model;
      const rowWeights = nv2.weights[side];
      const headline = nv2HeadlineCriterion(side);
      const ranked = criteriaOrder
        .map((key) => {
          const mine = nv2MetricValue(own, key);
          const theirs = nv2MetricValue(targetModel, key);
          const gap = mine != null && theirs != null ? mine - theirs : 0;
          const weight = rowWeights[key] || 0;
          // `headline` travels with the complaint so every wording path knows
          // whether this grievance may be spoken as the role's mandate or only
          // as a secondary cost. See nv2ComplaintLine.
          return { key, label: criteriaLabels[key] || key, mine, theirs, gap, weight, cost: weight * Math.max(0, gap), headline: key === headline };
        })
        .sort((a, b) => b.cost - a.cost || b.weight - a.weight);
      // Ranking on weight x gap alone let a lightly-weighted criterion with a
      // huge gap outrank the role's own priority: a Judges proxy introduced as
      // caring about Accuracy would open by demanding Protect Innocents, which
      // is a defensible utility move and an incoherent stakeholder. So the
      // headline criterion leads whenever it is genuinely short-changed; the
      // rest keep the cost order behind it. When it is already satisfied there
      // is nothing to misrepresent, and the cost ranking stands as it was.
      const lead = ranked.find((item) => item.key === headline);
      if (!lead || lead.gap <= 0.005) return ranked;
      return [lead, ...ranked.filter((item) => item.key !== headline)];
    }

    /* ---- which criterion may be given ground on ---------------------------
       "Giving ground" here means one specific thing: my NEXT model is allowed
       to score lower on that criterion than my current one. Three criteria can
       never carry that permission:

         - the criterion I am demanding, because the same model cannot move up
           and down on one axis in one move;
         - MY top-priority criterion, because it is the thing I am negotiating
           for — relaxing it concedes the case rather than trading in it;
         - THEIR top-priority criterion, because a model that scores lower there
           is worse for them. In outcome space a "concession" on the other
           side's number-one is not a gift, it is the opposite of one, and an
           offer built on it can never be the offer that repays them most.

       The last rule inverts the classic logrolling heuristic ("concede what is
       cheap for me and dear to them"), which only holds when the concession is
       a transfer. Here it is a degradation, so what we want to relax is what is
       cheap for BOTH of us — that is the slack the search spends on buying them
       an improvement where it actually counts.
       ---------------------------------------------------------------------- */
    function nv2ProtectedGiveKeys(side) {
      return new Set([
        nv2HeadlineCriterion(side),
        nv2HeadlineCriterion(nv2OtherSide(side)),
      ]);
    }

    function nv2GiveOptions(side, demandKey) {
      const other = nv2OtherSide(side);
      const mine = nv2.weights[side];
      const theirs = nv2.weights[other];
      const own = nv2Position(side)?.model;
      const blocked = nv2ProtectedGiveKeys(side);
      const eligible = criteriaOrder.filter((key) => key !== demandKey && !blocked.has(key));
      // Four criteria and at most three exclusions, so this cannot empty; the
      // fallback exists so a future criteria set cannot silently strand the UI.
      const pool = eligible.length ? eligible : criteriaOrder.filter((key) => key !== demandKey);
      return pool
        .map((key) => ({
          key,
          label: criteriaLabels[key] || key,
          mineWeight: mine[key] || 0,
          theirWeight: theirs[key] || 0,
          // Joint cost of letting this slip: what it takes off my utility plus
          // what it takes off theirs. Cheapest first.
          jointCost: (mine[key] || 0) + (theirs[key] || 0),
          current: nv2MetricValue(own, key),
        }))
        .sort((a, b) => a.jointCost - b.jointCost || a.mineWeight - b.mineWeight);
    }

    // Default pick for a side that is not choosing for itself (the automated
    // Other-party) and the initial selection in the participant's draft.
    function nv2DefaultGiveKey(side, demandKey) {
      return nv2GiveOptions(side, demandKey)[0]?.key || null;
    }

    function nv2GiveStep(stepKey) {
      return NV2_GIVE_STEPS.find((item) => item.key === stepKey) || NV2_GIVE_STEPS[1];
    }

    // Reservation utility at version t: how far down my own utility scale I am
    // prepared to travel, measured from my opening model toward theirs.
    function nv2Reservation(side, versionIndex) {
      const anchors = nv2?.anchors?.[side];
      if (!anchors) return 0;
      const t = Math.max(0, Math.min(NV2_MAX_VERSION, Number(versionIndex) || 0));
      const share = NV2_CONCESSION_SCHEDULE[t] ?? NV2_CONCESSION_SCHEDULE[NV2_CONCESSION_SCHEDULE.length - 1];
      return anchors.best - (anchors.best - anchors.atTheirBest) * share;
    }

    // Search the option set for the package this side should put on the table.
    // Constraints relax in tiers so the composer always previews something.
    function nv2SearchOffer(side, { demandKey, giveKey, giveAmount, versionIndex, targetModel = null, improvementTarget = null }) {
      const other = nv2OtherSide(side);
      const own = nv2Position(side)?.model;
      const target = targetModel || nv2Position(other)?.model;
      const pool = nv2.options || [];
      const giveBase = nv2MetricValue(own, giveKey);
      const giveFloor = giveBase == null ? -Infinity : giveBase - giveAmount;
      const demandBase = nv2MetricValue(target, demandKey);
      const demandFloor = demandBase == null ? -Infinity : demandBase + NV2_DEMAND_EPSILON;
      const reservation = nv2Reservation(side, versionIndex);
      // The declared criterion carries the full concession budget; everything
      // else may only slip half as far. Without this the search would quietly
      // take the loss somewhere the participant never agreed to, and the
      // "where can you give ground" control would be decorative.
      const collateralBudget = giveAmount * 0.5;
      const withinGive = (model) => {
        const declared = nv2MetricValue(model, giveKey);
        if (declared != null && declared < giveFloor - 1e-9) return false;
        return criteriaOrder.every((key) => {
          // The demanded criterion is exempt from the cap on purpose. When both
          // sides sit at opposite ends of the same axis, that axis is the only
          // currency either has: the mover converges down from its own maximum
          // while still demanding far more than the other side currently gives.
          // Capping it here starved the search and drove 19 of 20 cases to
          // impasse. The narrative stays honest because both numbers are shown.
          if (key === giveKey || key === demandKey) return true;
          const before = nv2MetricValue(own, key);
          const after = nv2MetricValue(model, key);
          if (before == null || after == null) return true;
          return before - after <= collateralBudget + 1e-9;
        });
      };
      const meetsDemand = (model) => {
        const value = nv2MetricValue(model, demandKey);
        return value == null || value >= demandFloor;
      };
      const aboveReservation = (model) => nv2Utility(model, side) >= reservation - 1e-9;
      const tiers = [
        { name: "full", test: (model) => withinGive(model) && meetsDemand(model) && aboveReservation(model) },
        { name: "drop_demand", test: (model) => withinGive(model) && aboveReservation(model) },
        { name: "drop_reservation", test: (model) => withinGive(model) && meetsDemand(model) },
        { name: "budget_only", test: withinGive },
      ];
      // How much better the offer has to be for the receiver before it counts as
      // a real move. The declared concession size sets the bar: a bigger
      // concession promises them a bigger gain.
      const ownForThem = nv2Utility(own, other);
      const moveBar = Number.isFinite(improvementTarget) ? improvementTarget : giveAmount;
      for (const tier of tiers) {
        const allFeasible = pool.filter(tier.test);
        if (!allFeasible.length) continue;
        const allMoving = allFeasible.filter((model) => nv2Utility(model, other) - ownForThem >= moveBar - 1e-9);
        const moving = nv2PreferExpectedDecision(allMoving);
        const feasible = nv2PreferExpectedDecision(allFeasible);
        // Concede the least that still moves them. Maximising *their* utility
        // instead would spend the whole reservation budget in one round, which
        // is not how a negotiator behaves — it is capitulation.
        const pick = moving.length
          ? moving.slice().sort((a, b) => {
              const delta = nv2Utility(b, side) - nv2Utility(a, side);
              if (Math.abs(delta) > 0.000001) return delta;
              return nv2Utility(b, other) - nv2Utility(a, other);
            })[0]
          : feasible.slice().sort((a, b) => {
              const delta = nv2Utility(b, other) - nv2Utility(a, other);
              if (Math.abs(delta) > 0.000001) return delta;
              return nv2Utility(b, side) - nv2Utility(a, side);
            })[0];
        if (pick && pick !== own && nv2Utility(pick, other) > ownForThem + 1e-6) {
          return { model: pick, tier: tier.name, reservation, giveFloor, demandFloor, reachedTarget: moving.length > 0, held: false };
        }
      }
      // v0 is intentionally unconstrained, but a side that is still standing
      // on the opposite decision by v2 must actually start converging. Choose
      // the best direction-aligned model that remains above reservation when
      // possible; this is a late fallback, not an opening-position rewrite.
      if (versionIndex >= 2 && !nv2FollowsExpectedDecision(own)) {
        const directional = pool.filter((model) => model !== own && nv2FollowsExpectedDecision(model));
        const individuallyRational = directional.filter(aboveReservation);
        const candidates = individuallyRational.length ? individuallyRational : directional;
        const pick = candidates.slice().sort((a, b) => {
          const jointDelta = (nv2Utility(b, side) + nv2Utility(b, other)) - (nv2Utility(a, side) + nv2Utility(a, other));
          if (Math.abs(jointDelta) > 0.000001) return jointDelta;
          return nv2Utility(b, side) - nv2Utility(a, side);
        })[0];
        if (pick) {
          return { model: pick, tier: "decision_direction", reservation, giveFloor, demandFloor, reachedTarget: false, held: false };
        }
      }
      return { model: own, tier: "held", reservation, giveFloor, demandFloor, reachedTarget: false, held: true };
    }

    // What the offered model buys the receiving side, relative to the mover's
    // previous position — the "what's in it for you" line of the package.
    function nv2PaybackFor(side, offerModel, previousModel) {
      const other = nv2OtherSide(side);
      const theirs = nv2.weights[other];
      return criteriaOrder
        .map((key) => {
          const before = nv2MetricValue(previousModel, key);
          const after = nv2MetricValue(offerModel, key);
          const gain = before != null && after != null ? after - before : 0;
          return { key, label: criteriaLabels[key] || key, before, after, gain, value: (theirs[key] || 0) * gain };
        })
        .sort((a, b) => b.value - a.value)[0] || null;
    }

    // What the move actually cost the mover. The declared criterion is only a
    // permission — report where the loss really landed, otherwise the message
    // can claim a concession that the offered model never made.
    function nv2ConcessionDetail(side, offerModel, previousModel, giveKey) {
      const drops = criteriaOrder
        .map((key) => {
          const before = nv2MetricValue(previousModel, key);
          const after = nv2MetricValue(offerModel, key);
          return { key, label: criteriaLabels[key] || key, before, after, drop: before != null && after != null ? before - after : 0 };
        })
        .filter((item) => item.drop > 0.001)
        .sort((a, b) => b.drop - a.drop);
      const declared = drops.find((item) => item.key === giveKey);
      if (declared) return { ...declared, asDeclared: true };
      if (drops.length) return { ...drops[0], asDeclared: false };
      const before = nv2MetricValue(previousModel, giveKey);
      return { key: giveKey, label: criteriaLabels[giveKey] || giveKey, before, after: nv2MetricValue(offerModel, giveKey), drop: 0, asDeclared: true };
    }

    // The automated Other-party's own move: same package structure, chosen for
    // it rather than by it, so the LLM never invents a bargaining position.
    function nv2AutoMove(side, incomingModel, versionIndex, receivedGain = null) {
      const complaints = nv2Complaints(side, incomingModel);
      const demandKey = complaints[0]?.key || criteriaOrder[0];
      const giveKey = nv2DefaultGiveKey(side, demandKey) || criteriaOrder.find((key) => key !== demandKey) || criteriaOrder[0];
      // Tit-for-tat: answer a concession with a concession, and a stonewall
      // with a stonewall. Without this the other side keeps sweetening against
      // a party that never moves, and impasse becomes unreachable.
      const needsDecisionMove = !nv2FollowsExpectedDecision(nv2Position(side)?.model);
      if (Number.isFinite(receivedGain) && receivedGain <= 0.001 && !(needsDecisionMove && versionIndex >= 2)) {
        return {
          model: nv2Position(side)?.model,
          tier: "hold",
          held: true,
          stonewalled: true,
          reachedTarget: false,
          demandKey,
          giveKey,
          giveAmount: 0,
          reciprocal: 0,
          complaint: complaints[0] || null,
        };
      }
      // Norm of reciprocity: answer the concession you were just handed rather
      // than running a fixed schedule. A fixed schedule lets whichever side
      // moves first be walked down alone, which reads as bad faith.
      const reciprocal = Number.isFinite(receivedGain)
        ? Math.max(0.015, Math.min(0.12, receivedGain))
        : 0.02 + 0.03 * Math.max(0, Math.min(NV2_MAX_VERSION - 1, versionIndex - 1));
      const giveAmount = Math.max(0.02, Math.min(0.12, reciprocal * 1.5));
      const search = nv2SearchOffer(side, { demandKey, giveKey, giveAmount, versionIndex, targetModel: incomingModel, improvementTarget: reciprocal });
      return { ...search, demandKey, giveKey, giveAmount, reciprocal, complaint: complaints[0] || null };
    }

    // Alternating-offers acceptance: take the offer when countering cannot
    // realistically do better, or when the deadline makes holding out worse.
    function nv2AcceptanceDecision(side, offerModel, versionIndex, receivedGain = null) {
      const utility = nv2Utility(offerModel, side);
      const plan = nv2AutoMove(side, offerModel, versionIndex, receivedGain);
      const counterUtility = plan.model ? nv2Utility(plan.model, side) : utility;
      const reservation = nv2Reservation(side, versionIndex);
      // The opening optima may disagree, but accepting an off-direction model
      // after bargaining starts would undo the case-level joint decision goal.
      if (!nv2FollowsExpectedDecision(offerModel)) {
        return { accept: false, reason: "lower_expected_joint_decision", utility, counterUtility, reservation, plan };
      }
      if (utility >= counterUtility - NV2_ACCEPT_TOLERANCE) {
        return { accept: true, reason: "no_better_counter", utility, counterUtility, reservation, plan };
      }
      if (utility >= reservation) {
        if (versionIndex >= NV2_MAX_VERSION) return { accept: true, reason: "deadline", utility, counterUtility, reservation, plan };
        return { accept: false, reason: "can_improve", utility, counterUtility, reservation, plan };
      }
      return { accept: false, reason: "below_reservation", utility, counterUtility, reservation, plan };
    }

    function nv2PushPosition(side, entry) {
      nv2[side].track.push(entry);
      nv2[side].viewIndex = nv2[side].track.length - 1;
    }

    function nv2EnsureDraft() {
      if (!nv2) return null;
      const target = nv2Position("other")?.model;
      const complaints = nv2Complaints("self", target);
      const real = complaints.filter((item) => item.gap > 0.005);
      // Reset a stale demand too, not just a missing one: as the models move, a
      // criterion can stop being a grievance, and leaving it selected would
      // desync the dropdown (which no longer lists it) from the draft state.
      const stillValid = (real.length ? real : complaints).some((item) => item.key === nv2.draft.demandKey);
      if (!criteriaOrder.includes(nv2.draft.demandKey) || !stillValid) {
        nv2.draft.demandKey = (real[0] || complaints[0])?.key || rankedCriteria?.[0] || criteriaOrder[0];
      }
      // The give list is derived (it drops the demanded criterion and both
      // sides' top priorities), so validate the draft against the list itself
      // rather than against criteriaOrder — otherwise changing the demand can
      // leave a giveKey selected that the dropdown no longer offers.
      const giveOptions = nv2GiveOptions("self", nv2.draft.demandKey);
      if (!giveOptions.some((item) => item.key === nv2.draft.giveKey)) {
        nv2.draft.giveKey = giveOptions[0]?.key || criteriaOrder.find((key) => key !== nv2.draft.demandKey) || criteriaOrder[0];
      }
      if (!NV2_GIVE_STEPS.some((item) => item.key === nv2.draft.giveStep)) nv2.draft.giveStep = "medium";
      return nv2.draft;
    }

    function nv2PreviewOffer() {
      const draft = nv2EnsureDraft();
      if (!draft) return null;
      const versionIndex = Math.min(NV2_MAX_VERSION, nv2NextVersion());
      const search = nv2SearchOffer("self", {
        demandKey: draft.demandKey,
        giveKey: draft.giveKey,
        giveAmount: nv2GiveStep(draft.giveStep).value,
        versionIndex,
      });
      return { ...search, versionIndex, demandKey: draft.demandKey, giveKey: draft.giveKey };
    }

    function nv2PointLabel(value) {
      const points = Math.max(0, Math.round(Math.abs(Number(value) || 0) * 100));
      return `${points} point${points === 1 ? "" : "s"}`;
    }

    function nv2ModelSeed(model) {
      return String(model?.seed ?? model?.id ?? "");
    }

    function nv2TopChange(fromModel, toModel, rowWeights, direction = "gain", blockedKeys = new Set()) {
      const rows = criteriaOrder
        .filter((key) => !blockedKeys.has(key))
        .map((key) => {
          const before = nv2MetricValue(fromModel, key);
          const after = nv2MetricValue(toModel, key);
          const delta = before != null && after != null ? after - before : 0;
          const amount = direction === "drop" ? Math.max(0, -delta) : Math.max(0, delta);
          return {
            key,
            label: criteriaLabels[key] || key,
            before,
            after,
            amount,
            weighted: amount * (rowWeights?.[key] || 0),
          };
        })
        .filter((item) => item.amount > 0.001)
        .sort((a, b) => b.weighted - a.weighted || b.amount - a.amount);
      return rows[0] || null;
    }

    function nv2CandidateFromModel(model, versionIndex) {
      const previousModel = nv2Position("self")?.model;
      const targetModel = nv2Position("other")?.model;
      if (!model || !previousModel || !targetModel) return null;
      if (nv2ModelSeed(model) === nv2ModelSeed(previousModel)) return null;
      const selfUtility = nv2Utility(model, "self");
      const otherUtility = nv2Utility(model, "other");
      const previousSelfUtility = nv2Utility(previousModel, "self");
      const previousOtherUtility = nv2Utility(previousModel, "other");
      const reservation = nv2Reservation("self", versionIndex);
      const demand = nv2TopChange(targetModel, model, nv2.weights.self, "gain");
      const sacrifice = nv2TopChange(previousModel, model, nv2.weights.self, "drop");
      const payback = nv2TopChange(previousModel, model, nv2.weights.other, "gain");
      const fallbackDemand = demand?.key || nv2Complaints("self", targetModel)[0]?.key || nv2HeadlineCriterion("self");
      const blocked = new Set([fallbackDemand]);
      const fallbackGive = sacrifice?.key || nv2DefaultGiveKey("self", fallbackDemand) || criteriaOrder.find((key) => !blocked.has(key)) || criteriaOrder[0];
      const jointUtility = selfUtility + otherUtility;
      const previousJointUtility = previousSelfUtility + previousOtherUtility;
      return {
        model,
        versionIndex,
        demandKey: fallbackDemand,
        giveKey: fallbackGive,
        sacrifice,
        payback,
        selfUtility,
        otherUtility,
        previousSelfUtility,
        previousOtherUtility,
        jointUtility,
        previousJointUtility,
        selfLoss: previousSelfUtility - selfUtility,
        otherGain: otherUtility - previousOtherUtility,
        jointGain: jointUtility - previousJointUtility,
        reservation,
        aboveReservation: selfUtility >= reservation - 1e-9,
        hasSelfReason: Boolean(demand && demand.amount > 0.001),
      };
    }

    function nv2OfferCandidates() {
      if (!nv2) return [];
      const versionIndex = Math.min(NV2_MAX_VERSION, nv2NextVersion());
      const evaluated = (nv2.options || [])
        .map((model) => nv2CandidateFromModel(model, versionIndex))
        .filter(Boolean);
      const improving = evaluated
        .filter((item) => item && item.jointGain > 0.001 && item.otherGain > 0.001);
      // Crossing into the better decision can be worthwhile even when the
      // concrete model tradeoff is not model-utility-positive by itself. Keep
      // such a direction-aligned fallback so the dropdown cannot strand Self
      // on the wrong v0 label.
      const offerable = improving.length ? improving : evaluated.filter((item) => nv2FollowsExpectedDecision(item.model));
      // Never guide Self below its current reservation when at least one
      // individually acceptable direction-aligned offer exists.
      const acceptable = offerable.filter((item) => item.aboveReservation);
      const rational = acceptable.length ? acceptable : offerable;
      return nv2PreferExpectedDecision(rational, (item) => item.model)
        .sort((a, b) => {
          const jointDelta = b.jointUtility - a.jointUtility;
          if (Math.abs(jointDelta) > 0.000001) return jointDelta;
          const selfDelta = b.selfUtility - a.selfUtility;
          if (Math.abs(selfDelta) > 0.000001) return selfDelta;
          return b.otherUtility - a.otherUtility;
        })
        .slice(0, 5);
    }

    function nv2CandidateOptionText(candidate) {
      if (!candidate) return "";
      const sacrifice = candidate.sacrifice
        ? `give up ${nv2CostAmount(candidate.sacrifice.amount)} on your ${candidate.sacrifice.label}`
        : "give up nothing measurable";
      const payback = candidate.payback
        ? `help them ${nv2GainAmount(candidate.payback.amount)} on ${candidate.payback.label}`
        : `improve the overall deal ${nv2GainAmount(candidate.jointGain)}`;
      return `${nv2ModelTag(candidate.model)}: ${sacrifice}; ${payback}; predicts ${nv2PredictionLabel(candidate.model)}`;
    }

    function nv2CandidateOptionTitle(candidate) {
      if (!candidate) return "";
      const sacrifice = candidate.sacrifice
        ? `Your ${candidate.sacrifice.label}: ${fmtPct(candidate.sacrifice.before)} -> ${fmtPct(candidate.sacrifice.after)} (${nv2PointLabel(candidate.sacrifice.amount)} lower)`
        : "No measurable drop on your criteria";
      const payback = candidate.payback
        ? `Their ${candidate.payback.label}: ${fmtPct(candidate.payback.before)} -> ${fmtPct(candidate.payback.after)} (${nv2PointLabel(candidate.payback.amount)} higher)`
        : `Joint utility improves by ${nv2PointLabel(candidate.jointGain)}`;
      return `${nv2ModelTag(candidate.model)} (${nv2PredictionLabel(candidate.model)}). ${sacrifice}. ${payback}.`;
    }

    function nv2EnsureSelectedCandidate() {
      const draft = nv2EnsureDraft();
      const candidates = nv2OfferCandidates();
      if (!draft) return { draft: null, candidates, selected: null };
      const selected = candidates.find((item) => nv2ModelSeed(item.model) === String(draft.selectedModelSeed));
      const next = selected || candidates[0] || null;
      if (next) {
        draft.selectedModelSeed = nv2ModelSeed(next.model);
        draft.demandKey = next.demandKey;
        draft.giveKey = next.giveKey;
      }
      return { draft, candidates, selected: next };
    }

    function nv2SelectedOfferCandidate() {
      return nv2EnsureSelectedCandidate().selected;
    }

    function resetNegotiateV2State() {
      if (!activeData) return;
      ensureDifferentProxyPersona();
      const allModels = activeData.models || [];
      const frontier = paretoOptimalModels(allModels);
      const options = frontier.length ? frontier : allModels;
      const selfWeights = normalizeWeights(elicitedWeights || userWeights || weights);
      const otherWeights = normalizeWeights(proxyWeights || proxyIdealWeights());
      // Weights are captured once and never mutated again: they are each
      // side's private, stable utility function for the whole negotiation.
      nv2 = {
        caseKey: nv2CaseKey(),
        options,
        weights: { self: selfWeights, other: otherWeights },
        anchors: {},
        self: { track: [], viewIndex: 0 },
        other: { track: [], viewIndex: 0 },
        status: "open",
        agreed: null,
        pending: null,
        decisionDirection: null,
        draft: { demandKey: null, giveKey: null, giveStep: "medium", selectedModelSeed: null },
        mutualHolds: 0,
        log: [],
      };
      // Opening positions remain the two unconstrained stakeholder optima.
      // The expected joint-decision direction guides negotiation only after
      // v0; applying it before these anchors would manufacture agreement at
      // the opening instead of letting the parties negotiate toward it.
      const selfBest = nv2BestModelFor("self", options);
      const otherBest = nv2BestModelFor("other", options);
      nv2.decisionDirection = nv2ExpectedDecisionDirection();
      // Once the case-level expected decision is known, negotiate *within*
      // that decision. Otherwise model-level utility can pull a late offer
      // back across the classification boundary and erase the decision gain.
      // Pareto filtering is repeated inside the selected label because a model
      // dominated globally by the opposite label can still be the best
      // implementable version of the preferred final decision.
      if (nv2.decisionDirection?.preferredLabel != null) {
        const directionalModels = allModels.filter(
          (model) => Number(model.pred_class) === Number(nv2.decisionDirection.preferredLabel)
        );
        const directionalFrontier = paretoOptimalModels(directionalModels);
        if (directionalModels.length) nv2.options = directionalFrontier.length ? directionalFrontier : directionalModels;
      }
      nv2.anchors = {
        self: { best: nv2Utility(selfBest, "self"), atTheirBest: nv2Utility(otherBest, "self") },
        other: { best: nv2Utility(otherBest, "other"), atTheirBest: nv2Utility(selfBest, "other") },
      };
      nv2PushPosition("self", { version: 0, model: selfBest, act: "open" });
      nv2PushPosition("other", { version: 0, model: otherBest, act: "open" });
      negotiateV2Busy = false;
      userWeights = { ...selfWeights };
      weights = { ...userWeights };
      proxyWeights = { ...otherWeights };
      negotiationEvents = [];
      nv2EnsureDraft();

      const sameClass = selfBest && otherBest && Number(selfBest.pred_class) === Number(otherBest.pred_class);
      const otherRole = personaTitle(proxyPersona || { label: "Other-party" });
      // Kept to a couple of lines: the composer's "..." popover carries the
      // mechanics, and the table beside it already shows who is strong where.
      addHistory(
        "system",
        "Opening positions (v0)",
        `${options.length} models fit this case and none of them wins on every criterion, so which one is "right" is a matter of priorities. `
          + `Your best is ${nv2ModelTag(selfBest)} (${escapeHtml(nv2PredictionLabel(selfBest))}); the ${escapeHtml(otherRole)}'s is ${nv2ModelTag(otherBest)} (${escapeHtml(nv2PredictionLabel(otherBest))})`
          + (sameClass ? ", and they point to the same decision." : ", and they point to opposite decisions.")
          + ` You get up to ${NV2_MAX_VERSION} offers; "Let them open" costs you nothing.`,
        null
      );
    }

    function negotiateV2SelectedItems() {
      if (!nv2EnsureForCurrentCase()) return [];
      if (nv2.status === "agreed" && nv2.agreed?.model) {
        return [
          { role: "self", roleLabel: "Agreed model", model: nv2.agreed.model },
          { role: "other", roleLabel: "Agreed model", model: nv2.agreed.model },
        ];
      }
      return [
        { role: "self", roleLabel: modelRoleLabel("self", "My model"), model: nv2ViewedPosition("self")?.model || null },
        { role: "other", roleLabel: modelRoleLabel("other", "Other model"), model: nv2ViewedPosition("other")?.model || null },
      ];
    }

    // Kept for the shared renderers: a compact description of where the
    // negotiation currently stands.
    function negotiateV2CurrentVersion() {
      if (!nv2) return null;
      const selfPosition = nv2ViewedPosition("self");
      const otherPosition = nv2ViewedPosition("other");
      const label = nv2.status === "agreed"
        ? `agreed at v${nv2.agreed?.version ?? 0}`
        : `v${selfPosition?.version ?? 0} vs v${otherPosition?.version ?? 0}`;
      const shared = nv2.status === "agreed";
      const summary = shared
        ? `Agreement: both sides stand behind model ${nv2ModelTag(nv2.agreed.model)} (${nv2PredictionLabel(nv2.agreed.model)}).`
        : nv2.status === "impasse"
          ? `No agreement after ${NV2_MAX_VERSION} rounds. Your final model ${nv2ModelTag(selfPosition?.model)} predicts ${nv2PredictionLabel(selfPosition?.model)}; theirs ${nv2ModelTag(otherPosition?.model)} predicts ${nv2PredictionLabel(otherPosition?.model)}.`
          : `Your model ${nv2ModelTag(selfPosition?.model)} predicts ${nv2PredictionLabel(selfPosition?.model)}; the Other-party's model ${nv2ModelTag(otherPosition?.model)} predicts ${nv2PredictionLabel(otherPosition?.model)}.`;
      return { label, shared, summary, status: nv2.status };
    }

    function nv2VersionOptionsForRole(role) {
      return nv2Track(role).map((entry) => ({
        label: `v${entry.version}`,
        shared: nv2.status === "agreed" && entry === nv2Position(role),
      }));
    }

    function negotiateV2VersionsByRole() {
      if (!nv2) return { self: [], other: [] };
      return { self: nv2VersionOptionsForRole("self"), other: nv2VersionOptionsForRole("other") };
    }

    function negotiateV2VersionIndexByRole() {
      if (!nv2) return { self: 0, other: 0 };
      return { self: nv2.self.viewIndex, other: nv2.other.viewIndex };
    }

    function applyNegotiateV2Version(role, index) {
      if (!nv2 || negotiateV2Busy) return;
      const side = role === "other" ? "other" : "self";
      const track = nv2Track(side);
      if (!track.length) return;
      nv2[side].viewIndex = Math.max(0, Math.min(track.length - 1, Number(index) || 0));
      nv2Rerender();
    }

    function nv2Rerender() {
      renderOfferControls();
      renderSummary();
      renderReconciliation();
      rerenderFeatureExplanationForCurrentWeights();
      renderFinalDecisionOptions();
    }

    // A model is identified to the LLM by name and prediction only. It used to
    // carry its full criteria vector, and that vector was where most of the
    // percentages in the replies came from: given the numbers, the model reads
    // them out. The speech-act fields below already say everything the reply
    // needs about movement, in words.
    function nv2ModelPayload(model) {
      if (!model) return null;
      return {
        id: nv2ModelTag(model),
        prediction: nv2PredictionLabel(model),
      };
    }

    /* ---- ingredients for the Other-party's rhetoric -------------------
       Integrative negotiation is carried by a small set of speech acts, and
       each one needs a fact to stand on. These helpers extract those facts so
       both the LLM and the offline fallback can build the same argument:
         acknowledge  <- what the other side just gave up  (perspective-taking)
         reciprocate  <- what I give back, and that it costs me (concession labelling)
         preserve     <- the limit I hold, and the role reason for it
         justify      <- the priority asymmetry that makes the swap pay
         gain-frame   <- their improvement stated as a gain, not my loss
       ------------------------------------------------------------------ */

    // What the other side actually conceded on their way to this offer, and
    // what it bought me. Basis for "I can see you moved on X".
    function nv2TheirLastMove(side, theirPreviousModel, theirOfferModel) {
      if (!theirPreviousModel || !theirOfferModel || theirPreviousModel === theirOfferModel) return null;
      const gaveUp = criteriaOrder
        .map((key) => {
          const before = nv2MetricValue(theirPreviousModel, key);
          const after = nv2MetricValue(theirOfferModel, key);
          return { key, label: criteriaLabels[key] || key, before, after, drop: before != null && after != null ? before - after : 0 };
        })
        .filter((item) => item.drop > 0.001)
        .sort((a, b) => b.drop - a.drop)[0] || null;
      const gainedMe = nv2PaybackFor(nv2OtherSide(side), theirOfferModel, theirPreviousModel);
      return { gaveUp, gainedMe: gainedMe && gainedMe.gain > 0.001 ? gainedMe : null };
    }

    // The limit I am holding and why. Stated as a role obligation rather than
    // a preference — an interest-based refusal, not stubbornness.
    function nv2ProtectedLimit(side, myModel, theirOfferModel) {
      const key = nv2HeadlineCriterion(side);
      const keep = nv2MetricValue(myModel, key);
      const underTheirs = nv2MetricValue(theirOfferModel, key);
      const cost = keep != null && underTheirs != null ? keep - underTheirs : 0;
      return {
        key,
        label: criteriaLabels[key] || key,
        cost,
        at_risk: cost > 0.001,
      };
    }

    // A side cannot say "this is the one thing I will not trade" about the very
    // criterion its own offer just let slip. The give-ground rules make that
    // rare — nobody may declare a concession on their own top priority — but the
    // search can still land the real loss there, so the PRESERVE act stands down
    // whenever it would contradict the concession being announced in the same
    // breath. The concession is what actually happened; the limit is a claim.
    function nv2LimitStandsWith(limit, concession, complaint = null) {
      if (!limit) return limit;
      if (concession && concession.drop > 0.001 && concession.key === limit.key) {
        return { ...limit, at_risk: false };
      }
      // Now that a side argues from its headline criterion, the limit it will
      // not trade is usually that same criterion — and "X still fails me, and X
      // is the line I cannot go below" says one thing twice. The complaint
      // already carries the mandate, so the clause stands down.
      if (complaint && complaint.key === limit.key) return { ...limit, at_risk: false };
      return limit;
    }

    // The differing priorities that make trading worthwhile at all. This is the
    // logrolling argument: we are not splitting one pie, we rank the slices
    // differently, so a swap beats a compromise for both of us.
    function nv2PriorityContrast(side) {
      const mine = nv2.weights[side];
      const theirs = nv2.weights[nv2OtherSide(side)];
      const ranked = criteriaOrder
        .map((key) => ({ key, label: criteriaLabels[key] || key, edge: (mine[key] || 0) - (theirs[key] || 0) }))
        .sort((a, b) => b.edge - a.edge);
      const iValueMore = ranked[0];
      const theyValueMore = ranked[ranked.length - 1];
      if (!iValueMore || !theyValueMore || iValueMore.key === theyValueMore.key) return null;
      if (iValueMore.edge <= 0.01 || theyValueMore.edge >= -0.01) return null;
      return { i_value_more: iValueMore.label, they_value_more: theyValueMore.label };
    }

    // How much ground I have already given across the whole negotiation —
    // lets the reciprocity claim be specific instead of rhetorical.
    function nv2MovementSoFar(side) {
      const track = nv2Track(side);
      const opening = track[0]?.model;
      const current = track[track.length - 1]?.model;
      if (!opening || !current) return null;
      const rounds = track.filter((entry) => ["counter", "offer", "open_offer"].includes(entry.act)).length;
      const key = nv2HeadlineCriterion(side);
      const from = nv2MetricValue(opening, key);
      const to = nv2MetricValue(current, key);
      return { rounds_moved: rounds, criterion: criteriaLabels[key] || key, given_up: from != null && to != null ? from - to : 0 };
    }

    function nv2PriorityOrder(side) {
      const rowWeights = nv2.weights[side];
      return criteriaOrder
        .slice()
        .sort((a, b) => (rowWeights[b] || 0) - (rowWeights[a] || 0))
        .map((key) => criteriaLabels[key] || key);
    }

    // The Other-party payload is deliberately weight-free: the LLM sees
    // criteria values, an ordinal priority list, and the move that was already
    // decided for it. It verbalizes; it never chooses.
    function nv2BuildPayload({ versionIndex, incomingModel, decision, move, previousModel, theirPreviousModel = null, theyHeld = false, opening = false }) {
      const offered = decision.accept ? incomingModel : move?.model;
      // An opening concedes nothing — there is no offer to concede against. The
      // ground it gives up against the Other-party's own ideal is real, but it
      // belongs to the gain-frame act (payback), not to reciprocation.
      const concession = decision.accept || opening ? null : nv2ConcessionDetail("other", offered, previousModel, move.giveKey);
      const payback = decision.accept ? null : nv2PaybackFor("other", offered, previousModel);
      const complaint = decision.accept ? null : move.complaint;
      const theirMove = nv2TheirLastMove("other", theirPreviousModel, incomingModel);
      const limit = nv2LimitStandsWith(nv2ProtectedLimit("other", offered, incomingModel), concession, complaint);
      const movement = nv2MovementSoFar("other");
      return {
        protocol: "model_negotiation",
        // Source these from the loaded case, not the DOM: the payload describes
        // the case being negotiated, and the selects can lag or be absent.
        dataset: activeData?.dataset || datasetSelect?.value || "",
        dataset_label: activeData?.dataset_label || activeData?.dataset || datasetSelect?.value || "",
        case_index: Number(activeData?.case?.test_case_index ?? caseSelect?.value),
        round: versionIndex,
        max_round: NV2_MAX_VERSION,
        user_role: personaTitle(currentPersona || { label: "Self" }),
        proxy_role: personaTitle(proxyPersona || { label: "Other-party" }),
        criteria_labels: criteriaLabels,
        my_priority_order: nv2PriorityOrder("other"),
        their_priority_order: nv2PriorityOrder("self"),
        case_features: activeData?.case?.features || {},
        option_count: (nv2.options || []).length,
        incoming_offer: nv2ModelPayload(incomingModel),
        my_previous_position: nv2ModelPayload(previousModel),
        // Whether the other side actually moved this turn. Without this the
        // model sees an ordinary counter situation, finds past concessions in
        // the history, and credits them to a turn where nothing was conceded.
        // "opening" is the third case: they have not offered anything at all
        // yet, which is not the same as standing still.
        their_move: opening ? "opening" : theyHeld ? "hold" : "offer",
        my_response: opening ? "open" : decision.accept ? "accept" : (move?.stonewalled ? "hold" : "counter"),
        decision_reason: decision.reason,
        counter_offer: decision.accept ? null : nv2ModelPayload(offered),
        // Every magnitude below is a phrase, never a value. The LLM cannot
        // quote a percentage it was never given, which is the only reliable
        // way to keep them out of the reply.
        // Same reasoning as the limit: the top-ranked complaint is not always a
        // real one, and a band would turn "no gap" into "a little short of".
        // is_my_top_priority decides whether this may be voiced as the role's
        // mandate or only as a secondary cost — the participant was told what
        // this role cares about, and the reply has to match that.
        complaint: complaint && complaint.gap > 0.001
          ? {
              criterion: complaint.label,
              how_far_off: nv2Shortfall(complaint.gap),
              is_my_top_priority: complaint.key === nv2HeadlineCriterion("other"),
              // Named so a secondary grievance can still be voiced on-role:
              // "you have my main concern covered, but this one costs me".
              my_top_priority: criteriaLabels[nv2HeadlineCriterion("other")] || "",
            }
          : null,
        concession: concession && concession.drop > 0.001 ? { criterion: concession.label, size: nv2CostAmount(concession.drop) } : null,
        payback: payback && payback.gain > 0.001 ? { criterion: payback.label, size: nv2GainAmount(payback.gain) } : null,
        // rhetorical ingredients
        they_just_conceded: theirMove?.gaveUp ? { criterion: theirMove.gaveUp.label, size: nv2CostAmount(theirMove.gaveUp.drop) } : null,
        it_gained_me: theirMove?.gainedMe ? { criterion: theirMove.gainedMe.label, size: nv2GainAmount(theirMove.gainedMe.gain) } : null,
        what_i_must_keep: {
          criterion: limit.label,
          // Only size the threat when there is one. Banding an unthreatened
          // limit would hand the model "a little" for a cost of zero.
          their_offer_would_cost_me: limit.at_risk ? nv2CostAmount(limit.cost) : null,
          actually_at_risk: limit.at_risk,
        },
        why_trading_works: nv2PriorityContrast("other"),
        how_far_i_have_moved: movement && movement.given_up > 0.001
          ? { rounds_moved: movement.rounds_moved, criterion: movement.criterion, given_up: nv2CostAmount(movement.given_up) }
          : null,
        deadline_reached: versionIndex >= NV2_MAX_VERSION,
        history: compactHistoryForProxy(),
      };
    }

    async function nv2Verbalize(payload, fallback) {
      if (!OPENAI_PROXY_URL) return { text: fallback, source: "fallback", reason: "no worker URL configured" };
      try {
        const response = await fetch(OPENAI_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (!response.ok) {
          // Surface the worker's own message. A bare "400" is indistinguishable
          // between a stale worker, a bad payload and a missing key; the body
          // says which, and this tooltip is the only place anyone will see it.
          const body = await response.text().catch(() => "");
          let detail = "";
          try {
            const parsed = JSON.parse(body);
            detail = [parsed?.error, parsed?.detail].filter(Boolean).join(": ");
          } catch {
            detail = body.slice(0, 140);
          }
          throw new Error(`HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}${detail ? ` — ${detail}` : ""}`);
        }
        const raw = await response.json();
        const text = raw?.explanation?.text;
        if (!text) return { text: fallback, source: "fallback", reason: "worker returned no text" };
        return { text, source: "llm" };
      } catch (error) {
        return { text: fallback, source: "fallback", reason: error.message };
      }
    }

    // A worker outage silently swaps the LLM wording for the scripted one, and
    // the two read almost alike. Label every turn so nobody has to guess after
    // the fact which version a participant actually saw.
    function nv2VoiceTag(voiced) {
      if (!voiced) return "";
      return voiced.source === "llm"
        ? `<span class="nv2-voice llm" title="This reply was written by the language model from the structured move.">LLM</span>`
        : `<span class="nv2-voice fallback" title="${escapeHtml(`Language model unavailable (${voiced.reason || "unknown"}); scripted wording used instead.`)}">scripted</span>`;
    }

    function nv2PackageRowsHtml(rows) {
      return rows.filter(Boolean).map((row) => `
        <div class="response-package-row">
          <span class="response-package-role">${escapeHtml(row.role)}</span>
          <span class="response-package-issue">${escapeHtml(row.issue)}</span>
          <span class="response-package-value">${escapeHtml(row.value)}</span>
        </div>
      `).join("");
    }

    /* ---- the three-beat turn ----------------------------------------------
       Every message in this protocol — the participant's, the Other-party's,
       scripted or voiced — is at most three sentences in one fixed order:

         (1) UNDERSTAND  — what the other side just gave up, and that it landed
         (2) POSITION    — what my role answers for, and why their model misses it
         (3) MOVE        — what I give in return, and the model that carries it

       An earlier version ran six acts, and both sides produced paragraphs that
       repeated the same trade argument every round; nobody reads that inside a
       negotiation they are also being asked to think about. A beat with no fact
       behind it is dropped rather than padded, so a turn can be two sentences,
       never four.
       ---------------------------------------------------------------------- */
    function nv2SelfOfferText({ offerModel, previousModel, targetModel, demandKey, giveKey }) {
      const demandLabel = criteriaLabels[demandKey] || demandKey;
      const concession = nv2ConcessionDetail("self", offerModel, previousModel, giveKey);
      const payback = nv2PaybackFor("self", offerModel, previousModel);
      const otherTrack = nv2Track("other");
      const theirMove = nv2TheirLastMove("self", otherTrack.length > 1 ? otherTrack[otherTrack.length - 2]?.model : null, targetModel);
      const parts = [];

      if (theirMove?.gaveUp) {
        parts.push(`You moved ${nv2CostAmount(theirMove.gaveUp.drop)} on ${escapeHtml(theirMove.gaveUp.label)}, and I can see what that cost you.`);
      }

      if (offerModel && targetModel && String(offerModel.seed ?? offerModel.id) === String(targetModel.seed ?? targetModel.id)) {
        parts.push(concession.drop > 0.001
          ? `I can meet you on model ${nv2ModelTag(targetModel)} because the tradeoff is still workable for me, even though it costs me ${nv2CostAmount(concession.drop)} on ${escapeHtml(concession.label)}.`
          : `I can meet you on model ${nv2ModelTag(targetModel)} because it is a workable shared choice for this case.`);
        return parts.join(" ");
      }

      const carries = `model ${nv2ModelTag(offerModel)} (${escapeHtml(nv2PredictionLabel(offerModel))})`;
      const cost = concession.drop > 0.001
        ? `It costs me ${nv2CostAmount(concession.drop)} on ${escapeHtml(concession.label)}`
        : "It does not cost me much on my side";
      const gain = payback && payback.gain > 0.001
        ? `and gives you ${nv2GainAmount(payback.gain)} on ${escapeHtml(payback.label)}`
        : "and improves the joint deal";
      const ask = demandKey ? ` while moving ${escapeHtml(demandLabel)} closer to what I can stand behind` : "";
      parts.push(`I chose ${carries} as the offer${ask}. ${cost}, ${gain}.`);
      return parts.join(" ");
    }

    // The same three beats the LLM is asked for — understand, position, move —
    // so a participant who happens to hit the offline path gets a turn of the
    // same shape and length, only stiffer.
    function nv2OtherFallbackText(decision, move, incomingModel, previousModel, versionIndex, theirPreviousModel = null) {
      const theirMove = nv2TheirLastMove("other", theirPreviousModel, incomingModel);
      const acknowledge = theirMove?.gaveUp
        ? `You let ${escapeHtml(theirMove.gaveUp.label)} slip ${nv2CostAmount(theirMove.gaveUp.drop)} to get here, and I can see what that cost you.`
        : null;
      const lastRound = versionIndex >= NV2_MAX_VERSION;

      if (decision.accept) {
        const parts = [];
        if (acknowledge) parts.push(acknowledge);
        parts.push(theirMove?.gainedMe
          ? `${escapeHtml(theirMove.gainedMe.label)} comes up ${nv2GainAmount(theirMove.gainedMe.gain)}, far enough that I can defend it to the people I answer to.`
          : `This clears the bar I set for my role.`);
        parts.push(decision.reason === "deadline"
          ? `We are out of rounds, so I accept model ${nv2ModelTag(incomingModel)} rather than have us both walk away with nothing.`
          : `Another round would not get my side enough to be worth your time, so I accept model ${nv2ModelTag(incomingModel)}.`);
        return parts.join(" ");
      }

      const complaint = move.complaint && move.complaint.gap > 0.001 ? move.complaint : null;
      const movement = nv2MovementSoFar("other");

      if (move.stonewalled) {
        const parts = [];
        parts.push(movement && movement.given_up > 0.001
          ? `I have already come down ${nv2CostAmount(movement.given_up)} on ${escapeHtml(movement.criterion)} across this negotiation, and this round you did not move at all.`
          : `You did not move this round, so I am not going to either.`);
        if (complaint) parts.push(`${escapeHtml(complaint.label)} is still ${nv2Shortfall(complaint.gap)} what I answer for, and nothing about that has changed.`);
        parts.push(lastRound
          ? `I am staying with model ${nv2ModelTag(move.model)}, which leaves us without an agreement.`
          : `I am staying with model ${nv2ModelTag(move.model)} — put something new on the table and I will look at it.`);
        return parts.join(" ");
      }

      const concession = nv2ConcessionDetail("other", move.model, previousModel, move.giveKey);
      const limit = nv2LimitStandsWith(nv2ProtectedLimit("other", move.model, incomingModel), concession, complaint);
      const payback = nv2PaybackFor("other", move.model, previousModel);
      const parts = [];
      if (acknowledge) parts.push(acknowledge);
      const holds = limit.at_risk ? `, while keeping ${escapeHtml(limit.label)} as my line` : "";
      if (complaint) {
        parts.push(nv2ComplaintLine({
          modelPhrase: "Your model",
          label: complaint.label,
          shortfall: nv2Shortfall(complaint.gap),
          headline: complaint.key === nv2HeadlineCriterion("other"),
          headlineLabel: criteriaLabels[nv2HeadlineCriterion("other")] || "",
          tail: holds,
        }));
      } else if (limit.at_risk) {
        parts.push(`${escapeHtml(limit.label)} is still the line I need to protect, and your model would cost me ${nv2CostAmount(limit.cost)} there.`);
      }
      const carries = `model ${nv2ModelTag(move.model)} (${escapeHtml(nv2PredictionLabel(move.model))})`;
      const cost = concession.drop > 0.001
        ? `it costs me ${nv2CostAmount(concession.drop)} on ${escapeHtml(concession.label)}`
        : "it does not cost me much on my side";
      const forYou = payback && payback.gain > 0.001
        ? `and gives you ${nv2GainAmount(payback.gain)} on ${escapeHtml(payback.label)}`
        : "and improves the joint deal";
      const closer = lastRound ? ` This is my last round, so it is this or no agreement.` : "";
      parts.push(`My counter is ${carries}: ${cost}, ${forYou}.${closer}`);
      return parts.join(" ");
    }

    // An opening is not a counter: there is nothing to acknowledge, nothing to
    // reciprocate and no gap in an offer that has not been made. What it does
    // have is a position, a reason for it, and — if the Other-party started
    // below its own ideal — an opening concession worth pointing at.
    function nv2OtherOpeningText(move, previousModel) {
      const complaint = move.complaint && move.complaint.gap > 0.001 ? move.complaint : null;
      const payback = nv2PaybackFor("other", move.model, previousModel);
      const parts = [];
      // Beat 1 has nothing to understand yet, so it goes to the one thing an
      // opening can say in its place: I am going first.
      parts.push(`Let me go first so you can see where my side stands.`);
      if (complaint) {
        parts.push(complaint.key === nv2HeadlineCriterion("other")
          ? `What I have to answer for here is ${escapeHtml(complaint.label)}, and the model you would pick on your own leaves it ${nv2Shortfall(complaint.gap)} what I can sign off on.`
          : `The model you would pick on your own costs me on ${escapeHtml(complaint.label)}, ${nv2Shortfall(complaint.gap)} where mine sits.`);
      }
      const opensWith = `model ${nv2ModelTag(move.model)} (${escapeHtml(nv2PredictionLabel(move.model))})`;
      parts.push(payback && payback.gain > 0.001
        ? `So I open with ${opensWith}, a model that already moves ${escapeHtml(payback.label)} ${nv2GainAmount(payback.gain)} toward you — tell me which model tradeoff you can live with.`
        : `So I open with ${opensWith} — tell me which model tradeoff you can live with.`);
      return parts.join(" ");
    }

    function nv2Settle(model, version, how) {
      nv2.status = "agreed";
      nv2.agreed = { model, version, how };
      nv2.pending = null;
    }

    function nv2CloseAsImpasse() {
      nv2.status = "impasse";
      // The standing offer survives the close: no more rounds does not mean the
      // Other-party's last model is off the table, and taking a final offer is
      // a normal way for a negotiation to end.
      addHistory(
        "system",
        "No rounds left",
        `You used all ${NV2_MAX_VERSION} of your offers without converging.`
          + (nv2.pending ? ` The Other-party's last model ${nv2ModelTag(nv2.pending.model)} is still on the table — take it or leave it.` : "")
          + " Otherwise both final positions stay side by side and the final decision is yours.",
        null
      );
    }

    // Participant accepts the Other-party's standing offer. Still available once
    // the rounds are spent: that is a final-offer acceptance, not a new round.
    function nv2AcceptPendingOffer() {
      if (!nv2 || negotiateV2Busy || nv2.status === "agreed" || !nv2.pending) return;
      const pending = nv2.pending;
      nv2PushPosition("self", { version: nv2NextVersion(), model: pending.model, act: "accept" });
      nv2Settle(pending.model, pending.version, "user_accepted");
      addHistory(
        "user",
        `Self accepts · v${pending.version}`,
        `I accept model ${nv2ModelTag(pending.model)} (${escapeHtml(nv2PredictionLabel(pending.model))}) as the model we both stand behind.`,
        null
      );
      addHistory("system", "Agreement reached", `Both sides now stand behind model ${nv2ModelTag(pending.model)}.`, null);
      nv2Rerender();
    }

    // Only before anything has been put on the table by either side. Once an
    // offer exists, "who opens" is settled and the question stops being asked.
    function nv2CanRequestOtherOpening() {
      return Boolean(nv2)
        && nv2.status === "open"
        && !nv2.pending
        && nv2Track("self").length === 1
        && nv2Track("other").length === 1;
    }

    /* Hand the first move to the Other-party.

       In an alternating-offers protocol the opener frames everything that
       follows: they name the criterion in dispute and set the anchor the reply
       has to argue against. Forcing Self to open makes the participant concede
       first in every session, which is both a worse experience and a confound —
       we cannot tell a concession made from conviction from one made because
       somebody had to go first. So this is a third opening act alongside
       offering and holding.

       It costs Self none of its offers: rounds are counted off the Self track,
       and this only adds to the Other-party's. The Other-party opens below its
       own ideal for the same reason a real negotiator does — an opening that is
       simply "my favourite model" gives the other side nothing to work with. */
    async function nv2RequestOtherOpening() {
      if (!nv2CanRequestOtherOpening() || negotiateV2Busy) return;
      const versionIndex = nv2Track("other").length;
      const selfAnchor = nv2Position("self")?.model;
      const previousModel = nv2Position("other")?.model;

      negotiateV2Busy = true;
      addHistory(
        "user",
        "Self asks them to open",
        `Before I put anything on the table, I want to hear where you stand and what this case looks like from your side.`,
        null
      );
      nv2Rerender();
      showProxyThinking();

      // Same machinery as any other turn: the move is chosen here, the wording
      // is chosen downstream. There is no acceptance branch — an opening has
      // nothing to accept, and Self's own best model is not an offer.
      const planned = nv2AutoMove("other", selfAnchor, versionIndex, null);
      // An empty option set leaves the search with nothing to pick; opening on
      // its own anchor is still a coherent opening, so resolve the model once
      // and let the wording and the payload describe the same thing.
      const move = { ...planned, model: planned.model || previousModel };
      const offerModel = move.model;
      const fallback = nv2OtherOpeningText(move, previousModel);
      const payload = nv2BuildPayload({
        versionIndex,
        incomingModel: selfAnchor,
        decision: { accept: false, reason: "opening" },
        move,
        previousModel,
        theirPreviousModel: null,
        opening: true,
      });
      const voiced = await nv2Verbalize(payload, fallback);
      removeProxyThinking();
      nv2.voiceLog = [...(nv2.voiceLog || []), { version: versionIndex, source: voiced.source, reason: voiced.reason || null }];

      nv2PushPosition("other", {
        version: versionIndex,
        model: offerModel,
        act: "open_offer",
        demandKey: move.demandKey,
        giveKey: move.giveKey,
        voice: voiced.source,
      });
      nv2.pending = { from: "other", model: offerModel, version: versionIndex };
      addHistory("proxy", `Other-party opening offer · v${versionIndex}`, `${voiced.text}${nv2VoiceTag(voiced)}`, null);
      negotiateV2Busy = false;
      nv2Rerender();
    }

    // hold === true: restate the current model instead of conceding. This is a
    // real bargaining act, not a no-op — it spends a round, signals a limit,
    // and (because the Other-party reciprocates in kind) is the only route to
    // a genuine impasse.
    async function nv2SendSelfOffer({ hold = false } = {}) {
      if (!nv2 || negotiateV2Busy || nv2.status !== "open") return;
      const { draft, selected } = nv2EnsureSelectedCandidate();
      const versionIndex = nv2NextVersion();
      if (versionIndex > NV2_MAX_VERSION) {
        nv2CloseAsImpasse();
        nv2Rerender();
        return;
      }
      const previousModel = nv2Position("self")?.model;
      const targetModel = nv2Position("other")?.model;
      const search = hold
        ? { model: previousModel, tier: "hold", held: true }
        : selected
          ? { model: selected.model, tier: "selected_model", held: false, demandKey: selected.demandKey, giveKey: selected.giveKey }
          : { model: previousModel, tier: "held", held: true };
      const offerModel = search.model;
      if (!hold && !selected) {
        nv2CloseAsImpasse();
        nv2Rerender();
        return;
      }

      negotiateV2Busy = true;
      nv2.pending = null;
      nv2PushPosition("self", {
        version: versionIndex,
        model: offerModel,
        act: hold ? "hold" : "offer",
        demandKey: search.demandKey || draft.demandKey,
        giveKey: search.giveKey || draft.giveKey,
        giveAmount: hold ? 0 : Math.max(0, selected?.sacrifice?.amount || 0),
        selectedModelSeed: hold ? null : nv2ModelSeed(offerModel),
        held: search.held,
      });
      addHistory(
        "user",
        hold ? `Self holds · v${versionIndex}` : `Self offer · v${versionIndex}`,
        hold
          // A hold is two beats, not three: there is no move to announce.
          ? `Model ${nv2ModelTag(targetModel)} still leaves ${escapeHtml(criteriaLabels[draft.demandKey] || draft.demandKey)} ${nv2Shortfall(nv2MetricValue(previousModel, draft.demandKey) - nv2MetricValue(targetModel, draft.demandKey))} what I can sign off on. I am staying with model ${nv2ModelTag(offerModel)} — close that gap and I will look again.`
          : nv2SelfOfferText({ offerModel, previousModel, targetModel, demandKey: search.demandKey || draft.demandKey, giveKey: search.giveKey || draft.giveKey }),
        null
      );
      nv2Rerender();

      showProxyThinking();
      // What Self's move was actually worth to the Other-party — the size of
      // the concession it now has to answer.
      const deliveredGain = nv2Utility(offerModel, "other") - nv2Utility(previousModel, "other");
      const decision = nv2AcceptanceDecision("other", offerModel, versionIndex, deliveredGain);
      const otherPrevious = nv2Position("other")?.model;
      const move = decision.accept ? null : decision.plan;
      const fallback = nv2OtherFallbackText(decision, move, offerModel, otherPrevious, versionIndex, previousModel);
      const payload = nv2BuildPayload({ versionIndex, incomingModel: offerModel, decision, move, previousModel: otherPrevious, theirPreviousModel: previousModel, theyHeld: hold || search.held });
      const voiced = await nv2Verbalize(payload, fallback);
      const text = `${voiced.text}${nv2VoiceTag(voiced)}`;
      removeProxyThinking();

      // Keep the provenance on the offer track too, so an exported transcript
      // can be split by wording source without re-parsing the chat HTML.
      nv2.voiceLog = [...(nv2.voiceLog || []), { version: versionIndex, source: voiced.source, reason: voiced.reason || null }];

      // Version numbers count a side's own positions, not the shared round.
      // Without an opening the two tracks advance in lockstep and this is the
      // round number; after one it is the round plus the opening, which is what
      // the version dropdown has to show if it is not to list v1 twice.
      const otherVersion = nv2Track("other").length;
      if (decision.accept) {
        nv2PushPosition("other", { version: otherVersion, model: offerModel, act: "accept", voice: voiced.source });
        nv2Settle(offerModel, versionIndex, decision.reason);
        addHistory("proxy", `Other-party accepts · v${otherVersion}`, text, null);
        addHistory("system", "Agreement reached", `Both sides now stand behind model ${nv2ModelTag(offerModel)} (${escapeHtml(nv2PredictionLabel(offerModel))}).`, null);
      } else {
        nv2PushPosition("other", {
          version: otherVersion,
          model: move.model,
          act: move.stonewalled ? "hold" : "counter",
          demandKey: move.demandKey,
          giveKey: move.giveKey,
          voice: voiced.source,
        });
        nv2.pending = { from: "other", model: move.model, version: otherVersion };
        addHistory("proxy", move.stonewalled ? `Other-party holds · v${otherVersion}` : `Other-party counter-offer · v${otherVersion}`, text, null);
        // One firm round is a signal, not a breakdown — a participant should be
        // able to hold once and still come back with an offer. Two rounds where
        // neither side moves is a real deadlock.
        nv2.mutualHolds = hold && move.stonewalled ? (nv2.mutualHolds || 0) + 1 : 0;
        if (nv2.mutualHolds >= 2) nv2CloseAsImpasse();
        else if (versionIndex >= NV2_MAX_VERSION) nv2CloseAsImpasse();
      }

      negotiateV2Busy = false;
      nv2Rerender();
    }

    function nv2StatusLine() {
      if (nv2.status === "agreed") return `Agreement reached at v${nv2.agreed.version}: model ${nv2ModelTag(nv2.agreed.model)}.`;
      if (nv2.status === "impasse") return `No agreement after ${NV2_MAX_VERSION} rounds.`;
      const next = nv2NextVersion();
      return `Round ${Math.min(next, NV2_MAX_VERSION)} of ${NV2_MAX_VERSION}`;
    }

    function renderNegotiateV2Controls() {
      if (!offerComposer) return;
      if (!nv2EnsureForCurrentCase()) return;
      offerComposer.classList.remove("locked");

      if (nv2.status !== "open") {
        const finalOffer = nv2.status === "impasse" && nv2.pending;
        const closed = nv2.status === "agreed"
          ? `Both sides stand behind model ${nv2ModelTag(nv2.agreed.model)}, predicting <strong>${escapeHtml(nv2PredictionLabel(nv2.agreed.model))}</strong>. Record your final decision on the left.`
          : finalOffer
            ? `No rounds left. The Other-party's final model ${nv2ModelTag(nv2.pending.model)} (${escapeHtml(nv2PredictionLabel(nv2.pending.model))}) is still on the table — take it, or leave both positions standing and decide for yourself.`
            : `The negotiation closed without agreement. Both final models stay on the left — the final decision is yours.`;
        offerComposer.innerHTML = `
          <div class="composer-bubble negotiate-v2-composer">
            <div class="composer-title">${escapeHtml(nv2StatusLine())}</div>
            <div class="response-preview">${closed}</div>
            ${finalOffer ? `<div class="composer-send-row"><div class="degree-summary"><div>Accepting their final offer ends the negotiation on their model.</div></div><div class="composer-actions"><button type="button" id="nv2AcceptButton" ${negotiateV2Busy ? "disabled" : ""}>Accept their final model</button></div></div>` : ""}
          </div>
        `;
        if (finalOffer) document.getElementById("nv2AcceptButton")?.addEventListener("click", nv2AcceptPendingOffer);
        return;
      }

      const { candidates, selected } = nv2EnsureSelectedCandidate();
      const busy = negotiateV2Busy;
      const canRequestOpening = nv2CanRequestOtherOpening();
      const targetModel = nv2Position("other")?.model;
      const offerModel = selected?.model || null;
      const candidateHtml = candidates.map((candidate) => `
        <option value="${escapeHtml(nv2ModelSeed(candidate.model))}" title="${escapeHtml(nv2CandidateOptionTitle(candidate))}" ${selected && nv2ModelSeed(candidate.model) === nv2ModelSeed(selected.model) ? "selected" : ""}>${escapeHtml(nv2CandidateOptionText(candidate))}</option>
      `).join("");
      const packageRows = selected ? nv2PackageRowsHtml([
        selected.sacrifice
          ? { role: "You give up", issue: selected.sacrifice.label, value: `${fmtPct(selected.sacrifice.before)} -> ${fmtPct(selected.sacrifice.after)}` }
          : { role: "You give up", issue: "nothing measurable", value: "no major criterion drop" },
        selected.payback
          ? { role: "They gain", issue: selected.payback.label, value: `${fmtPct(selected.payback.before)} -> ${fmtPct(selected.payback.after)}` }
          : { role: "They gain", issue: "overall fit", value: `+${nv2PointLabel(selected.otherGain)}` },
        selected.demandKey
          ? { role: "You ask", issue: criteriaLabels[selected.demandKey] || selected.demandKey, value: `${fmtPct(nv2MetricValue(targetModel, selected.demandKey))} -> ${fmtPct(nv2MetricValue(offerModel, selected.demandKey))}` }
          : null,
      ]) : "";
      const previewLine = selected
        ? `Offer ${nv2ModelTag(offerModel)} -> <strong>${escapeHtml(nv2PredictionLabel(offerModel))}</strong>`
        : "No model improves both joint utility and the Other-party from your current position.";
      const previewTitle = selected
        ? nv2CandidateOptionTitle(selected)
        : "No model improves both joint utility and the Other-party from your current position. You can hold firm or accept their pending model.";
      const pendingHtml = nv2.pending
        ? ` <span class="negotiate-v2-pending">they hold ${nv2ModelTag(nv2.pending.model)} (${escapeHtml(nv2PredictionLabel(nv2.pending.model))})</span>`
        : "";
      const modelSelectHtml = candidates.length
        ? `<select id="nv2ModelSelect" title="Pick the concrete model you are willing to put on the table. Each option summarizes what it costs you and what it gives the Other-party." ${busy ? "disabled" : ""}>${candidateHtml}</select>`
        : `<select id="nv2ModelSelect" disabled><option>No acceptable model offer available</option></select>`;
      const noCandidatePackage = '<div class="response-package-row"><span class="response-package-role">No package</span><span class="response-package-issue">No candidate model improves both joint utility and the Other-party from your current position.</span><span class="response-package-value">Hold or accept</span></div>';
      const detailsHtml = `
        <span class="composer-help nv2-details" tabindex="0" role="button" aria-label="What this offer contains">...
          <span class="composer-help-text">
            <div class="nv2-details-title">Selected model</div>
            <div class="response-package">${packageRows || noCandidatePackage}</div>
            <div class="nv2-details-note">
              <p>Pick the model you are willing to offer. The dropdown uses plain-language tradeoff sizes; hover or open this detail view for the exact criterion values.</p>
              <p>The system still uses the same negotiation rules after you send: the Other-party accepts if it cannot find a meaningfully better counter, otherwise it replies with an updated model.</p>
              ${canRequestOpening ? `<p>You do not have to go first: "Let them open" costs you none of your ${NV2_MAX_VERSION} offers.</p>` : ""}
            </div>
          </span>
        </span>`;

      offerComposer.innerHTML = `
        <div class="composer-bubble negotiate-v2-composer">
          <div class="composer-title">
            <span class="nv2-status">${escapeHtml(nv2StatusLine())}${pendingHtml}</span>
            ${detailsHtml}
          </div>
          <div class="nv2-move">
            <div class="nv2-move-block">
              <div class="response-config nv2-model-grid">
                <div class="response-field">
                  <label for="nv2ModelSelect">Choose model to offer</label>
                  ${modelSelectHtml}
                </div>
              </div>
              <div class="nv2-give-hint">Options show the top 5 models that improve joint utility and the Other-party from your current position, sorted by your utility.</div>
            </div>
          </div>
          <div class="composer-send-row">
            <div class="degree-summary nv2-offer-summary" title="${escapeHtml(previewTitle)}">${previewLine}</div>
            <div class="composer-actions">
              ${nv2.pending ? `<button type="button" id="nv2AcceptButton" ${busy ? "disabled" : ""}>Accept their model</button>` : ""}
              ${canRequestOpening ? `<button type="button" id="nv2OtherOpensButton" ${busy ? "disabled" : ""} title="Hand the first move to the Other-party. They put a model on the table and you answer it. This does not use up any of your own offers.">Let them open</button>` : ""}
              <button type="button" id="nv2HoldButton" ${busy ? "disabled" : ""} title="Restate your current model without conceding. This spends a round.">Hold firm</button>
              <button type="button" id="nv2SendButton" class="primary-button" ${busy || !offerModel ? "disabled" : ""}>${busy ? "Other-party is responding..." : "Send offer"}</button>
            </div>
          </div>
        </div>
      `;

      const modelSelect = document.getElementById("nv2ModelSelect");
      if (modelSelect) modelSelect.addEventListener("change", (event) => {
        nv2.draft.selectedModelSeed = event.target.value;
        const picked = nv2OfferCandidates().find((item) => nv2ModelSeed(item.model) === String(event.target.value));
        if (picked) {
          nv2.draft.demandKey = picked.demandKey;
          nv2.draft.giveKey = picked.giveKey;
        }
        renderNegotiateV2Controls();
      });
      document.getElementById("nv2SendButton")?.addEventListener("click", () => nv2SendSelfOffer());
      document.getElementById("nv2HoldButton")?.addEventListener("click", () => nv2SendSelfOffer({ hold: true }));
      document.getElementById("nv2OtherOpensButton")?.addEventListener("click", nv2RequestOtherOpening);
      document.getElementById("nv2AcceptButton")?.addEventListener("click", nv2AcceptPendingOffer);
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
