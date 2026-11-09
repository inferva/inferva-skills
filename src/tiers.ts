// Tier planning from live parameters: what stake moves an account to the next tier and what that changes.

import { tierFor, tierLadder, toUsdc, UNIT, type Params, type TierInfo } from "./protocol.js";

export type TierRow = TierInfo & {
  minStakeInfer: number;
  discountPct: number;
  /** Requests per minute, when known (from the docs or a 429 message). Not a governable parameter, so not in /api/params. */
  ratePerMin: number | null;
  /** Discount saved per month on the given provider cost, USDC. */
  monthlySavingsUsdc: number | null;
};

export type TierPlan = {
  stakedInfer: number;
  current: TierRow;
  next: (TierRow & { additionalStakeInfer: number }) | null;
  ladder: TierRow[];
  notes: string[];
};

export type PlanInput = {
  /** Current stake of the key owner, in INFER (human units). */
  stakedInfer: number;
  params: Params;
  /** Requests per minute for No tier, Tier 1, Tier 2, Tier 3, if known. */
  rateLimits?: readonly (number | null)[] | null;
  /** Expected monthly provider cost (before discount and fee), USDC, to value the discount. */
  monthlyProviderCostUsdc?: number | null;
};

/** Plan the next tier for an account. All thresholds and discounts come from the params passed in. */
export function planTier(input: PlanInput): TierPlan {
  const { params: p } = input;
  if (!Number.isFinite(input.stakedInfer) || input.stakedInfer < 0) throw new Error("stakedInfer must be a non-negative number");
  const staked = Math.round(input.stakedInfer * UNIT);
  const spend = input.monthlyProviderCostUsdc ?? null;
  const rows: TierRow[] = tierLadder(p).map((t) => ({
    ...t,
    minStakeInfer: toUsdc(t.minStake),
    discountPct: t.discountBps / 100,
    ratePerMin: input.rateLimits?.[t.level] ?? null,
    monthlySavingsUsdc: spend == null ? null : Math.round(spend * t.discountBps) / 10_000,
  }));
  const current = rows[tierFor(staked, p).level]!;
  const nextRow = current.level < 3 ? rows[current.level + 1]! : null;
  const notes: string[] = [];
  if (nextRow) {
    const gains: string[] = [];
    if (nextRow.discountBps > current.discountBps) gains.push(`discount ${current.discountPct}% → ${nextRow.discountPct}%`);
    if (nextRow.ratePerMin != null && current.ratePerMin != null) gains.push(`rate limit ${current.ratePerMin} → ${nextRow.ratePerMin} req/min`);
    if (nextRow.priority && !current.priority) gains.push("priority flag on every request");
    gains.push(`admitted under congestion until load reaches ${nextRow.congestionCeiling} req/min (now ${current.congestionCeiling})`);
    notes.push(`Stake ${toUsdc(nextRow.minStake - staked)} more INFER to reach ${nextRow.name}: ${gains.join(", ")}.`);
  } else notes.push("Already at the top tier.");
  if (!input.rateLimits) notes.push("Rate limits per tier are not in /api/params; read them from the docs (Rate limits page) or a 429 message and pass them in.");
  notes.push("Tier thresholds and discounts are governable and can change; re-read /api/params before acting.");
  notes.push("Stake also earns a share of protocol fees, paid in USDC; it is not a cost. Unstaking may have a cooldown (see unstake_cooldown_seconds if present).");
  return {
    stakedInfer: toUsdc(staked),
    current,
    next: nextRow ? { ...nextRow, additionalStakeInfer: toUsdc(nextRow.minStake - staked) } : null,
    ladder: rows,
    notes,
  };
}

/** Read the tier and its requests-per-minute from a 429 `rate_limit_exceeded` message. */
export function parseRateLimitMessage(message: string): { tier: string; ratePerMin: number } | null {
  const m = /Rate limit for (No tier|Tier \d) is (\d+) requests per minute/.exec(message);
  return m ? { tier: m[1]!, ratePerMin: Number(m[2]) } : null;
}
