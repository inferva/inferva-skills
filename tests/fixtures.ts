// Fixtures for offline tests only. They are not live INFERVA values; skills always read /api/params live.
import type { ChainRecord, EndpointLimits, ProviderEntry, Receipt } from "../src/api.js";
import type { Params } from "../src/protocol.js";

export const PARAMS: Params = {
  fee_bps: 1000,
  sponsor_share_bps: 8000,
  epoch_seconds: 3600,
  congestion_capacity_rpm: 600,
};

export const LIMITS: EndpointLimits = { maxMessages: 20, maxCharsPerMessage: 8000, maxOutputTokens: 1024 };

export const PROVIDERS: ProviderEntry[] = [
  { id: "prv_a", name: "Provider A", status: "active", weight: 100, routable: true, created_at: 0, model_prices: [{ model: "a-large", price_in: 3_000_000, price_out: 3_000_000 }] },
  { id: "prv_b", name: "Provider B", status: "active", weight: 100, routable: true, created_at: 1, model_prices: [{ model: "b-fast", price_in: 1_000_000, price_out: 2_600_000 }, { model: "b-mini", price_in: 2_000_000, price_out: 2_000_000 }] },
  { id: "prv_c", name: "Provider C", status: "active", weight: 50, routable: true, created_at: 2, model_prices: [{ model: "c-cheap", price_in: 1_000_000, price_out: 1_000_000 }] },
  { id: "prv_off", name: "Paused", status: "paused", weight: 100, routable: false, created_at: 3, model_prices: [{ model: "off", price_in: 1, price_out: 1 }] },
];

const GENESIS = "0".repeat(64);

/**
 * A real record from the public settlement log (seq 1), used as a known-good hash vector. It was settled while the
 * sponsor share was 40% of the fee (14 of 35); `discount`, `to_stakers` and `priority` are 0 as on every current record.
 */
export const RECORD_1: ChainRecord = {
  seq: 1,
  id: "req_b3554939b912de693875",
  payer: "0xc8164417c6a05a9bae75c26faca83a97bcc39e34",
  provider: "prv_basalt",
  model: "basalt-70b",
  tokens: 192,
  base: 346,
  discount: 0,
  fee: 35,
  to_stakers: 0,
  to_sponsor: 14,
  to_treasury: 21,
  capacity_id: "cap_3cf3b9fd84ba",
  priority: 0,
  epoch: 498374,
  prev_hash: GENESIS,
  hash: "47eaac5d4a736c64788462012ef0554f9d7fb55a7561381d969d2ec0d6347dd4",
  created_at: 1794147157318,
};

export const receiptFor = (record: ChainRecord, prev: Receipt["prev"] = null, next: Receipt["next"] = null): Receipt => ({
  record: { ...record, provider_name: "Basalt Inference", prompt_tokens: null, completion_tokens: null },
  prev,
  next,
  genesis: GENESIS,
});

export { GENESIS };

/** A fetch stub that serves JSON by path (query string included) and records what was requested. */
export function mockFetch(routes: Record<string, unknown | ((url: URL) => unknown)>) {
  const calls: string[] = [];
  const fetch = async (input: string) => {
    const url = new URL(input);
    calls.push(url.pathname + url.search);
    const hit = routes[url.pathname + url.search] ?? routes[url.pathname];
    if (hit === undefined) return new Response(JSON.stringify({ error: "Not found" }), { status: 404 });
    const body = typeof hit === "function" ? (hit as (u: URL) => unknown)(url) : hit;
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
  };
  return { fetch, calls };
}
