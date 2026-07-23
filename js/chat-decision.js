/* chat-decision.js — chat actions, Other-party box, opening offer, final decision, reconciliation
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function deactivateChatActions() {
      negotiationEvents = negotiationEvents.map((event) => ({
        ...event,
        actionable: false,
        text: typeof event.text === "string" ? event.text.replace(/<div class="history-actions">[\s\S]*?<\/div>/g, "") : event.text,
      }));
    }

    function bindCounterOfferActions(actionId, response) {
      const acceptButton = document.getElementById(`acceptProxyButton-${actionId}`);
      const modifyButton = document.getElementById(`continueOfferButton-${actionId}`);
      const proxyOfferName = response.initial ? "Other-party initial offer" : "Other-party counter-offer";
      if (acceptButton) {
        acceptButton.addEventListener("click", () => {
          deactivateChatActions();
          if (response.resultConsensus) {
            const consensus = resultConsensus(userWeights, response.counterWeights);
            setProxyWeights(response.counterWeights);
            addHistory("user", "Accepted result-level consensus", "Self accepts that both sides already select the same final prediction group, even though their weights are not identical.", userWeights);
            if (consensus) lockResultConsensus(consensus, userWeights);
            return;
          }
          composerLocked = true;
          composerNote = "Accepted. The negotiated criteria contract is locked in the composer.";
          setWeights(response.counterWeights, `Accepted ${proxyOfferName}`);
          setProxyWeights(response.counterWeights);
          addHistory("user", `Accepted ${proxyOfferName}`, `Self accepts the ${proxyOfferName} as the negotiated criteria contract.`, response.counterWeights);
          addHistory("proxy", "Consensus confirmed", "Great. The shared criteria contract now determines the reliability table and final decision chain.", response.counterWeights);
          pendingProxyCounter = null;
          pendingProxyResponse = null;
          renderOfferControls();
        }, { once: true });
      }
      if (modifyButton) {
        modifyButton.addEventListener("click", () => {
          deactivateChatActions();
          pendingProxyCounter = response.counterWeights;
          pendingProxyResponse = response;
          initializeComposerAdjustments(response.counterWeights);
          resetResponseActState(response);
          composerLocked = false;
          composerNote = "Unlocked from the Other-party's package offer. Choose a structured negotiation move, then send Self's response.";
          addHistory("user", `Modify ${proxyOfferName}`, `Self chooses to revise the ${proxyOfferName}. The composer now starts from the Other-party's proposed criteria contract.`, response.counterWeights);
          renderOfferControls();
        }, { once: true });
      }
    }

    function moveSentence(move) {
      const direction = move.delta >= 0 ? "Increase" : "Decrease";
      return `${direction} ${move.label}: ${fmtPct(move.from)} -> ${fmtPct(move.to)}`;
    }

    function sortedWeightEntries(rowWeights) {
      return criteriaOrder
        .map((key) => ({ key, label: criteriaLabels[key], value: rowWeights?.[key] || 0 }))
        .sort((a, b) => b.value - a.value);
    }

    function weightPhrase(entry) {
      return `${entry.label} ${Math.round(entry.value * 100)}%`;
    }

    function proxyFocusedAsk(userBaseline, proxyOffer) {
      const user = normalizeWeights(userBaseline || {});
      const proxy = normalizeWeights(proxyOffer || {});
      const ranked = criteriaOrder
        .map((key) => ({ key, label: criteriaLabels[key], user: user[key] || 0, proxy: proxy[key] || 0, gap: (proxy[key] || 0) - (user[key] || 0) }))
        .sort((a, b) => b.gap - a.gap);
      return ranked.find((item) => item.gap > 0.015) || ranked[0];
    }

    function describeProxyInitialOffer(proxyOffer, userBaseline) {
      const proposal = generateLogrollingCounterOffer(userBaseline, { forceCounter: true, opening: true });
      return proposal.explanation.text;
    }

    function describeProxyMoves(response) {
      if (response.control?.veto_stop || response.structuredProposal?.veto_stop) {
        const violations = response.control?.guard_violations || response.structuredProposal?.guard_violations || [];
        if (!violations.length) return "Negotiation stopped: no acceptable performance-guarded package is available.";
        return violations.map((item) => `Veto: ${escapeHtml(item.label)} ${fmtPct(item.value)} is below the ${fmtPct(item.threshold)} floor for ${escapeHtml(item.role_label || "this stakeholder")}.`).join("<br>");
      }
      if (response.structuredProposal) {
        const proposal = response.structuredProposal;
        const rows = [];
        if (proposal.ask) rows.push(`Ask: ${escapeHtml(proposal.ask.label)} ${fmtPct(proposal.ask.from)} -> ${fmtPct(proposal.ask.to)}`);
        if (proposal.concession) rows.push(`Concession: keep ${escapeHtml(proposal.concession.label)} at ${fmtPct(proposal.concession.to)}`);
        if (proposal.budget_source) rows.push(`Budget source: ${escapeHtml(proposal.budget_source.label)} ${fmtPct(proposal.budget_source.from)} -> ${fmtPct(proposal.budget_source.to)}`);
        rows.push(`Utilities: Self ${fmtPct(proposal.user_utility)}, Other-party ${fmtPct(proposal.proxy_utility)}.`);
        return rows.join("<br>");
      }
      if (!response.moves.length) return "No large weight changes.";
      const largest = [...response.moves].sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))[0];
      const direction = largest.delta >= 0 ? "raising" : "lowering";
      return `I am ${direction} ${escapeHtml(largest.label)} from ${fmtPct(largest.from)} to ${fmtPct(largest.to)} to move the proposal toward a shared reliability decision. The full adjustment is:<br>${response.moves.map(moveSentence).join("<br>")}`;
    }

    function addProxyCounterOffer(response) {
      const actionId = actionCounter++;
      const isInitial = Boolean(response.initial);
      const isVetoStop = Boolean(response.control?.veto_stop || response.structuredProposal?.veto_stop);
      const moveText = isVetoStop
        ? describeProxyMoves(response)
        : isInitial
          ? "This is an opening offer, not a final demand. Accept it if this focused tradeoff feels reasonable, or modify it to show where Self wants Other-party to give more room."
          : describeProxyMoves(response);
      const title = isVetoStop ? "Other-party performance veto" : isInitial ? "Other-party initial offer" : "Other-party counter-offer";
      const acceptLabel = isInitial ? "Accept offer" : "Accept counter-offer";
      const modifyLabel = isInitial ? "Modify this offer" : "Modify this counter-offer";
      const actions = isVetoStop ? "" : `
          <div class="history-actions">
            <button type="button" id="acceptProxyButton-${actionId}" class="primary-button">${acceptLabel}</button>
            <button type="button" id="continueOfferButton-${actionId}">${modifyLabel}</button>
          </div>`;
      addHistory(
        "proxy",
        title,
        `${response.explanation.text}
          <div class="proxy-moves">${moveText}</div>${actions}`,
        response.counterWeights,
        { actionable: !isVetoStop }
      );
      if (!isVetoStop) requestAnimationFrame(() => bindCounterOfferActions(actionId, response));
    }

    function beginUserOpeningOffer(baseWeights, source = "Elicited preference baseline") {
      const baseline = normalizeWeights(baseWeights || elicitedWeights || personaInitialWeights || activeData?.reconciliation?.default_weights || weights);
      proxyWeights = proxyIdealWeights();
      pendingProxyCounter = null;
      pendingProxyResponse = null;
      resetResponseActState();
      resetOpeningActState();
      setWeights(baseline, source);
      initializeComposerAdjustments(baseline);
      composerLocked = false;
      composerNote = "Start from Self's elicited preference. Choose an opening negotiation move, then send Self's first package offer.";
      renderSummary();
      renderReconciliation();
      renderOfferControls();
      renderHistory();
    }

    function openWithProxyOffer() {
      if (!activeData) return;
      const userBaseline = normalizeWeights(elicitedWeights || userWeights || activeData.reconciliation.default_weights);
      const proposal = generateLogrollingCounterOffer(userBaseline, { forceCounter: true, opening: true });
      const initialResponse = {
        ...proposal,
        initial: true,
        resultConsensus: false,
      };
      const initialProxyWeights = initialResponse.counterWeights;
      const isVetoStop = Boolean(initialResponse.control?.veto_stop || initialResponse.structuredProposal?.veto_stop);
      pendingProxyCounter = isVetoStop ? null : initialProxyWeights;
      pendingProxyResponse = isVetoStop ? null : initialResponse;
      initializeComposerAdjustments(isVetoStop ? userBaseline : initialProxyWeights);
      if (!isVetoStop) resetResponseActState(initialResponse);
      composerLocked = true;
      composerNote = isVetoStop
        ? "Negotiation stopped: the Other-party invoked a non-negotiable performance floor rather than making an opening trade-off."
        : "Other-party initial package offer loaded. Choose Accept in the chat, or Modify to unlock and edit it.";
      setProxyWeights(initialProxyWeights);
      renderOfferControls();
      addProxyCounterOffer(initialResponse);
    }

    function renderProxyBox(mode = null, options = {}) {
      if (!activeData || !showsNegotiationPanel()) return;
      if (!mode) {
        renderHistory();
        return;
      }

      if (!options.skipUserHistory) {
        addHistory("user", hasSubmittedUserOffer() ? "Self counter-offer" : "Self initial offer", "Self proposes criteria weights.", userWeights);
      }
      const consensus = resultConsensus(userWeights, proxyIdealWeights());
      if (consensus && negotiationRound >= MIN_ROUNDS_BEFORE_RESULT_CONSENSUS) {
        lockResultConsensus(consensus, userWeights);
        return;
      }
      showProxyThinking();
      setTimeout(async () => {
        try {
          const response = await negotiateWithProxy(userWeights);
          removeProxyThinking();
          if (response.accepted) {
            addHistory("proxy", "Other-party accepts", response.explanation.text, userWeights);
            offerSource = "Negotiated Self offer";
            initializeComposerAdjustments(userWeights);
            composerLocked = true;
            composerNote = "Consensus reached. The accepted criteria contract is locked in the composer.";
            setProxyWeights(proxyIdealWeights());
            pendingProxyCounter = null;
            pendingProxyResponse = null;
            renderSummary();
            renderReconciliation();
            renderOfferControls();
            return;
          }

          if (response.control?.veto_stop || response.structuredProposal?.veto_stop) {
            pendingProxyCounter = null;
            pendingProxyResponse = null;
            initializeComposerAdjustments(userWeights);
            composerLocked = true;
            composerNote = "Negotiation stopped: the Other-party invoked a non-negotiable performance floor rather than making another weight trade-off.";
            setProxyWeights(response.counterWeights);
            renderOfferControls();
            addProxyCounterOffer(response);
            return;
          }

          pendingProxyCounter = response.counterWeights;
          pendingProxyResponse = response;
          initializeComposerAdjustments(response.counterWeights);
          resetResponseActState(response);
          composerLocked = true;
          composerNote = "Other-party counter-offer loaded. Choose Accept in the chat, or Modify to unlock and edit it.";
          setProxyWeights(response.counterWeights);
          renderOfferControls();
          addProxyCounterOffer(response);
        } catch (error) {
          removeProxyThinking();
          addHistory("proxy", "Other-party control error", `Could not generate a counter-offer: ${error.message}`, null);
        }
      }, 850);
    }

    function decisionLabelForClass(classId) {
      const raw = activeData?.label_names?.[classId] || `Class ${classId}`;
      const lower = String(raw).toLowerCase();
      if (lower.includes("high") || lower === "1") return "High risk";
      if (lower.includes("low") || lower === "0") return "Low risk";
      return raw;
    }

    function resetFinalDecision() {
      finalDecision = null;
      renderFinalDecisionOptions();
    }

    function finalDecisionClassStatus(classId) {
      if (isSingleCondition() || isMultiOptimalCondition()) return { warning: false, reason: "" };
      const groups = (activeData?.reconciliation?.groups || []).filter((group) => Number(group.class_id) === Number(classId));
      if (!groups.length) return { warning: true, reason: "No candidate group for this decision." };
      const { userProfile, proxyProfile } = buildNegotiationContext(userWeights);
      const profiles = showsProxyWeights() ? guardProfiles(userProfile, proxyProfile) : [{ ...(userProfile || {}), guard_side: "Self" }];
      const violations = performanceGuardViolationsForProfiles(groups[0], profiles, { hardOnly: true });
      const first = violations[0];
      return {
        warning: Boolean(first),
        reason: first ? `${first.role_label} objection: ${first.label} ${fmtPct(first.value)} is below ${fmtPct(first.threshold)}. Self can still make this final decision.` : "",
      };
    }


    function aggregateOptimalModels() {
      const selfModel = selectedSingleOptimalModel(userWeights);
      const otherWeights = proxyWeights || proxyIdealWeights();
      const otherModel = selectedSingleOptimalModel(otherWeights);
      return { selfModel, otherModel, otherWeights };
    }

    function aggregateRecommendation() {
      const { selfModel, otherModel, otherWeights } = aggregateOptimalModels();
      const selfShare = Math.max(0, Math.min(1, Number(aggregateSelfShare) || 0));
      const otherShare = 1 - selfShare;
      const selfReliability = selfModel ? modelWeightedUtility(selfModel, userWeights) : 0;
      const otherReliability = otherModel ? modelWeightedUtility(otherModel, otherWeights) : 0;
      const selfWeight = selfShare * Math.max(0, selfReliability);
      const otherWeight = otherShare * Math.max(0, otherReliability);
      const denominator = selfWeight + otherWeight;
      const selfProb = Number(selfModel?.pred_prob);
      const otherProb = Number(otherModel?.pred_prob);
      const highProb = denominator > 0
        ? ((selfWeight * (Number.isFinite(selfProb) ? selfProb : 0)) + (otherWeight * (Number.isFinite(otherProb) ? otherProb : 0))) / denominator
        : NaN;
      const classId = Number.isFinite(highProb) ? (highProb >= 0.5 ? 1 : 0) : NaN;
      const label = activeData?.label_names?.[classId] || (classId === 1 ? "High Risk" : classId === 0 ? "Low Risk" : "Unavailable");
      return {
        selfModel,
        otherModel,
        selfShare,
        otherShare,
        selfReliability,
        otherReliability,
        selfWeight,
        otherWeight,
        denominator,
        highProb,
        classId,
        label,
      };
    }

    function aggregateRecommendationTooltip(rec) {
      if (!rec || !Number.isFinite(rec.highProb)) return "Aggregate recommendation unavailable.";
      const selfSeed = rec.selfModel?.seed ?? "-";
      const otherSeed = rec.otherModel?.seed ?? "-";
      const lowProb = 1 - rec.highProb;
      return [
        `Self model #${selfSeed}: importance ${fmtPct(rec.selfShare)} * reliability ${fmtPct(rec.selfReliability)} = aggregation weight ${fmtPct(rec.selfWeight)}; P(high) ${fmtProb(rec.selfModel?.pred_prob)}.`,
        `Other-party model #${otherSeed}: importance ${fmtPct(rec.otherShare)} * reliability ${fmtPct(rec.otherReliability)} = aggregation weight ${fmtPct(rec.otherWeight)}; P(high) ${fmtProb(rec.otherModel?.pred_prob)}.`,
        `Weighted P(high) = ${fmtProb(rec.highProb)}; P(low) = ${fmtProb(lowProb)}; recommendation = ${rec.label}.`,
      ].join("\n");
    }

    function renderAggregateRecommendationBanner() {
      const rec = aggregateRecommendation();
      const selfPct = Math.round(rec.selfShare * 100);
      const otherPct = 100 - selfPct;
      const highProbText = Number.isFinite(rec.highProb) ? fmtProb(rec.highProb) : "-";
      const tooltip = aggregateRecommendationTooltip(rec);
      finalDecisionStatusBanner.classList.remove("hidden", "conflict");
      finalDecisionStatusBanner.innerHTML = `
        <div class="aggregate-rec" title="${escapeHtml(tooltip)}">
          <div class="aggregate-rec-row aggregate-slider-row">
            <span class="aggregate-side self">Self importance <strong>${selfPct}%</strong></span>
            <input id="aggregateSelfSlider" class="aggregate-slider" type="range" min="0" max="100" step="1" value="${selfPct}" aria-label="Self importance for aggregate recommendation">
            <span class="aggregate-side other">Other-party <strong>${otherPct}%</strong></span>
          </div>
          <div class="aggregate-rec-row aggregate-result-row">
            <span class="aggregate-result-label">Aggregate recommendation</span>
            <strong class="aggregate-result class-${Number.isFinite(rec.classId) ? rec.classId : "unknown"}">${escapeHtml(rec.label)}</strong>
            <span class="aggregate-result-prob">weighted P(high) ${escapeHtml(highProbText)}</span>
            <span class="aggregate-help">hover for calculation</span>
          </div>
        </div>
      `;
      const slider = finalDecisionStatusBanner.querySelector("#aggregateSelfSlider");
      if (slider) {
        const updateAggregateBannerInPlace = () => {
          aggregateSelfShare = (Number(slider.value) || 0) / 100;
          const updated = aggregateRecommendation();
          const root = slider.closest(".aggregate-rec");
          const updatedSelfPct = Math.round(updated.selfShare * 100);
          const updatedOtherPct = 100 - updatedSelfPct;
          const selfText = root?.querySelector(".aggregate-side.self strong");
          const otherText = root?.querySelector(".aggregate-side.other strong");
          const result = root?.querySelector(".aggregate-result");
          const prob = root?.querySelector(".aggregate-result-prob");
          if (selfText) selfText.textContent = `${updatedSelfPct}%`;
          if (otherText) otherText.textContent = `${updatedOtherPct}%`;
          if (result) {
            result.className = `aggregate-result class-${Number.isFinite(updated.classId) ? updated.classId : "unknown"}`;
            result.textContent = updated.label;
          }
          if (prob) prob.textContent = `weighted P(high) ${Number.isFinite(updated.highProb) ? fmtProb(updated.highProb) : "-"}`;
          if (root) root.title = aggregateRecommendationTooltip(updated);
        };
        slider.addEventListener("input", updateAggregateBannerInPlace);
        slider.addEventListener("change", () => {
          updateAggregateBannerInPlace();
          renderReconciliation();
        });
      }
    }

    function renderFinalDecisionStatusBanner() {
      if (!finalDecisionStatusBanner) return;
      const showBanner = activeData && (studyCondition() === "negotiation" || isMultiOptimalCondition()) && showsProxyWeights();
      if (!showBanner) {
        finalDecisionStatusBanner.classList.add("hidden");
        finalDecisionStatusBanner.innerHTML = "";
        return;
      }
      if (isAggregateCondition()) {
        renderAggregateRecommendationBanner();
        return;
      }
      let selfWinner;
      let otherWinner;
      let versionLabel = "";
      if (isNegotiateV2Condition()) {
        const selected = negotiateV2SelectedItems();
        selfWinner = selected?.[0]?.model;
        otherWinner = selected?.[1]?.model;
        versionLabel = negotiateV2CurrentVersion()?.label || "v0";
      } else {
        selfWinner = isMultiOptimalCondition() ? selectedSingleOptimalModel(userWeights) : winningGroup(userWeights);
        const otherWeights = proxyWeights || proxyIdealWeights();
        otherWinner = isMultiOptimalCondition() ? selectedSingleOptimalModel(otherWeights) : winningGroup(proxyWeights);
      }
      const selfClassId = Number(selfWinner?.class_id ?? selfWinner?.pred_class);
      const otherClassId = Number(otherWinner?.class_id ?? otherWinner?.pred_class);
      const selfLabel = activeData?.label_names?.[selfClassId] || selfWinner?.label || `Class ${selfClassId}`;
      const otherLabel = activeData?.label_names?.[otherClassId] || otherWinner?.label || `Class ${otherClassId}`;
      const versionPrefix = versionLabel ? `${escapeHtml(versionLabel)}: ` : "";
      finalDecisionStatusBanner.classList.remove("hidden", "conflict");
      if (selfWinner && otherWinner && selfClassId === otherClassId) {
        finalDecisionStatusBanner.innerHTML = `Consensus reached: ${versionPrefix}both Self and Other-party identify <strong>${escapeHtml(selfLabel)}</strong> as the optimal prediction.`;
        return;
      }
      finalDecisionStatusBanner.classList.add("conflict");
      if (selfWinner && otherWinner) {
        finalDecisionStatusBanner.innerHTML = `Warning: no consensus yet. ${versionPrefix}Self optimal prediction is <strong>${escapeHtml(selfLabel)}</strong>, while Other-party optimal prediction is <strong>${escapeHtml(otherLabel)}</strong>. Their optimal predictions still conflict, so continue negotiating criteria concessions.`;
      } else {
        finalDecisionStatusBanner.innerHTML = `Warning: no consensus yet. ${versionPrefix}the optimal prediction cannot be computed for both sides.`;
      }
    }
    function renderFinalDecisionOptions() {
      renderFinalDecisionStatusBanner();
      if (!finalDecisionOptions || !activeData) return;
      const classIds = Object.keys(activeData.label_names || {}).map(Number).filter(Number.isFinite);
      const ids = classIds.length ? classIds : [0, 1];
      const statuses = Object.fromEntries(ids.map((classId) => [classId, finalDecisionClassStatus(classId)]));
      finalDecisionOptions.innerHTML = ids.map((classId) => {
        const status = statuses[classId] || { warning: false, reason: "" };
        return `
          <label class="final-decision-option" title="${escapeHtml(status.reason)}">
            <input type="radio" name="finalDecision" value="${classId}" ${String(finalDecision) === String(classId) ? "checked" : ""}>
            <span>${escapeHtml(decisionLabelForClass(classId))}</span>
          </label>
        `;
      }).join("");
      if (nextCaseButton) {
        nextCaseButton.disabled = finalDecision == null;
      }
      finalDecisionOptions.querySelectorAll("input[name='finalDecision']").forEach((input) => {
        input.addEventListener("change", () => {
          finalDecision = input.value;
          renderFinalDecisionOptions();
        });
      });
    }

    function updateReconcileIdentityBanner() {
      if (!reconcileIdentityBanner) return;
      const showBanner = isSingleCondition() || isMultiOptimalCondition() || studyCondition() === "exposure" || studyCondition() === "informed" || studyCondition() === "negotiation";
      if (!showBanner || !currentPersona) {
        reconcileIdentityBanner.classList.add("hidden");
        reconcileIdentityBanner.innerHTML = "";
        return;
      }
      const topKey = rankedCriteria[0] || defaultRankForPersona(currentPersona)[0] || criteriaOrder[0];
      const rolePhrase = personaRolePhrase(currentPersona);
      const criterionLabel = criteriaLabels[topKey] || topKey;
      let otherReminder = "";
      if (studyCondition() === "informed" || studyCondition() === "negotiation" || isMultiOptimalCondition()) {
        const other = proxyPersona || ensureDifferentProxyPersona();
        const otherKey = window.primaryCriterionKeyForPersona?.(other) || topMetricKeyForWeights(other?.weights || proxyWeights || {});
        const otherRole = personaTitle(other || { label: "Other stakeholder" });
        const otherMetric = criteriaLabels[otherKey] || otherKey;
        otherReminder = `<span class="informed-reminder-other">Other stakeholder (${escapeHtml(otherRole)}) thinks ${escapeHtml(otherMetric)} is important.</span>`;
      }
      reconcileIdentityBanner.innerHTML = `
        <span class="reconcile-identity-user">You are acting as a <strong>${escapeHtml(rolePhrase)}</strong>, and the criterion Self cares about most is <strong>${escapeHtml(criterionLabel)}</strong>.</span>
        ${otherReminder}
      `;
      reconcileIdentityBanner.classList.remove("hidden");
    }

    function renderReconciliation() {
      if (!activeData) return;
      updateReconcileIdentityBanner();
      renderFinalDecisionStatusBanner();
      decisionLabel.classList.remove("disagreement");
      consensusHint.classList.remove("disagreement");

      if (isSingleCondition()) {
        const model = selectedDefaultModel();
        if (!model) {
          decisionLabel.classList.add("disagreement");
          consensusHint.classList.add("disagreement");
          decisionLabel.textContent = "No prediction available";
          decisionReason.textContent = "No selected model is available for this case.";
          return;
        }
        const predictedLabel = activeData?.label_names?.[model.pred_class] || `Class ${model.pred_class}`;
        decisionLabel.textContent = predictedLabel;
        decisionReason.textContent = `${model.label || `Model ${model.seed}`} predicts ${predictedLabel} with P(class 1) ${fmtProb(model.pred_prob)}. Make the final decision after reviewing the input case and explanation.`;
        return;
      }

      if (isMultiOptimalCondition()) {
        const selected = isNegotiateV2Condition() ? negotiateV2SelectedItems() : null;
        const selfModel = selected?.[0]?.model || selectedSingleOptimalModel(userWeights);
        const otherModel = selected?.[1]?.model || selectedSingleOptimalModel(proxyWeights || proxyIdealWeights());
        const versionLabel = isNegotiateV2Condition() ? negotiateV2CurrentVersion()?.label || "v0" : "";
        const selfLabel = activeData?.label_names?.[selfModel?.pred_class] || `Class ${selfModel?.pred_class}`;
        const otherLabel = activeData?.label_names?.[otherModel?.pred_class] || `Class ${otherModel?.pred_class}`;
        if (isAggregateCondition()) {
          const rec = aggregateRecommendation();
          decisionLabel.textContent = rec.label;
          decisionReason.textContent = `The aggregate recommendation combines Self optimal model #${selfModel?.seed ?? "-"} and Other-party optimal model #${otherModel?.seed ?? "-"} using stakeholder importance and model reliability as aggregation weights.`;
        } else if (selfModel && otherModel && Number(selfModel.pred_class) === Number(otherModel.pred_class)) {
          decisionLabel.textContent = selfLabel;
          decisionReason.textContent = isNegotiateV2Condition()
            ? `${versionLabel}: Self model #${selfModel.seed} and Other-party model #${otherModel.seed} now both predict ${selfLabel}. The current negotiated model version has reached prediction consensus.`
            : `Self optimal model #${selfModel.seed} and Other-party optimal model #${otherModel.seed} both predict ${selfLabel}. Make the final decision after reviewing both model explanations.`;
        } else if (selfModel && otherModel) {
          decisionLabel.classList.add("disagreement");
          consensusHint.classList.add("disagreement");
          decisionLabel.textContent = `${selfLabel} / ${otherLabel}`;
          decisionReason.textContent = isNegotiateV2Condition()
            ? `${versionLabel}: Self model #${selfModel.seed} predicts ${selfLabel}, while Other-party model #${otherModel.seed} predicts ${otherLabel}. Choose criteria each side can sacrifice and generate another Rashomon model version.`
            : `Self optimal model #${selfModel.seed} predicts ${selfLabel}, while Other-party optimal model #${otherModel.seed} predicts ${otherLabel}. Review both model explanations before making the final decision.`;
        } else {
          decisionLabel.classList.add("disagreement");
          decisionLabel.textContent = "No result available";
          decisionReason.textContent = "The optimal models could not be computed for this case.";
        }
        return;
      }

      const userWinner = winningGroup(userWeights);
      const proxyWinner = showsProxyWeights() ? winningGroup(proxyWeights) : null;

      if (studyCondition() === "exposure") {
        if (userWinner) {
          decisionLabel.textContent = userWinner.label;
          decisionReason.textContent = `Under Self's elicited criteria weights, ${userWinner.label} is the most reliable prediction group (${fmtPct(userWinner.reliability)}). Make the final decision after reviewing the reliability table.`;
        } else {
          decisionLabel.classList.add("disagreement");
          consensusHint.classList.add("disagreement");
          decisionLabel.textContent = "No result available";
          decisionReason.textContent = "No group is available for this case.";
        }
        return;
      }

      if (studyCondition() === "informed") {
        if (userWinner && proxyWinner && userWinner.class_id === proxyWinner.class_id) {
          decisionLabel.textContent = userWinner.label;
          decisionReason.textContent = `Both Self weights and the Other-party stakeholder weights identify ${userWinner.label} as the most reliable prediction group. Make the final decision after reviewing both benefit columns.`;
        } else if (userWinner && proxyWinner) {
          decisionLabel.classList.add("disagreement");
          consensusHint.classList.add("disagreement");
          decisionLabel.textContent = "Different weighted results";
          decisionReason.textContent = `Self weights identify ${userWinner.label} (${fmtPct(userWinner.reliability)}), while the Other-party stakeholder weights identify ${proxyWinner.label} (${fmtPct(proxyWinner.reliability)}). Make the final decision after reviewing both perspectives.`;
        } else {
          decisionLabel.classList.add("disagreement");
          consensusHint.classList.add("disagreement");
          decisionLabel.textContent = "No result available";
          decisionReason.textContent = "No group is available for this case.";
        }
        return;
      }

      if (userWinner && proxyWinner && userWinner.class_id === proxyWinner.class_id) {
        decisionLabel.textContent = userWinner.label;
        decisionReason.textContent = `Consensus reached: both Self and Other-party identify ${userWinner.label} as the most reliable prediction group under their current weights. The final decision can be shown because the reliability chain agrees.`;
      } else if (userWinner && proxyWinner) {
        decisionLabel.classList.add("disagreement");
        consensusHint.classList.add("disagreement");
        decisionLabel.textContent = "No consensus yet";
        decisionReason.textContent = `Other-party thinks ${proxyWinner.label} is more reliable (${fmtPct(proxyWinner.reliability)}), while Self thinks ${userWinner.label} is more reliable (${fmtPct(userWinner.reliability)}). Continue negotiation until both sides select the same prediction group.`;
      } else {
        decisionLabel.classList.add("disagreement");
        consensusHint.classList.add("disagreement");
        decisionLabel.textContent = "No consensus yet";
        decisionReason.textContent = "No group is available for this case.";
      }
    }

