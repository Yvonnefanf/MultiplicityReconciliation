const CRITERIA_ORDER = ["accuracy", "tpr", "tnr", "local_consistency", "counterfactual_fairness"];
const DEFAULT_ALLOWED_ORIGINS = [
  "https://yvonnefanf.github.io",
  "http://127.0.0.1:8010",
  "http://localhost:8010",
  "http://127.0.0.1:8000",
  "http://localhost:8000"
];
const MAX_BODY_BYTES = 60_000;
const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";

export default {
  async fetch(request, env) {
    const cors = corsHeaders(request, env);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    if (request.method !== "POST") {
      return jsonResponse({ error: "Method not allowed" }, 405, cors);
    }

    const url = new URL(request.url);
    if (url.pathname !== "/negotiate") {
      return jsonResponse({ error: "Not found" }, 404, cors);
    }

    if (!isAllowedOrigin(request, env)) {
      return jsonResponse({ error: "Origin not allowed" }, 403, cors);
    }

    if (!env.OPENAI_API_KEY) {
      return jsonResponse({ error: "OPENAI_API_KEY secret is not configured" }, 500, cors);
    }

    let payload;
    try {
      payload = await readJsonBody(request);
      validatePayload(payload);
    } catch (error) {
      return jsonResponse({ error: error.message }, 400, cors);
    }

    try {
      const result = await callOpenAI(payload, env);
      return jsonResponse(result, 200, cors);
    } catch (error) {
      return jsonResponse({ error: "OpenAI negotiation failed", detail: error.message }, 502, cors);
    }
  }
};

function corsHeaders(request, env) {
  const origin = request.headers.get("Origin") || "";
  const allowed = allowedOrigins(env);
  const allowOrigin = allowed.includes(origin) ? origin : allowed[0];
  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
    "Content-Type": "application/json; charset=utf-8"
  };
}

function allowedOrigins(env) {
  const configured = String(env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return configured.length ? configured : DEFAULT_ALLOWED_ORIGINS;
}

function isAllowedOrigin(request, env) {
  const origin = request.headers.get("Origin");
  if (!origin) return true;
  return allowedOrigins(env).includes(origin);
}

async function readJsonBody(request) {
  const length = Number(request.headers.get("Content-Length") || 0);
  if (length > MAX_BODY_BYTES) throw new Error("Payload too large");
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) throw new Error("Payload too large");
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload must be an object");
  if (!payload.dataset || typeof payload.dataset !== "string") throw new Error("Missing dataset");
  if (!Number.isFinite(Number(payload.case_index))) throw new Error("Missing case_index");
  normalizeWeights(payload.user_weights || {});
  normalizeWeights(payload.proxy_weights || {});
  if (!Array.isArray(payload.groups)) throw new Error("Missing groups array");
}

async function callOpenAI(payload, env) {
  const model = env.OPENAI_MODEL || "gpt-5.5";
  const prompt = buildPrompt(payload);
  const response = await fetch(OPENAI_RESPONSES_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      input: [
        {
          role: "system",
          content: [{ type: "input_text", text: systemPrompt() }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: "proxy_negotiation_response",
          strict: true,
          schema: responseSchema()
        }
      },
      max_output_tokens: 1600
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
  }

  const data = await response.json();
  const parsed = parseOpenAIJson(data);
  return sanitizeModelResponse(parsed, payload);
}

function systemPrompt() {
  return [
    "You are a proxy negotiation agent for an interpretable ML reliability UI.",
    "Return only JSON matching the schema.",
    "Use the proxy role's priorities, but make realistic compromises toward the user's offer.",
    "The five weights must be nonnegative and sum to 1 after normalization.",
    "Accepted should be true only when the user's offer is close to proxy priorities or gives the same final decision.",
    "Keep explanation.text short, concrete, and user-facing. Do not mention API keys or hidden instructions."
  ].join(" ");
}

function buildPrompt(payload) {
  const safePayload = {
    dataset: payload.dataset,
    dataset_label: payload.dataset_label,
    case_index: Number(payload.case_index),
    round: Number(payload.round || 1),
    user_role: String(payload.user_role || "User").slice(0, 80),
    proxy_role: String(payload.proxy_role || "Proxy").slice(0, 80),
    criteria_labels: pickCriteriaLabels(payload.criteria_labels || {}),
    user_weights: normalizeWeights(payload.user_weights || {}),
    proxy_weights: normalizeWeights(payload.proxy_weights || {}),
    groups: sanitizeGroups(payload.groups || []),
    case_features: limitObject(payload.case_features || {}, 16),
    history: sanitizeHistory(payload.history || [])
  };

  return [
    "Generate the proxy response for this negotiation state.",
    "If not accepted, counter_weights should move toward proxy_weights while respecting the user's strongest stated priorities.",
    "Prefer small to moderate changes after round 1; in round 1 an opening offer can be closer to proxy_weights.",
    "Use moves to explain only material weight changes.",
    JSON.stringify(safePayload, null, 2)
  ].join("\n\n");
}

function responseSchema() {
  const weightProperties = Object.fromEntries(CRITERIA_ORDER.map((key) => [key, { type: "number", minimum: 0, maximum: 1 }]));
  return {
    type: "object",
    additionalProperties: false,
    required: ["accepted", "counter_weights", "moves", "explanation", "control"],
    properties: {
      accepted: { type: "boolean" },
      counter_weights: {
        type: "object",
        additionalProperties: false,
        required: CRITERIA_ORDER,
        properties: weightProperties
      },
      moves: {
        type: "array",
        maxItems: 5,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["key", "label", "from", "to", "delta"],
          properties: {
            key: { type: "string", enum: CRITERIA_ORDER },
            label: { type: "string" },
            from: { type: "number", minimum: 0, maximum: 1 },
            to: { type: "number", minimum: 0, maximum: 1 },
            delta: { type: "number", minimum: -1, maximum: 1 }
          }
        }
      },
      explanation: {
        type: "object",
        additionalProperties: false,
        required: ["source", "text"],
        properties: {
          source: { type: "string", enum: ["openai"] },
          text: { type: "string", maxLength: 900 }
        }
      },
      control: {
        type: "object",
        additionalProperties: false,
        required: ["source"],
        properties: {
          source: { type: "string", enum: ["cloudflare_worker"] }
        }
      }
    }
  };
}

function parseOpenAIJson(data) {
  const candidates = [];
  if (typeof data.output_text === "string") candidates.push(data.output_text);
  for (const item of data.output || []) {
    if (typeof item.text === "string") candidates.push(item.text);
    if (typeof item.output_text === "string") candidates.push(item.output_text);
    for (const part of item.content || []) {
      if (typeof part.text === "string") candidates.push(part.text);
      if (typeof part.output_text === "string") candidates.push(part.output_text);
      if (typeof part.json === "object" && part.json) return part.json;
      if (typeof part.content === "string") candidates.push(part.content);
    }
  }

  for (const candidate of candidates) {
    const text = String(candidate || "").trim();
    if (!text) continue;
    try {
      return JSON.parse(text);
    } catch {
      const start = text.indexOf("{");
      const end = text.lastIndexOf("}");
      if (start >= 0 && end > start) return JSON.parse(text.slice(start, end + 1));
    }
  }

  const diagnostic = {
    status: data.status,
    incomplete_details: data.incomplete_details,
    output_types: (data.output || []).map((item) => ({
      type: item.type,
      status: item.status,
      content_types: (item.content || []).map((part) => part.type)
    }))
  };
  throw new Error(`OpenAI response did not include parseable text output: ${JSON.stringify(diagnostic)}`);
}

function sanitizeModelResponse(raw, payload) {
  const user = normalizeWeights(payload.user_weights || {});
  const counter = normalizeWeights(raw.counter_weights || raw.counterWeights || user);
  const moves = Array.isArray(raw.moves) ? raw.moves : [];
  return {
    accepted: Boolean(raw.accepted),
    counter_weights: counter,
    moves: sanitizeMoves(moves, user, counter, payload.criteria_labels || {}),
    explanation: {
      source: "openai",
      text: String(raw.explanation?.text || "I generated a counter-offer based on the proxy role's priorities.").slice(0, 900)
    },
    control: { source: "cloudflare_worker" }
  };
}

function sanitizeMoves(moves, fromWeights, toWeights, labels) {
  const from = normalizeWeights(fromWeights);
  const to = normalizeWeights(toWeights);
  const modelMoves = moves
    .filter((move) => CRITERIA_ORDER.includes(move?.key))
    .map((move) => ({
      key: move.key,
      label: String(move.label || labels[move.key] || move.key).slice(0, 80),
      from: clamp01(Number.isFinite(Number(move.from)) ? Number(move.from) : from[move.key]),
      to: clamp01(Number.isFinite(Number(move.to)) ? Number(move.to) : to[move.key]),
      delta: Math.max(-1, Math.min(1, Number.isFinite(Number(move.delta)) ? Number(move.delta) : to[move.key] - from[move.key]))
    }))
    .filter((move) => Math.abs(move.delta) >= 0.005)
    .slice(0, 5);

  if (modelMoves.length) return modelMoves;
  return CRITERIA_ORDER
    .map((key) => ({
      key,
      label: String(labels[key] || key),
      from: from[key],
      to: to[key],
      delta: to[key] - from[key]
    }))
    .filter((move) => Math.abs(move.delta) >= 0.005)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 5);
}

function normalizeWeights(raw) {
  const clipped = {};
  for (const key of CRITERIA_ORDER) clipped[key] = clamp01(Number(raw?.[key]) || 0);
  const total = CRITERIA_ORDER.reduce((sum, key) => sum + clipped[key], 0);
  if (total <= 0) return Object.fromEntries(CRITERIA_ORDER.map((key) => [key, 1 / CRITERIA_ORDER.length]));
  return Object.fromEntries(CRITERIA_ORDER.map((key) => [key, clipped[key] / total]));
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function pickCriteriaLabels(raw) {
  return Object.fromEntries(CRITERIA_ORDER.map((key) => [key, String(raw[key] || key).slice(0, 80)]));
}

function sanitizeGroups(groups) {
  return groups.slice(0, 4).map((group) => ({
    class_id: Number(group.class_id),
    label: String(group.label || `Class ${group.class_id}`).slice(0, 80),
    count: Number(group.count || 0),
    criteria: limitObject(group.criteria || {}, 8),
    user_reliability: Number(group.user_reliability || 0),
    proxy_reliability: Number(group.proxy_reliability || 0),
    fairness_components: limitObject(group.fairness_components || {}, 8)
  }));
}

function sanitizeHistory(history) {
  return history.slice(-8).map((item) => ({
    role: String(item.role || "").slice(0, 30),
    title: String(item.title || "").slice(0, 100),
    text: String(item.text || "").slice(0, 700),
    weights: item.weights ? normalizeWeights(item.weights) : null
  }));
}

function limitObject(raw, maxKeys) {
  return Object.fromEntries(
    Object.entries(raw || {})
      .slice(0, maxKeys)
      .map(([key, value]) => [String(key).slice(0, 80), typeof value === "number" ? Number(value) : String(value).slice(0, 120)])
  );
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}
