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

    // Query keys arrive from an external study platform, so a parameter is read
    // under any of its accepted spellings and case-insensitively rather than
    // silently falling back to a default because of a capital letter.
    function urlParam(...names) {
      const params = getUrlParams();
      for (const name of names) {
        const value = params.get(name);
        if (value != null && value !== "") return value;
      }
      const wanted = names.map((name) => name.toLowerCase());
      for (const [key, value] of params.entries()) {
        if (value !== "" && wanted.includes(key.toLowerCase())) return value;
      }
      return null;
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

    // ---- appId <-> dataset -------------------------------------------------
    //
    // The study platform addresses each app by the scenario it presents, so
    // ?appId= is the public spelling. The dataset key stays the internal name
    // every data path, copy table and saved record already uses.
    const APP_ID_TO_DATASET = {
      recidivism: "compas",
      welfare_allocation: "acs_coverage",
    };
    const DATASET_TO_APP_ID = {
      compas: "recidivism",
      acs_coverage: "welfare_allocation",
    };
    // Spellings that have been handed out in links, mapped onto the canonical id.
    const APP_ID_ALIASES = {
      walfare_allocation: "welfare_allocation",
      welfare: "welfare_allocation",
      acs_coverage: "welfare_allocation",
      compas: "recidivism",
    };
    const DEFAULT_APP_ID = "recidivism";

    function normalizeAppId(value) {
      const key = String(value || "").trim().toLowerCase().replace(/[-\s]/g, "_");
      return APP_ID_ALIASES[key] || key;
    }

    // ?dataset= is the retired spelling. It is still read (its values are in
    // APP_ID_ALIASES) so an old link opens the scenario it always opened, but the
    // URL is rewritten to ?appId= and the old key dropped.
    function appIdFromUrl() {
      const appId = normalizeAppId(urlParam("appId", "app_id", "dataset"));
      return APP_ID_TO_DATASET[appId] ? appId : null;
    }

    function datasetFromUrl() {
      return APP_ID_TO_DATASET[appIdFromUrl()] || null;
    }

    function appIdForDataset(dataset) {
      return DATASET_TO_APP_ID[dataset] || DEFAULT_APP_ID;
    }

    function defaultDataset() {
      return APP_ID_TO_DATASET[DEFAULT_APP_ID];
    }

    function currentPersonaKeyFromUrl() {
      // Role is the only preference input accepted from the URL. `persona` is
      // retained as the canonical/legacy spelling, while `role` and
      // `user_role` let the study platform state the same assignment directly.
      const value = normalizePersonaKey(urlParam("role", "persona", "user_role"));
      return personaTypes[value] ? value : null;
    }

    function setPersonaKeyInUrl(personaKey) {
      // A participant who switches into the persona the other party currently
      // holds would leave both sides on the same key, so the stale pin is
      // dropped and the next draw picks a fresh opponent.
      const collides = otherPersonaKeyFromUrl() === normalizePersonaKey(personaKey);
      replaceUrlParams(collides ? { persona: personaKey, other: null } : { persona: personaKey });
    }

    // The other party is still drawn at random, but the draw is written back to
    // ?other= so a session is reproducible from its URL alone: reloading,
    // switching case or switching condition re-reads the pin instead of
    // re-rolling, which is what made the same participant face a different
    // opponent (and therefore a different "Other model") in every condition.
    function otherPersonaKeyFromUrl() {
      const value = normalizePersonaKey(getUrlParams().get("other"));
      return personaTypes[value] ? value : null;
    }

    function setOtherPersonaKeyInUrl(personaKey) {
      replaceUrlParams({ other: personaKey || null });
      return personaKey;
    }

    // Returns the pinned opponent, or null when there is none or the pin has
    // collided with the participant's own persona.
    function pinnedOtherPersonaKey(excludeKey = currentPersona?.key) {
      const key = otherPersonaKeyFromUrl();
      return key && key !== excludeKey ? key : null;
    }

    // The draw is scoped to one dataset+case. Within that scope the pin holds,
    // so a reload or a condition switch reproduces the same opponent; moving to
    // another case drops the pin so the next draw is a fresh random one and
    // rewrites ?other= with what it landed on. Starting at null means a page
    // load always honours the URL it was given.
    let otherPersonaPinScope = null;

    function releaseOtherPersonaPinOnScopeChange(scopeKey) {
      const changed = otherPersonaPinScope !== null && otherPersonaPinScope !== scopeKey;
      otherPersonaPinScope = scopeKey;
      if (changed) setOtherPersonaKeyInUrl(null);
      return changed;
    }

    // The persona is assigned by the study platform. Without one the participant
    // still needs a role to speak from, and community_members is the agreed
    // default. Weights always come from that role's fixed template; URL weight
    // parameters are deliberately ignored so a hand-edited link cannot change
    // model selection or negotiation outcomes.
    function ensurePersonaKey() {
      const key = currentPersonaKeyFromUrl() || DEFAULT_PERSONA_KEY;
      setPersonaKeyInUrl(key);
      return key;
    }

    function initialUserWeights() {
      return normalizeWeights(personaTypes[ensurePersonaKey()]?.weights || weights);
    }

    function rankOrderFromWeights(rawWeights) {
      const normalized = normalizeWeights(rawWeights || {});
      return [...criteriaOrder].sort((a, b) => (normalized[b] || 0) - (normalized[a] || 0));
    }

    function personaPreferenceFromKey(personaKey) {
      return enrichPersonaPreference(personaTypes[personaKey] || personaTypes[DEFAULT_PERSONA_KEY]);
    }

    function enrichPersonaPreference(persona) {
      const weights = normalizeWeights(persona.weights);
      const preference = {
        ...persona,
        name: persona.label,
        weights,
      };
      return {
        ...preference,
        negotiationProfile: buildNegotiationProfile(preference, weights),
      };
    }
