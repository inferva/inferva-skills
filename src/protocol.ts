// Mirrors of the INFERVA protocol math. Every number comes from live parameters (GET /api/params);
// nothing here hardcodes a fee, a discount or a tier threshold.

/** All on-ledger amounts are integers in micro units: 1 USDC (or 1 INFER) = 1_000_000. */
export const UNIT = 1_000_000;

export type Params = {
  fee_bps: number;
  staker_share_bps: number;
  sponsor_share_bps: number;
  epoch_seconds: number;
  tier1_stake: number;
  tier2_stake: number;
  tier3_stake: number;
  tier1_discount_bps: number;
  tier2_discount_bps: number;
  tier3_discount_bps: number;
  congestion_capacity_rpm: number;
  congestion_threshold_bps: number;
  [key: string]: number;
};

export type TierLevel = 0 | 1 | 2 | 3;

export type TierInfo = {
  level: TierLevel;
  name: string;
  /** Minimum stake for this tier, micro INFER (0 for "No tier"). */
  minStake: number;
  discountBps: number;
  /** Priority routing flag, written to every settlement record. Set from Tier 2 up. */
  priority: boolean;
  /** Admission ceiling under congestion: requests admitted per minute network-wide before this tier is deferred. */
  congestionCeiling: number;
};

export const tierName = (level: number) => (level === 0 ? "No tier" : `Tier ${level}`);

/** Same formula as the gateway's admission gate: lower tiers are deferred first as load rises. */
export function tierCeiling(level: number, p: Pick<Params, "congestion_capacity_rpm" | "congestion_threshold_bps">) {
  const bps = p.congestion_threshold_bps + Math.floor(((10_000 - p.congestion_threshold_bps) * level) / 3);
  return Math.max(1, Math.floor((p.congestion_capacity_rpm * bps) / 10_000));
}

/** The four tiers, built from live parameters. */
export function tierLadder(p: Params): TierInfo[] {
  const stakes = [0, p.tier1_stake, p.tier2_stake, p.tier3_stake];
  const discounts = [0, p.tier1_discount_bps, p.tier2_discount_bps, p.tier3_discount_bps];
  return ([0, 1, 2, 3] as const).map((level) => ({
    level,
    name: tierName(level),
    minStake: stakes[level]!,
    discountBps: discounts[level]!,
    priority: level >= 2,
    congestionCeiling: tierCeiling(level, p),
  }));
}

/** The tier a stake (micro INFER) falls into. */
export function tierFor(staked: number, p: Params): TierInfo {
  const ladder = tierLadder(p);
  for (let i = 3; i >= 1; i--) if (staked >= ladder[i]!.minStake) return ladder[i]!;
  return ladder[0]!;
}

export type Quote = {
  base: number;
  discount: number;
  fee: number;
  toStakers: number;
  toSponsor: number;
  toTreasury: number;
  total: number;
};

/**
 * Split of one request, exactly as the endpoint computes it. `pricePer1k` is micro USDC per 1,000 tokens.
 * The agent pays provider cost minus its tier discount, plus the protocol fee on top of the provider cost.
 */
export function quote(tokens: number, pricePer1k: number, discountBps: number, p: Params): Quote {
  const base = Math.ceil((tokens * pricePer1k) / 1000);
  const discount = Math.floor((base * discountBps) / 10_000);
  const fee = Math.ceil((base * p.fee_bps) / 10_000);
  const toStakers = Math.floor((fee * p.staker_share_bps) / 10_000);
  const toSponsor = Math.floor((fee * p.sponsor_share_bps) / 10_000);
  const toTreasury = fee - toStakers - toSponsor;
  return { base, discount, fee, toStakers, toSponsor, toTreasury, total: base - discount + fee };
}

export const toUsdc = (micro: number) => micro / UNIT;
export const toMicro = (usdc: number) => Math.round(usdc * UNIT);

/** Fields of a settlement record that its hash covers. */
export type SettlementFields = {
  id: string;
  payer: string;
  provider: string;
  model: string;
  tokens: number;
  base: number;
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
