/* negotiation-engine.js — issue classification, feasible contracts, Pareto/logrolling, Other-party API
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function buildNegotiationContext(offerWeights) {
      const userIdealFull = normalizeWeights(elicitedWeights || currentPersona?.weights || userWeights || offerWeights || weights);
      const proxyIdealFull = normalizeWeights(proxyIdealWeights());
      const userIdeal = decisionEffectiveWeights(userIdealFull);
      const proxyIdeal = decisionEffectiveWeights(proxyIdealFull);
      return {
        userProfile: profileForNegotiation(currentPersona || { label: "Self", weights: userIdealFull }, userIdeal),
        proxyProfile: profileForNegotiation(proxyPersona || { label: "Other-party", weights: proxyIdealFull }, proxyIdeal),
      };
    }

    function primaryCriterionKeyForProfile(profile) {
      const interestKey = profile?.interests?.find((item) => criteriaOrder.includes(item?.key))?.key;
      if (interestKey) return interestKey;
      return criteriaOrder
        .map((key) => ({ key, rank: issueRank(profile, key) }))
        .sort((a, b) => a.rank - b.rank)[0]?.key || criteriaOrder[0];
    }

    function classifyNegotiationIssues(userProfile, proxyProfile, offerWeights) {
      const offer = decisionEffectiveWeights(offerWeights);
      const keys = activeNegotiationKeys();
      const userCoreKey = primaryCriterionKeyForProfile(userProfile);
      const proxyCoreKey = primaryCriterionKeyForProfile(proxyProfile);
      const rows = keys.map((key) => {
        const userStake = caseCriterionStake(userProfile, key, offer);
        const proxyStake = caseCriterionStake(proxyProfile, key, offer);
        const jointSalience = userStake.salience + proxyStake.salience;
        const issueType = issueStakeType(userStake, proxyStake, jointSalience);
        const row = {
          key,
          label: criteriaLabels[key],
          offer: offer[key] || 0,
          userRank: issueRank(userProfile, key),
          proxyRank: issueRank(proxyProfile, key),
          userRigidity: issueRigidity(userProfile, key),
          proxyRigidity: issueRigidity(proxyProfile, key),
          proxyGap: issueAspiration(proxyProfile, key) - (offer[key] || 0),
          userGap: issueAspiration(userProfile, key) - (offer[key] || 0),
          minBound: Math.max(issueReservationMin(userProfile, key), issueReservationMin(proxyProfile, key)),
          maxBound: Math.min(issueReservationMax(userProfile, key), issueReservationMax(proxyProfile, key)),
          userStake,
          proxyStake,
          salienceUser: userStake.salience,
          salienceProxy: proxyStake.salience,
          jointSalience,
          leverage: Math.max(userStake.leverage, proxyStake.leverage),
          userIsCore: key === userCoreKey,
          proxyIsCore: key === proxyCoreKey,
          negotiabilityUser: stakeNegotiabilityScore(userStake),
          negotiabilityProxy: stakeNegotiabilityScore(proxyStake),
          negotiabilityJoint: jointNegotiabilityScore(userStake, proxyStake),
          negotiabilityLabel: negotiabilityLabel(jointNegotiabilityScore(userStake, proxyStake)),
          adequacyUser: userStake.adequacy,
          adequacyProxy: proxyStake.adequacy,
          floorRiskUser: Boolean(userStake.floor_risk || userStake.all_below_floor),
          floorRiskProxy: Boolean(proxyStake.floor_risk || proxyStake.all_below_floor),
          issueType,
          locked: issueData(userProfile, key).negotiability === "hard" || issueData(proxyProfile, key).negotiability === "hard" || userStake.all_below_floor || proxyStake.all_below_floor,
        };
        row.rationale = issueStakeRationale(row, row.salienceProxy >= row.salienceUser ? "proxy" : "user");
        return row;
      });

      const proxyAsk = rows
        .filter((row) => !row.locked && !row.floorRiskProxy && (
          row.proxyIsCore ? row.proxyGap > 0.001 : row.proxyGap > 0.005 && row.leverage > LOW_LEVERAGE_THRESHOLD
        ))
        .sort((a, b) => Number(b.proxyIsCore) - Number(a.proxyIsCore) || b.salienceProxy - a.salienceProxy || b.proxyGap - a.proxyGap || b.leverage - a.leverage);
      if (!proxyAsk.length) {
        const fallback = [...rows]
          .filter((row) => !row.locked)
          .sort((a, b) => Number(b.proxyIsCore) - Number(a.proxyIsCore) || b.salienceProxy - a.salienceProxy || b.proxyGap - a.proxyGap || a.proxyRank - b.proxyRank)[0] || rows[0];
        if (fallback) proxyAsk.push(fallback);
      }

      const proxyConcession = rows
        .filter((row) => !row.locked && row.key !== proxyAsk[0]?.key && (row.userIsCore || row.salienceUser >= HIGH_SALIENCE_THRESHOLD || row.floorRiskUser || row.userRank <= 2))
        .sort((a, b) => Number(b.userIsCore) - Number(a.userIsCore) || b.salienceUser - a.salienceUser || a.userRank - b.userRank || b.userRigidity - a.userRigidity);
      if (!proxyConcession.length) {
        const fallback = [...rows]
          .filter((row) => !row.locked && row.key !== proxyAsk[0]?.key)
          .sort((a, b) => Number(b.userIsCore) - Number(a.userIsCore) || b.salienceUser - a.salienceUser || a.userRank - b.userRank)[0];
        if (fallback) proxyConcession.push(fallback);
      }

      const budgetSource = rows
        .filter((row) => !row.locked && !row.userIsCore && !row.proxyIsCore && row.key !== proxyAsk[0]?.key && row.key !== proxyConcession[0]?.key && row.offer - row.minBound > NEGOTIATION_STEP && !row.floorRiskUser && !row.floorRiskProxy)
        .sort((a, b) => b.negotiabilityJoint - a.negotiabilityJoint || a.jointSalience - b.jointSalience || a.leverage - b.leverage || (b.offer - b.minBound) - (a.offer - a.minBound));
      if (!budgetSource.length) {
        const fallback = [...rows]
          .filter((row) => !row.locked && !row.proxyIsCore && row.key !== proxyAsk[0]?.key && row.offer - row.minBound > NEGOTIATION_STEP && !row.floorRiskUser && !row.floorRiskProxy)
          .sort((a, b) => Number(a.userIsCore) - Number(b.userIsCore) || b.negotiabilityJoint - a.negotiabilityJoint || a.jointSalience - b.jointSalience || (b.offer - b.minBound) - (a.offer - a.minBound))[0];
        if (fallback) budgetSource.push(fallback);
      }

      const lockedIssue = rows.filter((row) => row.locked || row.floorRiskUser || row.floorRiskProxy || (row.userRigidity >= 0.85 && row.proxyRigidity >= 0.85));
      return { rows, proxyAsk, proxyConcession, budgetSource, lockedIssue };
    }

    function stakeholderUtility(profile, rowWeights) {
      const row = decisionEffectiveWeights(rowWeights);
      const keys = activeNegotiationKeys();
      const totalRigidity = keys.reduce((total, key) => total + issueRigidity(profile, key), 0) || 1;
      const loss = keys.reduce((total, key) => total + issueRigidity(profile, key) * Math.abs((row[key] || 0) - issueIdeal(profile, key)), 0);
      const weightFit = 1 - loss / totalRigidity;
      const selected = winningGroup(row);
      if (!selected) return clamp01Value(weightFit);
      const stakes = keys.map((key) => caseCriterionStake(profile, key, row));
      const totalStake = stakes.reduce((total, stake) => total + issueRigidity(profile, stake.key) * Math.max(0.05, stake.priority), 0) || 1;
      const adequacyLoss = stakes.reduce((total, stake) => {
        const issueWeight = issueRigidity(profile, stake.key) * Math.max(0.05, stake.priority);
        return total + issueWeight * Math.max(0, stake.adequacy);
      }, 0) / totalStake;
      const floorPenalty = stakes.some((stake) => stake.floor_risk) ? 0.3 : 0;
      return clamp01Value(weightFit - 0.45 * adequacyLoss - floorPenalty);
    }

    function satisfiesReservations(rowWeights, userProfile, proxyProfile, baseWeights = null) {
      const row = decisionEffectiveWeights(rowWeights);
      const base = baseWeights ? decisionEffectiveWeights(baseWeights) : null;
      return activeNegotiationKeys().every((key) => {
        const minBound = Math.max(issueReservationMin(userProfile, key), issueReservationMin(proxyProfile, key));
        const maxBound = Math.min(issueReservationMax(userProfile, key), issueReservationMax(proxyProfile, key));
        const value = row[key] || 0;
        if (value < minBound - 0.001 || value > maxBound + 0.001) return false;
        if (base && Math.abs(value - (base[key] || 0)) > MAX_COUNTER_MOVE + 0.001) return false;
        if (base && !isImpactBoundedMove(key, value - (base[key] || 0))) return false;
        return true;
      });
    }

    function candidateWithUtilities(weights, userProfile, proxyProfile, classification, ask, concession, source) {
      const userUtility = stakeholderUtility(userProfile, weights);
      const proxyUtility = stakeholderUtility(proxyProfile, weights);
      const userWinner = winningGroup(weights);
      const proxyWinner = winningGroup(proxyIdealWeights());
      return {
        weights: normalizeWeights(weights),
        userUtility,
        proxyUtility,
        jointUtility: userUtility + proxyUtility,
        sameDecisionAsProxy: Boolean(userWinner && proxyWinner && userWinner.class_id === proxyWinner.class_id),
        ask,
        concession,
        source,
        classification,
      };
    }

    function generateFeasibleContracts(offerWeights, userProfile, proxyProfile, classification, options = {}) {
      const offer = decisionEffectiveWeights(offerWeights);
      const step = options.opening ? OPENING_NEGOTIATION_STEP : NEGOTIATION_STEP;
      const askItems = classification.proxyAsk.slice(0, 2);
      const concessionItems = classification.proxyConcession.length ? classification.proxyConcession.slice(0, 2) : [null];
      const sourceItems = classification.budgetSource.slice(0, 3);
      const candidates = [];

      askItems.forEach((ask) => {
        if (!ask) return;
        concessionItems.forEach((concession) => {
          sourceItems.forEach((source) => {
            if (!source || source.key === ask.key) return;
            const askGap = Math.max(0, Math.min(issueAspiration(proxyProfile, ask.key), ask.maxBound) - (offer[ask.key] || 0));
            let askDelta = impactBoundedDelta(ask.key, Math.min(step, askGap || step, MAX_COUNTER_MOVE));
            if (askDelta <= 0.004) return;
            let concessionDelta = 0;
            if (concession && concession.key !== source.key && concession.key !== ask.key) {
              const concessionTarget = Math.min(issueAspiration(userProfile, concession.key), concession.maxBound);
              concessionDelta = impactBoundedDelta(concession.key, Math.max(0, Math.min(step / 2, concessionTarget - (offer[concession.key] || 0), MAX_COUNTER_MOVE)));
            }
            let totalIncrease = askDelta + concessionDelta;
            const sourceCapacity = Math.min(
              Math.max(0, (offer[source.key] || 0) - source.minBound),
              impactBoundedDelta(source.key, totalIncrease)
            );
            const scaleDown = totalIncrease > 0 ? Math.min(1, sourceCapacity / totalIncrease) : 0;
            askDelta *= scaleDown;
            concessionDelta *= scaleDown;
            totalIncrease = askDelta + concessionDelta;
            if (totalIncrease <= 0.004) return;
            if ((offer[source.key] || 0) - totalIncrease < source.minBound - 0.001) return;
            const next = { ...offer };
            next[ask.key] = (next[ask.key] || 0) + askDelta;
            if (concessionDelta > 0) next[concession.key] = (next[concession.key] || 0) + concessionDelta;
            next[source.key] = (next[source.key] || 0) - totalIncrease;
            const normalized = normalizeWeights(next);
            if (!satisfiesReservations(normalized, userProfile, proxyProfile, offer)) return;
            if (!satisfiesPerformanceGuards(normalized, guardProfiles(userProfile, proxyProfile), { hardOnly: true })) return;
            candidates.push(candidateWithUtilities(normalized, userProfile, proxyProfile, classification, ask, concession, source));
          });
        });
      });

      if (!candidates.length) {
        const fallback = makeFallbackLogrollingCandidate(offer, userProfile, proxyProfile, classification, step);
        if (fallback) candidates.push(fallback);
      }
      return candidates;
    }

    function makeFallbackLogrollingCandidate(offer, userProfile, proxyProfile, classification, step) {
      const ask = classification.proxyAsk[0];
      const source = classification.budgetSource[0] || classification.rows
        .filter((row) => row.key !== ask?.key && row.offer - row.minBound > step / 2)
        .sort((a, b) => (b.offer - b.minBound) - (a.offer - a.minBound))[0];
      if (!ask || !source) return null;
      const delta = Math.min(
        impactBoundedDelta(ask.key, step / 2),
        impactBoundedDelta(source.key, step / 2),
        (offer[source.key] || 0) - source.minBound,
        ask.maxBound - (offer[ask.key] || 0),
        MAX_COUNTER_MOVE
      );
      if (delta <= 0.004) return null;
      const next = { ...offer, [ask.key]: (offer[ask.key] || 0) + delta, [source.key]: (offer[source.key] || 0) - delta };
      if (!satisfiesReservations(next, userProfile, proxyProfile, offer)) return null;
      if (!satisfiesPerformanceGuards(next, guardProfiles(userProfile, proxyProfile), { hardOnly: true })) return null;
      return candidateWithUtilities(next, userProfile, proxyProfile, classification, ask, classification.proxyConcession[0] || null, source);
    }

    function paretoFrontier(candidates) {
      return candidates.filter((candidate, index) => !candidates.some((other, otherIndex) => {
        if (index === otherIndex) return false;
        const noWorse = other.userUtility >= candidate.userUtility - 0.0001 && other.proxyUtility >= candidate.proxyUtility - 0.0001;
        const strictlyBetter = other.userUtility > candidate.userUtility + 0.0001 || other.proxyUtility > candidate.proxyUtility + 0.0001;
        return noWorse && strictlyBetter;
      }));
    }

    function selectCounterOffer(frontier) {
      return [...frontier].sort((a, b) => {
        const score = (item) => {
          const balance = Math.min(item.userUtility, item.proxyUtility);
          const coreAskBonus = item.ask?.proxyIsCore ? 0.08 : 0;
          const coreConcessionBonus = item.concession?.userIsCore ? 0.03 : 0;
          return item.proxyUtility * 0.55 + item.jointUtility * 0.2 + item.userUtility * 0.12 + balance * 0.1 + (item.sameDecisionAsProxy ? 0.03 : 0) + coreAskBonus + coreConcessionBonus;
        };
        return score(b) - score(a);
      })[0] || null;
    }

    function shouldAcceptStructuredOffer(offerWeights, userProfile, proxyProfile, options = {}) {
      if (options.forceCounter || negotiationRound <= 0) return false;
      const offer = decisionEffectiveWeights(offerWeights);
      if (!satisfiesReservations(offer, userProfile, proxyProfile)) return false;
      if (!satisfiesPerformanceGuards(offer, guardProfiles(userProfile, proxyProfile), { hardOnly: true })) return false;
      const proxyUtility = stakeholderUtility(proxyProfile, offer);
      const userWinner = winningGroup(offer);
      const proxyWinner = winningGroup(proxyIdealWeights());
      const sameDecision = Boolean(userWinner && proxyWinner && userWinner.class_id === proxyWinner.class_id);
      return proxyUtility >= 0.96 || (negotiationRound >= MIN_ROUNDS_BEFORE_RESULT_CONSENSUS && sameDecision && proxyUtility >= 0.9);
    }

    function acceptedStructuredText(offerWeights, proxyProfile) {
      const proxyUtility = stakeholderUtility(proxyProfile, offerWeights);
      return `I can accept this criteria contract. It stays within my reservation bounds and gives my stakeholder role enough utility (${fmtPct(proxyUtility)}), so we can use it to compute the reconciled reliability decision.`;
    }

    function proxyOfferAnchor(options = {}) {
      if (options.opening || negotiationRound === 0) return decisionEffectiveWeights(proxyIdealWeights());
      return decisionEffectiveWeights(proxyWeights || proxyIdealWeights());
    }

    function generateLogrollingCounterOffer(offerWeights, options = {}) {
      const userOffer = decisionEffectiveWeights(offerWeights);
      const proxyAnchor = proxyOfferAnchor(options);
      const { userProfile, proxyProfile } = buildNegotiationContext(offerWeights);
      const vetoStop = options.opening ? null : performanceVetoStop(userOffer, proxyAnchor, userProfile, proxyProfile, options);
      if (vetoStop) return vetoStop;
      if (shouldAcceptStructuredOffer(userOffer, userProfile, proxyProfile, options)) {
        return {
          accepted: true,
          counterWeights: expandEffectiveWeights(userOffer, proxyWeights),
          moves: [],
          explanation: { source: "structured", text: acceptedStructuredText(userOffer, proxyProfile) },
          control: { source: "structured_logrolling", proxy_utility: stakeholderUtility(proxyProfile, userOffer), pareto_efficient: true },
          structuredProposal: null,
        };
      }

      const classification = classifyNegotiationIssues(userProfile, proxyProfile, proxyAnchor);
      const candidates = generateFeasibleContracts(proxyAnchor, userProfile, proxyProfile, classification, { opening: options.opening || negotiationRound === 0 });
      const frontier = paretoFrontier(candidates);
      const selected = selectCounterOffer(frontier.length ? frontier : candidates);
      if (!selected) {
        const target = normalizeWeights(Object.fromEntries(criteriaOrder.map((key) => [key, 0.85 * (proxyAnchor[key] || 0) + 0.15 * (userOffer[key] || 0)])));
        if (!satisfiesPerformanceGuards(target, guardProfiles(userProfile, proxyProfile), { hardOnly: true })) {
          return makePerformanceVetoResponse(target, proxyAnchor, userProfile, proxyProfile, { noFeasible: true });
        }
        return {
          accepted: false,
          counterWeights: expandEffectiveWeights(target, proxyWeights),
          moves: staticMoves(proxyAnchor, target),
          explanation: { source: "structured", text: "I could not find a clean criteria-contract package within the reservation and guardrail bounds, so I am making only a small movement from my current Other-party anchor toward Self's offer." },
          control: { source: "structured_logrolling", pareto_efficient: false, fallback: true, anchor: "proxy" },
          structuredProposal: null,
        };
      }

      const proposal = {
        ask: selected.ask ? proposalIssueSummary(selected.ask, proxyAnchor, selected.weights) : null,
        concession: selected.concession ? proposalIssueSummary(selected.concession, proxyAnchor, selected.weights) : null,
        budget_source: selected.source ? proposalIssueSummary(selected.source, proxyAnchor, selected.weights) : null,
        user_utility: selected.userUtility,
        proxy_utility: selected.proxyUtility,
        joint_utility: selected.jointUtility,
        pareto_efficient: frontier.includes(selected),
      };
      const counterWeights = expandEffectiveWeights(selected.weights, proxyWeights);
      return {
        accepted: false,
        counterWeights,
        moves: staticMoves(proxyAnchor, selected.weights),
        explanation: { source: "structured", text: describeStructuredProposal(proposal) },
        control: { source: "structured_logrolling", pareto_efficient: proposal.pareto_efficient, user_utility: selected.userUtility, proxy_utility: selected.proxyUtility, anchor: "proxy" },
        structuredProposal: proposal,
      };
    }

    function proposalIssueSummary(issue, fromWeights, toWeights) {
      const from = fromWeights[issue.key] || 0;
      const to = toWeights[issue.key] || 0;
      const leverage = Number(issue.leverage ?? criterionStats(issue.key).spread ?? 0) || 0;
      return {
        key: issue.key,
        label: issue.label || criteriaLabels[issue.key],
        from,
        to,
        delta: to - from,
        impact: Math.abs(to - from) * leverage,
        issue_type: issue.issueType || "monitor",
        leverage,
        salience_user: Number(issue.salienceUser || 0),
        salience_proxy: Number(issue.salienceProxy || 0),
        negotiability_score: Number(issue.negotiabilityJoint ?? 0.5),
        negotiability_label: issue.negotiabilityLabel || negotiabilityLabel(Number(issue.negotiabilityJoint ?? 0.5)),
        adequacy_user: Number(issue.adequacyUser || 0),
        adequacy_proxy: Number(issue.adequacyProxy || 0),
        floor_risk_user: Boolean(issue.floorRiskUser),
        floor_risk_proxy: Boolean(issue.floorRiskProxy),
        rationale: issue.rationale || issueStakeRationale(issue, issue.salienceProxy >= issue.salienceUser ? "proxy" : "user"),
      };
    }

    function issueMetadataSentence(issue, side = "proxy") {
      if (!issue) return "";
      const adequacy = side === "user" ? issue.adequacy_user : issue.adequacy_proxy;
      const floorRisk = side === "user" ? issue.floor_risk_user : issue.floor_risk_proxy;
      const notes = [];
      if (Number(issue.leverage) >= HIGH_LEVERAGE_THRESHOLD) notes.push(`it differs by ${fmtPct(issue.leverage)} across prediction groups`);
      if (Number(issue.leverage) <= LOW_LEVERAGE_THRESHOLD) notes.push(`it differs by only ${fmtPct(issue.leverage)} across prediction groups`);
      if (floorRisk) notes.push("it is near or below a hard guardrail");
      else if (Number(adequacy) > 0.01) notes.push(`it is ${fmtPct(adequacy)} below the role target`);
      return notes.length ? ` (${notes.join("; ")})` : "";
    }

    function describeStructuredProposal(proposal) {
      if (!proposal) return "I am proposing a bounded counter-offer based on the case-specific criteria contract.";
      const ask = proposal.ask;
      const concession = proposal.concession;
      const source = proposal.budget_source;
      const parts = [];
      if (concession) {
        parts.push(`I keep Self's core concern, ${escapeHtml(concession.label)}, visible in this case-specific decision rule (${fmtPct(concession.from)} to ${fmtPct(concession.to)})${escapeHtml(issueMetadataSentence(concession, "user"))}.`);
      }
      if (ask) {
        parts.push(`In return, I ask for more case-level emphasis on ${escapeHtml(ask.label)} (${fmtPct(ask.from)} to ${fmtPct(ask.to)})${escapeHtml(issueMetadataSentence(ask, "proxy"))}.`);
      }
      if (source) {
        parts.push(`To keep the total criteria budget fixed, I fund this package from ${escapeHtml(source.label)} (${fmtPct(source.from)} to ${fmtPct(source.to)}), because it is lower-stakes for this case${escapeHtml(issueMetadataSentence(source, "proxy"))}.`);
      }
      parts.push("This changes the criteria contract for this case; it does not claim that either stakeholder has changed their underlying values.");
      parts.push(proposal.pareto_efficient
        ? "This counter-offer is Pareto-efficient among the feasible packages I checked under the salience and guardrail constraints."
        : "This counter-offer satisfies the reservation and guardrail bounds, but it is a fallback package rather than a strict Pareto-frontier offer.");
      return parts.join("<br><br>");
    }

    async function negotiateWithStaticProxy(offerWeights, fallbackReason = null) {
      const result = generateLogrollingCounterOffer(offerWeights);
      negotiationRound += 1;
      if (fallbackReason) {
        result.explanation.text = `${result.explanation.text}<br><br><span class="muted">Structured Other-party fallback: ${escapeHtml(fallbackReason)}</span>`;
        result.control = { ...(result.control || {}), fallback_reason: fallbackReason };
      }
      return result;
    }

    function compactHistoryForProxy() {
      return negotiationEvents.slice(-8).map((event) => ({
        role: event.role,
        title: event.title,
        text: String(event.text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 700),
        weights: event.weights ? decisionEffectiveWeights(event.weights) : null,
      }));
    }

    function compactGroupsForProxy(rowWeights) {
      if (!activeData?.reconciliation?.groups) return [];
      return activeData.reconciliation.groups.map((group) => ({
        class_id: group.class_id,
        label: group.label,
        count: group.count,
        criteria: group.criteria,
        user_reliability: computeReliability(group, rowWeights),
        proxy_reliability: computeReliability(group, proxyIdealWeights()),
        fairness_components: group.fairness_components || null,
      })).sort((a, b) => a.class_id - b.class_id);
    }

    function compactCaseStakesForProxy(rowWeights, userProfile, proxyProfile) {
      const offer = decisionEffectiveWeights(rowWeights || userWeights);
      return Object.fromEntries(criteriaOrder.map((key) => {
        const stats = criterionStats(key);
        return [key, {
          min: stats.min,
          max: stats.max,
          range: stats.spread,
          best_group: stats.best_group,
          worst_group: stats.worst_group,
          user: compactStakeForProxy(caseCriterionStake(userProfile, key, offer)),
          proxy: compactStakeForProxy(caseCriterionStake(proxyProfile, key, offer)),
        }];
      }));
    }

    function buildProxyPayload(offerWeights, structuredResponse = null) {
      const offer = decisionEffectiveWeights(offerWeights);
      const datasetMetaItem = datasetMeta.find((item) => item.key === datasetSelect.value) || {};
      const { userProfile, proxyProfile } = buildNegotiationContext(offerWeights);
      return {
        dataset: datasetSelect.value,
        dataset_label: datasetMetaItem.label || activeData?.dataset_label || datasetSelect.value,
        case_index: Number(caseSelect.value),
        round: negotiationRound + 1,
        user_role: personaTitle(currentPersona || { label: "Self" }),
        proxy_role: personaTitle(proxyPersona || { label: "Other-party" }),
        criteria_labels: criteriaLabels,
        user_weights: offer,
        proxy_weights: decisionEffectiveWeights(proxyIdealWeights()),
        groups: compactGroupsForProxy(offer),
        case_stakes: compactCaseStakesForProxy(offer, userProfile, proxyProfile),
        case_features: activeData?.case?.features || {},
        history: compactHistoryForProxy(),
        negotiation_profiles: {
          user: compactNegotiationProfile(userProfile),
          proxy: compactNegotiationProfile(proxyProfile),
        },
        structured_proposal: structuredResponse ? {
          accepted: structuredResponse.accepted,
          counter_weights: decisionEffectiveWeights(structuredResponse.counterWeights),
          moves: structuredResponse.moves,
          explanation: structuredResponse.explanation,
          control: structuredResponse.control,
          package: structuredResponse.structuredProposal,
        } : null,
      };
    }

    function normalizeProxyResponse(raw, offerWeights, structuredResponse = null) {
      if (structuredResponse) {
        return {
          ...structuredResponse,
          explanation: {
            source: raw?.explanation?.source || "openai",
            text: raw?.explanation?.text || structuredResponse.explanation.text,
          },
          control: { ...(structuredResponse.control || {}), ...(raw?.control || {}), source: raw?.control?.source || structuredResponse.control?.source || "structured_logrolling" },
        };
      }
      const offer = decisionEffectiveWeights(offerWeights);
      const rawWeights = raw?.counter_weights || raw?.counterWeights || offer;
      const effectiveCounter = normalizeWeights(rawWeights);
      const expandedCounter = expandEffectiveWeights(effectiveCounter, proxyWeights);
      const moves = Array.isArray(raw?.moves) && raw.moves.length
        ? raw.moves.map((move) => ({
            key: move.key,
            label: move.label || criteriaLabels[move.key] || move.key,
            from: Number.isFinite(Number(move.from)) ? Number(move.from) : offer[move.key],
            to: Number.isFinite(Number(move.to)) ? Number(move.to) : effectiveCounter[move.key],
            delta: Number.isFinite(Number(move.delta)) ? Number(move.delta) : (effectiveCounter[move.key] || 0) - (offer[move.key] || 0),
          })).filter((move) => criteriaOrder.includes(move.key))
        : staticMoves(offer, effectiveCounter);
      return {
        accepted: Boolean(raw?.accepted),
        counterWeights: expandedCounter,
        moves,
        explanation: {
          source: raw?.explanation?.source || "openai",
          text: raw?.explanation?.text || "I generated a prompt-based counter-offer from the Other-party role's priorities.",
        },
        control: { ...(raw?.control || {}), source: raw?.control?.source || "cloudflare_worker" },
      };
    }

    async function negotiateWithProxy(offerWeights) {
      const structuredResponse = generateLogrollingCounterOffer(offerWeights);
      if (structuredResponse.accepted || structuredResponse.control?.veto_stop || structuredResponse.structuredProposal?.veto_stop) {
        negotiationRound += 1;
        return structuredResponse;
      }
      if (!OPENAI_PROXY_URL) {
        negotiationRound += 1;
        return {
          ...structuredResponse,
          explanation: {
            ...structuredResponse.explanation,
            text: `${structuredResponse.explanation.text}<br><br><span class="muted">Worker URL is not configured; using the structured logrolling proposal directly.</span>`,
          },
        };
      }
      try {
        const response = await fetch(OPENAI_PROXY_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(buildProxyPayload(offerWeights, structuredResponse)),
        });
        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          throw new Error(`${response.status} ${response.statusText}${errorText ? `: ${errorText.slice(0, 160)}` : ""}`);
        }
        const raw = await response.json();
        const result = normalizeProxyResponse(raw, offerWeights, structuredResponse);
        negotiationRound += 1;
        return result;
      } catch (error) {
        negotiationRound += 1;
        return {
          ...structuredResponse,
          explanation: {
            ...structuredResponse.explanation,
            text: `${structuredResponse.explanation.text}<br><br><span class="muted">OpenAI verbalization fallback: ${escapeHtml(error.message)}</span>`,
          },
          control: { ...(structuredResponse.control || {}), fallback_reason: error.message },
        };
      }
    }

