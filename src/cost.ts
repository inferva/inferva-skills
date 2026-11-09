// Cost before and after a request: the worst-case pre-check the endpoint runs, and the `inferva` block it returns.

import type { EndpointLimits, ProviderEntry } from "./api.js";
import { quote, toMicro, toUsdc, type Params, type Quote } from "./protocol.js";

export type ChatMessage = { role?: string; content?: unknown };

export type Route = {
  providerId: string;
  providerName: string;
  model: string;
  /** micro USDC per 1M tokens */
  priceIn: number;
  priceOut: number;
  /** Highest per-1k price the route can charge (micro USDC), used by the worst-case check. */
  worstPer1k: number;
  /** Effective per-1k price for an actual input/output split. */
  priceFor: (promptTokens: number, completionTokens: number) => number;
};

/**
 * Pick the provider and model the endpoint would route to. `auto` takes the best scored model across routable
 * providers; a model id takes the best scored provider serving it. Score = blended price × (100 / weight), lowest wins.
 * `allowed` narrows `auto` to a key's allowed-models list.
 */
export function routeFor(wanted: string, providers: readonly ProviderEntry[], allowed?: readonly string[] | null): Route | null {
  const want = wanted.toLowerCase();
  const allow = allowed?.length ? new Set(allowed.map((m) => m.toLowerCase())) : null;
  const ordered = [...providers].filter((p) => p.routable && p.status === "active" && p.weight > 0).sort((a, b) => a.created_at - b.created_at);
  let best: { p: ProviderEntry; model: string; price_in: number; price_out: number; score: number } | null = null;
  for (const p of ordered)
    for (const m of p.model_prices ?? []) {
      if (want !== "auto" && m.model !== want) continue;
      if (want === "auto" && allow && !allow.has(m.model)) continue;
      const score = ((m.price_in + m.price_out) / 2) * (100 / p.weight);
      if (!best || score < best.score) best = { p, model: m.model, price_in: m.price_in, price_out: m.price_out, score };
    }
  if (!best) return null;
  const { price_in, price_out } = best;
  return {
    providerId: best.p.id,
    providerName: best.p.name,
    model: best.model,
    priceIn: price_in,
    priceOut: price_out,
    worstPer1k: Math.max(price_in, price_out) / 1000,
    priceFor: (pt, ct) => (pt + ct > 0 ? (pt * price_in + ct * price_out) / (pt + ct) / 1000 : price_in / 1000),
  };
}

const textOf = (content: unknown) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((part) => (typeof (part as { text?: unknown })?.text === "string" ? (part as { text: string }).text : "")).join(" ")
      : "";

/** The messages the endpoint actually uses: the last `maxMessages`, each cut to `maxCharsPerMessage`, empty ones dropped. */
export function prepareMessages(messages: readonly ChatMessage[], limits: EndpointLimits) {
  return messages
    .slice(-limits.maxMessages)
    .map((m) => ({ role: m.role === "assistant" ? "assistant" : "user", content: textOf(m.content).slice(0, limits.maxCharsPerMessage) }))
    .filter((m) => m.content);
}

export type WorstCaseInput = { messages: readonly ChatMessage[]; model?: string; max_tokens?: number };
export type WorstCaseContext = {
  params: Params;
  providers: readonly ProviderEntry[];
  limits: EndpointLimits;
  /** The key owner's tier discount. Default 0, which overstates the cost slightly for staked owners. */
  discountBps?: number;
  /** The key's allowed-models list, if it has one. */
  allowed?: readonly string[] | null;
};

export type WorstCase = {
  route: Omit<Route, "priceFor">;
  maxTokens: number;
  promptChars: number;
  /** Tokens the endpoint assumes for the check: ceil(prompt chars / 3) + max_tokens. */
  worstTokens: number;
  quote: Quote;
  /** USDC the key owner must hold (and a capped key must have left this month) for the request to be accepted. */
  worstTotalUsdc: number;
  notes: string[];
};

/** Reproduce the endpoint's pre-generation check: the most this request can cost. */
export function estimateWorstCase(input: WorstCaseInput, ctx: WorstCaseContext): WorstCase {
  if (!Array.isArray(input.messages) || !input.messages.length) throw new Error("send a non-empty messages array");
  const msgs = prepareMessages(input.messages, ctx.limits);
  if (!msgs.length) throw new Error("messages have no text content (the endpoint returns 400)");
  const prompt = msgs.map((m) => m.content).join("\n");
  const maxOut = ctx.limits.maxOutputTokens;
  const maxTokens = Math.min(Math.max(Number(input.max_tokens) || maxOut, 1), maxOut);
  const wanted = String(input.model ?? "auto").toLowerCase();
  const notes: string[] = [];
  if (ctx.allowed?.length && wanted !== "auto" && !ctx.allowed.map((m) => m.toLowerCase()).includes(wanted))
    throw new Error(`this key may not use "${wanted}" (the endpoint returns 403 model_not_allowed)`);
  const route = routeFor(wanted, ctx.providers, wanted === "auto" ? ctx.allowed : null);
  if (!route) throw new Error(`no routable provider serves "${wanted}" (the endpoint returns 404 model_not_found)`);
  const worstTokens = Math.ceil(prompt.length / 3) + maxTokens;
  const discountBps = ctx.discountBps ?? 0;
  const q = quote(worstTokens, route.worstPer1k, discountBps, ctx.params);
  if (input.messages.length > ctx.limits.maxMessages) notes.push(`Only the last ${ctx.limits.maxMessages} messages are used.`);
  if (Number(input.max_tokens) > maxOut) notes.push(`max_tokens is capped at ${maxOut}.`);
  if (!ctx.discountBps) notes.push("No tier discount assumed; a staked key owner pays less.");
  notes.push("The final charge uses real token counts and is usually well below this worst case.");
  const { priceFor: _drop, ...routeInfo } = route;
  return { route: routeInfo, maxTokens, promptChars: prompt.length, worstTokens, quote: q, worstTotalUsdc: toUsdc(q.total), notes };
}

/** Expected cost for a known (or guessed) input/output split on a route. */
export function expectedCost(route: Route, promptTokens: number, completionTokens: number, discountBps: number, p: Params) {
  return quote(promptTokens + completionTokens, route.priceFor(promptTokens, completionTokens), discountBps, p);
}

export type InfervaBlock = {
  provider: string;
  priority: boolean;
  tier: string;
  cost_usdc: number;
  breakdown: { provider_cost: number; discount: number; protocol_fee: number; to_stakers: number; to_sponsor: number; to_treasury: number };
  capacity: string;
  epoch: number;
  settlement: { hash: string; prev_hash: string };
  receipt: string;
};

export type BlockExplanation = { ok: boolean; problems: string[]; lines: string[]; requestId: string | null };

/** Check the arithmetic of an `inferva` block and explain where the money went, in plain words. */
export function explainInfervaBlock(block: InfervaBlock): BlockExplanation {
  const b = block.breakdown;
  const problems: string[] = [];
  const m = { cost: toMicro(block.cost_usdc), base: toMicro(b.provider_cost), discount: toMicro(b.discount), fee: toMicro(b.protocol_fee) };
  const split = toMicro(b.to_stakers) + toMicro(b.to_sponsor) + toMicro(b.to_treasury);
  if (m.cost !== m.base - m.discount + m.fee) problems.push(`cost_usdc ${block.cost_usdc} ≠ provider_cost − discount + protocol_fee (${toUsdc(m.base - m.discount + m.fee)})`);
  if (split !== m.fee) problems.push(`to_stakers + to_sponsor + to_treasury (${toUsdc(split)}) ≠ protocol_fee ${b.protocol_fee}`);
  if (!/^[0-9a-f]{64}$/.test(block.settlement?.hash ?? "")) problems.push("settlement.hash is not 64 hex characters");
  if (!/^[0-9a-f]{64}$/.test(block.settlement?.prev_hash ?? "")) problems.push("settlement.prev_hash is not 64 hex characters");
  const lines = [
    `Charged ${block.cost_usdc} USDC: provider cost ${b.provider_cost} − ${block.tier} discount ${b.discount} + protocol fee ${b.protocol_fee}.`,
    `${block.provider} served it from sponsored capacity ${block.capacity}; the sponsor is repaid the provider cost and earns ${b.to_sponsor} of the fee.`,
    b.to_stakers > 0 ? `${b.to_stakers} USDC of the fee went to $INFER stakers.` : "Nothing went to stakers on this request (with no stake on the network, the staker share goes to the treasury).",
    `${b.to_treasury} USDC went to the treasury. Settled in epoch ${block.epoch}${block.priority ? " with the priority flag" : ""}.`,
    `Settlement hash ${block.settlement?.hash}, chained to ${block.settlement?.prev_hash}. Receipt: ${block.receipt}`,
  ];
  const id = /\/receipt\/([^/?#]+)/.exec(block.receipt ?? "")?.[1] ?? null;
  return { ok: problems.length === 0, problems, lines, requestId: id };
}
