/* case-features.js — HTML escaping and case feature / SHAP pattern rendering
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    const FEATURE_DISPLAY_LIMIT = 6;

    function escapeHtml(value) {
      return String(value)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    }

    function humanizeFeatureName(name) {
      return String(name || "")
        .replace(/_/g, " ")
        .replace(/\b\w/g, (char) => char.toUpperCase());
    }

    function formatFeatureValue(name, value) {
      if (value == null || value === "") return "Unknown";
      const numeric = Number(value);
      if (Number.isFinite(numeric)) {
        const lower = String(name).toLowerCase();
        if (lower.includes("income") || lower.includes("amount") || lower.includes("assets")) {
          return numeric.toLocaleString("en-US");
        }
        if (lower.includes("month")) return `${numeric} months`;
        return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2);
      }
      return String(value);
    }

    function readableCaseFeatures(dataset, rawFeatures) {
      const raw = rawFeatures || {};
      if (dataset === "compas") {
        const raceKeys = ["African American", "Asian", "Hispanic", "Native American", "Other race"];
        const race = raceKeys.find((key) => Number(raw[key]) === 1) || "White";
        const age = Number(raw["Age below 25"]) === 1 ? "< 25" : Number(raw["Age above 45"]) === 1 ? "> 45" : "25-45";
        const sex = Number(raw.Female) === 1 ? "Female" : "Male";
        const charge = Number(raw.Misdemeanor) === 1 ? "Misdemeanor" : "Felony";
        const priors = raw["Number of priors"] ?? "Unknown";
        const scoreFactor = Number(raw["Score factor"]) === 1 ? "Present" : "Not present";
        return [
          { label: "Age", value: age },
          { label: "Race", value: race },
          { label: "Sex", value: sex },
          { label: "Charge", value: charge },
          { label: "Prior offenses", value: formatFeatureValue("Number of priors", priors) },
          { label: "Risk score factor", value: scoreFactor }
        ];
      }
      return Object.entries(raw).map(([name, value]) => ({
        label: humanizeFeatureName(name),
        value: formatFeatureValue(name, value)
      }));
    }

    function compactShap(value) {
      const numeric = Number(value);
      if (!Number.isFinite(numeric)) return "-";
      if (Math.abs(numeric) < 0.005) return "0.00";
      return `${numeric > 0 ? "+" : ""}${numeric.toFixed(2)}`;
    }

    function shapValueFor(features, keys) {
      return keys.reduce((sum, key) => sum + (Number(features?.[key]) || 0), 0);
    }

    function readableShapRows(dataset, rawFeatures, shapPatterns) {
      const raw = rawFeatures || {};
      if (dataset === "compas") {
        const raceKeys = ["African American", "Asian", "Hispanic", "Native American", "Other race"];
        const activeRace = raceKeys.find((key) => Number(raw[key]) === 1);
        const race = activeRace || "White";
        const raceShapKeys = activeRace ? [activeRace] : raceKeys;
        const ageKeys = ["Age below 25", "Age above 45"];
        const age = Number(raw["Age below 25"]) === 1 ? "< 25" : Number(raw["Age above 45"]) === 1 ? "> 45" : "25-45";
        return [
          { label: "Age", value: age, keys: ageKeys },
          { label: "Race", value: race, keys: raceShapKeys },
          { label: "Sex", value: Number(raw.Female) === 1 ? "Female" : "Male", keys: ["Female"] },
          { label: "Charge", value: Number(raw.Misdemeanor) === 1 ? "Misdemeanor" : "Felony", keys: ["Misdemeanor"] },
          { label: "Prior offenses", value: formatFeatureValue("Number of priors", raw["Number of priors"] ?? "Unknown"), keys: ["Number of priors"] },
          { label: "Risk score factor", value: Number(raw["Score factor"]) === 1 ? "Present" : "Not present", keys: ["Score factor"] },
        ];
      }
      return Object.entries(raw).map(([name, value]) => ({
        label: humanizeFeatureName(name),
        value: formatFeatureValue(name, value),
        keys: [name],
      }));
    }

    function subgroupDescription(dataset, rawFeatures) {
      const raw = rawFeatures || {};
      if (dataset === "compas") {
        const raceKeys = ["African American", "Asian", "Hispanic", "Native American", "Other race"];
        const race = raceKeys.find((key) => Number(raw[key]) === 1) || "White";
        const sex = Number(raw.Female) === 1 ? "Female" : "Male";
        return `${race}, ${sex}`;
      }
      const parts = [];
      ["Education", "Self employed", "CIBIL score"].forEach((key) => {
        if (raw[key] != null && raw[key] !== "") parts.push(`${humanizeFeatureName(key)}: ${formatFeatureValue(key, raw[key])}`);
      });
      return parts.length ? parts.join(", ") : "matching case subgroup";
    }

    function classIdByRiskLabel(labelNames, riskWord, fallback) {
      const entries = Object.entries(labelNames || {});
      const found = entries.find(([, label]) => String(label).toLowerCase().includes(riskWord));
      return found ? String(found[0]) : String(fallback);
    }

    function renderPatternCell(value, mode, maxAbs, label, count) {
      if (!count) return `<span class="pattern-empty">No models</span>`;
      const numeric = Number(value) || 0;
      const threshold = Math.max(0.015, (Number(maxAbs) || 0) * 0.08);
      const title = `${label}: average SHAP ${compactShap(numeric)} across ${count} models`;
      if (Math.abs(numeric) < threshold) {
        return `
          <div class="pattern-viz" title="${escapeHtml(`${title}; too small to emphasize`)}">
            <div class="pattern-track muted"></div>
          </div>
        `;
      }
      const width = maxAbs > 0 ? Math.min(50, Math.abs(numeric) / maxAbs * 50) : 0;
      const fillClass = numeric >= 0 ? "high" : "low";
      return `
        <div class="pattern-viz" title="${escapeHtml(title)}">
          <div class="pattern-track"><div class="pattern-fill ${fillClass}" style="width:${width}%"></div></div>
        </div>
      `;
    }

    function correlationForKeys(correlations, keys) {
      const links = (keys || []).flatMap((key) => correlations?.[key] || []);
      if (!links.length) return null;
      return [...links].sort((a, b) => Math.abs(Number(b.correlation) || 0) - Math.abs(Number(a.correlation) || 0))[0];
    }

    function renderSingleInfluenceBar(value, maxAbs, error = 0) {
      const numeric = Number(value) || 0;
      const scaleMax = Math.max(Number(maxAbs) || 0, 0.001);
      const width = Math.max(1, Math.min(46, (Math.abs(numeric) / scaleMax) * 46));
      const side = numeric >= 0 ? "high" : "low";
      const err = Math.max(0, Number(error) || 0);
      const errStart = Math.max(-scaleMax, numeric - err);
      const errEnd = Math.min(scaleMax, numeric + err);
      const errLeft = 50 + (errStart / scaleMax) * 46;
      const errWidth = Math.max(0, ((errEnd - errStart) / scaleMax) * 46);
      return `
        <div class="single-influence-row">
          <span class="single-influence-axis"></span>
          <span class="single-influence-bar ${side}" style="width:${width.toFixed(1)}%"></span>
          ${err > 0 ? `<span class="single-influence-error" style="left:${errLeft.toFixed(1)}%; width:${errWidth.toFixed(1)}%" title="${escapeHtml(`Mean SHAP ${compactShap(numeric)}; +/- ${compactShap(err).replace("+", "")}`)}"></span>` : ""}
        </div>
      `;
    }

    function renderSingleEvalMetric(label, value, error = 0) {
      const numeric = Math.max(0, Math.min(1, Number(value) || 0));
      const pct = Math.round(numeric * 100);
      const err = Math.max(0, Number(error) || 0);
      const errStart = Math.max(0, (numeric - err) * 100);
      const errEnd = Math.min(100, (numeric + err) * 100);
      return `
        <div class="single-eval-row">
          <span class="single-eval-label">${escapeHtml(label)}</span>
          <div class="single-eval-bar">
            <div class="single-eval-track">
              <span class="single-eval-fill" style="width:${pct}%"></span>
              ${err > 0 ? `<span class="single-eval-error" style="left:${errStart.toFixed(1)}%; width:${(errEnd - errStart).toFixed(1)}%" title="${escapeHtml(`Mean ${pct}%; +/- ${Math.round(err * 100)}pt`)}"></span>` : ""}
            </div>
            <span class="single-eval-value">${pct}%</span>
          </div>
        </div>
      `;
    }

    const PERFORMANCE_SIMILAR_DELTA = 0.03;

    function performanceDeltaIsSimilar(stats) {
      const delta = Number(stats?.delta);
      return Number.isFinite(delta) && Math.abs(delta) < PERFORMANCE_SIMILAR_DELTA;
    }

    function performanceRowIsSimilar(statsList) {
      return Array.isArray(statsList) && statsList.length > 0 && statsList.every(performanceDeltaIsSimilar);
    }

    function renderPerformanceComparisonCell(stats, baselineLabel = "baseline", extraClass = "") {
      const rawValue = Number(stats?.value);
      const hasValue = Number.isFinite(rawValue);
      const value = hasValue ? Math.max(0, Math.min(1, rawValue)) : null;
      const valuePct = hasValue ? Math.max(0, Math.min(100, value * 100)) : 0;
      const pct = hasValue ? valuePct.toFixed(1) : "-";
      const delta = Number(stats?.delta);
      const spread = Math.max(0, Number(stats?.spread) || 0);
      const isComparable = Number.isFinite(delta);
      const absDelta = isComparable ? Math.abs(delta) : 0;
      const direction = !isComparable || absDelta < 0.005 ? "same" : delta > 0 ? "better" : "worse";
      const deltaSymbol = direction === "better" ? "&#9650;" : direction === "worse" ? "&#9660;" : "&#8776;";
      const deltaMagnitude = isComparable ? Math.abs(delta * 100).toFixed(1).replace(/\.0$/, "") : "-";
      const deltaText = isComparable ? `${deltaMagnitude}%` : "-";
      const hoverDirection = direction === "better" ? "better" : direction === "worse" ? "worse" : "similar";
      const comparisonLabel = stats?.comparisonLabel || baselineLabel || "avg";
      const hoverDeltaText = isComparable ? `${hoverDirection} than ${comparisonLabel} by ${deltaMagnitude}%` : `${comparisonLabel} comparison unavailable`;
      const className = `class-${stats?.item?.classId}`;
      const overallValue = Number(stats?.overallValue);
      const hasOverall = Number.isFinite(overallValue);
      const overallPct = hasOverall ? Math.max(0, Math.min(100, overallValue * 100)) : null;
      const overallText = hasOverall ? `${overallPct.toFixed(1)}%` : "unavailable";
      const valueScope = stats?.valueScope || "current performance";
      const segmentLeft = hasOverall ? Math.min(valuePct, overallPct) : 0;
      const segmentWidth = hasOverall ? Math.abs(valuePct - overallPct) : valuePct;
      const baselineWidth = hasOverall ? segmentLeft : valuePct;
      const markerLeft = hasValue ? valuePct.toFixed(1) : "0.0";
      const title = hasValue
        ? `${stats?.item?.label || "Group"}: ${valueScope} ${pct}%; ${hoverDeltaText}; ${comparisonLabel} ${overallText}; SD +/- ${(spread * 100).toFixed(1)}pt`
        : `${stats?.item?.label || "Group"}: subgroup/local metric unavailable for this criterion; ${comparisonLabel} cannot be computed from available local fields`;
      return `
        <div class="exposure-performance-cell ${className} ${escapeHtml(extraClass)}" title="${escapeHtml(title)}">
          <div class="exposure-performance-bar" aria-label="${escapeHtml(`${stats?.item?.label || "Group"} ${valueScope} ${pct}${hasValue ? "%" : ""}; ${hoverDeltaText}`)}">
            <div class="exposure-performance-plot">
              <div class="exposure-performance-track">
                <span class="exposure-performance-baseline" style="width:${baselineWidth.toFixed(1)}%"></span>
                <span class="exposure-performance-fill ${direction}" style="left:${segmentLeft.toFixed(1)}%; width:${segmentWidth.toFixed(1)}%"></span>
                <span class="exposure-performance-value-marker" style="left:${markerLeft}%"></span>
              </div>
            </div>
            <div class="exposure-performance-compare">
              <span class="exposure-performance-delta ${direction}"><span class="exposure-performance-arrow">${deltaSymbol}</span> ${escapeHtml(deltaText)}</span>
            </div>
          </div>
        </div>
      `;
    }

    function numericValues(values) {
      return values.map(Number).filter(Number.isFinite);
    }

    function mean(values) {
      const nums = numericValues(values);
      return nums.length ? nums.reduce((sum, value) => sum + value, 0) / nums.length : null;
    }

    function firstFiniteMetricValue(source, keys) {
      for (const key of keys || []) {
        if (!key) continue;
        const value = Number(source?.[key]);
        if (Number.isFinite(value)) return value;
      }
      return null;
    }

    function sampleStd(values) {
      const nums = numericValues(values);
      if (nums.length < 2) return 0;
      const avg = mean(nums);
      return Math.sqrt(nums.reduce((sum, value) => sum + Math.pow(value - avg, 2), 0) / (nums.length - 1));
    }

    function modelsForGroup(group, models = []) {
      const seedSet = new Set((group?.model_seeds || []).map((seed) => String(seed)));
      if (seedSet.size) return models.filter((model) => seedSet.has(String(model.seed)));
      return models.filter((model) => String(model.pred_class) === String(group?.class_id));
    }

    function shapErrorFor(pattern, keys) {
      const spreads = pattern?.feature_std || pattern?.features_std || pattern?.std_features || pattern?.stderr_features;
      if (!spreads) return 0;
      const variances = (keys || []).map((key) => Math.pow(Number(spreads[key]) || 0, 2));
      return Math.sqrt(variances.reduce((sum, value) => sum + value, 0));
    }

    function renderSingleCaseFeaturePattern(dataset, rawFeatures, shapPatterns, labelNames, selectedModel, summary = [], options = {}) {
      const fallbackRows = readableCaseFeatures(dataset, rawFeatures).map((item) => ({ ...item, keys: [] }));
      const classId = String(selectedModel?.pred_class ?? 1);
      const selectedPattern = shapPatterns?.by_class?.[classId] || {};
      // Prefer the pinned single model's own per-case SHAP (shap_patterns.by_model[seed]);
      // fall back to the class-averaged pattern when it is not available.
      const singleModelPattern = shapPatterns?.by_model?.[String(selectedModel?.seed)];
      const influencePattern = singleModelPattern || selectedPattern;
      const hasExplanation = Boolean((shapPatterns?.by_class || shapPatterns?.by_model) && selectedModel);
      const allRows = hasExplanation ? readableShapRows(dataset, rawFeatures, shapPatterns) : fallbackRows;
      const allValues = allRows.map((row) => shapValueFor(influencePattern.features, row.keys));
      const rowPairs = allRows.map((row, index) => ({ row, value: allValues[index] }));
      const topPairs = rowPairs
        .slice()
        .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
        .slice(0, FEATURE_DISPLAY_LIMIT);
      const visiblePairs = topPairs.length ? topPairs : rowPairs.slice(0, FEATURE_DISPLAY_LIMIT);
      const rows = visiblePairs.map((pair) => pair.row);
      const shapValues = visiblePairs.map((pair) => pair.value);
      const maxAbs = Math.max(Number(shapPatterns?.max_abs_value) || 0, ...shapValues.map((value) => Math.abs(value)), 0.001);
      const predictedClass = Number(selectedModel?.pred_class);
      const predictionLabel = selectedModel
        ? (labelNames?.[selectedModel.pred_class] || selectedPattern.label || `Class ${selectedModel.pred_class}`)
        : "-";
      const predictionClassName = Number.isFinite(predictedClass) ? `class-${predictedClass}` : "unknown";
      const modelId = selectedModel?.seed ?? selectedModel?.id ?? selectedModel?.label ?? "-";
      const lowLabel = labelNames?.[0] || "Type 1";
      const highLabel = labelNames?.[1] || "Type 2";
      const evalMetricDefs = [
        { label: "Subgroup Acc.", localKeys: ["subgroup_accuracy", "local_accuracy"], modelKeys: ["subgroup_accuracy", "local_accuracy"], overallKeys: ["test_accuracy"], rankKey: "accuracy" },
        { label: "Individual Fairness.", localKeys: ["local_consistency"], modelKeys: ["local_consistency"], overallKeys: ["global_consistency", "test_consistency", "overall_consistency", "overall_local_consistency"], rankKey: "local_consistency" },
        { label: "CF fairness", localKeys: ["counterfactual_fairness"], modelKeys: ["counterfactual_fairness"], overallKeys: ["global_counterfactual_fairness", "test_counterfactual_fairness", "overall_counterfactual_fairness"], rankKey: "counterfactual_fairness" },
        { label: "Catch Truly High-Risk", localKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], modelKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], overallKeys: ["tpr"], rankKey: "tpr" },
        { label: "Avoid False High-Risk", localKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], modelKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], overallKeys: ["tnr"], rankKey: "tnr" },
      ];
      // Order by the user's elicited criterion ranking (most important first);
      // metrics outside the ranking (e.g. Test accuracy) keep their original
      // relative order and follow the ranked ones.
      const rank = Array.isArray(rankedCriteria) ? rankedCriteria : [];
      const evalRankIndex = (key) => {
        const i = key == null ? -1 : rank.indexOf(key);
        return i === -1 ? Infinity : i;
      };
      const evalMetrics = evalMetricDefs
        .map((def, index) => ({ def, index }))
        .sort((a, b) => (evalRankIndex(a.def.rankKey) - evalRankIndex(b.def.rankKey)) || (a.index - b.index))
        .map((entry) => entry.def);
      const baselineModels = Array.isArray(options?.baselineModels) ? options.baselineModels : null;
      const baselineLabel = options?.baselineLabel || "this model global average over all test cases";
      const helpText = options?.helpText || '<span class="better">Green</span> bars mean this model\'s race+sex subgroup performance is higher than the same model\'s global performance over all test cases; <span class="worse">red</span> bars mean it is lower. The number after each bar is subgroup score minus this model global score. Hover for exact subgroup and global values. Full bar = 100%.';
      const useModelMetricFallback = Boolean(options?.useModelMetricFallback);
      const metricValueForModel = (model, metric, includeFallback = false) => {
        let value = firstFiniteMetricValue(model, includeFallback ? metric.modelKeys : metric.localKeys);
        const localFnr = firstFiniteMetricValue(model, ["local_fnr", "local_false_negative_rate"]);
        const localFpr = firstFiniteMetricValue(model, ["local_fpr", "local_false_positive_rate"]);
        if (value == null && metric.rankKey === "tpr" && localFnr != null) value = 1 - localFnr;
        if (value == null && metric.rankKey === "tnr" && localFpr != null) value = 1 - localFpr;
        return value;
      };
      const singlePerformanceItem = {
        classId,
        label: options?.modelLabel || "AI Model",
      };
      const singlePerformanceRows = evalMetrics.map((metric) => {
        const localValue = metricValueForModel(selectedModel, metric, useModelMetricFallback);
        const overallValue = baselineModels
          ? mean(baselineModels.map((model) => metricValueForModel(model, metric, true)))
          : firstFiniteMetricValue(selectedModel, metric.overallKeys);
        const spread = baselineModels
          ? sampleStd(baselineModels.map((model) => metricValueForModel(model, metric, true)))
          : 0;
        const hasLocal = Number.isFinite(Number(localValue));
        const hasOverall = Number.isFinite(Number(overallValue));
        const stats = {
          item: singlePerformanceItem,
          value: hasLocal ? localValue : null,
          spread,
          overallValue: hasOverall ? overallValue : null,
          delta: hasLocal && hasOverall ? Number(localValue) - Number(overallValue) : NaN,
          comparisonLabel: baselineModels ? "average subgroup/local score across all candidate models" : baselineLabel,
          valueScope: baselineModels ? "selected model subgroup/local score" : "this model subgroup score",
        };
        const mutedClass = performanceRowIsSimilar([stats]) ? "metric-muted" : "";
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${mutedClass}">${escapeHtml(metric.label)}</div>
            ${renderPerformanceComparisonCell(stats, baselineLabel, mutedClass)}
          </div>
        `;
      }).join("");
      return `
        <div class="single-explanation-diagram single-compact-diagram" aria-label="Single model performance explanation">
          <div class="exposure-input-case-panel" aria-label="Input case attributes">
            <div class="single-diagram-heading exposure-input-case-heading">Input Case</div>
            <div class="single-feature-list exposure-input-case-list">
              <div class="single-diagram-heading single-attr-heading">Attribute</div>
              <div class="single-diagram-heading single-value-heading">Value</div>
              ${visiblePairs.map((pair) => `
                <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
              `).join("")}
            </div>
          </div>

          <div class="exposure-performance-panel single-performance-panel" aria-label="Single model prediction performance metrics">
            <div class="single-model-prediction-line ${predictionClassName}"><span>Model #${escapeHtml(modelId)}: Prediction: ${escapeHtml(predictionLabel)}</span>
              <span class="exposure-detail-wrap single-detail-wrap">
                <button type="button" class="exposure-detail-button" aria-label="Show XAI explanation detail">?</button>
                <div class="exposure-shap-popover single-shap-popover" role="tooltip" aria-label="XAI explanation detail">
                  <div class="single-feature-list exposure-shap-feature-list">
                    <div class="single-diagram-heading single-attr-heading">Attribute</div>
                    <div class="single-diagram-heading single-value-heading">Value</div>
                    ${visiblePairs.map((pair) => `
                      <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                      <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
                    `).join("")}
                  </div>
                  <div class="single-influence-box exposure-influence-column">
                    <div class="single-diagram-heading">Influence</div>
                    <div class="single-framed-plot single-influence-plot exposure-influence-plot" style="grid-template-rows: repeat(${rows.length}, var(--single-row-height));">
                      ${visiblePairs.map((pair, index) => renderSingleInfluenceBar(shapValues[index], maxAbs)).join("")}
                    </div>
                    <div class="single-influence-labels"><span>${escapeHtml(lowLabel)}</span><span>${escapeHtml(highLabel)}</span></div>
                  </div>
                  <div class="single-ai-prediction single-popover-ai">
                    <div class="single-ai-title">AI prediction</div>
                    <div class="single-ai-box ${predictionClassName}">
                      <span class="single-ai-label">${escapeHtml(predictionLabel)}</span>
                    </div>
                  </div>
                </div>
              </span>
            </div>
            <div class="single-diagram-heading exposure-performance-heading">
              Performance on Subgroup: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span>
              <span class="exposure-performance-help" tabindex="0" aria-label="Performance bar legend">?
                <span class="exposure-performance-help-text">${helpText}</span>
              </span>
            </div>

            <div class="exposure-performance-table single-performance-table">
              <div class="exposure-performance-label exposure-performance-criteria-heading">Criteria</div>
              <div class="exposure-performance-group ${predictionClassName}">${escapeHtml(singlePerformanceItem.label)}</div>
              <div class="exposure-performance-label exposure-performance-subheader-spacer"></div>
              <div class="exposure-performance-subheader"><span>Score</span><span>vs. Avg.</span></div>
              ${singlePerformanceRows}
            </div>
          </div>
        </div>
            `;
    }

    function topMetricKeyForWeights(rowWeights) {
      const entries = criteriaOrder
        .map((key) => ({ key, value: Number(rowWeights?.[key]) || 0 }))
        .sort((a, b) => b.value - a.value);
      return entries[0]?.key || criteriaOrder[0];
    }

    function exposureMetricHighlightClass(metric, highlight = {}) {
      const classes = [];
      if (highlight.userKey && metric.rankKey === highlight.userKey) classes.push("metric-highlight-user");
      if (highlight.otherKey && metric.rankKey === highlight.otherKey) classes.push("metric-highlight-other");
      return classes.join(" ");
    }

    function performanceTableWeights(rawWeights) {
      if (typeof decisionEffectiveWeights === "function") return decisionEffectiveWeights(rawWeights || {});
      return normalizeWeights(rawWeights || {});
    }

    function performanceTableReliability(item, rowWeights) {
      const effective = performanceTableWeights(rowWeights);
      const criteria = item?.group?.criteria || {};
      return criteriaOrder.reduce((score, key) => score + (effective[key] || 0) * (Number(criteria[key]) || 0), 0);
    }

    function renderPerformanceWeightCell(rowWeights, key, kind, extraClass = "") {
      const effective = performanceTableWeights(rowWeights);
      const value = Number(effective[key]) || 0;
      const classes = [kind, extraClass].filter(Boolean).join(" ");
      return `<div class="exposure-performance-weight-cell ${classes}">${Math.round(value * 100)}%</div>`;
    }

    function renderPerformanceWeightPair(userRowWeights, proxyRowWeights, key, extraClass = "") {
      const classes = ["exposure-performance-weight-pair", extraClass].filter(Boolean).join(" ");
      return `
        <div class="${classes}">
          ${renderPerformanceWeightCell(userRowWeights, key, "user", extraClass)}
          ${renderPerformanceWeightCell(proxyRowWeights, key, "proxy", extraClass)}
        </div>
      `;
    }

    function renderPerformanceWeightSpacerPair() {
      return `
        <div class="exposure-performance-weight-pair reliability-spacer">
          <div class="exposure-performance-weight-cell reliability-spacer"></div>
          <div class="exposure-performance-weight-cell reliability-spacer"></div>
        </div>
      `;
    }

    function reliabilityContributionTitle(item, rowWeights) {
      const effective = performanceTableWeights(rowWeights);
      const criteria = item?.group?.criteria || {};
      const parts = criteriaOrder.map((key) => {
        const weight = Number(effective[key]) || 0;
        const score = Number(criteria[key]) || 0;
        const contribution = weight * score;
        const label = criteriaLabels[key] || key;
        return `${label}: ${Math.round(weight * 100)}% x ${(score * 100).toFixed(1)}% = ${(contribution * 100).toFixed(1)}pt`;
      });
      const total = performanceTableReliability(item, rowWeights);
      return `Weighted sum for ${item?.label || "prediction"}: ${parts.join("; ")}; Total = ${(total * 100).toFixed(1)}%`;
    }

    function renderOptimalPredictionCell(item, rowWeights, bestValue, kind) {
      const value = performanceTableReliability(item, rowWeights);
      const isBest = Math.abs(value - bestValue) < 0.000001;
      const title = reliabilityContributionTitle(item, rowWeights);
      return `
        <div class="exposure-performance-optimal-cell ${kind}" title="${escapeHtml(title)}">
          ${isBest ? '<span class="optimal-check" aria-label="Optimal prediction">✓</span>' : ""}
        </div>
      `;
    }

    function renderExposureCaseFeaturePattern(dataset, rawFeatures, shapPatterns, labelNames, summary = [], models = [], groups = [], options = {}) {
      if (!shapPatterns?.by_class) {
        return renderCaseFeaturePatterns(dataset, rawFeatures, shapPatterns, labelNames, summary);
      }
      const highId = classIdByRiskLabel(labelNames, "high", 1);
      const lowId = classIdByRiskLabel(labelNames, "low", 0);
      const groupByClass = new Map((groups || []).map((group) => [String(group.class_id), group]));
      const summaryByClass = new Map((summary || []).map((item) => [String(item.class_id), item]));
      const ordered = [lowId, highId]
        .map((classId) => {
          const key = String(classId);
          const group = groupByClass.get(key) || summaryByClass.get(key) || shapPatterns.by_class?.[key];
          const pattern = shapPatterns.by_class?.[key] || {};
          if (!group && !pattern?.count) return null;
          const count = Number(group?.count ?? pattern?.count ?? 0);
          return {
            classId: key,
            label: group?.label || pattern?.label || labelNames?.[classId] || `Class ${classId}`,
            count,
            pattern,
            group,
            groupModels: modelsForGroup(group || { class_id: classId }, models),
          };
        })
        .filter((item) => item && item.count > 0);
      if (!ordered.length) {
        return renderCaseFeaturePatterns(dataset, rawFeatures, shapPatterns, labelNames, summary);
      }
      const rows = readableShapRows(dataset, rawFeatures, shapPatterns);
      const rowPairs = rows.map((row) => {
        const values = ordered.map((item) => shapValueFor(item.pattern?.features, row.keys));
        const score = Math.max(...values.map((value) => Math.abs(value)), 0);
        return { row, values, score };
      });
      const visiblePairs = rowPairs
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, FEATURE_DISPLAY_LIMIT);
      const maxAbs = Math.max(
        Number(shapPatterns.max_abs_value) || 0,
        ...visiblePairs.flatMap((pair) => pair.values.map((value) => Math.abs(value))),
        0.001
      );
      const lowLabel = labelNames?.[0] || "Type 1";
      const highLabel = labelNames?.[1] || "Type 2";
      const evalMetricDefs = [
        { label: "Subgroup Acc.", localKey: "subgroup_accuracy", overallKey: "test_accuracy", rankKey: "accuracy" },
        { label: "Individual Fairness", localKey: "local_consistency", overallKey: "local_consistency", rankKey: "local_consistency" },
        { label: "CF fairness", localKey: "counterfactual_fairness", overallKey: "counterfactual_fairness", rankKey: "counterfactual_fairness" },
        { label: "Catch Truly High-Risk", localKey: "subgroup_tpr", overallKey: "tpr", rankKey: "tpr" },
        { label: "Avoid False High-Risk", localKey: "subgroup_tnr", overallKey: "tnr", rankKey: "tnr" },
      ];
      const rank = Array.isArray(rankedCriteria) ? rankedCriteria : [];
      const evalRankIndex = (key) => {
        const i = key == null ? -1 : rank.indexOf(key);
        return i === -1 ? Infinity : i;
      };
      const evalMetrics = evalMetricDefs
        .map((def, index) => ({ def, index }))
        .sort((a, b) => (evalRankIndex(a.def.rankKey) - evalRankIndex(b.def.rankKey)) || (a.index - b.index))
        .map((entry) => entry.def);
      const highlight = options?.highlight || {};
      const reminderHtml = options?.reminderHtml || "";
      const showNegotiationWeights = Boolean(options?.showNegotiationWeights);
      const negotiationUserWeights = options?.userWeights || userWeights || weights;
      const negotiationProxyWeights = options?.proxyWeights || proxyWeights || weights;
      const influenceColumns = ordered.map((item) => `
        <div class="single-influence-box exposure-influence-column">
          <div class="single-diagram-heading">${escapeHtml(item.label)} (${Math.round(item.count)}/100)</div>
          <div class="single-framed-plot single-influence-plot exposure-influence-plot" style="grid-template-rows: repeat(${visiblePairs.length}, var(--single-row-height));">
            ${visiblePairs.map((pair) => renderSingleInfluenceBar(
              shapValueFor(item.pattern?.features, pair.row.keys),
              maxAbs,
              shapErrorFor(item.pattern, pair.row.keys)
            )).join("")}
          </div>
          <div class="single-influence-labels"><span>${escapeHtml(lowLabel)}</span><span>${escapeHtml(highLabel)}</span></div>
        </div>
      `).join("");
      const globalModelMean = (key) => mean((models || []).map((model) => model?.[key]));
      const evalStats = (item, metric) => {
        const values = item.groupModels.map((model) => model?.[metric.localKey]);
        const avg = mean(values);
        const spread = sampleStd(values);
        const fallback = item.group?.criteria?.[metric.rankKey] ?? summaryByClass.get(String(item.classId))?.[`avg_${metric.localKey}`];
        const localValue = avg ?? fallback;
        const overallValue = globalModelMean(metric.overallKey);
        return { item, value: localValue, spread, overallValue, delta: Number(localValue) - Number(overallValue) };
      };
      const performanceRows = evalMetrics.map((metric) => {
        const stats = ordered.map((item) => evalStats(item, metric));
        const highlightClass = exposureMetricHighlightClass(metric, highlight);
        const mutedClass = performanceRowIsSimilar(stats) ? "metric-muted" : "";
        const rowClass = [highlightClass, mutedClass].filter(Boolean).join(" ");
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${rowClass}">${escapeHtml(metric.label)}</div>
            ${stats.map((stat) => renderPerformanceComparisonCell(stat, "global models average overall", rowClass)).join("")}
          </div>
        `;
      }).join("");
      const performanceSubheaders = `
        <div class="exposure-performance-label exposure-performance-subheader-spacer"></div>
        ${ordered.map(() => `<div class="exposure-performance-subheader"><span>Score</span><span>vs. Avg.</span></div>`).join("")}
      `;
      const userReliabilityValues = ordered.map((item) => performanceTableReliability(item, negotiationUserWeights));
      const proxyReliabilityValues = ordered.map((item) => performanceTableReliability(item, negotiationProxyWeights));
      const userBestReliability = Math.max(...userReliabilityValues);
      const proxyBestReliability = Math.max(...proxyReliabilityValues);
      const reliabilityRows = showNegotiationWeights
        ? `
          <div class="exposure-performance-row reliability-row user">
            <div class="exposure-performance-label reliability-label user-optimal-label">Self optimal</div>
            ${ordered.map((item) => renderOptimalPredictionCell(item, negotiationUserWeights, userBestReliability, "user")).join("")}
          </div>
          <div class="exposure-performance-row reliability-row proxy">
            <div class="exposure-performance-label reliability-label proxy-optimal-label">Other optimal</div>
            ${ordered.map((item) => renderOptimalPredictionCell(item, negotiationProxyWeights, proxyBestReliability, "proxy")).join("")}
          </div>
        `
        : "";
      const performanceGridColumns = `180px repeat(${ordered.length}, 150px)`;
      return `
        <div class="single-explanation-diagram exposure-explanation-diagram" aria-label="Exposure condition prediction explanation">
          <div class="exposure-input-case-panel" aria-label="Input case attributes">
            <div class="single-diagram-heading exposure-input-case-heading">Input Case</div>
            <div class="single-feature-list exposure-input-case-list">
              <div class="single-diagram-heading single-attr-heading">Attribute</div>
              <div class="single-diagram-heading single-value-heading">Value</div>
              ${visiblePairs.map((pair) => `
                <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
              `).join("")}
            </div>
          </div>

          <div class="exposure-performance-panel" aria-label="Prediction performance metrics">
            <div class="single-diagram-heading exposure-performance-heading">
              Performance on Subgroup: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span>
              <span class="exposure-performance-help" tabindex="0" aria-label="Performance bar legend">?
                <span class="exposure-performance-help-text"><span class="better">Green</span> bars are better and <span class="worse">red</span> bars are worse than global models' average overall metric; the number after each bar is the difference from avg. Hover for exact subgroup value. Full bar = 100%.</span>
              </span>
            </div>
            
            ${reminderHtml}
            <div class="exposure-performance-table" style="grid-template-columns: ${performanceGridColumns};">
              <div class="exposure-performance-label exposure-performance-criteria-heading">Criteria</div>
              ${ordered.map((item, index) => `<div class="exposure-performance-group class-${item.classId}">${escapeHtml(item.label)} (${Math.round(item.count)}/100)${index === 0 ? `
                <span class="exposure-detail-wrap">
                  <button type="button" class="exposure-detail-button" aria-label="Show SHAP explanation detail">?</button>
                  <div class="exposure-shap-popover" role="tooltip" aria-label="SHAP explanation detail">
                    <div class="single-feature-list exposure-shap-feature-list">
                      <div class="single-diagram-heading single-attr-heading">Attribute</div>
                      <div class="single-diagram-heading single-value-heading">Value</div>
                      ${visiblePairs.map((pair) => `
                        <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                        <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
                      `).join("")}
                    </div>
                    ${influenceColumns}
                  </div>
                </span>` : ""}</div>`).join("")}
              ${performanceSubheaders}
              ${performanceRows}
              ${reliabilityRows}
            </div>
          </div>
        </div>
      `;
    }


    function renderMultiOptimalCaseFeaturePattern(dataset, rawFeatures, shapPatterns, labelNames, models, selectedItems, options = {}) {
      const fallbackRows = readableCaseFeatures(dataset, rawFeatures).map((item) => ({ ...item, keys: [] }));
      const activeItems = (selectedItems || []).filter((item) => item?.model);
      if (!activeItems.length) return renderCaseFeaturePatterns(dataset, rawFeatures, shapPatterns, labelNames, []);
      const patterns = activeItems.map((item) => shapPatterns?.by_model?.[String(item.model.seed)] || { features: {} });
      const hasExplanation = Boolean(shapPatterns?.by_model);
      const allRows = hasExplanation ? readableShapRows(dataset, rawFeatures, shapPatterns) : fallbackRows;
      const rowPairs = allRows.map((row) => {
        const values = patterns.map((pattern) => shapValueFor(pattern.features, row.keys));
        return { row, values, score: Math.max(...values.map((value) => Math.abs(value)), 0) };
      });
      const visiblePairs = rowPairs
        .slice()
        .sort((a, b) => b.score - a.score)
        .slice(0, FEATURE_DISPLAY_LIMIT);
      const maxAbs = Math.max(
        Number(shapPatterns?.max_abs_value) || 0,
        ...visiblePairs.flatMap((pair) => pair.values.map((value) => Math.abs(value))),
        0.001
      );
      const lowLabel = labelNames?.[0] || "Type 1";
      const highLabel = labelNames?.[1] || "Type 2";
      const evalMetricDefs = [
        { label: "Subgroup Acc.", localKeys: ["subgroup_accuracy", "local_accuracy"], modelKeys: ["subgroup_accuracy", "local_accuracy"], rankKey: "accuracy" },
        { label: "Individual Fairness", localKeys: ["local_consistency"], modelKeys: ["local_consistency"], rankKey: "local_consistency" },
        { label: "CF fairness", localKeys: ["counterfactual_fairness"], modelKeys: ["counterfactual_fairness"], rankKey: "counterfactual_fairness" },
        { label: "Catch Truly High-Risk", localKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], modelKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], rankKey: "tpr" },
        { label: "Avoid False High-Risk", localKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], modelKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], rankKey: "tnr" },
      ];
      const rank = Array.isArray(rankedCriteria) ? rankedCriteria : [];
      const evalRankIndex = (key) => {
        const i = key == null ? -1 : rank.indexOf(key);
        return i === -1 ? Infinity : i;
      };
      const evalMetrics = evalMetricDefs
        .map((def, index) => ({ def, index }))
        .sort((a, b) => (evalRankIndex(a.def.rankKey) - evalRankIndex(b.def.rankKey)) || (a.index - b.index))
        .map((entry) => entry.def);
      const metricValueForModel = (model, metric) => firstFiniteMetricValue(model, metric.modelKeys || metric.localKeys);
      const baselineLabel = "all models subgroup/local average";
      const performanceRows = evalMetrics.map((metric) => {
        const baselineValues = (models || []).map((model) => metricValueForModel(model, metric));
        const overallValue = mean(baselineValues);
        const spread = sampleStd(baselineValues);
        const stats = activeItems.map((item) => {
          const localValue = metricValueForModel(item.model, metric);
          const hasLocal = Number.isFinite(Number(localValue));
          const hasOverall = Number.isFinite(Number(overallValue));
          return {
            item: { classId: item.model.pred_class, label: item.roleLabel },
            value: hasLocal ? localValue : null,
            spread,
            overallValue: hasOverall ? overallValue : null,
            delta: hasLocal && hasOverall ? Number(localValue) - Number(overallValue) : NaN,
            comparisonLabel: "average subgroup/local score across all candidate models",
            valueScope: `${item.roleLabel} selected model subgroup/local score`,
          };
        });
        const mutedClass = performanceRowIsSimilar(stats) ? "metric-muted" : "";
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${mutedClass}">${escapeHtml(metric.label)}</div>
            ${stats.map((stat) => renderPerformanceComparisonCell(stat, baselineLabel, mutedClass)).join("")}
          </div>
        `;
      }).join("");
      const performanceGridColumns = `180px repeat(${activeItems.length}, 180px)`;
      const roleTagLabel = { self: "self", other: "other" };
      const versionTagHtml = (item) => {
        if (!options.versionTag || !Array.isArray(options.versions) || !options.versions.length) return "";
        const role = roleTagLabel[item.role] || item.role || "";
        const current = Number(options.currentVersionIndex) || 0;
        const optionsHtml = options.versions.map((version, index) =>
          `<option value="${index}" ${index === current ? "selected" : ""}>${escapeHtml(role)} · ${escapeHtml(version.label)}${version.shared ? " ✓" : ""}</option>`
        ).join("");
        return `<select class="negotiate-v2-model-version-select" data-role="${escapeHtml(item.role || "")}" title="This is ${escapeHtml(role)}'s optimal model at the selected version. Switch to review the optimal model from an earlier round.">${optionsHtml}</select>`;
      };
      const modelHeader = (item, index) => {
        const model = item.model;
        const classId = Number(model.pred_class);
        const predictionLabel = labelNames?.[model.pred_class] || `Class ${model.pred_class}`;
        const pattern = patterns[index] || { features: {} };
        return `
          <div class="exposure-performance-group multi-optimal-group class-${classId}">
            <div class="multi-optimal-role"><span>${escapeHtml(item.roleLabel)}</span>${versionTagHtml(item)}</div>
            <div class="multi-optimal-model-line">
              <span class="exposure-detail-wrap multi-optimal-detail-wrap" tabindex="0" role="button" aria-label="Show SHAP explanation detail">
                <span class="model-detail-link">Model #${escapeHtml(model.seed ?? model.id ?? "-")}: ${escapeHtml(predictionLabel)}</span>
                <div class="exposure-shap-popover" role="tooltip" aria-label="SHAP explanation detail">
                <div class="single-feature-list exposure-shap-feature-list">
                  <div class="single-diagram-heading single-attr-heading">Attribute</div>
                  <div class="single-diagram-heading single-value-heading">Value</div>
                  ${visiblePairs.map((pair) => `
                    <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                    <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
                  `).join("")}
                </div>
                <div class="single-influence-box exposure-influence-column">
                  <div class="single-diagram-heading">Model #${escapeHtml(model.seed ?? model.id ?? "-")} SHAP</div>
                  <div class="single-framed-plot single-influence-plot exposure-influence-plot" style="grid-template-rows: repeat(${visiblePairs.length}, var(--single-row-height));">
                    ${visiblePairs.map((pair) => renderSingleInfluenceBar(shapValueFor(pattern.features, pair.row.keys), maxAbs)).join("")}
                  </div>
                  <div class="single-influence-labels"><span>${escapeHtml(lowLabel)}</span><span>${escapeHtml(highLabel)}</span></div>
                </div>
                <div class="single-ai-prediction multi-optimal-popover-ai">
                  <div class="single-ai-title">AI prediction</div>
                  <div class="single-ai-box class-${classId}">
                    <span class="single-ai-label">${escapeHtml(predictionLabel)}</span>
                  </div>
                </div>
                </div>
              </span>
            </div>
          </div>
        `;
      };
      return `
        <div class="single-explanation-diagram exposure-explanation-diagram multi-optimal-diagram" aria-label="Multi optimal model explanation">
          <div class="exposure-input-case-panel" aria-label="Input case attributes">
            <div class="single-diagram-heading exposure-input-case-heading">Input Case</div>
            <div class="single-feature-list exposure-input-case-list">
              <div class="single-diagram-heading single-attr-heading">Attribute</div>
              <div class="single-diagram-heading single-value-heading">Value</div>
              ${visiblePairs.map((pair) => `
                <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                <div class="single-value-cell" title="${escapeHtml(pair.row.value)}">${escapeHtml(pair.row.value)}</div>
              `).join("")}
            </div>
          </div>
          <div class="exposure-performance-panel" aria-label="Multi optimal model performance metrics">
            <div class="single-diagram-heading exposure-performance-heading">
              Performance on Subgroup: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span>
              <span class="exposure-performance-help" tabindex="0" aria-label="Performance bar legend">?
                <span class="exposure-performance-help-text"><span class="better">Green</span> bars mean the selected model's subgroup/local score is higher than the average subgroup/local score across all candidate models for this case; <span class="worse">red</span> bars mean it is lower. The number after each bar is selected subgroup/local score minus all-model subgroup/local average. Hover for exact values. Full bar = 100%.</span>
              </span>
            </div>
            <div class="exposure-performance-table multi-optimal-table" style="grid-template-columns: ${performanceGridColumns};">
              <div class="exposure-performance-label exposure-performance-criteria-heading">Criteria</div>
              ${activeItems.map(modelHeader).join("")}
              <div class="exposure-performance-label exposure-performance-subheader-spacer"></div>
              ${activeItems.map(() => `<div class="exposure-performance-subheader"><span>Score</span><span>vs. Avg.</span></div>`).join("")}
              ${performanceRows}
            </div>
          </div>
        </div>
      `;
    }

    function renderCriteriaLink(correlations, row, shapValue, maxAbs) {
      const numeric = Number(shapValue) || 0;
      const threshold = Math.max(0.015, (Number(maxAbs) || 0) * 0.08);
      if (Math.abs(numeric) < threshold) return `<span class="criteria-empty">—</span>`;
      const link = correlationForKeys(correlations, row.keys);
      if (!link) return `<span class="criteria-empty">—</span>`;
      const corr = Number(link.correlation) || 0;
      const criterion = criteriaLabels[link.criterion] || link.criterion;
      const direction = corr >= 0 ? "positive" : "negative";
      const arrow = corr >= 0 ? "↑" : "↓";
      const verb = corr >= 0 ? "increases with" : "decreases with";
      const title = `Within this prediction group, this feature's SHAP values ${verb} ${criterion}.`;
      return `<span class="criteria-link ${direction}" title="${escapeHtml(title)}"><span aria-hidden="true">${arrow}</span><span>${escapeHtml(criterion)}</span></span>`;
    }

    function renderCaseFeaturePatterns(dataset, rawFeatures, shapPatterns, labelNames, summary = []) {
      if (!shapPatterns?.by_class) {
        return readableCaseFeatures(dataset, rawFeatures).map((item) => `
          <div class="feature" title="${escapeHtml(item.label)}: ${escapeHtml(item.value)}"><span>${escapeHtml(item.label)}</span><span>${escapeHtml(item.value)}</span></div>
        `).join("");
      }
      const highId = classIdByRiskLabel(labelNames, "high", 1);
      const lowId = classIdByRiskLabel(labelNames, "low", 0);
      const summaryByClass = new Map((summary || []).map((item) => [String(item.class_id), item]));
      const highSummary = summaryByClass.get(String(highId));
      const lowSummary = summaryByClass.get(String(lowId));
      const high = shapPatterns.by_class?.[highId] || {};
      const low = shapPatterns.by_class?.[lowId] || {};
      const rows = readableShapRows(dataset, rawFeatures, shapPatterns);
      const maxAbs = Math.max(Number(shapPatterns.max_abs_value) || 0, ...rows.flatMap((row) => [
        Math.abs(shapValueFor(high.features, row.keys)),
        Math.abs(shapValueFor(low.features, row.keys)),
      ]));
      const patternHeader = (item, fallbackLabel, className) => {
        const label = item?.label || fallbackLabel;
        const count = Number(item?.count ?? 0);
        const percent = Number(item?.percent ?? 0);
        return `
          <span class="case-pattern-title">${escapeHtml(label)}<br>${count}/100 models</span>
     
        `;
      };
      return `
        <table class="case-pattern-table">
          <colgroup>
            <col class="case-pattern-attr-col">
            <col class="case-pattern-value-col">
            <col class="case-pattern-decision-col">
            <col class="case-pattern-decision-col">
          </colgroup>
          <thead>
            <tr class="case-pattern-group">
              <th class="input-case-group" colspan="2">Input case</th>
              <th class="decision-explanation-group" colspan="2">Decision explanation</th>
            </tr>
            <tr>
              <th>Attribute</th>
              <th>Value</th>
              <th>${patternHeader(lowSummary, low.label || "Low Risk", "class-0")}</th>
              <th>${patternHeader(highSummary, high.label || "High Risk", "class-1")}</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => {
              const highValue = shapValueFor(high.features, row.keys);
              const lowValue = shapValueFor(low.features, row.keys);
              return `
                <tr>
                  <td class="attr-cell" title="${escapeHtml(row.label)}">${escapeHtml(row.label)}</td>
                  <td class="value-cell" title="${escapeHtml(row.value)}">${escapeHtml(row.value)}</td>
                  <td class="pattern-cell">${renderPatternCell(lowValue, "low", maxAbs, "Low-risk pattern", low.count)}</td>
                  <td class="pattern-cell">${renderPatternCell(highValue, "high", maxAbs, "High-risk pattern", high.count)}</td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
        <div class="case-pattern-note">Signed SHAP patterns: red supports High Risk; teal supports Low Risk.</div>
      `;
    }

