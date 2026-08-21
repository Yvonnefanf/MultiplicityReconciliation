/* elicitation.js — proxy persona selection and the role-default participant preference
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope.

   The external study platform supplies only the participant role. This file
   turns that role's fixed default weights into the state negotiation reads. */

    // Who the other stakeholder is comes from the case file, not from a draw and
    // not from ?other=: Final_summative_study pins one opponent per (role, case id), so the
    // participant's role and the case id determine the whole screen. See
    // eval/build_final_summative_study.py.
    function assignedOtherPersonaKey() {
      const key = normalizePersonaKey(activeData?.assignment?.other_role);
      return personaTypes[key] ? key : null;
    }

    function makeProxyPersonaPreference(excludeKey = currentPersona?.key) {
      const assigned = assignedOtherPersonaKey();
      if (assigned) return personaPreferenceFromKey(assigned);
      const pinned = pinnedOtherPersonaKey(excludeKey);
      if (pinned) return personaPreferenceFromKey(pinned);
      // No assignment (the walkthrough case, or a hand-built link): take the
      // first role that is not the participant's rather than drawing one, so
      // even the unassigned path reproduces itself on reload.
      const choices = personaKeys.filter((key) => key !== excludeKey);
      return personaPreferenceFromKey(setOtherPersonaKeyInUrl((choices.length ? choices : personaKeys)[0]));
    }

    function weightDistance(aWeights, bWeights) {
      const a = normalizeWeights(aWeights || {});
      const b = normalizeWeights(bWeights || {});
      return criteriaOrder.reduce((total, key) => total + Math.abs((a[key] || 0) - (b[key] || 0)), 0);
    }

    function chooseConflictingProxyPersona(userBaseline, excludeKey = currentPersona?.key) {
      // An assigned opponent is not a candidate to be improved on: the case was
      // picked for the verdict that pairing produces.
      const assigned = assignedOtherPersonaKey();
      if (assigned) return personaPreferenceFromKey(assigned);
      const pinned = pinnedOtherPersonaKey(excludeKey);
      if (pinned) return personaPreferenceFromKey(pinned);
      const user = normalizeWeights(userBaseline || userWeights || elicitedWeights || weights);
      // Conflict is tested on the optimal *models*, because that is the pair the
      // participant is shown in multioptimal/aggregate and at the negotiatev2
      // opening. Testing it on winningGroup() instead -- group-level
      // reliability -- selected an opponent that often agreed on screen.
      //
      // activeCriteria() consults proxyPersona, so each candidate is scored
      // while standing in as the proxy: otherwise the criteria set used to pick
      // the opponent differs from the one used to display them.
      const previousProxyPersona = proxyPersona;
      const candidates = personaKeys
        .filter((key) => key !== excludeKey)
        .map((key) => {
          const persona = personaPreferenceFromKey(key);
          proxyPersona = persona;
          const userOptimal = selectedSingleOptimalModel(user);
          const proxyOptimal = selectedSingleOptimalModel(persona.weights);
          return {
            persona,
            conflicts: Boolean(userOptimal && proxyOptimal
              && Number(userOptimal.pred_class) !== Number(proxyOptimal.pred_class)),
            distance: weightDistance(user, persona.weights),
          };
        });
      proxyPersona = previousProxyPersona;
      const conflicting = candidates.filter((item) => item.conflicts);
      const ranked = candidates.sort((a, b) => b.distance - a.distance);
      // Furthest-weights-first among the conflicting candidates rather than a
      // draw, so this path is reproducible too.
      const chosen = conflicting.length
        ? ranked.find((item) => item.conflicts).persona
        : ranked[0]?.persona;
      if (!chosen) return makeProxyPersonaPreference(excludeKey);
      setOtherPersonaKeyInUrl(chosen.key);
      return chosen;
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

    function makePersonaPreference() {
      return personaPreferenceFromKey(ensurePersonaKey());
    }

    function personaTitle(persona) {
      return String(persona?.label || persona?.role || "Stakeholder").trim() || "Stakeholder";
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

    // The participant's preference is fixed for the whole session and always
    // comes from the named role's template. Nothing inside the app edits it, so
    // it is simply re-derived whenever per-case state is reset.
    function applyInitialPreference() {
      elicitedWeights = initialUserWeights();
      rankedCriteria = rankOrderFromWeights(elicitedWeights);
    }

    function personaRolePhrase(persona) {
      const key = persona?.key;
      return persona?.rolePhrase || personaTypes[key]?.rolePhrase || "stakeholder";
    }
