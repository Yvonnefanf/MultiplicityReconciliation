/* persona-persistence.js — URL params, session persistence, persona selection
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    function randomItem(items) {
      return items[Math.floor(Math.random() * items.length)];
    }

    function normalizePersonaKey(value) {
      return String(value || "").trim().toLowerCase().replace(/-/g, "_");
    }

    function getUrlParams() {
      return new URLSearchParams(window.location.search);
    }

    function replaceUrlParams(updates) {
      const url = new URL(window.location.href);
      Object.entries(updates).forEach(([key, value]) => {
        if (value == null || value === "") {
          url.searchParams.delete(key);
        } else {
          url.searchParams.set(key, String(value));
        }
      });
      window.history.replaceState({}, "", url.toString());
    }

    function stageFromUrl() {
      const value = String(getUrlParams().get("stage") || "1").toLowerCase();
      return { "1": "persona", "2": "preference", "3": "reconcile", persona: "persona", preference: "preference", reconcile: "reconcile" }[value] || "persona";
    }

    function stageToUrlValue(stage) {
      return { persona: "1", preference: "2", reconcile: "3" }[stage] || "1";
    }

    function currentStorageKey() {
      const dataset = datasetSelect?.value || "dataset";
      const caseIndex = caseSelect?.value || "case";
      const persona = currentPersona?.key || currentPersonaKeyFromUrl() || "persona";
      return `case-distribution:${dataset}:${caseIndex}:${persona}`;
    }


    function calibrationProfileStorageKey(personaKey = currentPersona?.key || currentPersonaKeyFromUrl() || "persona") {
      const dataset = datasetSelect?.value || "dataset";
      return `case-stakes-calibration:${dataset}:${personaKey}`;
    }

    function saveCalibrationProfile() {
      // Calibration is currently disabled; salience uses the default theory prior.
    }

    function restoreCalibrationProfile() {
      stakeholderSalienceParams = defaultSalienceParams();
      calibrationFitted = false;
      elicitedFloor = null;
      return false;
    }

    function saveElicitationState() {
      try {
        sessionStorage.setItem(currentStorageKey(), JSON.stringify({
          consent: Boolean(personaConsentCheckbox?.checked),
          rankedCriteria,
          pairwiseAnswers,
          pairwiseIndex,
          elicitedWeights,
          updatedAt: Date.now()
        }));
      } catch (error) {
        console.warn("Could not save elicitation state", error);
      }
    }

    function restoreElicitationState() {
      try {
        const raw = sessionStorage.getItem(currentStorageKey());
        if (!raw) return false;
        const saved = JSON.parse(raw);
        if (Array.isArray(saved.rankedCriteria)) {
          const validRank = saved.rankedCriteria.filter((key) => criteriaOrder.includes(key));
          rankedCriteria = [...validRank, ...criteriaOrder.filter((key) => !validRank.includes(key))].slice(0, criteriaOrder.length);
        }
        if (Array.isArray(saved.pairwiseAnswers)) {
          const allowed = new Set(intensityOptions.map((option) => option.key));
          pairwiseAnswers = Array.from({ length: Math.max(0, rankedCriteria.length - 1) }, (_, index) => {
            const answer = saved.pairwiseAnswers[index];
            return allowed.has(answer) ? answer : null;
          });
        }
        pairwiseIndex = Number.isInteger(saved.pairwiseIndex)
          ? Math.max(-1, Math.min(saved.pairwiseIndex, pairwiseAnswers.length))
          : pairwiseIndex;
        if (personaConsentCheckbox && personaNextButton) {
          personaConsentCheckbox.checked = Boolean(saved.consent);
          personaNextButton.disabled = !personaConsentCheckbox.checked;
        }
        calibrationOrder = [];
        calibrationAnswers = [];
        calibrationIndex = 0;
        stakeholderSalienceParams = defaultSalienceParams();
        calibrationFitted = false;
        elicitedFloor = null;
        applySalienceParamsToCurrentPersona();
        updateElicitedWeights();
        return true;
      } catch (error) {
        console.warn("Could not restore elicitation state", error);
        return false;
      }
    }

    function currentPersonaKeyFromUrl() {
      const params = new URLSearchParams(window.location.search);
      const value = normalizePersonaKey(params.get("persona"));
      return personaTypes[value] ? value : null;
    }

    function setPersonaKeyInUrl(personaKey) {
      replaceUrlParams({ persona: personaKey });
    }

    function ensurePersonaKey() {
      const existing = currentPersonaKeyFromUrl();
      if (existing) return existing;
      const selected = randomItem(personaKeys);
      setPersonaKeyInUrl(selected);
      return selected;
    }

    function switchToNextRandomPersona() {
      const current = currentPersonaKeyFromUrl();
      const choices = personaKeys.filter((key) => key !== current);
      const selected = randomItem(choices.length ? choices : personaKeys);
      setPersonaKeyInUrl(selected);
      return selected;
    }

    function personaPreferenceFromKey(personaKey) {
      const persona = personaTypes[personaKey] || personaTypes.community_members;
      const archetype = preferenceArchetypes[persona.preferenceKey] || preferenceArchetypes.sensitivity_protection;
      return enrichPersonaPreference(persona, archetype);
    }

    function enrichPersonaPreference(persona, archetype, idealOverride = null) {
      const weights = normalizeWeights(idealOverride || persona.weights);
      const preference = {
        ...persona,
        name: persona.label,
        preferenceLabel: archetype.label,
        preferenceNote: archetype.note,
        weights,
      };
      return {
        ...preference,
        negotiationProfile: buildNegotiationProfile(preference, weights),
      };
    }

