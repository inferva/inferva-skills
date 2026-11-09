// Thin readers for INFERVA's public, unauthenticated routes. Every helper takes an optional `fetch`
// so it can be tested offline and used from any runtime.

import type { Params } from "./protocol.js";

export const DEFAULT_BASE_URL = "https://dapp.inferva.xyz";

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;
export type ApiOptions = { baseUrl?: string; fetch?: Fetch };

export class InfervaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message);
    this.name = "InfervaApiError";
  }
}

const base = (o?: ApiOptions) => (o?.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");

export async function getJson<T>(path: string, o?: ApiOptions): Promise<T> {
  const f = o?.fetch ?? (globalThis.fetch as Fetch);
  const res = await f(`${base(o)}${path}`, { headers: { accept: "application/json" } });
  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: string | { message?: string } };
      detail = typeof body.error === "string" ? body.error : (body.error?.message ?? "");
    } catch {
      /* not JSON */
    }
    throw new InfervaApiError(`GET ${path} returned ${res.status}${detail ? `: ${detail}` : ""}`, res.status, path);
  }
  return (await res.json()) as T;
}

export type ParamInfo = Record<string, { label: string; kind: "bps" | "amount" | "seconds" | "count"; governable: boolean }>;

/** Live protocol parameters (governable values change through proposals). */
export async function fetchParams(o?: ApiOptions): Promise<{ params: Params; info: ParamInfo }> {
  return getJson("/api/params", o);
}

export type ModelEntry = { id: string; object: "model"; owned_by: string; description?: string; price_per_1k_usdg?: number };

/** `auto` plus every model an active provider serves. */
export async function fetchModels(o?: ApiOptions): Promise<ModelEntry[]> {
  return (await getJson<{ data: ModelEntry[] }>("/v1/models", o)).data;
}

export type ProviderModelPrice = { model: string; price_in: number; price_out: number };
export type ProviderEntry = {
  id: string;
  name: string;
  status: string;
  weight: number;
  routable: boolean;
  created_at: number;
  /** Per-model prices, micro USDG per 1M tokens, input and output. */
  model_prices: ProviderModelPrice[];
};

/** Registered providers with their per-model input/output prices and routing weight. */
export async function fetchProviders(o?: ApiOptions): Promise<ProviderEntry[]> {
  return getJson("/api/providers", o);
}

export type EndpointLimits = { maxMessages: number; maxCharsPerMessage: number; maxOutputTokens: number };
export type Catalog = { models: unknown[]; fee_bps: number; limits: EndpointLimits; window_days: number };

/** The model catalog; its `limits` are the hard limits the endpoint enforces. */
export async function fetchCatalog(o?: ApiOptions): Promise<Catalog> {
  return getJson("/api/agents/catalog", o);
}

/**
 * Live gateway load. Every caller shares one lane: requests are admitted while the load (admitted requests in the
 * last minute) is under capacity, and deferred with a 429 and Retry-After above it.
 */
export type NetworkState = {
  capacity: number;
  load: number;
  attempts: number;
  congested: boolean;
  admitted: number;
  deferred: number;
  minutes: { minute: number; admitted: number; deferred: number }[];
  activeProviders: number;
  routableProviders: number;
};

/** Live congestion meter: load over the last minute against capacity. */
export async function fetchNetwork(o?: ApiOptions): Promise<NetworkState> {
  return getJson("/api/network", o);
}

export type ChainRecord = {
  seq: number;
  id: string;
  payer: string;
  provider: string;
  model: string;
  tokens: number;
  base: number;
  /** Hashed. 0 on current records; older records may carry a value. */
  discount: number;
  fee: number;
  /** Legacy column, not hashed. 0 on current records. */
  to_stakers: number;
  to_sponsor: number;
  to_treasury: number;
  capacity_id: string;
  /** Legacy column, not hashed. 0 on current records. */
  priority: number;
  epoch: number;
  prev_hash: string;
  hash: string;
  created_at: number;
};

export type Receipt = {
  record: ChainRecord & { provider_name: string; prompt_tokens: number | null; completion_tokens: number | null };
  prev: { seq: number; id: string; hash: string } | null;
  next: { seq: number; id: string; prev_hash: string } | null;
  genesis: string;
};

/** One settlement record with its neighbours, so both links can be checked. */
export async function fetchReceipt(id: string, o?: ApiOptions): Promise<Receipt> {
  return getJson(`/api/receipts/${encodeURIComponent(id)}`, o);
}

/** A page of the settlement chain in order, starting after `after` (a seq). */
export async function fetchChainPage(after = 0, limit = 200, o?: ApiOptions): Promise<{ genesis: string; records: ChainRecord[] }> {
  return getJson(`/api/chain?after=${after}&limit=${limit}`, o);
}
