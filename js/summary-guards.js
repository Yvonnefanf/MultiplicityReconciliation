/* summary-guards.js — reliability summary, issue accessors, performance-guard veto logic
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function renderNegotiatedWeights(rowWeights, kind) {
      return criteriaOrder.map((key) => `
        <td><span class="weight-display ${kind}">${Math.round((rowWeights[key] || 0) * 100)}%</span></td>
      `).join("");
    }

    function computeReliability(group, rowWeights = userWeights) {
      const effective = decisionEffectiveWeights(rowWeights);
      return criteriaOrder.reduce((score, key) => score + (effective[key] || 0) * (Number(group.criteria[key]) || 0), 0);
    }

    function modelCriterionValue(model, key) {
      const source = model || {};
      const keyMap = {
        accuracy: ["subgroup_accuracy", "local_accuracy"],
        tpr: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"],
        tnr: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"],
        local_consistency: ["local_consistency"],
        counterfactual_fairness: ["counterfactual_fairness"],
      };
      const keys = keyMap[key] || [key];
      for (const metricKey of keys) {
        const value = Number(source[metricKey]);
        if (Number.isFinite(value)) return value;
      }
      const fnr = Number(source.local_fnr ?? source.local_false_negative_rate);
      if (key === "tpr" && Number.isFinite(fnr)) return 1 - fnr;
      const fpr = Number(source.local_fpr ?? source.local_false_positive_rate);
      if (key === "tnr" && Number.isFinite(fpr)) return 1 - fpr;
      return null;
    }

    function modelDominates(a, b) {
      let hasStrictAdvantage = false;
      let compared = 0;
      for (const key of criteriaOrder) {
        const av = modelCriterionValue(a, key);
        const bv = modelCriterionValue(b, key);
        if (!Number.isFinite(av) || !Number.isFinite(bv)) continue;
        compared += 1;
        if (av < bv - 0.0000001) return false;
        if (av > bv + 0.0000001) hasStrictAdvantage = true;
      }
      return compared > 0 && hasStrictAdvantage;
    }

    function paretoOptimalModels(models = []) {
      const candidates = (models || []).filter(Boolean);
      return candidates.filter((candidate) => !candidates.some((other) => other !== candidate && modelDominates(other, candidate)));
    }

    function modelWeightedUtility(model, rowWeights = userWeights) {
      const effective = decisionEffectiveWeights(rowWeights || {});
      return criteriaOrder.reduce((score, key) => {
        const value = modelCriterionValue(model, key);
        return score + (effective[key] || 0) * (Number.isFinite(value) ? value : 0);
      }, 0);
    }

    function selectedSingleOptimalModel(rowWeights = userWeights) {
      if (!activeData?.models?.length) return null;
      const frontier = paretoOptimalModels(activeData.models);
      const candidates = frontier.length ? frontier : activeData.models;
      const priorityKey = rankedCriteria?.[0] || topMetricKeyForWeights?.(rowWeights || {}) || criteriaOrder[0];
      return candidates
        .slice()
        .sort((a, b) => {
          const utilityDelta = modelWeightedUtility(b, rowWeights) - modelWeightedUtility(a, rowWeights);
          if (Math.abs(utilityDelta) > 0.000001) return utilityDelta;
          const priorityDelta = (modelCriterionValue(b, priorityKey) || 0) - (modelCriterionValue(a, priorityKey) || 0);
          if (Math.abs(priorityDelta) > 0.000001) return priorityDelta;
          return Number(b.pred_prob || 0) - Number(a.pred_prob || 0);
        })[0] || activeData.models[0];
    }

    function topContributor(group, rowWeights = userWeights) {
      const effective = decisionEffectiveWeights(rowWeights);
      return criteriaOrder
        .map((key) => ({ key, label: criteriaLabels[key], value: (effective[key] || 0) * (Number(group.criteria[key]) || 0) }))
        .sort((a, b) => b.value - a.value)[0];
    }

    function winningGroup(rowWeights, options = {}) {
      if (!activeData) return null;
      const profiles = Array.isArray(options.guardProfiles) ? options.guardProfiles.filter(Boolean) : [];
      const hardOnly = options.hardOnly !== false;
      const groups = activeData.reconciliation.groups
        .map((group) => ({ ...group, reliability: computeReliability(group, rowWeights) }))
        .filter((group) => !profiles.length || !performanceGuardViolationsForProfiles(group, profiles, { hardOnly }).length);
      return groups.sort((a, b) => b.reliability - a.reliability || b.count - a.count)[0] || null;
    }

    function resultConsensus(userRowWeights = userWeights, proxyRowWeights = proxyWeights) {
      const userWinner = winningGroup(userRowWeights);
      const proxyWinner = winningGroup(proxyRowWeights);
      if (!userWinner || !proxyWinner || userWinner.class_id !== proxyWinner.class_id) return null;
      return {
        label: userWinner.label,
        userReliability: userWinner.reliability,
        proxyReliability: proxyWinner.reliability
      };
    }

    function resultConsensusText(consensus) {
      return `Even though our weights are not identical, they already point to the same result: ${escapeHtml(consensus.label)} is the more reliable group for both of us. Other-party gets ${fmtPct(consensus.proxyReliability)} with its weights, and Self gets ${fmtPct(consensus.userReliability)} with Self weights.<br><br>So I do not need our weights to match perfectly. What matters here is that the final decision agrees. If Self is comfortable with that result-level consensus, accept the offer; otherwise Self can still modify the weights.`;
    }

    function lockResultConsensus(consensus, acceptedWeights = userWeights) {
      composerLocked = true;
      initializeComposerAdjustments(acceptedWeights);
      composerNote = "Result-level consensus reached. The composer is locked because both sides select the same prediction group.";
      pendingProxyCounter = null;
      pendingProxyResponse = null;
      renderSummary();
      renderReconciliation();
      renderOfferControls();
      addHistory("proxy", "Result-level consensus", resultConsensusText(consensus), proxyWeights);
    }

    function selectedDefaultModel() {
      if (!activeData?.models?.length) return null;
      if (isSingleOptimalCondition()) return selectedSingleOptimalModel(userWeights);
      // In the single condition the same deployed model is used across every case.
      const configuredSeed = isSingleCondition()
        ? singleModelSeed()
        : (activeData.default_model_seed ?? activeData.case?.default_model_seed);
      if (configuredSeed != null) {
        const matched = activeData.models.find((model) => String(model.seed) === String(configuredSeed));
        if (matched) return matched;
      }
      return activeData.models[0];
    }

    function singleMetric(label, value, formatter = fmtPct) {
      return `
        <div class="single-model-metric">
          <strong>${escapeHtml(formatter(value))}</strong>
          <span>${escapeHtml(label)}</span>
        </div>
      `;
    }

    function renderSingleModelSummary() {
      const model = selectedDefaultModel();
      if (!model) {
        summaryTableWrap.innerHTML = `<div class="status">No model prediction is available for this case.</div>`;
        return;
      }
      const predictedLabel = activeData?.label_names?.[model.pred_class] || `Class ${model.pred_class}`;
      summaryTableWrap.innerHTML = `
        <div class="single-model-card">
          <div class="single-model-metrics">
            ${singleMetric("Local consistency", model.local_consistency)}
            ${singleMetric("CF fairness", model.counterfactual_fairness)}
            ${singleMetric("Local TPR", model.tpr)}
            ${singleMetric("Local TNR", model.tnr)}
            ${singleMetric("Test accuracy", model.test_accuracy)}
          </div>
        </div>
      `;
    }


    function renderMultiOptimalSummary() {
      const negotiateItems = isNegotiateV2Condition() ? negotiateV2SelectedItems() : null;
      const selfModel = negotiateItems?.[0]?.model || selectedSingleOptimalModel(userWeights);
      const otherModel = negotiateItems?.[1]?.model || selectedSingleOptimalModel(proxyWeights || proxyIdealWeights());
      const versionLabel = isNegotiateV2Condition() ? negotiateV2CurrentVersion()?.label : null;
      const card = (title, model) => {
        if (!model) return `<div class="single-model-card"><div class="single-model-kicker">${escapeHtml(title)}</div><div class="status">No optimal model available.</div></div>`;
        const predictedLabel = activeData?.label_names?.[model.pred_class] || `Class ${model.pred_class}`;
        return `
          <div class="single-model-card multi-optimal-summary-card">
            <div class="single-model-kicker">${escapeHtml(title)}</div>
            <div class="single-model-heading"><strong>Model #${escapeHtml(model.seed ?? model.id ?? "-")}</strong>: ${escapeHtml(predictedLabel)}</div>
            <div class="single-model-metrics">
              ${singleMetric("Subgroup Acc.", model.subgroup_accuracy ?? model.local_accuracy)}
              ${singleMetric("Subgroup TPR", model.subgroup_tpr ?? model.local_tpr)}
              ${singleMetric("Subgroup TNR", model.subgroup_tnr ?? model.local_tnr)}
              ${singleMetric("Individual fairness", model.local_consistency)}
              ${singleMetric("CF fairness", model.counterfactual_fairness)}
            </div>
          </div>
        `;
      };
      const versionNote = versionLabel ? `<div class="multi-optimal-version-note">Negotiation version: ${escapeHtml(versionLabel)}</div>` : "";
      summaryTableWrap.innerHTML = `${versionNote}<div class="multi-optimal-summary">${card("Self optimal", selfModel)}${card("Other-party optimal", otherModel)}</div>`;
    }

    function renderSummary() {
      if (!activeData) return;
      const predictionHeading = document.querySelector(".prediction-header h2");
      if (predictionHeading) predictionHeading.textContent = isMultiOptimalCondition() ? "Optimal Model Predictions" : isSingleOptimalCondition() ? "Optimal Model Prediction" : isSingleCondition() ? "Model Prediction" : "Prediction Reliability";
      if (isSingleCondition()) {
        renderSingleModelSummary();
        return;
      }
      if (isMultiOptimalCondition()) {
        renderMultiOptimalSummary();
        return;
      }
      const includeProxy = showsProxyWeights();
      const userWinner = winningGroup(userWeights);
      const proxyWinner = includeProxy ? winningGroup(proxyWeights) : null;
      const groups = activeData.reconciliation.groups.map((group) => ({
        ...group,
        userReliability: computeReliability(group, userWeights),
        proxyReliability: includeProxy ? computeReliability(group, proxyWeights) : null,
      })).sort((a, b) => a.class_id - b.class_id);
      const summaryByClass = new Map(activeData.summary.map((item) => [item.class_id, item]));
      const userRoleLabel = personaTitle(currentPersona || { label: "Self" });
      const proxyRoleLabel = personaTitle(proxyPersona || { label: "Other-party" });
      const userEffective = decisionEffectiveWeights(userWeights);
      const proxyEffective = includeProxy ? decisionEffectiveWeights(proxyWeights) : null;

      const lowGroup = groups[0];
      const highGroup = groups[1] || groups[0];
      const visibleGroups = [lowGroup, highGroup].filter(Boolean).slice(0, 2);
      const shortLabels = {
        tpr: "Local TPR",
        tnr: "Local TNR",
        local_consistency: "Individual fairness",
        counterfactual_fairness: "CF fairness"
      };
      const fullLabels = {
        tpr: "Local True Positive Rate / Catch Truly High-Risk Cases in the 30-neighbor local region",
        tnr: "Local True Negative Rate / Avoid False High-Risk Labels in the 30-neighbor local region",
        local_consistency: "Individual Fairness",
        counterfactual_fairness: "CF Fairness"
      };

      const criterionHeaders = criteriaOrder.map((key) => {
        const inactive = isInactiveCriterion(key);
        const stats = criterionStats(key);
        const title = `${fullLabels[key] || criteriaLabels[key]}: ${criteriaDescriptions[key] || ""} Range ${fmtPct(stats.spread)}; min ${fmtPct(stats.min)}, max ${fmtPct(stats.max)}.`;
        const subnote = inactive
          ? `<span class="matrix-subnote">~${Math.round(stats.mean * 100)}% +/-2</span>`
          : `<span class="matrix-subnote">range ${Math.round(stats.spread * 100)}pt</span>`;
        return `
          <th class="matrix-criterion-col ${inactive ? "inactive-row" : ""}" title="${escapeHtml(title)}">
            <span class="matrix-criterion-label">${escapeHtml(shortLabels[key] || criteriaLabels[key])}</span>${subnote}
          </th>
        `;
      }).join("");

      const bestCriterionByKey = Object.fromEntries(criteriaOrder.map((key) => {
        const best = visibleGroups
          .map((group) => ({ group, value: Number(group.criteria?.[key]) || 0 }))
          .sort((a, b) => b.value - a.value)[0];
        return [key, best?.group?.class_id];
      }));
      const bestIcon = `<span class="best-icon" aria-label="best value" title="Best value"></span>`;
      const { userProfile, proxyProfile } = buildNegotiationContext(userWeights);
      const profileGuards = includeProxy ? guardProfiles(userProfile, proxyProfile) : [{ ...(userProfile || {}), guard_side: "Self" }];
      const guardViolationsByGroup = Object.fromEntries(visibleGroups.map((group) => [group.class_id, performanceGuardViolationsForProfiles(group, profileGuards, { hardOnly: true })]));
      const predictionRows = visibleGroups.map((group) => {
        const summary = summaryByClass.get(group.class_id);
        const isUserBest = userWinner && group.class_id === userWinner.class_id;
        const isProxyBest = proxyWinner && group.class_id === proxyWinner.class_id;
        return `
          <tr class="prediction-matrix-row">
            <th class="row-head matrix-solution-col">
              <span class="prediction-header-title">${escapeHtml(group.label)}</span>
              <span class="prediction-header-meta">${group.count}/100 models</span>
            </th>
            ${criteriaOrder.map((key) => {
              const inactive = isInactiveCriterion(key);
              const isBestCriterion = !inactive && bestCriterionByKey[key] === group.class_id;
              const violation = (guardViolationsByGroup[group.class_id] || []).find((item) => item.key === key);
              const vetoIcon = violation ? `<span class="veto-icon" aria-label="performance floor violated" title="${escapeHtml(`${violation.role_label}: floor ${fmtPct(violation.threshold)}`)}"></span>` : "";
              return `<td class="matrix-cell matrix-criterion-col ${inactive ? "inactive" : ""} ${isBestCriterion && !violation ? "best" : ""} ${violation ? "veto" : ""}">${inactive ? "-" : `${fmtPct(group.criteria[key])}${violation ? vetoIcon : isBestCriterion ? bestIcon : ""}`}</td>`;
            }).join("")}
            <td class="matrix-benefit-col user-benefit-col benefit-cell user ${isUserBest ? "best" : ""}">${fmtPct(group.userReliability)}${isUserBest ? bestIcon : ""}</td>
            ${includeProxy ? `<td class="matrix-benefit-col proxy-benefit-col benefit-cell proxy ${isProxyBest ? "best" : ""}">${fmtPct(group.proxyReliability)}${isProxyBest ? bestIcon : ""}</td>` : ""}
          </tr>
        `;
      }).join("");

      const weightRow = (kind, roleLabel, rowWeights) => `
        <tr class="matrix-weight-row ${kind}">
          <th class="row-head matrix-solution-col">
            <span class="matrix-weight-label">${kind === "user" ? "Self weights" : "Other-party weights"}</span>
          </th>
          ${criteriaOrder.map((key) => {
            const inactive = isInactiveCriterion(key);
            const pct = Math.round((rowWeights[key] || 0) * 100);
            return `
              <td class="matrix-criterion-col weight-bar-cell ${inactive ? "inactive-row" : ""}">
                ${inactive ? `<span class="weight-display ${kind}">-</span>` : `<span class="weight-display ${kind}">${pct}%</span>`}
              </td>
            `;
          }).join("")}
          <td class="matrix-benefit-col benefit-empty"></td>
          ${includeProxy ? `<td class="matrix-benefit-col benefit-empty"></td>` : ""}
        </tr>
      `;

      summaryTableWrap.innerHTML = `
        <table class="summary-table comparison-matrix ${includeProxy ? "with-proxy" : "user-only"}">
          <thead>
            <tr>
              <th class="corner-cell matrix-solution-col"></th>
              ${criterionHeaders}
              <th class="matrix-benefit-col user-benefit-col">Self<br>benefits<span class="benefit-role">${escapeHtml(userRoleLabel)}</span></th>
              ${includeProxy ? `<th class="matrix-benefit-col proxy-benefit-col">Other-party<br>benefits<span class="benefit-role">${escapeHtml(proxyRoleLabel)}</span></th>` : ""}
            </tr>
          </thead>
          <tbody>
            ${predictionRows}
            ${weightRow("user", userRoleLabel, userEffective)}
            ${includeProxy ? weightRow("proxy", proxyRoleLabel, proxyEffective) : ""}
          </tbody>
        </table>
      `;
    }

    function staticMoves(fromWeights, toWeights) {
      const from = normalizeWeights(fromWeights || {});
      const to = normalizeWeights(toWeights || {});
      return criteriaOrder
        .map((key) => ({
          key,
          label: criteriaLabels[key],
          from: from[key] || 0,
          to: to[key] || 0,
          delta: (to[key] || 0) - (from[key] || 0),
        }))
        .filter((move) => Math.abs(move.delta) >= 0.005)
        .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
    }

    function issueData(profile, key) {
      return profile?.issues?.[key] || {};
    }

    function issueRank(profile, key) {
      return Number(issueData(profile, key).rank) || criteriaOrder.length;
    }

    function issueRigidity(profile, key) {
      return Number(issueData(profile, key).rigidity) || 0.5;
    }

    function issueReservationMin(profile, key) {
      return Math.max(0, Number(issueData(profile, key).reservation_min) || 0);
    }

    function issueReservationMax(profile, key) {
      const value = Number(issueData(profile, key).reservation_max);
      return Number.isFinite(value) ? Math.min(1, value) : 1;
    }

    function issueAspiration(profile, key) {
      const issue = issueData(profile, key);
      return Number.isFinite(Number(issue.aspiration)) ? Number(issue.aspiration) : Number(issue.ideal) || 0;
    }

    function issueIdeal(profile, key) {
      return Number(issueData(profile, key).ideal) || 0;
    }

    function performanceGuard(profile, key) {
      return profile?.performance_guards?.[key] || {};
    }

    function performanceGuardThreshold(profile, key) {
      const guard = performanceGuard(profile, key);
      if (!guard.enabled || guard.negotiability !== "hard" || !(Number(guard.veto_min) > 0)) return null;
      return Number(guard.veto_min) || 0;
    }

    function guardRoleLabel(profile) {
      const side = profile?.guard_side || profile?.guardSide;
      const role = profile?.role_label || "Stakeholder";
      return side ? `${side} hard floor (${role})` : role;
    }

    function guardProfiles(userProfile, proxyProfile) {
      return [
        { ...(userProfile || {}), guard_side: "Self" },
        { ...(proxyProfile || {}), guard_side: "Other-party" },
      ];
    }

    function performanceGuardViolations(group, profile, options = {}) {
      if (!group || !profile) return [];
      const hardOnly = options.hardOnly !== false;
      return criteriaOrder.flatMap((key) => {
        const guard = performanceGuard(profile, key);
        if (!guard.enabled) return [];
        if (hardOnly && guard.negotiability !== "hard") return [];
        const threshold = performanceGuardThreshold(profile, key);
        if (threshold == null) return [];
        const value = Number(group.criteria?.[key]) || 0;
        if (value >= threshold - 0.001) return [];
        return [{
          key,
          label: criteriaLabels[key] || key,
          value,
          threshold,
          role_label: guardRoleLabel(profile),
          group_label: group.label,
          negotiability: guard.negotiability || "hard",
          public_reason: guard.public_reason || performanceGuardReason(profile, key, 1),
        }];
      });
    }

    function performanceGuardViolationsForProfiles(group, profiles, options = {}) {
      return profiles.flatMap((profile) => performanceGuardViolations(group, profile, options));
    }

    function satisfiesPerformanceGuards(rowWeights, profiles, options = {}) {
      const winner = winningGroup(rowWeights);
      if (!winner) return false;
      return !performanceGuardViolationsForProfiles(winner, profiles, options).length;
    }

    function acceptableGroupsForProfiles(profiles, options = {}) {
      return (activeData?.reconciliation?.groups || []).filter((group) => !performanceGuardViolationsForProfiles(group, profiles, options).length);
    }

    function performanceVetoText(winner, violations, options = {}) {
      const primary = violations[0];
      const selected = winner ? `${escapeHtml(winner.label)}` : "the selected model group";
      const intro = options.noFeasible
        ? "I need to stop the negotiation here because no candidate model group satisfies the non-negotiable performance floors for this case."
        : `I need to stop the negotiation here. Under this criteria contract, ${selected} would be selected, but it violates a non-negotiable performance floor.`;
      if (!primary) return `${intro}<br><br>This is a performance veto, not a weight trade-off: other criteria cannot compensate for a model group that falls below the floor.`;
      return `${intro}<br><br>${escapeHtml(primary.role_label)} requires ${escapeHtml(primary.label)} to be at least ${fmtPct(primary.threshold)}, but ${selected} has ${fmtPct(primary.value)}.<br><br>This is a performance veto, not a logrolling issue: I am not asking for a smaller concession, I am saying this model group is outside my acceptable set.`;
    }

    function makePerformanceVetoResponse(offerWeights, proxyAnchor, userProfile, proxyProfile, options = {}) {
      const winner = winningGroup(offerWeights);
      const violations = options.violations || (winner ? performanceGuardViolations(winner, proxyProfile, { hardOnly: true }) : []);
      const counter = expandEffectiveWeights(proxyAnchor || proxyOfferAnchor(options), proxyWeights);
      return {
        accepted: false,
        counterWeights: counter,
        moves: [],
        explanation: { source: "structured", text: performanceVetoText(winner, violations, options) },
        control: {
          source: "structured_performance_veto",
          veto_stop: true,
          terminated: true,
          selected_group: winner ? { class_id: winner.class_id, label: winner.label } : null,
          guard_violations: violations,
        },
        structuredProposal: {
          veto_stop: true,
          selected_group: winner ? { class_id: winner.class_id, label: winner.label } : null,
          guard_violations: violations,
          termination_reason: "performance_guard_veto",
          user_utility: stakeholderUtility(userProfile, offerWeights),
          proxy_utility: stakeholderUtility(proxyProfile, offerWeights),
          pareto_efficient: false,
        },
      };
    }

    function performanceVetoStop(offerWeights, proxyAnchor, userProfile, proxyProfile, options = {}) {
      const winner = winningGroup(offerWeights);
      if (!winner) return null;
      const proxyViolations = performanceGuardViolations(winner, { ...proxyProfile, guard_side: "Other-party" }, { hardOnly: true });
      if (proxyViolations.length) return makePerformanceVetoResponse(offerWeights, proxyAnchor, userProfile, proxyProfile, { ...options, violations: proxyViolations });
      const jointlyAcceptable = acceptableGroupsForProfiles(guardProfiles(userProfile, proxyProfile), { hardOnly: true });
      if (!jointlyAcceptable.length) {
        const allViolations = performanceGuardViolationsForProfiles(winner, guardProfiles(userProfile, proxyProfile), { hardOnly: true });
        return makePerformanceVetoResponse(offerWeights, proxyAnchor, userProfile, proxyProfile, { ...options, violations: allViolations, noFeasible: true });
      }
      return null;
    }

    function activeNegotiationKeys() {
      return activeCriteria();
    }

    function compactNegotiationProfile(profile) {
      return {
        key: profile?.key,
        role_label: profile?.role_label,
        position_example: profile?.position_example,
        salience_params: profileSalienceParams(profile),
        interests: (profile?.interests || []).slice(0, 3),
        issues: Object.fromEntries(criteriaOrder.map((key) => {
          const issue = issueData(profile, key);
          return [key, {
            ideal: issue.ideal,
            baseline_priority: issue.baseline_priority,
            aspiration: issue.aspiration,
            reservation_min: issue.reservation_min,
            reservation_max: issue.reservation_max,
            floor: issue.floor,
            target: issue.target,
            guard_type: issue.guard_type,
            rank: issue.rank,
            rigidity: issue.rigidity,
            negotiability: issue.negotiability,
            public_reason: issue.public_reason,
          }];
        })),
        performance_guards: Object.fromEntries(criteriaOrder.map((key) => {
          const guard = performanceGuard(profile, key);
          return [key, {
            enabled: Boolean(guard.enabled),
            veto_min: guard.veto_min,
            target_min: guard.target_min,
            floor: guard.floor,
            target: guard.target,
            guard_type: guard.guard_type,
            scope: guard.scope,
            negotiability: guard.negotiability,
            public_reason: guard.public_reason,
          }];
        })),
      };
    }

