// Mirrors of the INFERVA protocol math. Every number comes from live parameters (GET /api/params);
// nothing here hardcodes a fee or a fee share.

/** All on-ledger amounts are integers in micro units: 1 USDG (or 1 INFER) = 1_000_000. */
export const UNIT = 1_000_000;

export type Params = {
  fee_bps: number;
  /** Share of the protocol fee that goes to the capacity sponsor. The treasury takes the rest. */
  sponsor_share_bps: number;
  epoch_seconds: number;
  congestion_capacity_rpm: number;
  [key: string]: number;
};

/** Requests per minute each paying account may send. The same for every account. */
export const RATE_PER_MIN = 10;

export type Quote = {
  base: number;
  fee: number;
  toSponsor: number;
  toTreasury: number;
  total: number;
};

/**
 * Split of one request, exactly as the endpoint computes it. `pricePer1k` is micro USDG per 1,000 tokens.
 * The agent pays the provider cost plus the protocol fee on top; the fee goes to the capacity sponsor and the
 * treasury takes the remainder.
 */
export function quote(tokens: number, pricePer1k: number, p: Params): Quote {
  const base = Math.ceil((tokens * pricePer1k) / 1000);
  const fee = Math.ceil((base * p.fee_bps) / 10_000);
  const toSponsor = Math.floor((fee * p.sponsor_share_bps) / 10_000);
  const toTreasury = fee - toSponsor;
  return { base, fee, toSponsor, toTreasury, total: base + fee };
}

export const toUsdg = (micro: number) => micro / UNIT;
export const toMicro = (usdg: number) => Math.round(usdg * UNIT);

/** Fields of a settlement record that its hash covers. */
export type SettlementFields = {
  id: string;
  payer: string;
  provider: string;
  model: string;
  tokens: number;
  base: number;
  /** 0 on current records. It stays in the hash, so older records that carry a value still verify. */
  discount: number;
  fee: number;
  capacity_id: string;
  epoch: number;
  created_at: number;
};

/** Canonical string each settlement record hashes, chained to the previous record. Same order as the protocol. */
export function settlementPayload(r: SettlementFields, prevHash: string) {
  return [prevHash, r.id, r.payer, r.provider, r.model, r.tokens, r.base, r.discount, r.fee, r.capacity_id, r.epoch, r.created_at].join("|");
}

export async function sha256Hex(text: string) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
