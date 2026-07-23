/* utils-salience.js — generic helpers (api/fetch/weights) and salience-scalar params
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    const STATIC_DATA_VERSION = "20260723-negotiatev2-v1";

    function staticApiUrl(url) {
      if (url === "/api/datasets") return "data/datasets.json";
      let match = url.match(/^\/api\/([^/]+)\/model-global-metrics$/);
      if (match) return `data/${match[1]}/model_global_metrics.json`;
      match = url.match(/^\/api\/([^/]+)\/cases$/);
      if (match) return `data/${match[1]}/cases.json`;
      match = url.match(/^\/api\/([^/]+)\/cases\/(\d+)$/);
      if (match) return `data/${match[1]}/cases/${match[2]}.json`;
      return url;
    }

    async function fetchJson(url) {
      const staticUrl = staticApiUrl(url);
      try {
        const cacheBustedUrl = staticUrl.includes("?") ? `${staticUrl}&v=${STATIC_DATA_VERSION}` : `${staticUrl}?v=${STATIC_DATA_VERSION}`;
        const response = await fetch(cacheBustedUrl, { cache: "no-store" });
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return response.json();
      } catch (error) {
        if (location.protocol === "file:") {
          throw new Error("This static export needs to be opened through GitHub Pages or a local static server, not directly as a file:// URL.");
        }
        throw error;
      }
    }

    function setLoading(message) {
      if (modelRows) modelRows.innerHTML = `<tr><td colspan="10" class="status">${message}</td></tr>`;
      summaryTableWrap.innerHTML = `<div class="status">${message}</div>`;
      decisionLabel.textContent = "-";
      decisionReason.textContent = message;
    }

    function normalizeWeights(raw) {
      const clipped = {};
      criteriaOrder.forEach((key) => { clipped[key] = Math.max(0, Number(raw[key]) || 0); });
      const total = criteriaOrder.reduce((sum, key) => sum + clipped[key], 0);
      if (total <= 0) {
        const equal = {};
        criteriaOrder.forEach((key) => { equal[key] = 1 / criteriaOrder.length; });
        return equal;
      }
      const normalized = {};
      criteriaOrder.forEach((key) => { normalized[key] = clipped[key] / total; });
      return normalized;
    }

    function shortWeights(w) {
      return criteriaOrder.map((key) => `${criteriaLabels[key]} ${Math.round((w[key] || 0) * 100)}%`).join(" · ");
    }

    function clampRange(value, min, max) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return min;
      return Math.max(min, Math.min(max, numeric));
    }

    function defaultSalienceParams() {
      return paramsFromScalar(SALIENCE_SCALAR_DEFAULT, "default");
    }

    // The salience model has one free parameter. alpha (leverage) and beta
    // (target-gap) share the fitted sensitivity `s`; gamma (floor risk) is fixed
    // at 1 because it is non-compensatory. Keeping the {alpha,beta,gamma} shape
    // means every downstream reader and the worker payload stay unchanged.
    function paramsFromScalar(scalar, source = "calibrated") {
      const s = clampRange(scalar, SALIENCE_SCALAR_MIN, SALIENCE_SCALAR_MAX);
      return { alpha: s, beta: s, gamma: 1, s, source };
    }

    function scalarFromParams(params) {
      return clampRange(params?.s ?? params?.alpha ?? SALIENCE_SCALAR_DEFAULT, SALIENCE_SCALAR_MIN, SALIENCE_SCALAR_MAX);
    }

    function normalizeSalienceParams(raw = null, source = null) {
      const s = clampRange(raw?.s ?? raw?.alpha ?? raw?.leverage ?? SALIENCE_SCALAR_DEFAULT, SALIENCE_SCALAR_MIN, SALIENCE_SCALAR_MAX);
      return { alpha: s, beta: s, gamma: 1, s, source: source || raw?.source || "default" };
    }

    function currentSalienceParams() {
      return normalizeSalienceParams(stakeholderSalienceParams || defaultSalienceParams());
    }

    function profileSalienceParams(profile) {
      return normalizeSalienceParams(profile?.salience_params || defaultSalienceParams());
    }

    function applySalienceParamsToCurrentPersona() {
      if (!currentPersona) return;
      currentPersona.salienceParams = currentSalienceParams();
      currentPersona.negotiationProfile = buildNegotiationProfile(currentPersona, currentPersona.weights || elicitedWeights || weights);
    }

    function setStakeholderSalienceParams(nextParams, source = "calibrated") {
      stakeholderSalienceParams = normalizeSalienceParams(nextParams, source);
      calibrationFitted = source !== "default";
      applySalienceParamsToCurrentPersona();
      saveCalibrationProfile();
      saveElicitationState();
    }

    function salienceParamSummary(params = currentSalienceParams()) {
      return `case-stakes sensitivity ${scalarFromParams(params).toFixed(2)}`;
    }

