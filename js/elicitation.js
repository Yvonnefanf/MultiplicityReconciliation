/* elicitation.js — proxy persona, persona card, pairwise ranking & review elicitation
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function makeProxyPersonaPreference(excludeKey = currentPersona?.key) {
      const choices = personaKeys.filter((key) => key !== excludeKey);
      return personaPreferenceFromKey(randomItem(choices.length ? choices : personaKeys));
    }

    function weightDistance(aWeights, bWeights) {
      const a = normalizeWeights(aWeights || {});
      const b = normalizeWeights(bWeights || {});
      return criteriaOrder.reduce((total, key) => total + Math.abs((a[key] || 0) - (b[key] || 0)), 0);
    }

    function chooseConflictingProxyPersona(userBaseline, excludeKey = currentPersona?.key) {
      const user = normalizeWeights(userBaseline || userWeights || elicitedWeights || weights);
      const userWinner = winningGroup(user);
      const candidates = personaKeys
        .filter((key) => key !== excludeKey)
        .map((key) => {
          const persona = personaPreferenceFromKey(key);
          const winner = winningGroup(persona.weights);
          return {
            persona,
            winner,
            conflicts: Boolean(userWinner && winner && winner.class_id !== userWinner.class_id),
            distance: weightDistance(user, persona.weights),
          };
        });
      const conflicting = candidates.filter((item) => item.conflicts);
      if (conflicting.length) return randomItem(conflicting).persona;
      const ranked = candidates.sort((a, b) => b.distance - a.distance);
      return ranked[0]?.persona || makeProxyPersonaPreference(excludeKey);
    }

    function ensureConflictingProxyPersona(userBaseline) {
      proxyPersona = chooseConflictingProxyPersona(userBaseline, currentPersona?.key);
      proxyWeights = proxyIdealWeights();
      return proxyPersona;
    }

    function proxyIdealWeights() {
      if (proxyPersona?.weights) return normalizeWeights(proxyPersona.weights);
      if (activeData?.reconciliation?.proxy_weights) return normalizeWeights(activeData.reconciliation.proxy_weights);
      return normalizeWeights(weights);
    }

    function hasCompleteElicitedPreference() {
      return Boolean(elicitedWeights) && pairwiseAnswers.length > 0 && answeredPairCount() === pairwiseAnswers.length;
    }

    function makePersonaPreference() {
      const personaKey = ensurePersonaKey();
      const persona = personaTypes[personaKey] || personaTypes.defendants;
      const archetype = preferenceArchetypes[persona.preferenceKey] || preferenceArchetypes.local_error_balance;
      return enrichPersonaPreference(persona, archetype);
    }

    function personaTitle(persona) {
      return String(persona?.label || persona?.role || "Stakeholder").trim() || "Stakeholder";
    }

    function resetPersonaConsent() {
      if (!personaConsentCheckbox || !personaNextButton) return;
      personaConsentCheckbox.checked = false;
      personaNextButton.disabled = true;
    }

    function renderPersonaCard() {
      if (!personaCard || !currentPersona) return;
      personaCard.innerHTML = `
        <h2 class="persona-reading-title">Persona: ${escapeHtml(personaTitle(currentPersona))}</h2>
        <div class="persona-reading-copy">
          <p>${escapeHtml(currentPersona.context)}</p>
          <p>Your position might sound like: <strong>${escapeHtml(currentPersona.positionExample || currentPersona.priority)}</strong></p>
          <p>Your underlying interest is <strong>${escapeHtml(currentPersona.interests?.[0]?.label || currentPersona.priority)}</strong>. The negotiation will protect core interests while looking for trade-offs across criteria.</p>
          <p>Other roles may prioritize different interests. Throughout the deliberation, express your role's concern and look for a criteria contract that both sides can accept.</p>
        </div>
      `;
    }

    function resetNegotiationState(note) {
      negotiationEvents = [];
      pendingProxyCounter = null;
      pendingProxyResponse = null;
      resetResponseActState();
      resetOpeningActState();
      negotiationRound = 0;
      composerLocked = false;
      composerNote = note;
      if (activeData) proxyWeights = proxyIdealWeights();
      renderHistory();
    }

    function hasSubmittedUserOffer() {
      return negotiationEvents.some((event) => event.role === "user" && (event.title === "Self initial offer" || event.title === "Self counter-offer"));
    }

    function defaultRankForPersona(persona) {
      const fallback = [...criteriaOrder];
      const preferred = personaRankDefaults[persona?.key] || fallback;
      return [...preferred, ...fallback.filter((key) => !preferred.includes(key))].slice(0, criteriaOrder.length);
    }

    function resetPairwiseState() {
      rankedCriteria = defaultRankForPersona(currentPersona);
      pairwiseAnswers = Array(Math.max(0, rankedCriteria.length - 1)).fill(null);
      pairwiseIndex = -1;
      elicitedWeights = inferWeightsFromPairwise();
      calibrationOrder = [];
      calibrationAnswers = [];
      calibrationIndex = 0;
      calibrationFitted = false;
      elicitedFloor = null;
      floorLadder = null;
    }

    function answeredPairCount() {
      return pairwiseAnswers.filter((answer) => answer !== null).length;
    }

    function inferWeightsFromPairwise() {
      const scores = {};
      if (!rankedCriteria.length) return normalizeWeights({});
      scores[rankedCriteria[rankedCriteria.length - 1]] = 1;
      for (let i = rankedCriteria.length - 2; i >= 0; i -= 1) {
        const answer = pairwiseAnswers[i];
        const ratio = intensityOptions.find((option) => option.key === answer)?.ratio || 1;
        scores[rankedCriteria[i]] = scores[rankedCriteria[i + 1]] * ratio;
      }
      criteriaOrder.forEach((key) => {
        if (scores[key] == null) scores[key] = 1;
      });
      return normalizeWeights(scores);
    }

    function updateElicitedWeights() {
      elicitedWeights = inferWeightsFromPairwise();
    }

    function renderWeightPreview(previewWeights) {
      return criteriaOrder.map((key) => {
        const pct = Math.round((previewWeights[key] || 0) * 100);
        return `
          <div class="weight-preview-row">
            <span>${criteriaLabels[key]}</span>
            <div class="preview-track"><div class="preview-fill" style="width:${pct}%"></div></div>
            <strong>${pct}%</strong>
          </div>
        `;
      }).join("");
    }

    function moveRankedCriterion(index, direction) {
      const nextIndex = index + direction;
      if (nextIndex < 0 || nextIndex >= rankedCriteria.length) return;
      const next = [...rankedCriteria];
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      rankedCriteria = next;
      pairwiseAnswers = Array(Math.max(0, rankedCriteria.length - 1)).fill(null);
      updateElicitedWeights();
      resetCalibrationForPreferenceChange();
      saveElicitationState();
      renderPreferenceElicitation();
    }

    function renderPairwiseProgress() {
      if (!pairwiseProgress) return;
      const activeCount = pairwiseIndex < 0 ? 0 : pairwiseIndex + 1;
      pairwiseProgress.innerHTML = pairwiseAnswers.map((answer, index) => `
        <span class="${answer !== null || index < activeCount ? "active" : ""}"></span>
      `).join("");
    }

    function personaRolePhrase(persona) {
      const key = persona?.key || "stakeholder";
      return {
        judges: "judge",
        defendants: "defendant",
        community_members: "community member",
        fairness_advocates: "fairness advocate"
      }[key] || "stakeholder";
    }

    function setPairwiseMode(mode) {
      ["ranking-card", "compare-card", "review-card"].forEach((item) => pairwiseContent?.classList.remove(item));
      ["ranking-mode", "compare-mode", "review-mode"].forEach((item) => pairwiseContent?.parentElement?.classList.remove(item));
      pairwiseContent?.classList.add(`${mode}-card`);
      pairwiseContent?.parentElement?.classList.add(`${mode}-mode`);
    }

    function bindRankingDrag() {
      let dragIndex = null;
      pairwiseContent.querySelectorAll(".ranking-row").forEach((row) => {
        row.addEventListener("dragstart", () => {
          dragIndex = Number(row.dataset.rankIndex);
          row.classList.add("dragging");
        });
        row.addEventListener("dragend", () => {
          row.classList.remove("dragging");
          dragIndex = null;
        });
        row.addEventListener("dragover", (event) => event.preventDefault());
        row.addEventListener("drop", (event) => {
          event.preventDefault();
          const dropIndex = Number(row.dataset.rankIndex);
          if (dragIndex === null || dragIndex === dropIndex) return;
          const next = [...rankedCriteria];
          const [moved] = next.splice(dragIndex, 1);
          next.splice(dropIndex, 0, moved);
          rankedCriteria = next;
          pairwiseAnswers = Array(Math.max(0, rankedCriteria.length - 1)).fill(null);
          updateElicitedWeights();
          resetCalibrationForPreferenceChange();
          saveElicitationState();
          renderPreferenceElicitation();
        });
      });
    }

    function rerankCriteria() {
      pairwiseIndex = -1;
      pairwiseAnswers = Array(Math.max(0, rankedCriteria.length - 1)).fill(null);
      updateElicitedWeights();
      resetCalibrationForPreferenceChange();
      saveElicitationState();
      renderPreferenceElicitation();
    }

    function renderRankingStep() {
      setPairwiseMode("ranking");
      if (pairwiseProgress) pairwiseProgress.style.display = "none";
      pairwiseNav.style.display = "none";
      startReconciliationButton.style.display = "inline-flex";
      pairwiseTitle.innerHTML = "Rank these criteria<em>from most to least important to you.</em>";
      pairwiseSubtitle.textContent = `Think about your role as a ${personaRolePhrase(currentPersona)}. Drag to reorder - place the criterion that matters most to you at the top.`;
      pairwiseCounter.textContent = "Ranking";
      startReconciliationButton.disabled = false;
      startReconciliationButton.innerHTML = `This order looks right <span class="chevron right" aria-hidden="true"></span>`;
      pairwiseContent.innerHTML = `
        <div class="ranking-list">
          ${rankedCriteria.map((key, index) => `
            <div class="ranking-row" draggable="true" data-rank-index="${index}">
              <span class="ranking-grip" aria-hidden="true">&bull;&bull;<br>&bull;&bull;<br>&bull;&bull;</span>
              <span class="ranking-index">${index + 1}</span>
              <div>
                <div class="ranking-name">${escapeHtml(criteriaLabels[key])}</div>
                <div class="ranking-desc">${escapeHtml(criteriaDescriptions[key])}</div>
              </div>
              ${index === 0 ? `<span class="ranking-pill">Most important</span>` : ""}
              ${index === rankedCriteria.length - 1 ? `<span class="ranking-pill">Least important</span>` : ""}
            </div>
          `).join("")}
        </div>
      `;
      bindRankingDrag();
    }

    function renderPairwiseStep() {
      // Pairwise steps are intentionally simple; calibration happens after priority review.
      setPairwiseMode("compare");
      if (pairwiseProgress) pairwiseProgress.style.display = "none";
      pairwiseNav.style.display = "grid";
      startReconciliationButton.style.display = "none";
      const higherKey = rankedCriteria[pairwiseIndex];
      const lowerKey = rankedCriteria[pairwiseIndex + 1];
      const answered = answeredPairCount();
      const complete = answered === pairwiseAnswers.length;
      pairwiseTitle.textContent = "How much more important?";
      pairwiseSubtitle.innerHTML = `You ranked <strong>${escapeHtml(criteriaLabels[higherKey])}</strong> above <strong>${escapeHtml(criteriaLabels[lowerKey])}</strong>. How much more important is it to you?`;
      pairwiseCounter.textContent = `${pairwiseIndex + 1} / ${pairwiseAnswers.length}`;
      preferenceBackButton.innerHTML = `<span class="chevron left" aria-hidden="true"></span> Previous pair`;
      preferenceBackButton.disabled = pairwiseIndex === 0;
      pairwiseNextButton.innerHTML = `${pairwiseIndex === pairwiseAnswers.length - 1 ? "Review priorities" : "Next pair"} <span class="chevron right" aria-hidden="true"></span>`;
      pairwiseNextButton.disabled = pairwiseAnswers[pairwiseIndex] === null;
      pairwiseContent.innerHTML = `
        <div class="pair-cards">
          <div class="criterion-card">
            <div class="criterion-rank">#${pairwiseIndex + 1} (ranked higher)</div>
            <div class="criterion-name">${escapeHtml(criteriaLabels[higherKey])}</div>
            <div class="criterion-description">${escapeHtml(criteriaDescriptions[higherKey])}</div>
          </div>
          <div class="pair-versus">vs</div>
          <div class="criterion-card">
            <div class="criterion-rank">#${pairwiseIndex + 2} (ranked lower)</div>
            <div class="criterion-name">${escapeHtml(criteriaLabels[lowerKey])}</div>
            <div class="criterion-description">${escapeHtml(criteriaDescriptions[lowerKey])}</div>
          </div>
        </div>
        <p class="pair-question">Compared to ${escapeHtml(criteriaLabels[lowerKey])}, how important is ${escapeHtml(criteriaLabels[higherKey])} to you?</p>
        <div class="intensity-options">
          ${intensityOptions.map((option) => `
            <label class="intensity-option">
              <input type="radio" name="pairwiseIntensity" value="${option.key}" ${pairwiseAnswers[pairwiseIndex] === option.key ? "checked" : ""}>
              <span>${escapeHtml(option.label)}</span>
            </label>
          `).join("")}
        </div>
        <button id="rerankButton" type="button" class="rerank-button">Re-rank criteria</button>
      `;
      document.getElementById("rerankButton")?.addEventListener("click", rerankCriteria);
      pairwiseContent.querySelectorAll("input[name='pairwiseIntensity']").forEach((input) => {
        input.addEventListener("change", () => {
          pairwiseAnswers[pairwiseIndex] = input.value;
          updateElicitedWeights();
          resetCalibrationForPreferenceChange();
          saveElicitationState();
          renderPreferenceElicitation();
        });
      });
    }

    function renderReviewStep() {
      setPairwiseMode("review");
      if (pairwiseProgress) pairwiseProgress.style.display = "none";
      pairwiseNav.style.display = "none";
      startReconciliationButton.style.display = "none";
      const orderedRows = rankedCriteria.map((key, index) => ({ key, index, weight: elicitedWeights[key] || 0 }));
      pairwiseTitle.textContent = "Your computed priorities";
      pairwiseSubtitle.textContent = `These priorities were derived from your ranking and adjacent comparisons. Confirm them to start reconciliation as a ${personaRolePhrase(currentPersona)}.`;
      pairwiseCounter.textContent = "Review";
      pairwiseContent.innerHTML = `
        <div class="computed-card">
          <div class="computed-list">
            ${orderedRows.map((row) => {
              const pct = Math.round(row.weight * 100);
              return `
                <div class="computed-row">
                  <div class="computed-rank">${row.index + 1}</div>
                  <div>
                    <span class="computed-name">${escapeHtml(criteriaLabels[row.key])}</span>
                    <span class="computed-desc">${escapeHtml(criteriaDescriptions[row.key])}</span>
                  </div>
                  <div class="computed-pct">${pct}%</div>
                  <div class="computed-track"><div class="computed-fill" style="width:${pct}%"></div></div>
                </div>
              `;
            }).join("")}
          </div>
          <p class="computed-note">These priorities are read-only - they were calculated from your ranking and adjacent comparisons.</p>
        </div>
        <div class="review-actions">
          <button id="reviewBackButton" type="button" class="review-button secondary"><span class="chevron left" aria-hidden="true"></span> Edit comparisons</button>
          <button id="reviewRerankButton" type="button" class="review-button secondary">Re-rank criteria</button>
          <button id="reviewConfirmButton" type="button" class="review-button primary">Start reconciliation <span class="chevron right" aria-hidden="true"></span></button>
        </div>
      `;
      document.getElementById("reviewBackButton")?.addEventListener("click", () => {
        pairwiseIndex = Math.max(0, pairwiseAnswers.length - 1);
        saveElicitationState();
        renderPreferenceElicitation();
      });
      document.getElementById("reviewRerankButton")?.addEventListener("click", rerankCriteria);
      document.getElementById("reviewConfirmButton")?.addEventListener("click", startReconciliationFromElicitation);
    }



    function resetCalibrationForPreferenceChange() {
      calibrationOrder = [];
      calibrationAnswers = [];
      calibrationIndex = 0;
      calibrationFitted = false;
      elicitedFloor = null;
      floorLadder = null;
      stakeholderSalienceParams = defaultSalienceParams();
      applySalienceParamsToCurrentPersona();
    }

    function renderPreferenceElicitation() {
      if (!pairwiseContent) return;
      updateElicitedWeights();
      renderPairwiseProgress();
      if (pairwiseIndex < 0) {
        renderRankingStep();
      } else if (pairwiseIndex < pairwiseAnswers.length) {
        renderPairwiseStep();
      } else {
        pairwiseIndex = pairwiseAnswers.length;
        renderReviewStep();
      }
    }
