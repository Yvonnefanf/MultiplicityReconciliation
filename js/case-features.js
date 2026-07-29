/* case-features.js — HTML escaping and case feature / SHAP pattern rendering
   Part of the Negotiated Rashomon Reconciliation app. Loaded as an ordered
   classic script; all top-level declarations share one global scope. */

    const FEATURE_DISPLAY_LIMIT = 6;
    // Fixed row order for the input attributes, applied in every condition.
    // Ordering by |SHAP| made the rows reshuffle between cases, models and
    // conditions, so nothing could be compared across panels at a glance.
    // Labels not listed here (other datasets) keep the old |SHAP| ordering.
    const FEATURE_DISPLAY_ORDER_BY_DATASET = {
      compas: ["Prior offenses", "Charge severity", "Risk score factor", "Age", "Race", "Sex"],
      // Eligibility-relevant attributes lead; demographics follow.
      acs_coverage: ["Annual income", "Employment", "Disability", "Household", "Education", "Age", "Race", "Sex", "Citizenship"],
    };
    const FEATURE_DISPLAY_ORDER = FEATURE_DISPLAY_ORDER_BY_DATASET.compas;

    function featureOrderIndex(dataset, label) {
      const order = FEATURE_DISPLAY_ORDER_BY_DATASET[dataset] || FEATURE_DISPLAY_ORDER;
      const index = order.indexOf(String(label));
      return index === -1 ? order.length : index;
    }

    // Sort into the fixed order, falling back to magnitude for any attribute the
    // fixed list does not cover, then keep the leading rows.
    function orderRowsForDisplay(pairs, magnitudeOf, dataset) {
      return pairs
        .slice()
        .sort((a, b) => featureOrderIndex(dataset, a.row?.label) - featureOrderIndex(dataset, b.row?.label)
          || (magnitudeOf(b) - magnitudeOf(a)))
        .slice(0, FEATURE_DISPLAY_LIMIT);
    }

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

    // "Misdemeanor" / "Felony" are legal terms of art that a lay participant
    // should not have to decode mid-task, and the only thing the decision turns
    // on is how serious the charge was. Lead with the severity; keep the legal
    // term in the hover text so precision is not lost.
    function chargeSeverity(rawFeatures) {
      const isMisdemeanor = Number(rawFeatures?.Misdemeanor) === 1;
      return {
        value: isMisdemeanor ? "Less serious" : "More serious",
        hint: isMisdemeanor
          ? "Less serious charge (misdemeanor)"
          : "More serious charge (felony)",
      };
    }

    // ACSPublicCoverage ships 19 raw ACS recodes. Participants should not have to
    // read a 19-row table, and several columns only mean anything together (the
    // three disability flags, the household flags), so they are folded into one
    // readable row each. `keys` lists the raw columns a row stands for, so a
    // row's SHAP contribution is the sum over the columns it covers.
    const ACS_RACE_KEYS = ["Black", "Asian", "Other race"];
    const ACS_DISABILITY_KEYS = ["Disability", "Hearing difficulty", "Vision difficulty", "Cognitive difficulty"];
    const ACS_HOUSEHOLD_KEYS = ["Married", "Dependent child", "Gave birth last year"];
    const ACS_CITIZENSHIP_KEYS = ["US citizen", "Foreign born", "Moved last year", "Military service"];

    function acsEducationBand(level) {
      const code = Number(level);
      if (!Number.isFinite(code)) return "Unknown";
      if (code <= 15) return "No high school diploma";
      if (code <= 17) return "High school";
      if (code <= 19) return "Some college";
      if (code === 20) return "Associate degree";
      if (code === 21) return "Bachelor's degree";
      return "Graduate degree";
    }

    function acsDisabilitySummary(raw) {
      const specifics = [
        [raw["Hearing difficulty"], "hearing"],
        [raw["Vision difficulty"], "vision"],
        [raw["Cognitive difficulty"], "cognitive"],
      ].filter(([flag]) => Number(flag) === 1).map(([, label]) => label);
      const hasDisability = Number(raw.Disability) === 1 || specifics.length > 0;
      if (!hasDisability) return { value: "None reported", hint: "No disability reported" };
      return {
        value: specifics.length ? `Yes (${specifics.join(", ")})` : "Yes",
        hint: specifics.length
          ? `Reported disability, including ${specifics.join(", ")} difficulty`
          : "Reported disability",
      };
    }

    function acsHouseholdSummary(raw) {
      const parts = [];
      parts.push(Number(raw.Married) === 1 ? "Married" : "Not married");
      if (Number(raw["Dependent child"]) === 1) parts.push("dependent child");
      if (Number(raw["Gave birth last year"]) === 1) parts.push("gave birth last year");
      return parts.join(", ");
    }

    function acsCitizenshipSummary(raw) {
      const parts = [Number(raw["US citizen"]) === 1 ? "US citizen" : "Not a US citizen"];
      if (Number(raw["Foreign born"]) === 1) parts.push("foreign born");
      if (Number(raw["Moved last year"]) === 1) parts.push("moved last year");
      if (Number(raw["Military service"]) === 1) parts.push("military service");
      return parts.join(", ");
    }

    function acsReadableRows(raw) {
      const activeRace = ACS_RACE_KEYS.find((key) => Number(raw[key]) === 1);
      const disability = acsDisabilitySummary(raw);
      const income = Number(raw["Personal income"]);
      return [
        {
          label: "Annual income",
          value: Number.isFinite(income) ? `$${income.toLocaleString("en-US")}` : "Unknown",
          keys: ["Personal income"],
        },
        {
          label: "Employment",
          value: Number(raw.Employed) === 1 ? "Employed" : "Not employed",
          keys: ["Employed"],
        },
        { label: "Disability", value: disability.value, hint: disability.hint, keys: ACS_DISABILITY_KEYS },
        { label: "Household", value: acsHouseholdSummary(raw), keys: ACS_HOUSEHOLD_KEYS },
        { label: "Education", value: acsEducationBand(raw["Education level"]), keys: ["Education level"] },
        { label: "Age", value: formatFeatureValue("Age", raw.Age), keys: ["Age"] },
        { label: "Race", value: activeRace || "White", keys: activeRace ? [activeRace] : ACS_RACE_KEYS },
        { label: "Sex", value: Number(raw.Female) === 1 ? "Female" : "Male", keys: ["Female"] },
        { label: "Citizenship", value: acsCitizenshipSummary(raw), keys: ACS_CITIZENSHIP_KEYS },
      ];
    }

    function readableCaseFeatures(dataset, rawFeatures) {
      const raw = rawFeatures || {};
      if (dataset === "acs_coverage") {
        return acsReadableRows(raw).map(({ keys, ...row }) => row);
      }
      if (dataset === "compas") {
        const raceKeys = ["African American", "Asian", "Hispanic", "Native American", "Other race"];
        const race = raceKeys.find((key) => Number(raw[key]) === 1) || "White";
        const age = Number(raw["Age below 25"]) === 1 ? "< 25" : Number(raw["Age above 45"]) === 1 ? "> 45" : "25-45";
        const sex = Number(raw.Female) === 1 ? "Female" : "Male";
        const charge = chargeSeverity(raw);
        const priors = raw["Number of priors"] ?? "Unknown";
        const scoreFactor = Number(raw["Score factor"]) === 1 ? "Present" : "Not present";
        return [
          { label: "Age", value: age },
          { label: "Race", value: race },
          { label: "Sex", value: sex },
          { label: "Charge severity", value: charge.value, hint: charge.hint },
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
      if (dataset === "acs_coverage") {
        return acsReadableRows(raw);
      }
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
          { label: "Charge severity", value: chargeSeverity(raw).value, hint: chargeSeverity(raw).hint, keys: ["Misdemeanor"] },
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

    // Must match the race+sex subgroup that scripts/add_subgroup_metrics.py
    // computes the per-model subgroup accuracy / TPR / TNR on.
    function subgroupDescription(dataset, rawFeatures) {
      const raw = rawFeatures || {};
      const sex = Number(raw.Female) === 1 ? "Female" : "Male";
      if (dataset === "compas") {
        const raceKeys = ["African American", "Asian", "Hispanic", "Native American", "Other race"];
        const race = raceKeys.find((key) => Number(raw[key]) === 1) || "White";
        return `${race}, ${sex}`;
      }
      if (dataset === "acs_coverage") {
        const race = ACS_RACE_KEYS.find((key) => Number(raw[key]) === 1) || "White";
        return `${race}, ${sex}`;
      }
      return "matching case subgroup";
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

    // Per-model SHAP values for one feature across the models in a group. The
    // group's stored pattern only keeps the mean, but every model's attribution
    // is available, so the spread can be shown rather than averaged away.
    function groupShapValues(groupModels, shapPatterns, keys) {
      const byModel = shapPatterns?.by_model;
      if (!byModel) return [];
      return (groupModels || [])
        .map((model) => byModel[String(model?.seed)]?.features)
        .filter(Boolean)
        .map((features) => shapValueFor(features, keys))
        .filter((value) => Number.isFinite(value));
    }

    // Beeswarm placement: bin along the x axis and fan colliding points out
    // symmetrically, so a dense cluster reads as dense instead of as one dot.
    // Deterministic (no random jitter) so the plot is stable across re-renders.
    //
    // Offsets are returned in PX, deliberately. A percentage margin on an
    // absolutely positioned element resolves against the containing block's
    // WIDTH, not its height, so a "12%" offset became ~55px on a 456px-wide
    // plot and threw points into the neighbouring row.
    function beeswarmOffsets(xs, { binWidth = 1.8, step = 4, cap = 12 } = {}) {
      const binCounts = new Map();
      return xs
        .slice()
        .sort((a, b) => a.x - b.x)
        .map((point) => {
          const bin = Math.round(point.x / binWidth);
          const seen = binCounts.get(bin) || 0;
          binCounts.set(bin, seen + 1);
          const raw = Math.ceil(seen / 2) * step;
          const offset = seen === 0 ? 0 : Math.min(cap, raw) * (seen % 2 === 1 ? -1 : 1);
          return { ...point, offset };
        });
    }

    function shapSummaryPoints(values, maxAbs) {
      const scaleMax = Math.max(Number(maxAbs) || 0, 0.001);
      const points = values.map((value) => {
        const clamped = Math.max(-scaleMax, Math.min(scaleMax, value));
        return { x: 50 + (clamped / scaleMax) * 46, value };
      });
      return beeswarmOffsets(points, { binWidth: 1.8, step: 4, cap: 12 });
    }

    // One row of a SHAP summary (beeswarm) plot: each dot is one model in the
    // group. Replaces the single mean bar in the aggregate conditions, where a
    // lone bar is indistinguishable from the single-model view.
    function renderShapSummaryRow(values, maxAbs, meanValue, featureLabel = "") {
      if (!values.length) return renderSingleInfluenceBar(meanValue, maxAbs, 0);
      const scaleMax = Math.max(Number(maxAbs) || 0, 0.001);
      const points = shapSummaryPoints(values, maxAbs);
      const mean = Number(meanValue);
      const meanX = 50 + (Math.max(-scaleMax, Math.min(scaleMax, Number.isFinite(mean) ? mean : 0)) / scaleMax) * 46;
      const positive = values.filter((value) => value > 0).length;
      const min = Math.min(...values);
      const max = Math.max(...values);
      const title = `${featureLabel ? `${featureLabel}: ` : ""}${values.length} models`
        + ` | mean ${compactShap(mean)}`
        + ` | range ${compactShap(min)} to ${compactShap(max)}`
        + ` | ${positive} push toward the higher-risk class, ${values.length - positive} toward the lower`;
      return `
        <div class="single-influence-row shap-summary-row" title="${escapeHtml(title)}">
          <span class="single-influence-axis"></span>
          ${points.map((point) => `<span class="shap-summary-dot ${point.value >= 0 ? "high" : "low"}" style="left:${point.x.toFixed(1)}%; margin-top:${point.offset.toFixed(0)}px"></span>`).join("")}
          <span class="shap-summary-mean" style="left:${meanX.toFixed(1)}%"></span>
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
    // Greying out criteria the models barely differ on is off for now: every
    // criterion row renders at full contrast. Flip this back to true to restore
    // the muted styling.
    const MUTE_SIMILAR_PERFORMANCE_ROWS = false;

    function performanceDeltaIsSimilar(stats) {
      const delta = Number(stats?.delta);
      return Number.isFinite(delta) && Math.abs(delta) < PERFORMANCE_SIMILAR_DELTA;
    }

    function performanceRowIsSimilar(statsList) {
      if (!MUTE_SIMILAR_PERFORMANCE_ROWS) return false;
      return Array.isArray(statsList) && statsList.length > 0 && statsList.every(performanceDeltaIsSimilar);
    }

    // Every condition now reports performance as a bare number: no track, no
    // swarm, no vs-average column. The comparison detail stays in the hover
    // title so it is still recoverable without competing with the score.
    function renderPerformanceValueCell(text, title, ariaLabel, classNames) {
      const classes = ["exposure-performance-cell", ...classNames.filter(Boolean)].join(" ");
      return `
        <div class="${escapeHtml(classes)}" title="${escapeHtml(title)}">
          <span class="exposure-performance-score" aria-label="${escapeHtml(ariaLabel)}">${escapeHtml(text)}</span>
        </div>
      `;
    }

    // Distribution counterpart of renderPerformanceComparisonCell, for the
    // conditions that aggregate a whole group of models: the number shown is the
    // group mean, with the per-model range and spread kept on hover.
    function renderPerformanceDistributionCell(stats, baselineLabel = "baseline", extraClass = "") {
      const values = (stats?.values || []).map(Number).filter(Number.isFinite);
      if (!values.length) return renderPerformanceComparisonCell(stats, baselineLabel, extraClass);
      const meanValue = Number(stats?.value);
      const hasMean = Number.isFinite(meanValue);
      const overallValue = Number(stats?.overallValue);
      const hasOverall = Number.isFinite(overallValue);
      const min = Math.min(...values);
      const max = Math.max(...values);
      const spread = Math.max(0, Number(stats?.spread) || 0);
      const label = stats?.item?.label || "Group";
      const meanText = hasMean ? `${(Math.max(0, Math.min(1, meanValue)) * 100).toFixed(1)}%` : "-";
      const title = `${label} - ${stats?.item?.metricLabel || "metric"}: ${values.length} models`
        + `${hasMean ? ` | mean ${(meanValue * 100).toFixed(1)}%` : ""}`
        + ` | range ${(min * 100).toFixed(1)}% to ${(max * 100).toFixed(1)}%`
        + ` | SD +/- ${(spread * 100).toFixed(1)}pt`
        + `${hasOverall ? ` | ${baselineLabel} ${(overallValue * 100).toFixed(1)}%` : ""}`;
      return renderPerformanceValueCell(meanText, title, title, [
        "distribution",
        `class-${stats?.item?.classId}`,
        extraClass,
      ]);
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
      const deltaMagnitude = isComparable ? Math.abs(delta * 100).toFixed(1).replace(/\.0$/, "") : "-";
      const hoverDirection = direction === "better" ? "better" : direction === "worse" ? "worse" : "similar";
      const comparisonLabel = stats?.comparisonLabel || baselineLabel || "avg";
      const hoverDeltaText = isComparable ? `${hoverDirection} than ${comparisonLabel} by ${deltaMagnitude}%` : `${comparisonLabel} comparison unavailable`;
      const overallValue = Number(stats?.overallValue);
      const hasOverall = Number.isFinite(overallValue);
      const overallPct = hasOverall ? Math.max(0, Math.min(100, overallValue * 100)) : null;
      const overallText = hasOverall ? `${overallPct.toFixed(1)}%` : "unavailable";
      const valueScope = stats?.valueScope || "current performance";
      const title = hasValue
        ? `${stats?.item?.label || "Group"}: ${valueScope} ${pct}%; ${hoverDeltaText}; ${comparisonLabel} ${overallText}; SD +/- ${(spread * 100).toFixed(1)}pt`
        : `${stats?.item?.label || "Group"}: subgroup/local metric unavailable for this criterion; ${comparisonLabel} cannot be computed from available local fields`;
      const ariaLabel = `${stats?.item?.label || "Group"} ${valueScope} ${pct}${hasValue ? "%" : ""}`;
      return renderPerformanceValueCell(hasValue ? `${pct}%` : "-", title, ariaLabel, [
        `class-${stats?.item?.classId}`,
        extraClass,
      ]);
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
      const topPairs = orderRowsForDisplay(rowPairs, (pair) => Math.abs(pair.value), dataset);
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
        { label: "Accuracy", localKeys: ["subgroup_accuracy", "local_accuracy"], modelKeys: ["subgroup_accuracy", "local_accuracy"], overallKeys: ["test_accuracy"], rankKey: "accuracy" },
        { label: "Fairness", localKeys: ["local_consistency"], modelKeys: ["local_consistency"], overallKeys: ["global_consistency", "test_consistency", "overall_consistency", "overall_local_consistency"], rankKey: "local_consistency" },
        { label: criteriaLabels.tpr, localKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], modelKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], overallKeys: ["tpr"], rankKey: "tpr" },
        { label: criteriaLabels.tnr, localKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], modelKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], overallKeys: ["tnr"], rankKey: "tnr" },
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
      const helpText = options?.helpText || 'Each number is this model\'s score on that criterion for the race+sex subgroup, as a percentage (100% is perfect). Hover any number for the model\'s global score over all test cases and how far the subgroup score sits from it.';
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
        label: options?.modelLabel || "Score",
      };
      // Single-optimal only: say out loud why this model rather than one of the
      // others is on screen, since nothing else on the panel reveals that it was
      // chosen against the participant's own ranking.
      const rankedTopMetric = rank.length && evalMetrics[0]?.rankKey === rank[0] ? evalMetrics[0] : null;
      const optimalNote = options?.mode === "singleOptimal"
        ? `Picked for you: best matches your priorities${rankedTopMetric ? `, with higher <strong>${escapeHtml(rankedTopMetric.label)}</strong>` : ""}.`
        : "";
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
        // Only one stakeholder is on screen here, but their top criterion still
        // gets the same blue band and Self tag as in the multi conditions, so
        // "this is the one you said matters most" reads the same throughout.
        const highlightClass = exposureMetricHighlightClass(metric, options?.highlight || {});
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${mutedClass} ${highlightClass}">${criterionOwnerTags(metric, options?.highlight || {})}${escapeHtml(metric.label)}</div>
            ${renderPerformanceComparisonCell(stats, baselineLabel, `${mutedClass} ${highlightClass}`)}
          </div>
        `;
      }).join("");
      // Three columns -- input case, prediction, performance -- laid out as one
      // grid so the panel headings share a row, the Attribute/Value and
      // Criteria/Score column heads share the next, and the body rows below them
      // sit on the same 32px rhythm instead of drifting apart.
      return `
        <div class="single-explanation-diagram single-compact-diagram" aria-label="Single model performance explanation">
          <div class="single-diagram-heading single-panel-heading">Input Case</div>
          <div class="single-diagram-heading single-panel-heading">AI System Prediction</div>
          <div class="single-diagram-heading single-panel-heading">
            AI System Performance <br/> on: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span>
            <span class="exposure-performance-help" tabindex="0" aria-label="Performance score legend">?
              <span class="exposure-performance-help-text">${helpText}</span>
            </span>
          </div>

          <div class="single-column-heads single-input-heads">
            <span class="single-diagram-heading single-attr-heading">Attribute</span>
            <span class="single-diagram-heading single-value-heading">Value</span>
          </div>
          <div class="single-column-heads single-prediction-heads" aria-hidden="true"></div>
          <div class="single-column-heads single-performance-heads">
            <span class="single-diagram-heading single-criteria-heading">Criteria</span>
            <span class="single-diagram-heading single-score-heading">Score</span>
          </div>

          <div class="single-column-body single-input-body" aria-label="Input case attributes">
            ${visiblePairs.map((pair) => `
              <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
              <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
            `).join("")}
          </div>

          <div class="single-column-body single-prediction-body" aria-label="AI system prediction">
            ${optimalNote ? `<p class="single-prediction-note">${optimalNote}</p>` : ""}
            <div class="single-prediction-result ${predictionClassName}">${escapeHtml(predictionLabel)}</div>
            <span class="exposure-detail-wrap single-explanation-wrap" tabindex="0" role="button" aria-label="Show XAI explanation detail">
              <span class="single-explanation-link">AI Explanation</span>
              <div class="exposure-shap-popover single-shap-popover" role="tooltip" aria-label="XAI explanation detail">
                <div class="single-feature-list exposure-shap-feature-list">
                  <div class="single-diagram-heading single-attr-heading">Attribute</div>
                  <div class="single-diagram-heading single-value-heading">Value</div>
                  ${visiblePairs.map((pair) => `
                    <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                    <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
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

          <div class="single-column-body single-performance-body" aria-label="Single model performance metrics">
            ${singlePerformanceRows}
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

    // Side-by-side conditions put the numbers there to be compared, so on each
    // row the better score carries the weight and the others step back. Ranked
    // on the value as displayed (one decimal) -- bolding one "100.0%" over an
    // identical-looking "100.0%" would read as arbitrary -- and a tie leaves
    // every score at its normal weight.
    function scoreLeadClasses(values) {
      const shown = values.map((value) => (Number.isFinite(Number(value)) ? Math.round(Number(value) * 1000) / 10 : null));
      const present = shown.filter((value) => value !== null);
      if (shown.length < 2 || !present.length) return shown.map(() => "");
      const best = Math.max(...present);
      if (present.filter((value) => value === best).length !== 1) return shown.map(() => "");
      return shown.map((value) => (value === best ? "score-leader" : "score-trailing"));
    }

    // Marker put in front of a criterion label to say whose top priority it is.
    // Colour-coded to the side it stands for: blue for the participant, orange
    // for the other stakeholder, matching the colours those sides carry
    // elsewhere in the table.
    function criterionOwnerTag(kind) {
      const text = kind === "user" ? "Self" : "Other";
      const title = kind === "user" ? "Your top-priority criterion" : "The other stakeholder's top-priority criterion";
      return `<span class="criteria-owner-tag ${kind}" title="${escapeHtml(title)}">${text}</span>`;
    }

    function criterionOwnerTags(metric, highlight = {}) {
      const tags = [];
      if (highlight.userKey && metric.rankKey === highlight.userKey) tags.push(criterionOwnerTag("user"));
      if (highlight.otherKey && metric.rankKey === highlight.otherKey) tags.push(criterionOwnerTag("other"));
      return tags.join("");
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
      const visiblePairs = orderRowsForDisplay(rowPairs, (pair) => pair.score, dataset);
      // Individual models reach further out than any group mean, so the axis has
      // to be sized on the per-model values too. Scaling on the means alone
      // clamped the tails onto the plot edge and piled them up there.
      const perModelExtremes = shapPatterns?.by_model
        ? ordered.flatMap((item) => visiblePairs.flatMap((pair) =>
            groupShapValues(item.groupModels, shapPatterns, pair.row.keys).map((value) => Math.abs(value))))
        : [];
      const maxAbs = Math.max(
        Number(shapPatterns.max_abs_value) || 0,
        ...visiblePairs.flatMap((pair) => pair.values.map((value) => Math.abs(value))),
        ...perModelExtremes,
        0.001
      );
      const lowLabel = labelNames?.[0] || "Type 1";
      const highLabel = labelNames?.[1] || "Type 2";
      const evalMetricDefs = [
        { label: "Accuracy", localKey: "subgroup_accuracy", overallKey: "test_accuracy", rankKey: "accuracy" },
        { label: "Individual Fairness", localKey: "local_consistency", overallKey: "local_consistency", rankKey: "local_consistency" },
        { label: criteriaLabels.tpr, localKey: "subgroup_tpr", overallKey: "tpr", rankKey: "tpr" },
        { label: criteriaLabels.tnr, localKey: "subgroup_tnr", overallKey: "tnr", rankKey: "tnr" },
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
      // These conditions aggregate a whole group of models, so the explanation
      // is drawn as a SHAP summary plot (one dot per model) rather than a single
      // mean bar -- a lone bar looks identical to the single-model conditions
      // and hides the disagreement that is the point of the group view.
      const hasPerModelShap = Boolean(shapPatterns?.by_model);
      const influenceColumns = ordered.map((item) => `
        <div class="single-influence-box exposure-influence-column">
          <div class="single-diagram-heading">${escapeHtml(item.label)} (${Math.round(item.count)}/100)</div>
          <div class="single-framed-plot single-influence-plot exposure-influence-plot ${hasPerModelShap ? "shap-summary-plot" : ""}" style="grid-template-rows: repeat(${visiblePairs.length}, var(--single-row-height));">
            ${visiblePairs.map((pair) => {
              const meanValue = shapValueFor(item.pattern?.features, pair.row.keys);
              if (!hasPerModelShap) return renderSingleInfluenceBar(meanValue, maxAbs, shapErrorFor(item.pattern, pair.row.keys));
              return renderShapSummaryRow(groupShapValues(item.groupModels, shapPatterns, pair.row.keys), maxAbs, meanValue, pair.row.label);
            }).join("")}
          </div>
          <div class="single-influence-labels"><span>${escapeHtml(lowLabel)}</span><span>${escapeHtml(highLabel)}</span></div>
          ${hasPerModelShap ? `<div class="shap-summary-legend"><span class="perf-key-item"><span class="perf-key-dot"></span>one of the ${Math.round(item.count)} models</span><span class="perf-key-item"><span class="perf-key-mean"></span>solid = group mean SHAP</span></div>` : ""}
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
        // Carry the per-model values through so the cell can draw the spread
        // instead of collapsing the group to its mean.
        return {
          item: { ...item, metricLabel: metric.label },
          values: numericValues(values),
          value: localValue,
          spread,
          overallValue,
          delta: Number(localValue) - Number(overallValue),
        };
      };
      const performanceRows = evalMetrics.map((metric, index) => {
        const stats = ordered.map((item) => evalStats(item, metric));
        const highlightClass = exposureMetricHighlightClass(metric, highlight);
        const mutedClass = performanceRowIsSimilar(stats) ? "metric-muted" : "";
        const rowClass = [highlightClass, mutedClass].filter(Boolean).join(" ");
        const leadClasses = scoreLeadClasses(stats.map((stat) => stat.value));
        // Rows are already sorted by the participant's own ranking; tag the two
        // ends so the ordering is legible rather than merely true.
        const rankTag = index === 0
          ? `<span class="criteria-rank-tag top"></span>`
          : index === evalMetrics.length - 1
            ? `<span class="criteria-rank-tag bottom"></span>`
            : "";
        const ownerTags = criterionOwnerTags(metric, highlight);
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${rowClass}">${ownerTags}${escapeHtml(metric.label)}${rankTag}</div>
            ${stats.map((stat, column) => renderPerformanceDistributionCell(stat, "all-model average", `${rowClass} ${leadClasses[column]}`)).join("")}
          </div>
        `;
      }).join("");
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
      // Only wide enough for the group header line now that the cells are numbers.
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
                <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
              `).join("")}
            </div>
          </div>

          <div class="exposure-performance-panel" aria-label="Prediction performance metrics">
            <div class="single-diagram-heading exposure-performance-heading">
              Performance on Subgroup: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span>
              <span class="exposure-performance-help" tabindex="0" aria-label="Performance plot legend">?
                <span class="exposure-performance-help-text">Each number is the mean score of the models in that group on that criterion, as a percentage (100% is perfect). Hover any number for how many models it averages, their range, their spread, and the average across all 100 candidate models.</span>
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
                        <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
                      `).join("")}
                    </div>
                    ${influenceColumns}
                  </div>
                </span>` : ""}</div>`).join("")}
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
      const visiblePairs = orderRowsForDisplay(rowPairs, (pair) => pair.score, dataset);
      const maxAbs = Math.max(
        Number(shapPatterns?.max_abs_value) || 0,
        ...visiblePairs.flatMap((pair) => pair.values.map((value) => Math.abs(value))),
        0.001
      );
      const lowLabel = labelNames?.[0] || "Type 1";
      const highLabel = labelNames?.[1] || "Type 2";
      const evalMetricDefs = [
        { label: "Accuracy", localKeys: ["subgroup_accuracy", "local_accuracy"], modelKeys: ["subgroup_accuracy", "local_accuracy"], rankKey: "accuracy" },
        { label: "Individual Fairness", localKeys: ["local_consistency"], modelKeys: ["local_consistency"], rankKey: "local_consistency" },
        { label: criteriaLabels.tpr, localKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], modelKeys: ["subgroup_tpr", "local_tpr", "local_true_positive_rate", "local_recall", "local_sensitivity"], rankKey: "tpr" },
        { label: criteriaLabels.tnr, localKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], modelKeys: ["subgroup_tnr", "local_tnr", "local_true_negative_rate", "local_specificity"], rankKey: "tnr" },
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
        const highlightClass = exposureMetricHighlightClass(metric, options?.highlight || {});
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
        const leadClasses = scoreLeadClasses(stats.map((stat) => stat.value));
        return `
          <div class="exposure-performance-row ${mutedClass}">
            <div class="exposure-performance-label ${mutedClass} ${highlightClass}">${criterionOwnerTags(metric, options?.highlight || {})}${escapeHtml(metric.label)}</div>
            ${stats.map((stat, column) => renderPerformanceComparisonCell(stat, baselineLabel, `${mutedClass} ${highlightClass} ${leadClasses[column]}`)).join("")}
          </div>
        `;
      }).join("");
      const performanceGridColumns = `220px repeat(${activeItems.length}, 150px)`;
      const roleTagLabel = { self: "self", other: "other" };
      const versionTagHtml = (item) => {
        if (!options.versionTag) return "";
        // Each side keeps its own offer track, so the dropdown is per role.
        const versions = options.versionsByRole?.[item.role] || [];
        if (!versions.length) return "";
        const role = roleTagLabel[item.role] || item.role || "";
        const current = Number(options.versionIndexByRole?.[item.role]) || 0;
        const optionsHtml = versions.map((version, index) =>
          `<option value="${index}" ${index === current ? "selected" : ""}>${escapeHtml(version.label)}${version.shared ? " ✓" : ""}</option>`
        ).join("");
        return `<select class="negotiate-v2-model-version-select" data-role="${escapeHtml(item.role || "")}" title="This is the model ${escapeHtml(role)} stood behind at the selected round. Switch to review an earlier offer.">${optionsHtml}</select>`;
      };
      // The column head carries only whose model this is; what the model
      // predicted moved to a row at the foot of the table, so the criteria rows
      // read as one block between the two.
      const roleHeader = (item) => `
        <div class="exposure-performance-group multi-optimal-group">
          <div class="multi-optimal-role"><span>${escapeHtml(item.roleLabel)}</span>${versionTagHtml(item)}</div>
        </div>
      `;
      const predictionCell = (item, index) => {
        const model = item.model;
        const classId = Number(model.pred_class);
        const predictionLabel = labelNames?.[model.pred_class] || `Class ${model.pred_class}`;
        const modelId = model.seed ?? model.id ?? "-";
        const pattern = patterns[index] || { features: {} };
        return `
          <div class="multi-optimal-prediction-cell">
            <div class="multi-optimal-prediction-value class-${classId}" title="${escapeHtml(`${item.roleLabel}: model #${modelId}`)}">${escapeHtml(predictionLabel)}</div>
            <span class="exposure-detail-wrap multi-optimal-detail-wrap" tabindex="0" role="button" aria-label="${escapeHtml(`Show the explanation behind the ${item.roleLabel} prediction`)}">
              <span class="model-detail-link">AI Explanation</span>
              <div class="exposure-shap-popover" role="tooltip" aria-label="SHAP explanation detail">
                <div class="single-feature-list exposure-shap-feature-list">
                  <div class="single-diagram-heading single-attr-heading">Attribute</div>
                  <div class="single-diagram-heading single-value-heading">Value</div>
                  ${visiblePairs.map((pair) => `
                    <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                    <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
                  `).join("")}
                </div>
                <div class="single-influence-box exposure-influence-column">
                  <div class="single-diagram-heading">Model #${escapeHtml(modelId)} SHAP</div>
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
        `;
      };
      // Read top to bottom: the one input case, a brace fanning it out to each
      // side's model, the criteria scores, then what each model predicted. It is
      // ONE grid -- caption column, criteria label column, then a column per
      // model -- so the case box and brace stay centred over the model columns
      // while the caption sits beside the table. Every child is placed
      // explicitly: auto-placement would drop the caption into the empty space
      // beside the case box.
      const stackColumns = `10px ${performanceGridColumns}`;
      const modelSpan = "grid-column: 3 / -1;";
      return `
        <div class="single-explanation-diagram exposure-explanation-diagram multi-optimal-diagram" style="grid-template-columns: ${stackColumns};" aria-label="Multi optimal model explanation">
          <div class="multi-optimal-case-box" style="${modelSpan} grid-row: 1;" aria-label="Input case attributes">
            <div class="single-feature-list multi-optimal-case-list">
              <div class="single-diagram-heading single-attr-heading">Attribute</div>
              <div class="single-diagram-heading single-value-heading">Value</div>
              ${visiblePairs.map((pair) => `
                <div class="single-attr-cell" title="${escapeHtml(pair.row.label)}">${escapeHtml(pair.row.label)}</div>
                <div class="single-value-cell" title="${escapeHtml(pair.row.hint || pair.row.value)}">${escapeHtml(pair.row.value)}</div>
              `).join("")}
            </div>
          </div>
          <div class="multi-optimal-brace" style="${modelSpan} grid-row: 2;" aria-hidden="true">
            <svg viewBox="0 0 1000 60" preserveAspectRatio="none" focusable="false">
              <path d="M4 58 Q4 30 44 30 L456 30 Q500 30 500 2 Q500 30 544 30 L956 30 Q996 30 996 58"
                    fill="none" stroke="#111" stroke-width="2.5" stroke-linecap="round" vector-effect="non-scaling-stroke"></path>
            </svg>
          </div>
          <div class="single-diagram-heading multi-optimal-subgroup-heading" style="grid-column: 1; grid-row: 3;">
            
            <span class="exposure-performance-help" tabindex="0" aria-label="Performance score legend">?
            <span class="exposure-performance-help-text">
            Performance on: <span class="exposure-performance-subgroup">${escapeHtml(subgroupDescription(dataset, rawFeatures))}</span> <br/>
            Each number is the selected model's subgroup/local score on that criterion, as a percentage (100% is perfect). Hover any number for the average subgroup/local score across all candidate models and how far this model sits from it.</span>
            </span>
          </div>
          <div class="exposure-performance-table multi-optimal-table" style="grid-column: 2 / -1; grid-row: 3; grid-template-columns: ${performanceGridColumns};" aria-label="Multi optimal model performance metrics">
            <div class="exposure-performance-label exposure-performance-criteria-heading">Criteria</div>
            ${activeItems.map(roleHeader).join("")}
            ${performanceRows}
            <div class="exposure-performance-label multi-optimal-corner"></div>
            ${activeItems.map(predictionCell).join("")}
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
                  <td class="value-cell" title="${escapeHtml(row.hint || row.value)}">${escapeHtml(row.value)}</td>
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

