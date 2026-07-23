/* profiles-stakes.js — negotiation profiles, performance guards, criterion stats & case stakes
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function buildNegotiationProfile(persona, idealWeights = persona?.weights) {
      const ideal = normalizeWeights(idealWeights || {});
      const rankOrder = personaRankDefaults[persona?.key] || criteriaOrder;
      const salienceParams = normalizeSalienceParams(persona?.salienceParams || defaultSalienceParams());
      const issues = {};
      const performanceGuards = {};
      criteriaOrder.forEach((key) => {
        const rank = Math.max(1, rankOrder.indexOf(key) + 1 || criteriaOrder.length);
        const rigidity = rank === 1 ? 0.9 : rank === 2 ? 0.75 : rank === 3 ? 0.58 : rank === 4 ? 0.42 : 0.3;
        const negotiability = rank <= 2 ? "soft" : rank === criteriaOrder.length ? "flexible" : "soft";
        const slack = rank === 1 ? 0.55 : rank === 2 ? 0.45 : rank === 3 ? 0.35 : rank === 4 ? 0.3 : 0.28;
        const aspirationDelta = rank <= 2 ? 0.04 : rank === 3 ? 0.02 : 0;
        const guard = performanceGuardForIssue(persona, key, rank);
        const baselinePriority = ideal[key] || 0;
        issues[key] = {
          ideal: baselinePriority,
          baseline_priority: baselinePriority,
          aspiration: Math.min(0.8, baselinePriority + aspirationDelta),
          reservation_min: Math.max(0.02, baselinePriority - slack),
          reservation_max: Math.min(0.8, baselinePriority + slack),
          floor: guard.veto_min,
          target: guard.target_min,
          guard_type: guard.negotiability,
          rank,
          rigidity,
          negotiability,
          public_reason: criterionPublicReason(persona, key, rank),
        };
        performanceGuards[key] = guard;
      });
      return {
        key: persona?.key || "stakeholder",
        role_label: personaTitle(persona),
        story_context: persona?.context || "",
        position_example: persona?.positionExample || `I want the final decision to reflect ${persona?.priority || "my stakeholder concern"}.`,
        interests: persona?.interests || [{ key: rankOrder[0], label: criteriaLabels[rankOrder[0]] || "Priority", rationale: persona?.concern || "This issue reflects the stakeholder's main concern." }],
        salience_params: salienceParams,
        issues,
        performance_guards: performanceGuards,
      };
    }

    function performanceGuardForIssue(persona, key, rank) {
      // The user's hard floor for their top criterion is *elicited* (floor ladder),
      // not a rank-derived constant. It only applies to the current user persona.
      const isUserTopFloor = Boolean(elicitedFloor)
        && key === elicitedFloor.key
        && persona?.key && currentPersona?.key
        && persona.key === currentPersona.key;
      const enabled = isUserTopFloor || rank <= 2;
      const negotiability = isUserTopFloor ? "hard" : rank === 1 ? "hard" : rank === 2 ? "soft" : "flexible";
      const vetoMin = isUserTopFloor ? clamp01Value(elicitedFloor.value) : rank === 1 ? 0.3 : 0;
      const targetMin = rank === 1 ? 0.55 : rank === 2 ? 0.45 : 0;
      return {
        enabled,
        veto_min: vetoMin,
        target_min: targetMin,
        floor: vetoMin,
        target: targetMin,
        guard_type: negotiability,
        scope: key === "tpr" || key === "tnr" ? `local_${LOCAL_SCOPE_SIZE}` : "case_group",
        negotiability,
        public_reason: performanceGuardReason(persona, key, rank),
      };
    }

    function performanceGuardReason(persona, key, rank) {
      const criterion = criteriaLabels[key] || key;
      if (rank === 1) return `${criterion} is a non-compensatory performance floor for this role: if a model group performs too poorly here, other criteria should not compensate for it.`;
      if (rank === 2) return `${criterion} is a soft performance floor for this role and should be protected before weighted trade-offs are considered.`;
      return `${criterion} is monitored, but this role does not use it as a veto floor.`;
    }

    function criterionPublicReason(persona, key, rank) {
      const criterion = criteriaLabels[key] || key;
      if (rank === 1) return `${criterion} is this role's core interest: ${persona?.concern || criteriaDescriptions[key] || "it matters for this stakeholder."}`;
      if (rank === 2) return `${criterion} is an important supporting concern for this role.`;
      if (rank >= 4) return `${criterion} matters, but this role treats it as more flexible during package trade-offs.`;
      return `${criterion} remains relevant, but it can be balanced against the role's higher-priority interests.`;
    }

    function profileForNegotiation(persona, idealOverride = null) {
      if (!persona) return buildNegotiationProfile({ label: "Stakeholder", weights }, idealOverride || weights);
      return buildNegotiationProfile(persona, idealOverride || persona.weights || weights);
    }

    function criterionStatsFromCaseData(caseData, key) {
      const groups = caseData?.reconciliation?.groups || [];
      const entries = groups.map((group) => ({
        group,
        value: clamp01Value(Number(group.criteria?.[key]) || 0),
        weight: Math.max(0, Number(group.count) || 0),
      }));
      const values = entries.map((entry) => entry.value);
      if (!values.length) {
        return {
          min: 0,
          max: 0,
          mean: 0,
          weightedMean: 0,
          variance: 0,
          sd: 0,
          spread: 0,
          range: 0,
          inactive: false,
          best_group: null,
          worst_group: null,
        };
      }
      const min = Math.min(...values);
      const max = Math.max(...values);
      const mean = values.reduce((total, value) => total + value, 0) / values.length;
      const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0);
      const weightedMean = totalWeight > 0
        ? entries.reduce((total, entry) => total + entry.value * entry.weight, 0) / totalWeight
        : mean;
      const variance = totalWeight > 0
        ? entries.reduce((total, entry) => total + entry.weight * Math.pow(entry.value - weightedMean, 2), 0) / totalWeight
        : values.reduce((total, value) => total + Math.pow(value - mean, 2), 0) / values.length;
      const sd = Math.sqrt(Math.max(0, variance));
      const best = [...entries].sort((a, b) => b.value - a.value)[0];
      const worst = [...entries].sort((a, b) => a.value - b.value)[0];
      const spread = max - min;
      const compactGroup = (entry) => entry ? {
        class_id: entry.group.class_id,
        label: entry.group.label,
        value: entry.value,
      } : null;
      return {
        min,
        max,
        mean,
        weightedMean,
        variance,
        sd,
        spread,
        range: spread,
        inactive: spread <= SAME_CRITERIA_THRESHOLD,
        best_group: compactGroup(best),
        worst_group: compactGroup(worst),
      };
    }

    function criterionStats(key) {
      return criterionStatsFromCaseData(activeData, key);
    }

    function clamp01Value(value) {
      return Math.max(0, Math.min(1, Number(value) || 0));
    }

    function issueBaselinePriority(profile, key) {
      const issue = profile?.issues?.[key] || {};
      const raw = Number(issue.baseline_priority ?? issue.ideal ?? 0);
      return clamp01Value(raw);
    }

    function issueTarget(profile, key) {
      const guard = profile?.performance_guards?.[key] || {};
      const issue = profile?.issues?.[key] || {};
      return clamp01Value(Number(guard.target_min ?? guard.target ?? issue.target ?? 0));
    }

    function issueFloor(profile, key) {
      const guard = profile?.performance_guards?.[key] || {};
      const issue = profile?.issues?.[key] || {};
      if (!guard.enabled || guard.negotiability !== "hard") return 0;
      return clamp01Value(Number(guard.veto_min ?? guard.floor ?? issue.floor ?? 0));
    }

    function reliabilityForCaseGroup(group, rowWeights) {
      const effective = normalizeWeights(rowWeights || weights);
      return criteriaOrder.reduce((score, key) => score + (effective[key] || 0) * (Number(group.criteria?.[key]) || 0), 0);
    }

    function winningGroupForCaseData(caseData, rowWeights) {
      const groups = caseData?.reconciliation?.groups || [];
      return groups
        .map((group) => ({ ...group, reliability: reliabilityForCaseGroup(group, rowWeights) }))
        .sort((a, b) => b.reliability - a.reliability || b.count - a.count)[0] || null;
    }

    function selectedValueForStake(key, rowWeights = null) {
      const stats = criterionStats(key);
      const selected = rowWeights ? winningGroup(rowWeights) : null;
      if (selected) return Number(selected.criteria?.[key]) || 0;
      return Number(stats.best_group?.value ?? stats.max ?? 0) || 0;
    }

    function selectedValueForCaseStake(caseData, key, rowWeights = null) {
      const stats = criterionStatsFromCaseData(caseData, key);
      const selected = rowWeights ? winningGroupForCaseData(caseData, rowWeights) : null;
      if (selected) return Number(selected.criteria?.[key]) || 0;
      return Number(stats.best_group?.value ?? stats.max ?? 0) || 0;
    }

    function caseCriterionStakeForCaseData(caseData, profile, key, rowWeights = null) {
      const stats = criterionStatsFromCaseData(caseData, key);
      const selectedValue = selectedValueForCaseStake(caseData, key, rowWeights);
      const target = issueTarget(profile, key);
      const floor = issueFloor(profile, key);
      const priority = issueBaselinePriority(profile, key);
      const adequacy = Math.max(0, target - selectedValue);
      const floorRisk = floor > 0 && selectedValue < floor - 0.001 ? 1 : 0;
      const allBelowFloor = floor > 0 && stats.max < floor - 0.001;
      const params = profileSalienceParams(profile);
      const leverageContribution = params.alpha * (stats.spread || 0);
      const adequacyContribution = params.beta * adequacy;
      const floorContribution = params.gamma * floorRisk;
      const salience = priority * (leverageContribution + adequacyContribution + floorContribution);
      return {
        key,
        priority,
        leverage: stats.spread || 0,
        min: stats.min,
        max: stats.max,
        best_group: stats.best_group,
        worst_group: stats.worst_group,
        selected_value: selectedValue,
        target,
        floor,
        adequacy,
        floor_risk: floorRisk,
        all_below_floor: allBelowFloor,
        salience,
        salience_params: params,
        salience_components: {
          leverage: leverageContribution,
          adequacy: adequacyContribution,
          floor: floorContribution,
        },
      };
    }

    function caseCriterionStake(profile, key, rowWeights = null) {
      return caseCriterionStakeForCaseData(activeData, profile, key, rowWeights);
    }

    function issueStakeType(userStake, proxyStake, jointSalience = null) {
      const joint = jointSalience ?? ((userStake?.salience || 0) + (proxyStake?.salience || 0));
      const leverage = Math.max(userStake?.leverage || 0, proxyStake?.leverage || 0);
      const floorRisk = Boolean(userStake?.floor_risk || proxyStake?.floor_risk || userStake?.all_below_floor || proxyStake?.all_below_floor);
      if (floorRisk) return "guardrail";
      if (joint <= LOW_JOINT_SALIENCE_THRESHOLD || leverage <= LOW_LEVERAGE_THRESHOLD) return "low_stakes";
      if (joint >= HIGH_SALIENCE_THRESHOLD && leverage >= HIGH_LEVERAGE_THRESHOLD) return "tradeoff";
      return "monitor";
    }


    function stakeNegotiabilityScore(stake) {
      if (!stake) return 0.5;
      if (stake.floor_risk || stake.all_below_floor) return 0;
      const saliencePressure = clamp01Value((stake.salience || 0) / Math.max(HIGH_SALIENCE_THRESHOLD * 2, 0.001));
      const leveragePressure = clamp01Value((stake.leverage || 0) / Math.max(HIGH_LEVERAGE_THRESHOLD * 2, 0.001));
      const adequacyPressure = clamp01Value((stake.adequacy || 0) / 0.25);
      return clamp01Value(1 - (0.55 * saliencePressure + 0.25 * leveragePressure + 0.2 * adequacyPressure));
    }

    function jointNegotiabilityScore(userStake, proxyStake) {
      return Math.min(stakeNegotiabilityScore(userStake), stakeNegotiabilityScore(proxyStake));
    }

    function negotiabilityLabel(score) {
      if (score <= 0.05) return "blocked";
      if (score < 0.34) return "low";
      if (score < 0.67) return "medium";
      return "high";
    }

    function issueStakeRationale(row, side = "proxy") {
      const stake = side === "user" ? row?.userStake : row?.proxyStake;
      if (!row || !stake) return "This issue remains part of the case-specific criteria contract.";
      const label = row.label || criteriaLabels[row.key] || row.key;
      const notes = [];
      if (stake.leverage >= HIGH_LEVERAGE_THRESHOLD) {
        notes.push(`${label} differs by ${fmtPct(stake.leverage)} across the candidate prediction groups`);
      } else if (stake.leverage <= LOW_LEVERAGE_THRESHOLD) {
        notes.push(`${label} differs by only ${fmtPct(stake.leverage)} across the candidate prediction groups`);
      }
      if (stake.all_below_floor) {
        notes.push(`all candidate groups are below this role's hard floor of ${fmtPct(stake.floor)}`);
      } else if (stake.floor_risk) {
        notes.push(`the currently selected group is below this role's hard floor of ${fmtPct(stake.floor)}`);
      } else if (stake.adequacy > 0.01) {
        notes.push(`the current case-level value is ${fmtPct(stake.adequacy)} below this role's target`);
      }
      if (!notes.length) notes.push(`${label} is adequate enough to be handled as a bounded trade-off in this case`);
      return notes.join("; ");
    }

    function impactBoundedDelta(key, desiredDelta) {
      const leverage = Math.max(criterionStats(key).spread || 0, 0.001);
      const impactLimit = MAX_COUNTER_IMPACT / leverage;
      return Math.max(0, Math.min(Math.max(0, desiredDelta), MAX_COUNTER_MOVE, impactLimit));
    }

    function isImpactBoundedMove(key, delta) {
      const leverage = criterionStats(key).spread || 0;
      return Math.abs(delta) * leverage <= MAX_COUNTER_IMPACT + 0.001;
    }

    function compactStakeForProxy(stake) {
      if (!stake) return null;
      return {
        priority: stake.priority,
        leverage: stake.leverage,
        selected_value: stake.selected_value,
        target: stake.target,
        floor: stake.floor,
        adequacy: stake.adequacy,
        floor_risk: Boolean(stake.floor_risk),
        all_below_floor: Boolean(stake.all_below_floor),
        salience: stake.salience,
        salience_components: stake.salience_components || null,
        negotiability_score: stakeNegotiabilityScore(stake),
        negotiability_label: negotiabilityLabel(stakeNegotiabilityScore(stake)),
      };
    }

    function inactiveCriteria() {
      return criteriaOrder.filter((key) => criterionStats(key).inactive);
    }

    function activeCriteria() {
      const activeSet = new Set(criteriaOrder.filter((key) => !criterionStats(key).inactive));
      [
        window.primaryCriterionKeyForPersona?.(currentPersona),
        window.primaryCriterionKeyForPersona?.(proxyPersona),
        rankedCriteria?.[0],
      ].forEach((key) => {
        if (criteriaOrder.includes(key)) activeSet.add(key);
      });
      const active = criteriaOrder.filter((key) => activeSet.has(key));
      return active.length ? active : [...criteriaOrder];
    }

    function isInactiveCriterion(key) {
      return criterionStats(key).inactive && activeCriteria().length < criteriaOrder.length;
    }

    function decisionEffectiveWeights(rowWeights) {
      const full = normalizeWeights(rowWeights || {});
      const active = activeCriteria();
      if (active.length === criteriaOrder.length) return full;
      const activeMass = active.reduce((total, key) => total + (full[key] || 0), 0);
      if (activeMass <= 0) return normalizeWeights(Object.fromEntries(active.map((key) => [key, 1])));
      const effective = {};
      criteriaOrder.forEach((key) => { effective[key] = active.includes(key) ? (full[key] || 0) / activeMass : 0; });
      return normalizeWeights(effective);
    }

    function expandEffectiveWeights(effectiveWeights, baseFullWeights = weights) {
      const effective = decisionEffectiveWeights(effectiveWeights || {});
      const base = normalizeWeights(baseFullWeights || {});
      const inactive = inactiveCriteria();
      const active = activeCriteria();
      if (!inactive.length || active.length === criteriaOrder.length) return normalizeWeights(effectiveWeights || base);
      const inactiveMass = inactive.reduce((total, key) => total + (base[key] || 0), 0);
      const activeMass = Math.max(0, 1 - inactiveMass);
      const expanded = {};
      inactive.forEach((key) => { expanded[key] = base[key] || 0; });
      active.forEach((key) => { expanded[key] = activeMass * (effective[key] || 0); });
      return normalizeWeights(expanded);
    }

