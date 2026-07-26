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

function isModelNegotiation(payload) {
  return payload?.protocol === "model_negotiation";
}

function validatePayload(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Payload must be an object");
  if (!payload.dataset || typeof payload.dataset !== "string") throw new Error("Missing dataset");
  if (!Number.isFinite(Number(payload.case_index))) throw new Error("Missing case_index");
  if (isModelNegotiation(payload)) {
    if (!payload.incoming_offer || typeof payload.incoming_offer !== "object") throw new Error("Missing incoming_offer");
    if (!["accept", "counter", "hold"].includes(payload.my_response)) throw new Error("my_response must be accept, counter or hold");
    if (payload.my_response === "counter" && !payload.counter_offer) throw new Error("Missing counter_offer");
    return;
  }
  normalizeWeights(payload.user_weights || {});
  normalizeWeights(payload.proxy_weights || {});
  if (!Array.isArray(payload.groups)) throw new Error("Missing groups array");
}

async function callOpenAI(payload, env) {
  const model = env.OPENAI_MODEL || "gpt-5.4-mini";
  const modelProtocol = isModelNegotiation(payload);
  const prompt = modelProtocol ? buildModelNegotiationPrompt(payload) : buildPrompt(payload);
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
          content: [{ type: "input_text", text: modelProtocol ? modelNegotiationSystemPrompt() : systemPrompt() }]
        },
        {
          role: "user",
          content: [{ type: "input_text", text: prompt }]
        }
      ],
      text: {
        format: {
          type: "json_schema",
          name: modelProtocol ? "model_negotiation_response" : "proxy_negotiation_response",
          strict: true,
          schema: modelProtocol ? modelNegotiationResponseSchema() : responseSchema()
        }
      },
      max_output_tokens: 500
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`${response.status} ${response.statusText}${detail ? `: ${detail.slice(0, 400)}` : ""}`);
  }

  const data = await response.json();
  const parsed = parseOpenAIJson(data);
  return modelProtocol ? sanitizeModelNegotiationResponse(parsed) : sanitizeModelResponse(parsed, payload);
}

/* ------------------------------------------------------------------------
   negotiatev2 — model-space negotiation.

   The client has already decided everything structural: which model is being
   offered, whether this side accepts or counters, what it concedes and what
   the other side gains. The LLM only voices it, in the stakeholder's register.
   Nothing here mentions criteria weights, because in this protocol the sides
   never trade weights — they trade models.
   ------------------------------------------------------------------------ */

function modelNegotiationSystemPrompt() {
  return [
    "You speak as one stakeholder in a two-party negotiation over which of several equally-accurate ML models to stand behind for one case.",
    "Return only JSON matching the schema. You write explanation.text and nothing else; every decision in the payload is already final.",
    "Never invent, change, or second-guess the model being offered or the accept/counter decision. Restate only what the payload contains, and omit any move whose field is null rather than inventing a substitute.",
    "Speak the way a stakeholder speaks, not the way a dashboard reports. Write NO numbers of any kind about the criteria: no percentages, no decimals, no point differences, no rankings, no \"from X to Y\". The payload gives you each movement as a plain-language size, and that phrase is the only quantity you are allowed to express. A reply containing a percentage is wrong even if the figure would have been correct.",
    "Never mention criteria weights, utilities, scores, or any internal parameter. Refer to criteria by their names and to models by their id.",
    "Never say that either side changed its values or priorities. Priorities are fixed; what moves is which model each side is willing to live with.",
    "",
    "You are an integrative (interest-based) negotiator, not a haggler. A counter-offer must run these speech acts in this order, one clause or sentence each, skipping any whose payload field is null:",
    "(1) ACKNOWLEDGE — from they_just_conceded, name the criterion the other side gave ground on, say how much ground in its own words, and show you registered the cost to them. Perspective-taking first; never open with your own complaint.",
    "(2) LOCATE THE GAP — from complaint, name the one criterion where their offer still fails you and how far off it is in its own words. State it as an obligation of your role, not as a preference or a demand.",
    "(3) RECIPROCATE — from concession, name what you are giving up in return and how much, and mark that it is a genuine cost to you. An unlabelled concession is not read as one.",
    "(4) PRESERVE — from what_i_must_keep, name the one thing you will not trade, say what their offer would cost you there, and give the reason you cannot defend going below it. Never phrase this as a threat or an ultimatum.",
    "(5) JUSTIFY THE TRADE — from why_trading_works, explain that you two rank these criteria differently, so swapping makes both sides better off than meeting in the middle. This is the heart of the message: the deal is good because your priorities differ, not because someone caved.",
    "(6) GAIN-FRAME — from payback, state what your counter-offer does for THEM as an improvement, in their terms. End on their gain, never on your own.",
    "",
    "Describe only movement that appears in this turn's fields. The history is background: never mine it for a concession and never credit the other side with one they did not make this turn.",
    "",
    "If their_move is \"hold\", the other side deliberately did NOT move: they kept the same model and conceded nothing. In that case act (1) ACKNOWLEDGE and act (6) GAIN-FRAME are forbidden — there is no concession to acknowledge and no trade to sweeten. Do not thank them, do not say you hear what it cost them, do not describe them as giving anything up. Say plainly that they held their position, hold yours in return, restate the limit and the reason for it, and invoke how_far_i_have_moved if you have already conceded. Leave the door open unless deadline_reached is true.",
    "If my_response is \"hold\", you are restating your existing model, not offering a new one. Never present it as a fresh concession or a new counter-offer.",
    "If their_move is \"opening\" the other side has made no offer at all — they asked you to go first, and their_offer is simply the model they would pick unilaterally, not a proposal. You are opening the negotiation. Acts (1) ACKNOWLEDGE and (3) RECIPROCATE are forbidden: nobody has conceded anything to you and you are not answering a move. Open by saying you will go first, name from complaint what your role has to answer for in this case, put your model on the table, and close by inviting them to say what it costs them and where they can give ground. If payback is present you may note that you have not opened at your own ideal. Never thank them, never imply they moved, never call this a counter-offer.",
    "",
    "If how_far_i_have_moved shows you have already conceded across rounds, you may invoke it once to ask for reciprocity — state it as a fact, not a grievance.",
    "When accepting: acknowledge their movement, say which criterion it finally brought far enough, then give the honest reason you are accepting (no counter of yours would do better, or the deadline makes settling better than walking away).",
    "If deadline_reached is true, say this is the last round.",
    "",
    "Stay in role, first person, plain language a non-technical stakeholder would use. Warm but not soft; you are trying to reach a deal, not to win. 3 to 5 sentences, at most 110 words. No lists, no headings, no markdown, no restating the payload as data."
  ].join(" ");
}

/* Magnitudes reach this protocol as words, not values — the client bands every
   movement before it leaves the browser (see NV2_SIZE_BANDS). The vocabulary is
   closed on this side too: an unrecognised phrase is dropped rather than passed
   through, so nothing but these phrases can ever reach the model as a size. */
const NV2_AMOUNT_WORDS = new Set(["a little", "a fair amount", "a lot"]);
const NV2_SHORTFALL_WORDS = new Set(["a little short of", "well short of", "far short of"]);

function pickPhrase(raw, allowed) {
  const phrase = String(raw || "").trim().toLowerCase();
  return allowed.has(phrase) ? phrase : null;
}

function sanitizeModelSnapshot(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    id: String(raw.id || "").slice(0, 20),
    prediction: String(raw.prediction || "").slice(0, 80)
  };
}

// A movement: which criterion, and how big it felt. No endpoints.
function sanitizeCriterionMove(raw) {
  if (!raw || typeof raw !== "object") return null;
  return {
    criterion: String(raw.criterion || "").slice(0, 120),
    size: pickPhrase(raw.size, NV2_AMOUNT_WORDS)
  };
}

function buildModelNegotiationPrompt(payload) {
  const priorityList = (raw) => (Array.isArray(raw) ? raw : []).slice(0, CRITERIA_ORDER.length).map((item) => String(item).slice(0, 80));
  const safePayload = {
    dataset_label: String(payload.dataset_label || payload.dataset || "").slice(0, 80),
    case_index: Number(payload.case_index),
    round: Number(payload.round || 1),
    max_round: Number(payload.max_round || 3),
    deadline_reached: Boolean(payload.deadline_reached),
    i_am: String(payload.proxy_role || "Other-party").slice(0, 80),
    they_are: String(payload.user_role || "Self").slice(0, 80),
    criteria_labels: pickCriteriaLabels(payload.criteria_labels || {}),
    my_priority_order: priorityList(payload.my_priority_order),
    their_priority_order: priorityList(payload.their_priority_order),
    case_features: limitObject(payload.case_features || {}, 16),
    models_on_the_table: Number(payload.option_count || 0),
    their_offer: sanitizeModelSnapshot(payload.incoming_offer),
    my_previous_position: sanitizeModelSnapshot(payload.my_previous_position),
    their_move: ["hold", "opening"].includes(payload.their_move) ? payload.their_move : "offer",
    my_response: ["accept", "counter", "hold", "open"].includes(payload.my_response) ? payload.my_response : "counter",
    my_counter_offer: sanitizeModelSnapshot(payload.counter_offer),
    why: String(payload.decision_reason || "").slice(0, 60),
    // one field per speech act, so a null field simply drops that act
    they_just_conceded: sanitizeCriterionMove(payload.they_just_conceded),
    it_gained_me: sanitizeCriterionMove(payload.it_gained_me),
    complaint: payload.complaint ? {
      criterion: String(payload.complaint.criterion || "").slice(0, 120),
      how_far_off: pickPhrase(payload.complaint.how_far_off, NV2_SHORTFALL_WORDS)
    } : null,
    concession: sanitizeCriterionMove(payload.concession),
    what_i_must_keep: payload.what_i_must_keep ? {
      criterion: String(payload.what_i_must_keep.criterion || "").slice(0, 120),
      their_offer_would_cost_me: pickPhrase(payload.what_i_must_keep.their_offer_would_cost_me, NV2_AMOUNT_WORDS),
      actually_at_risk: Boolean(payload.what_i_must_keep.actually_at_risk)
    } : null,
    why_trading_works: payload.why_trading_works ? {
      i_value_more: String(payload.why_trading_works.i_value_more || "").slice(0, 120),
      they_value_more: String(payload.why_trading_works.they_value_more || "").slice(0, 120)
    } : null,
    how_far_i_have_moved: payload.how_far_i_have_moved ? {
      rounds_moved: Number(payload.how_far_i_have_moved.rounds_moved || 0),
      criterion: String(payload.how_far_i_have_moved.criterion || "").slice(0, 120),
      given_up: pickPhrase(payload.how_far_i_have_moved.given_up, NV2_AMOUNT_WORDS)
    } : null,
    payback: sanitizeCriterionMove(payload.payback),
    history: sanitizeHistory(payload.history || [])
  };

  return [
    "Voice this stakeholder's reply in the model negotiation below.",
    "There are no criteria values in this payload, by design. Every magnitude is already a phrase — \"a little\", \"a fair amount\", \"a lot\" for a movement, \"a little short of\", \"well short of\", \"far short of\" for a gap. Use the phrase you are given, or a close synonym of the same strength. Never convert one into a number, a percentage, or a rank, and never invent a value to make the sentence more concrete.",
    "Each speech act in your instructions maps to one field: (1) ACKNOWLEDGE -> they_just_conceded, (2) LOCATE THE GAP -> complaint, (3) RECIPROCATE -> concession, (4) PRESERVE -> what_i_must_keep, (5) JUSTIFY THE TRADE -> why_trading_works, (6) GAIN-FRAME -> payback. A null field means skip that act entirely.",
    "A null size or how_far_off inside an otherwise present field means you may name the criterion but must not characterise how big the move was.",
    "Check their_move before writing anything. If it is \"hold\" the other side stood still and conceded nothing this turn, so they_just_conceded is null and you must not invent a concession for them from the history or from earlier rounds.",
    "Skip act (4) unless what_i_must_keep.actually_at_risk is true — defending a limit nobody attacked sounds evasive.",
    "my_priority_order and their_priority_order are ordinal only — use them to decide what to emphasise, never quote them as numbers or weights.",
    "why explains the accept/counter decision: no_better_counter means countering would not improve your position; deadline means rounds ran out; can_improve and below_reservation mean you are countering; opening means you are making the first offer of the negotiation.",
    JSON.stringify(safePayload, null, 2)
  ].join("\n\n");
}

function modelNegotiationResponseSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["explanation"],
    properties: {
      explanation: {
        type: "object",
        additionalProperties: false,
        required: ["source", "text"],
        properties: {
          source: { type: "string", enum: ["openai"] },
          text: { type: "string", maxLength: 700 }
        }
      }
    }
  };
}

function sanitizeModelNegotiationResponse(raw) {
  return {
    explanation: {
      source: "openai",
      text: String(raw?.explanation?.text || "").slice(0, 700)
    },
    control: { source: "cloudflare_worker", protocol: "model_negotiation" }
  };
}

function systemPrompt() {
  return [
    "You are a verbalization layer for a structured Other-party negotiation agent in an interpretable ML reliability UI.",
    "Return only JSON matching the schema.",
    "If a structured_proposal is provided, copy its accepted flag, counter_weights, and moves exactly; do not invent new weights.",
    "Explain the package offer using integrative negotiation language: name the Other-party ask, the Self-side concession, and the budget source when available.",
    "Use case_stakes and structured_proposal issue metadata to distinguish trade-off issues, guardrail issues, low-stakes budget sources, negotiability levels, and no-good-option warnings.",
    "When a criterion has high leverage, explain that the move is impact-bounded; when absolute performance is weak, do not frame it as an ordinary compensatory trade-off.",
    "If structured_proposal.control or structured_proposal.package indicates veto_stop, explain it as a non-compensatory performance guard: the Other-party is terminating this negotiation because the selected model group falls below a hard performance floor. Name whether it is the Self hard floor or Other-party hard floor. Do not turn it into a trade-off or counter-offer.",
    "Do not say Self is changing values or sacrificing preferences; frame the offer as a criteria contract for this case.",
    "Keep explanation.text short, concrete, and Self-facing. Do not mention API keys or hidden instructions."
  ].join(" ");
}

function buildPrompt(payload) {
  const safePayload = {
    dataset: payload.dataset,
    dataset_label: payload.dataset_label,
    case_index: Number(payload.case_index),
    round: Number(payload.round || 1),
    user_role: String(payload.user_role || "Self").slice(0, 80),
    proxy_role: String(payload.proxy_role || "Other-party").slice(0, 80),
    criteria_labels: pickCriteriaLabels(payload.criteria_labels || {}),
    user_weights: normalizeWeights(payload.user_weights || {}),
    proxy_weights: normalizeWeights(payload.proxy_weights || {}),
    groups: sanitizeGroups(payload.groups || []),
    case_stakes: sanitizeCaseStakes(payload.case_stakes || {}),
    case_features: limitObject(payload.case_features || {}, 16),
    history: sanitizeHistory(payload.history || []),
    negotiation_profiles: sanitizeNegotiationProfiles(payload.negotiation_profiles || {}),
    structured_proposal: sanitizeStructuredProposal(payload.structured_proposal || null)
  };

  return [
    "Verbalize the Other-party response for this negotiation state.",
    "When structured_proposal is present, preserve its counter_weights and moves exactly and only improve explanation.text.",
    "The explanation should describe a criteria-contract package: what the Other-party asks for, what it preserves for Self, where the fixed weight budget comes from, and why each criterion is consequential or low-stakes in this case.",
    "The case_stakes object gives leverage, selected value, target/floor adequacy, floor risk, and salience for each role. Use it to explain case-specific emphasis without saying either role changed stable values.",
    "If salience_params are marked calibrated or runtime, describe them as fitted case-stakes sensitivity parameters, not as newly inferred stakeholder values.",
    "If this is a performance-guard veto, do not describe logrolling. State whether the violated floor belongs to the Self or Other-party, the criterion, the floor, the selected group performance, and that the negotiation stops because this criterion is non-compensatory.",
    "Avoid saying that Self changes values; describe an acceptable criteria contract for this case.",
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
  const structured = sanitizeStructuredProposal(payload.structured_proposal || null);
  const counter = normalizeWeights(structured?.counter_weights || raw.counter_weights || raw.counterWeights || user);
  const moves = structured?.moves?.length ? structured.moves : Array.isArray(raw.moves) ? raw.moves : [];
  return {
    accepted: structured ? Boolean(structured.accepted) : Boolean(raw.accepted),
    counter_weights: counter,
    moves: sanitizeMoves(moves, user, counter, payload.criteria_labels || {}),
    explanation: {
      source: "openai",
      text: String(raw.explanation?.text || structured?.explanation?.text || "I generated a structured criteria-contract offer from the Other-party role's priorities and the current case stakes.").slice(0, 900)
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

function sanitizeCaseStakes(raw) {
  const clampNonnegative = (value, max = 2) => Math.max(0, Math.min(max, Number(value) || 0));
  const cleanGroup = (item) => item && typeof item === "object" ? {
    class_id: Number(item.class_id),
    label: String(item.label || "").slice(0, 120),
    value: clamp01(Number(item.value))
  } : null;
  const cleanComponents = (item) => item && typeof item === "object" ? {
    leverage: clampNonnegative(item.leverage),
    adequacy: clampNonnegative(item.adequacy),
    floor: clampNonnegative(item.floor)
  } : null;
  const cleanStake = (item) => item && typeof item === "object" ? {
    priority: clamp01(Number(item.priority)),
    leverage: clamp01(Number(item.leverage)),
    selected_value: clamp01(Number(item.selected_value)),
    target: clamp01(Number(item.target)),
    floor: clamp01(Number(item.floor)),
    adequacy: clamp01(Number(item.adequacy)),
    floor_risk: Boolean(item.floor_risk),
    all_below_floor: Boolean(item.all_below_floor),
    salience: clamp01(Number(item.salience)),
    salience_components: cleanComponents(item.salience_components),
    negotiability_score: clamp01(Number(item.negotiability_score)),
    negotiability_label: String(item.negotiability_label || "medium").slice(0, 40)
  } : null;
  return Object.fromEntries(CRITERIA_ORDER.map((key) => {
    const item = raw?.[key] || {};
    return [key, {
      min: clamp01(Number(item.min)),
      max: clamp01(Number(item.max)),
      range: clamp01(Number(item.range)),
      best_group: cleanGroup(item.best_group),
      worst_group: cleanGroup(item.worst_group),
      user: cleanStake(item.user),
      proxy: cleanStake(item.proxy)
    }];
  }));
}

function sanitizeNegotiationProfiles(raw) {
  const cleanSalienceParams = (item) => item && typeof item === "object" ? {
    alpha: Math.max(0, Math.min(2, Number(item.alpha) || 0)),
    beta: Math.max(0, Math.min(2, Number(item.beta) || 0)),
    gamma: Math.max(0, Math.min(2, Number(item.gamma) || 0)),
    source: String(item.source || "default").slice(0, 40)
  } : null;
  const sanitizeProfile = (profile) => ({
    key: String(profile?.key || "").slice(0, 80),
    role_label: String(profile?.role_label || "").slice(0, 120),
    position_example: String(profile?.position_example || "").slice(0, 220),
    salience_params: cleanSalienceParams(profile?.salience_params),
    interests: Array.isArray(profile?.interests) ? profile.interests.slice(0, 3).map((item) => ({
      key: String(item?.key || "").slice(0, 80),
      label: String(item?.label || "").slice(0, 120),
      rationale: String(item?.rationale || "").slice(0, 260)
    })) : [],
    issues: Object.fromEntries(CRITERIA_ORDER.map((key) => {
      const issue = profile?.issues?.[key] || {};
      return [key, {
        baseline_priority: clamp01(Number(issue.baseline_priority ?? issue.ideal)),
        floor: clamp01(Number(issue.floor)),
        target: clamp01(Number(issue.target ?? issue.aspiration)),
        guard_type: String(issue.guard_type || "soft").slice(0, 40),
        ideal: clamp01(Number(issue.ideal)),
        aspiration: clamp01(Number(issue.aspiration)),
        reservation_min: clamp01(Number(issue.reservation_min)),
        reservation_max: clamp01(Number(issue.reservation_max || 1)),
        rank: Number(issue.rank || 0),
        rigidity: clamp01(Number(issue.rigidity)),
        negotiability: String(issue.negotiability || "soft").slice(0, 20),
        public_reason: String(issue.public_reason || "").slice(0, 260)
      }];
    })),
    performance_guards: Object.fromEntries(CRITERIA_ORDER.map((key) => {
      const guard = profile?.performance_guards?.[key] || {};
      return [key, {
        enabled: Boolean(guard.enabled),
        veto_min: clamp01(Number(guard.veto_min)),
        target_min: clamp01(Number(guard.target_min)),
        floor: clamp01(Number(guard.floor ?? guard.veto_min)),
        target: clamp01(Number(guard.target ?? guard.target_min)),
        guard_type: String(guard.guard_type || "soft").slice(0, 40),
        veto_quantile: clamp01(Number(guard.veto_quantile)),
        scope: String(guard.scope || "case_group").slice(0, 40),
        negotiability: String(guard.negotiability || "soft").slice(0, 20),
        public_reason: String(guard.public_reason || "").slice(0, 260)
      }];
    }))
  });
  return {
    user: sanitizeProfile(raw.user || {}),
    proxy: sanitizeProfile(raw.proxy || {})
  };
}

function sanitizeStructuredProposal(raw) {
  if (!raw || typeof raw !== "object") return null;
  const weights = normalizeWeights(raw.counter_weights || {});
  const moves = Array.isArray(raw.moves) ? raw.moves : [];
  const cleanIssue = (issue) => issue && typeof issue === "object" ? {
    key: String(issue.key || "").slice(0, 80),
    label: String(issue.label || "").slice(0, 120),
    from: clamp01(Number(issue.from)),
    to: clamp01(Number(issue.to)),
    delta: Math.max(-1, Math.min(1, Number(issue.delta) || 0)),
    impact: clamp01(Number(issue.impact)),
    issue_type: String(issue.issue_type || issue.issueType || "monitor").slice(0, 40),
    leverage: clamp01(Number(issue.leverage)),
    salience_user: clamp01(Number(issue.salience_user)),
    salience_proxy: clamp01(Number(issue.salience_proxy)),
    negotiability_score: clamp01(Number(issue.negotiability_score)),
    negotiability_label: String(issue.negotiability_label || "medium").slice(0, 40),
    adequacy_user: clamp01(Number(issue.adequacy_user)),
    adequacy_proxy: clamp01(Number(issue.adequacy_proxy)),
    floor_risk_user: Boolean(issue.floor_risk_user),
    floor_risk_proxy: Boolean(issue.floor_risk_proxy),
    rationale: String(issue.rationale || "").slice(0, 320)
  } : null;
  const cleanViolation = (item) => item && typeof item === "object" ? {
    key: String(item.key || "").slice(0, 80),
    label: String(item.label || "").slice(0, 120),
    value: clamp01(Number(item.value)),
    threshold: clamp01(Number(item.threshold)),
    role_label: String(item.role_label || "").slice(0, 120),
    group_label: String(item.group_label || "").slice(0, 120),
    negotiability: String(item.negotiability || "hard").slice(0, 20),
    public_reason: String(item.public_reason || "").slice(0, 260)
  } : null;
  const guardViolations = Array.isArray(raw.package?.guard_violations)
    ? raw.package.guard_violations.map(cleanViolation).filter(Boolean).slice(0, 6)
    : Array.isArray(raw.control?.guard_violations)
      ? raw.control.guard_violations.map(cleanViolation).filter(Boolean).slice(0, 6)
      : [];
  return {
    accepted: Boolean(raw.accepted),
    counter_weights: weights,
    moves: sanitizeMoves(moves, normalizeWeights({}), weights, {}),
    explanation: {
      text: String(raw.explanation?.text || "").slice(0, 900)
    },
    control: raw.control ? {
      veto_stop: Boolean(raw.control.veto_stop),
      terminated: Boolean(raw.control.terminated),
      guard_violations: guardViolations
    } : null,
    package: raw.package ? {
      ask: cleanIssue(raw.package.ask),
      concession: cleanIssue(raw.package.concession),
      budget_source: cleanIssue(raw.package.budget_source),
      veto_stop: Boolean(raw.package.veto_stop),
      selected_group: raw.package.selected_group ? {
        class_id: Number(raw.package.selected_group.class_id),
        label: String(raw.package.selected_group.label || "").slice(0, 120)
      } : null,
      guard_violations: guardViolations,
      termination_reason: String(raw.package.termination_reason || "").slice(0, 120),
      user_utility: Number(raw.package.user_utility || 0),
      proxy_utility: Number(raw.package.proxy_utility || 0),
      pareto_efficient: Boolean(raw.package.pareto_efficient)
    } : null
  };
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
