#!/usr/bin/env node
/* Select exp_data case ids whose by-label evaluation favors Negotiate.
 *
 * Condition:
 *   self optimal label != other optimal label
 *   negotiate --metric > selected baseline condition(s) by at least
 *   --min-margin points. By default, --metric joint_mean_by_label and
 *   --beat single compare Negotiate against Ignore only.
 *
 * Writes:
 *   exp_data/<dataset>/<role>/selected_data.txt
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const expRoot = path.join(repo, "exp_data");
const runsPath = path.join(repo, "eval", "results", "runs.csv");
const args = Object.fromEntries(
  process.argv.slice(2).map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? "true"] : null)).filter(Boolean)
);
const MIN_MARGIN = args.minMargin ? Number(args.minMargin) : 0;
const METRIC = args.metric || "joint_mean_by_label";
const BEAT = (args.beat || "single").split(",").map((s) => s.trim()).filter(Boolean);
const CONDITIONS = ["single", "singleoptimal", "multioptimal", "aggregate", "negotiatev2"];

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (ch !== "\r") {
      field += ch;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows;
  return body
    .filter((r) => r.length === header.length)
    .map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function numericLabel(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function roleDirs() {
  const datasets = fs.readdirSync(expRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  const dirs = [];
  for (const dataset of datasets) {
    const datasetDir = path.join(expRoot, dataset);
    for (const roleEntry of fs.readdirSync(datasetDir, { withFileTypes: true })) {
      if (roleEntry.isDirectory()) {
        dirs.push({ dataset, role: roleEntry.name, dir: path.join(datasetDir, roleEntry.name) });
      }
    }
  }
  return dirs;
}

if (!fs.existsSync(runsPath)) {
  throw new Error(`Missing ${path.relative(repo, runsPath)}. Run node eval/run_modeling_eval.mjs first.`);
}

const runRows = parseCsv(fs.readFileSync(runsPath, "utf8"));
const metricsByKey = new Map();
for (const row of runRows) {
  const key = [row.dataset, row.case, row.self, row.other].join("|");
  const bucket = metricsByKey.get(key) || {};
  bucket[row.condition] = {
    finalLabel: numericLabel(row.final_modelling_label),
    metric: Number(row[METRIC]),
  };
  metricsByKey.set(key, bucket);
}

const summaries = [];
for (const { dataset, role, dir } of roleDirs()) {
  const selected = [];
  const files = fs.readdirSync(dir)
    .filter((name) => /^\d+\.json$/.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10));

  let missingRuns = 0;
  for (const file of files) {
    const payload = JSON.parse(fs.readFileSync(path.join(dir, file), "utf8"));
    const assignment = payload.assignment || {};
    const expected = assignment.expected || {};
    const caseId = Number(assignment.case_id ?? path.basename(file, ".json"));
    const testCaseIndex = Number(assignment.test_case_index ?? payload.case?.test_case_index);
    const otherRole = assignment.other_role;
    const selfOptimal = numericLabel(expected.user_pred_class);
    const otherOptimal = numericLabel(expected.other_pred_class);

    if (selfOptimal == null || otherOptimal == null || selfOptimal === otherOptimal) continue;

    const metrics = metricsByKey.get([dataset, testCaseIndex, role, otherRole].join("|"));
    const needed = ["negotiatev2", ...BEAT];
    if (!metrics || needed.some((condition) => !metrics[condition] || !Number.isFinite(metrics[condition].metric))) {
      missingRuns += 1;
      continue;
    }

    const negotiateMetric = metrics.negotiatev2.metric;
    const beatsAllRequested = BEAT.every((condition) => negotiateMetric > metrics[condition].metric + MIN_MARGIN);
    if (beatsAllRequested) {
      selected.push(caseId);
    }
  }

  fs.writeFileSync(path.join(dir, "selected_data.txt"), JSON.stringify(selected));
  summaries.push({ dataset, role, selected: selected.length, total: files.length, missingRuns });
}

console.log(`criterion: negotiate ${METRIC} > ${BEAT.join(",")} + ${MIN_MARGIN}`);
for (const s of summaries) {
  const missing = s.missingRuns ? `, missing eval rows ${s.missingRuns}` : "";
  console.log(`${s.dataset}/${s.role}: ${s.selected}/${s.total}${missing}`);
}
