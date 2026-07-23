/* calibration.js — floor-ladder + adaptive example-comparison calibration and salience fit
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function normalizeElicitedFloor(raw) {
      if (!raw || typeof raw !== "object") return null;
      if (!criteriaOrder.includes(raw.key)) return null;
      const value = Number(raw.value);
      if (!Number.isFinite(value)) return null;
      return { key: raw.key, value: clamp01Value(value), source: raw.source || "elicited" };
    }

    function calibrationPoolCases() {
      const valid = (calibrationCaseData || []).filter(Boolean);
      return valid.length ? valid : [activeData].filter(Boolean);
    }

    // The single most-discriminating pair of prediction groups in a case.
    function calibrationPairForCase(caseData) {
      const groups = [...(caseData?.reconciliation?.groups || [])];
      if (groups.length < 2) return { left: groups[0] || null, right: groups[0] || null };
      let best = { left: groups[0], right: groups[1], score: -1 };
      for (let i = 0; i < groups.length; i += 1) {
        for (let j = i + 1; j < groups.length; j += 1) {
          const range = criteriaOrder.reduce((total, key) => total + Math.abs((Number(groups[i].criteria?.[key]) || 0) - (Number(groups[j].criteria?.[key]) || 0)), 0);
          if (range > best.score) best = { left: groups[i], right: groups[j], score: range };
        }
      }
      // Always show the lower class_id on the left (e.g. predicted Low Risk /
      // Rejected) and the higher on the right (predicted High Risk / Approved).
      const [left, right] = [best.left, best.right].sort((a, b) => Number(a.class_id) - Number(b.class_id));
      return { left, right };
    }

    // Information-gain proxy: a case discriminates `s` well if the candidate
    // grid values disagree about which group wins (sign flips), then by how much.
    function caseDiscrimination(caseData) {
      const pair = calibrationPairForCase(caseData);
      if (!pair.left || !pair.right) return -1;
      const diffs = SALIENCE_SCALAR_GRID.map((s) => {
        const p = paramsFromScalar(s);
        return calibrationGroupUtility(pair.left, caseData, p) - calibrationGroupUtility(pair.right, caseData, p);
      });
      const signs = new Set(diffs.map((d) => Math.sign(d) || 0));
      const range = Math.max(...diffs) - Math.min(...diffs);
      return (signs.size > 1 ? 10 : 0) + range;
    }

    function mostDiscriminativeCaseIndex(usedIndices = []) {
      const pool = calibrationPoolCases();
      const used = new Set(usedIndices);
      let bestIdx = -1;
      let bestScore = -Infinity;
      pool.forEach((caseData, idx) => {
        if (used.has(idx)) return;
        const score = caseDiscrimination(caseData);
        if (score > bestScore) { bestScore = score; bestIdx = idx; }
      });
      if (bestIdx >= 0) return bestIdx;
      return pool.findIndex((_, idx) => !used.has(idx));
    }

    function ensureCalibrationSetup() {
      const pool = calibrationPoolCases();
      calibrationOrder = (Array.isArray(calibrationOrder) ? calibrationOrder : []).filter((idx) => idx >= 0 && idx < pool.length);
      if (!calibrationOrder.length && pool.length) {
        const first = mostDiscriminativeCaseIndex([]);
        if (first >= 0) calibrationOrder = [first];
      }
      calibrationAnswers = calibrationOrder.map((_, i) => ({
        choice: ["left", "right", "both", "neither"].includes(calibrationAnswers[i]?.choice) ? calibrationAnswers[i].choice : null,
        strength: ["slight", "clear", "strong"].includes(calibrationAnswers[i]?.strength) ? calibrationAnswers[i].strength : null,
      }));
      calibrationIndex = Math.max(0, Math.min(calibrationIndex, Math.max(0, calibrationOrder.length - 1)));
    }

    function advanceCalibration() {
      const nextIdx = mostDiscriminativeCaseIndex(calibrationOrder);
      if (nextIdx < 0 || calibrationOrder.includes(nextIdx)) return false;
      calibrationOrder.push(nextIdx);
      calibrationAnswers.push({ choice: null, strength: null });
      calibrationIndex = calibrationOrder.length - 1;
      return true;
    }

    function calibrationCaseForCursor(cursor) {
      const pool = calibrationPoolCases();
      const idx = calibrationOrder[cursor];
      return pool[idx] || pool[cursor] || activeData;
    }

    function beginFloorFromReview() {
      pairwiseIndex = pairwiseAnswers.length + 1;
      initFloorLadder();
      saveElicitationState();
      renderPreferenceElicitation();
    }

    function beginCalibrationFromFloor() {
      ensureCalibrationSetup();
      pairwiseIndex = pairwiseAnswers.length + 2;
      saveElicitationState();
      renderPreferenceElicitation();
    }

    // ---- Floor (reservation) elicitation for the user's top-priority criterion ----
    // Floor candidates must span a *meaningful* acceptability range, not just the
    // narrow cluster of values models happen to achieve. We anchor to the observed
    // distribution but widen downward: from a clearly-too-low level up to ~median,
    // in interpretable 0.05 steps, so each ladder question genuinely discriminates.
    function floorCandidateValues(key) {
      const values = [];
      calibrationPoolCases().forEach((caseData) => {
        (caseData?.reconciliation?.groups || []).forEach((group) => {
          const v = Number(group?.criteria?.[key]);
          if (Number.isFinite(v)) values.push(clamp01Value(v));
        });
      });
      if (!values.length) return [0.3, 0.45, 0.6, 0.75];
      values.sort((a, b) => a - b);
      const q = (p) => values[Math.min(values.length - 1, Math.max(0, Math.round(p * (values.length - 1))))];
      const round05 = (v) => Math.round(v * 20) / 20;
      const low = Math.max(0.05, round05(q(0.05) - 0.15));
      const high = Math.min(0.95, round05(Math.max(q(0.6), low + 0.15)));
      const steps = 4;
      const out = [];
      for (let i = 0; i < steps; i += 1) out.push(round05(low + ((high - low) * i) / (steps - 1)));
      return [...new Set(out)].sort((a, b) => a - b);
    }

    function initFloorLadder() {
      const key = rankedCriteria[0] || criteriaOrder[0];
      const candidates = floorCandidateValues(key);
      floorLadder = {
        key,
        candidates,
        lo: 0,
        hi: candidates.length - 1,
        mid: (candidates.length - 1) >> 1,
        acceptedIdx: null,
        history: [],
        done: candidates.length === 0,
        value: candidates.length ? candidates[0] : 0,
      };
      if (floorLadder.done) finalizeFloorLadder();
    }

    // Acceptability is monotone increasing in the threshold (a group performing
    // better is easier to accept), so a binary search finds the smallest
    // acceptable value = the reservation floor in ~log2(n) questions.
    function answerFloorLadder(acceptable) {
      if (!floorLadder || floorLadder.done) return;
      const mid = floorLadder.mid;
      floorLadder.history.push({ value: floorLadder.candidates[mid], acceptable });
      if (acceptable) {
        floorLadder.acceptedIdx = mid;
        floorLadder.hi = mid - 1;
      } else {
        floorLadder.lo = mid + 1;
      }
      if (floorLadder.lo > floorLadder.hi || floorLadder.history.length >= FLOOR_LADDER_MAX_QUESTIONS) {
        finalizeFloorLadder();
      } else {
        floorLadder.mid = (floorLadder.lo + floorLadder.hi) >> 1;
      }
    }

    function finalizeFloorLadder() {
      const idx = floorLadder.acceptedIdx;
      floorLadder.value = idx != null
        ? floorLadder.candidates[idx]
        : floorLadder.candidates[floorLadder.candidates.length - 1];
      floorLadder.done = true;
      setElicitedFloor(floorLadder.key, floorLadder.value);
    }

    function setElicitedFloor(key, value) {
      elicitedFloor = { key, value: clamp01Value(value), source: "elicited" };
      applySalienceParamsToCurrentPersona();
      saveCalibrationProfile();
      saveElicitationState();
    }

    function calibrationCaseTitle(caseData, index) {
      const dataset = caseData?.dataset_label || activeData?.dataset_label || datasetSelect.value;
      const caseIndex = caseData?.case?.test_case_index ?? index + 1;
      return `${dataset} Case ${caseIndex}`;
    }

    function calibrationProfileForParams(params = currentSalienceParams()) {
      return buildNegotiationProfile({ ...(currentPersona || {}), salienceParams: params }, elicitedWeights || userWeights || weights);
    }

    function criterionAdequacyForGroup(profile, key, group) {
      const value = Number(group?.criteria?.[key]) || 0;
      const target = issueTarget(profile, key);
      const floor = issueFloor(profile, key);
      return {
        value,
        target,
        floor,
        adequacy: Math.max(0, target - value),
        floorRisk: floor > 0 && value < floor - 0.001 ? 1 : 0,
      };
    }

    function calibrationGroupUtility(group, caseData, params = currentSalienceParams()) {
      if (!group) return -Infinity;
      const profile = calibrationProfileForParams(params);
      return criteriaOrder.reduce((total, key) => {
        const priority = issueBaselinePriority(profile, key);
        const stats = criterionStatsFromCaseData(caseData, key);
        const adequacy = criterionAdequacyForGroup(profile, key, group);
        const sensitivity = 1 + params.alpha * (stats.spread || 0);
        const benefit = sensitivity * adequacy.value;
        const penalty = params.beta * adequacy.adequacy + params.gamma * adequacy.floorRisk;
        return total + priority * (benefit - penalty);
      }, 0);
    }

    function calibrationPairRecord(cursor, params = currentSalienceParams()) {
      const caseData = calibrationCaseForCursor(cursor);
      const pair = calibrationPairForCase(caseData);
      return {
        caseData,
        left: pair.left,
        right: pair.right,
        leftUtility: calibrationGroupUtility(pair.left, caseData, params),
        rightUtility: calibrationGroupUtility(pair.right, caseData, params),
      };
    }

    // The models that make up a prediction group (they voted for its class).
    function groupMemberModels(caseData, group) {
      const seeds = new Set((group?.model_seeds || []).map(Number));
      if (!seeds.size) return [];
      return (caseData?.models || []).filter((model) => seeds.has(Number(model.seed)));
    }

    // Bar = the group's average for this criterion; error bar = how much the
    // member models disagree (±1 SD). This is a real within-group uncertainty,
    // unlike the old across-group "spread" that just restated the A/B gap.
    function groupCriterionDispersion(caseData, group, key) {
      const mean = clamp01Value(Number(group?.criteria?.[key]) || 0);
      const values = groupMemberModels(caseData, group)
        .map((model) => Number(model[key]))
        .filter((value) => Number.isFinite(value));
      if (values.length < 2) return { mean, sd: 0 };
      const mu = values.reduce((total, value) => total + value, 0) / values.length;
      const sd = Math.sqrt(values.reduce((total, value) => total + (value - mu) ** 2, 0) / values.length);
      return { mean, sd };
    }

    function calibrationBarRow(tag, group, caseData, key) {
      const { mean, sd } = groupCriterionDispersion(caseData, group, key);
      const pct = (v) => `${(clamp01Value(v) * 100).toFixed(0)}%`;
      const errLeft = clamp01Value(mean - sd) * 100;
      const errWidth = (clamp01Value(mean + sd) - clamp01Value(mean - sd)) * 100;
      const belowFloor = elicitedFloor && key === elicitedFloor.key && mean < elicitedFloor.value - 0.001;
      const floorMark = belowFloor
        ? `<span class="cmp-floor" title="Below your elicited floor of ${fmtPct(elicitedFloor.value)}">⚠</span>`
        : "";
      const sdLabel = sd > 0.005 ? ` <span class="cmp-sd">±${(sd * 100).toFixed(0)}</span>` : "";
      return `
        <div class="cmp-row">
          <span class="cmp-col-label">${escapeHtml(criteriaShortLabels[key] || criteriaLabels[key])}</span>
          <div class="cmp-track">
            <div class="cmp-fill ${tag}" style="width: ${pct(mean)};"></div>
            ${sd > 0.005 ? `<div class="cmp-err" style="left: ${errLeft.toFixed(1)}%; width: ${Math.max(0, errWidth).toFixed(1)}%;"></div>` : ""}
          </div>
          <span class="cmp-val">${pct(mean)}${sdLabel}${floorMark}</span>
        </div>
      `;
    }

    function calibrationOptionColumn(tag, group, caseData) {
      return `
        <div class="cmp-col">
          <div class="cmp-col-head ${tag}">
            <span class="cmp-tag ${tag}">${tag.toUpperCase()}</span>
            <span>Predicted ${escapeHtml(group?.label || "group")}</span>
          </div>
          ${criteriaOrder.map((key) => calibrationBarRow(tag, group, caseData, key)).join("")}
        </div>
      `;
    }

    function calibrationComparisonChart(record) {
      const caseData = record.caseData;
      return `
        <div class="cmp-chart">
          <div class="cmp-cols">
            ${calibrationOptionColumn("a", record.left, caseData)}
            ${calibrationOptionColumn("b", record.right, caseData)}
          </div>
          <div class="cmp-legend">
            <span class="cmp-key">bar = group average · whisker = model disagreement (±1 SD)</span>
          </div>
        </div>
      `;
    }

    function renderFloorLadderStep() {
      setPairwiseMode("review");
      if (pairwiseProgress) pairwiseProgress.style.display = "none";
      pairwiseNav.style.display = "none";
      startReconciliationButton.style.display = "none";
      const topKey = rankedCriteria[0] || criteriaOrder[0];
      if (!floorLadder || floorLadder.key !== topKey) initFloorLadder();
      const key = floorLadder.key;
      const label = criteriaLabels[key] || key;
      pairwiseTitle.textContent = "Set your non-negotiable floor";
      pairwiseSubtitle.textContent = `For your top priority (${label}), tell us the lowest performance you could still accept. Below this floor no other criterion can compensate.`;
      pairwiseCounter.textContent = floorLadder.done ? "Floor set" : `Question ${floorLadder.history.length + 1}`;
      if (floorLadder.done) {
        pairwiseContent.innerHTML = `
          <div class="computed-card">
            <p class="computed-note">Your hard floor for <strong>${escapeHtml(label)}</strong> is <strong>${fmtPct(floorLadder.value)}</strong>. During negotiation, any model group below this is outside your acceptable set and triggers a performance veto (it cannot be traded away).</p>
          </div>
          <div class="review-actions">
            <button id="floorBackButton" type="button" class="review-button secondary"><span class="chevron left" aria-hidden="true"></span> Redo floor</button>
            <button id="floorNextButton" type="button" class="review-button primary">Compare example decisions <span class="chevron right" aria-hidden="true"></span></button>
          </div>`;
        document.getElementById("floorBackButton")?.addEventListener("click", () => {
          initFloorLadder();
          saveElicitationState();
          renderPreferenceElicitation();
        });
        document.getElementById("floorNextButton")?.addEventListener("click", beginCalibrationFromFloor);
        return;
      }
      const threshold = floorLadder.candidates[floorLadder.mid];
      pairwiseContent.innerHTML = `
        <div class="calibration-card">
          <div class="calibration-case">
            <div class="calibration-case-meta">${escapeHtml(criteriaDescriptions[key] || label)}</div>
            <div class="calibration-case-title" style="margin:12px 0;">Would you accept a decision group whose ${escapeHtml(label)} is only <strong>${fmtPct(threshold)}</strong>?</div>
            <div class="calibration-choice-grid">
              <label><input type="radio" name="floorChoice" value="yes"> Yes, still acceptable</label>
              <label><input type="radio" name="floorChoice" value="no"> No, that is too low</label>
            </div>
            <div class="calibration-fit-note">This is elicited only for your #1 criterion because that is the only floor the negotiation enforces as a hard, non-compensatory veto.</div>
          </div>
          <div class="review-actions">
            <button id="floorBackButton" type="button" class="review-button secondary"><span class="chevron left" aria-hidden="true"></span> Back to priorities</button>
          </div>
        </div>`;
      pairwiseContent.querySelectorAll("input[name='floorChoice']").forEach((input) => {
        input.addEventListener("change", (event) => {
          answerFloorLadder(event.target.value === "yes");
          saveElicitationState();
          renderPreferenceElicitation();
        });
      });
      document.getElementById("floorBackButton")?.addEventListener("click", () => {
        pairwiseIndex = pairwiseAnswers.length;
        saveElicitationState();
        renderPreferenceElicitation();
      });
    }

    function renderCalibrationStep() {
      setPairwiseMode("review");
      if (pairwiseProgress) pairwiseProgress.style.display = "none";
      pairwiseNav.style.display = "none";
      startReconciliationButton.style.display = "none";
      ensureCalibrationSetup();
      const record = calibrationPairRecord(calibrationIndex);
      const answer = calibrationAnswers[calibrationIndex] || {};
      const canContinue = Boolean(answer.choice) && Boolean(answer.strength);
      const isLast = calibrationIndex === calibrationOrder.length - 1;
      const canStop = canContinue && isLast && calibrationStopReached();
      const primaryLabel = canStop ? "Fit and start" : "Next example";
      pairwiseTitle.textContent = "Compare example decisions";
      pairwiseSubtitle.textContent = "Which group is more reliable for your role? We stop as soon as your choices are predictable.";
      pairwiseCounter.textContent = `Question ${calibrationIndex + 1}`;
      pairwiseContent.innerHTML = `
        <div class="calibration-card">
          <div class="calibration-case cmp-layout">
            <div class="cmp-main">
              <div class="calibration-case-title">${escapeHtml(calibrationCaseTitle(record.caseData, calibrationIndex))}</div>
              ${calibrationComparisonChart(record)}
            </div>
            <aside class="cmp-questions">
              <div>
                <div class="calibration-case-meta">Which group is more reliable for your role?</div>
                <div class="calibration-choice-grid">
                  ${[
                    ["left", "A · " + escapeHtml(record.left?.label || "Low")],
                    ["right", "B · " + escapeHtml(record.right?.label || "High")],
                    ["both", "Both fine"],
                    ["neither", "Neither"]
                  ].map(([key, label]) => `
                    <label>
                      <input type="radio" name="calibrationChoice" value="${key}" ${answer.choice === key ? "checked" : ""}>
                      ${label}
                    </label>
                  `).join("")}
                </div>
              </div>
              <div>
                <div class="calibration-case-meta">How strong is your preference?</div>
                <div class="calibration-acceptance">
                  ${[
                    ["slight", "Slight"],
                    ["clear", "Clear"],
                    ["strong", "Strong"]
                  ].map(([key, label]) => `
                    <label>
                      <input type="radio" name="calibrationStrength" value="${key}" ${answer.strength === key ? "checked" : ""}>
                      ${escapeHtml(label)}
                    </label>
                  `).join("")}
                </div>
              </div>
            </aside>
          </div>
          <div class="review-actions">
            <button id="calibrationBackButton" type="button" class="review-button secondary"><span class="chevron left" aria-hidden="true"></span> ${calibrationIndex === 0 ? "Back to floor" : "Previous example"}</button>
            <button id="calibrationSkipButton" type="button" class="review-button secondary">Use suggested settings</button>
            <button id="calibrationNextButton" type="button" class="review-button primary" ${canContinue ? "" : "disabled"}>${primaryLabel} <span class="chevron right" aria-hidden="true"></span></button>
          </div>
        </div>
      `;
      pairwiseContent.querySelectorAll("input[name='calibrationChoice']").forEach((input) => {
        input.addEventListener("change", (event) => {
          calibrationAnswers[calibrationIndex] = { ...(calibrationAnswers[calibrationIndex] || {}), choice: event.target.value };
          saveElicitationState();
          renderPreferenceElicitation();
        });
      });
      pairwiseContent.querySelectorAll("input[name='calibrationStrength']").forEach((input) => {
        input.addEventListener("change", (event) => {
          calibrationAnswers[calibrationIndex] = { ...(calibrationAnswers[calibrationIndex] || {}), strength: event.target.value };
          saveElicitationState();
          renderPreferenceElicitation();
        });
      });
      document.getElementById("calibrationBackButton")?.addEventListener("click", () => {
        if (calibrationIndex <= 0) {
          pairwiseIndex = pairwiseAnswers.length + 1;
        } else {
          calibrationIndex -= 1;
        }
        saveElicitationState();
        renderPreferenceElicitation();
      });
      document.getElementById("calibrationSkipButton")?.addEventListener("click", () => {
        setStakeholderSalienceParams(defaultSalienceParams(), "default");
        calibrationFitted = true;
        saveCalibrationProfile();
        saveElicitationState();
        startReconciliationFromElicitation();
      });
      document.getElementById("calibrationNextButton")?.addEventListener("click", () => {
        if (!canContinue) return;
        if (!isLast) {
          calibrationIndex += 1;
          saveElicitationState();
          renderPreferenceElicitation();
          return;
        }
        if (canStop || !advanceCalibration()) {
          fitStakeholderSalienceParamsFromCalibration();
          startReconciliationFromElicitation();
          return;
        }
        saveElicitationState();
        renderPreferenceElicitation();
      });
    }

    function calibrationAnswerRecords(params = currentSalienceParams()) {
      return calibrationAnswers.map((answer, index) => {
        const record = calibrationPairRecord(index, params);
        if (!record.caseData || !record.left || !record.right || !answer?.choice || !answer?.strength) return null;
        return { ...record, answer };
      }).filter(Boolean);
    }

    // 1-D grid search over the single salience sensitivity `s`. Uses the
    // strength label to set the expected utility margin, with a light shrink
    // toward the neutral default so sparse/indifferent answers stay near 1.0.
    function fitSalienceScalar() {
      const marginByStrength = { slight: 0.05, clear: 0.14, strong: 0.28 };
      let bestS = SALIENCE_SCALAR_DEFAULT;
      let bestScore = -Infinity;
      SALIENCE_SCALAR_GRID.forEach((s) => {
        const params = paramsFromScalar(s, "calibrated");
        let score = -0.12 * Math.abs(s - SALIENCE_SCALAR_DEFAULT);
        calibrationAnswerRecords(params).forEach((record) => {
          const diff = record.leftUtility - record.rightUtility;
          const margin = marginByStrength[record.answer.strength] || marginByStrength.clear;
          if (record.answer.choice === "left") score -= Math.max(0, margin - diff);
          if (record.answer.choice === "right") score -= Math.max(0, margin + diff);
          if (record.answer.choice === "both") score -= Math.abs(diff);
          if (record.answer.choice === "neither") score -= 0.35 * Math.max(record.leftUtility, record.rightUtility) + 0.1 * Math.abs(diff);
        });
        if (score > bestScore) {
          bestScore = score;
          bestS = s;
        }
      });
      return bestS;
    }

    function fitStakeholderSalienceParamsFromCalibration() {
      const records = calibrationAnswerRecords(defaultSalienceParams());
      if (!records.length) {
        setStakeholderSalienceParams(defaultSalienceParams(), "default");
        return defaultSalienceParams();
      }
      const best = paramsFromScalar(fitSalienceScalar(), "calibrated");
      setStakeholderSalienceParams(best, "calibrated");
      return best;
    }

    // Does the current best-fit `s` already predict this answered comparison?
    function calibrationPredictionCorrect(record) {
      const margin = 0.05;
      const diff = record.leftUtility - record.rightUtility;
      let predicted = "both";
      if (diff > margin) predicted = "left";
      else if (diff < -margin) predicted = "right";
      const choice = record.answer.choice;
      if (choice === "both" || choice === "neither") return Math.abs(diff) <= margin;
      return predicted === choice;
    }

    // Adaptive stopping: stop once we can predict the last few answers, or hit
    // the cap / exhaust the pool. Never stop before a minimum number of answers.
    function calibrationStopReached() {
      const answered = calibrationAnswers.filter((a) => a?.choice && a?.strength).length;
      if (answered < CALIBRATION_MIN_QUESTIONS) return false;
      if (answered >= CALIBRATION_MAX_QUESTIONS) return true;
      if (calibrationPoolCases().length <= answered) return true;
      const params = paramsFromScalar(fitSalienceScalar(), "calibrated");
      const recent = calibrationAnswerRecords(params).slice(-CALIBRATION_STOP_STREAK);
      if (recent.length < CALIBRATION_STOP_STREAK) return false;
      return recent.every((record) => calibrationPredictionCorrect(record));
    }

    function resetCalibrationForPreferenceChange() {
      calibrationOrder = [];
      calibrationAnswers = [];
      calibrationIndex = 0;
      floorLadder = null;
      elicitedFloor = null;
      setStakeholderSalienceParams(defaultSalienceParams(), "default");
    }

    function renderPreferenceElicitation() {
      if (!pairwiseContent) return;
      updateElicitedWeights();
      renderPairwiseProgress();
      if (pairwiseIndex < 0) {
        renderRankingStep();
      } else if (pairwiseIndex < pairwiseAnswers.length) {
        renderPairwiseStep();
      } else if (pairwiseIndex === pairwiseAnswers.length) {
        renderReviewStep();
      } else if (pairwiseIndex === pairwiseAnswers.length + 1) {
        renderFloorLadderStep();
      } else {
        renderCalibrationStep();
      }
    }

