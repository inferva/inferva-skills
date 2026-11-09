---
name: inferva-cost-check
description: Estimate the worst-case USDC cost of an INFERVA chat completion before sending it (the same check the endpoint runs against the key owner's balance and the key's spend cap), and explain the inferva block returned after it (cost_usdc and every breakdown field). Use before large or repeated requests, when budgeting an agent run, when a request fails on funds or spend cap, or when the user asks what a request cost or where the money went.
---

# Cost check

Every INFERVA request has two numbers: the worst case the endpoint checks **before** generating, and the actual
charge it settles **after**, from real token counts. Both use the same formula and live parameters.

## Formula (all integers in micro USDC, 1 USDC = 1,000,000)

```
base      = ceil(tokens × price_per_1k / 1000)            provider cost
discount  = floor(base × tier_discount_bps / 10,000)       from the key owner's stake tier
fee       = ceil(base × fee_bps / 10,000)                  protocol fee, on top of the provider cost
to_stakers = floor(fee × staker_share_bps / 10,000)
to_sponsor = floor(fee × sponsor_share_bps / 10,000)
to_treasury = fee − to_stakers − to_sponsor
total     = base − discount + fee                           what the key owner pays
```

`fee_bps`, the share bps and the tier discounts come from `GET https://dapp.inferva.xyz/api/params`. Never quote
them from memory; they are governable.

**Worst case (before):** `tokens = ceil(prompt characters / 3) + max_tokens`, priced at the higher of the route's
input and output price. The prompt is the text of the messages the endpoint keeps (last `maxMessages`, each cut to
`maxCharsPerMessage`) joined with newlines; `max_tokens` is clamped to `maxOutputTokens` (limits from
`/api/agents/catalog`). The request is rejected with `402` unless the owner's USDC ≥ worst-case total, and, for a
capped key, unless spent-this-month + other in-flight holds + worst-case total ≤ the cap. It also needs a sponsored
capacity position with at least the worst-case `base` left, or it gets `503 capacity_exhausted`.

**Actual (after):** the same formula with real `prompt_tokens` and `completion_tokens`, each billed at its own
price (input vs output). It is usually far below the worst case.

## Steps

1. Run the estimate with the real request (or a close draft):
   ```bash
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --prompt "..." [--model auto] [--max-tokens 512] [--staked <INFER>] [--allowed m1,m2]
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --messages request.json
   ```
   It reads params, providers (per-model input/output prices and routing weights) and limits live, picks the route
   the endpoint would pick, and returns `{ route, maxTokens, worstTokens, quote, worstTotalUsdc, notes }`.
   `--staked` applies the owner's tier discount; without it no discount is assumed (slight overestimate).
2. Compare `worstTotalUsdc` with what the owner holds and what the key has left of its cap. If it does not fit,
   lower `max_tokens`, trim the prompt, or pick a cheaper model id; do not just retry.
3. Send the request. Then explain the result:
   ```bash
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --explain response.json
   ```
   This checks `cost_usdc = provider_cost − discount + protocol_fee` and
   `protocol_fee = to_stakers + to_sponsor + to_treasury`, and returns plain-language lines plus the request id.

Functions: `estimateWorstCase()`, `routeFor()`, `prepareMessages()`, `expectedCost()`, `explainInfervaBlock()` in
`src/cost.ts`; `quote()` in `src/protocol.ts`.

## The `inferva` block

| Field | Meaning |
|---|---|
| `provider` | Name of the provider that served the request |
| `tier` / `priority` | The payer's tier at request time; priority is set from Tier 2 up |
| `cost_usdc` | Total charged to the key owner |
| `breakdown.provider_cost` | `base`: tokens × the provider's price |
| `breakdown.discount` | Tier discount, subtracted from the provider cost |
| `breakdown.protocol_fee` | Fee on top of the provider cost; split into the next three fields |
| `breakdown.to_stakers` | Share for $INFER stakers (0 when nobody is staked; it then goes to the treasury) |
| `breakdown.to_sponsor` | Share for the capacity sponsor whose position served the request |
| `breakdown.to_treasury` | Remainder of the fee |
| `capacity` | Sponsored capacity position drawn by `provider_cost` |
| `epoch` | Epoch the request settled in |
| `settlement.hash` / `prev_hash` | This record's hash and the previous record's hash |
| `receipt` | Public receipt page; the id after `/receipt/` is the request id |

With `stream: true`, the block is on the last chunk (the one with `finish_reason: "stop"` and `usage`). A stream
that delivered any content is charged for what it used, even if it was cut short; one that delivered nothing is not.

## Output

"Worst case for this request on <model> via <provider>: <worstTotalUsdc> USDC. It settled at <cost_usdc> USDC:
<provider_cost> provider cost − <discount> discount + <protocol_fee> fee (<to_stakers> to stakers, <to_sponsor> to
the sponsor, <to_treasury> to the treasury)." Use the real numbers from the script, never example values.

## Failure modes

- No routable provider for the model: the script says so (the endpoint would return 404).
- Model not on the key's allowed list: the script says so (403).
- Arithmetic in a returned block does not add up: report the `problems` and audit the receipt.
