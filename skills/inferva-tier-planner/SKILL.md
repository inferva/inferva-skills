---
name: inferva-tier-planner
description: From live INFERVA parameters, work out the key owner's current stake tier and how much more $INFER stake reaches the next one, and what that changes - request discount, rate limit, priority flag and admission under congestion - optionally valued against expected monthly spend. Use when an agent keeps hitting rate limits or congestion deferrals, when the user asks whether staking is worth it for their usage, or asks what tier they are in or what the tiers are.
---

# Tier planner

One stake sets everything: the account's stake decides its tier, and the tier applies to every request made with any
of that account's agent keys. Stake is not spent; stakers also earn a share of every protocol fee, paid in USDC.

## What a tier changes

| Benefit | Source |
|---|---|
| Discount on provider cost | `tier1_discount_bps` / `tier2_discount_bps` / `tier3_discount_bps` from `/api/params` |
| Stake needed | `tier1_stake` / `tier2_stake` / `tier3_stake` (micro INFER, 1 INFER = 1,000,000) |
| Rate limit (requests per minute, per account) | Fixed per tier in the endpoint, not a governable parameter, so it is **not** in `/api/params`. Read it from the docs (https://docs.inferva.xyz/api/rate-limits) or from a `429` message ("Rate limit for Tier N is X requests per minute"), and pass it in with `--rate-limits` |
| Priority flag | Set from Tier 2 up; written to each settlement record |
| Admission under congestion | Each tier is admitted until network load (requests in the last minute) reaches its ceiling: `capacity × (threshold_bps + (10,000 − threshold_bps) × level / 3) / 10,000`, from `congestion_capacity_rpm` and `congestion_threshold_bps`. Lower tiers are deferred first |

Never state a threshold, discount or rate from memory. Governance can change thresholds and discounts at any time.

## Steps

1. Get the owner's current stake in INFER. Ask the user if you do not know it (the app's **Stake** page shows it).
   Do not guess.
2. Run:
   ```bash
   pnpm tsx skills/inferva-tier-planner/scripts/plan.ts --staked <INFER> [--monthly-cost <USDC provider cost/month>] [--rate-limits <none,t1,t2,t3>]
   ```
   It reads `/api/params` and `/api/network` live and returns `{ current, next: { additionalStakeInfer, ... },
   ladder[], notes[], network }`. Functions: `planTier()`, `parseRateLimitMessage()` in `src/tiers.ts`;
   `tierLadder()`, `tierFor()`, `tierCeiling()` in `src/protocol.ts`.
3. Explain the gap to the next tier: additional stake, discount before → after, rate limit before → after (if known),
   priority, congestion ceiling before → after.
4. If the user gave a monthly provider cost, show the discount it saves per month at each tier (`monthlySavingsUsdc`).
   The discount applies to the provider cost only, not to the protocol fee.
5. Tie it to the symptom: frequent `rate_limit_exceeded` → rate limit is the reason to move up; frequent
   `congestion_deferred` → the congestion ceiling and priority are the reason; neither → the discount and fee share
   are the only reasons.

## Output

"You have <staked> INFER staked, which is <current>. <additionalStakeInfer> more INFER reaches <next>: discount
<a>% → <b>%, <rate change>, <priority>, admitted under congestion until <ceiling> req/min instead of <ceiling>."
Then: "These values were read from the live parameters just now and are governable."

## Failure modes

- Do not present staking as an investment or promise returns. Fee rebates depend on real request volume and the
  share of total stake; say so if asked.
- Do not pick a stake amount for the user; show what each tier needs and let them decide.
- If `unstake_cooldown_seconds` is present in the params, mention that unstaking is not instant.
- If `/api/params` cannot be read, stop: there is nothing safe to compute from.
