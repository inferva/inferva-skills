---
name: inferva-cost-check
description: Estimate the worst-case USDG cost of an INFERVA chat completion before sending it (the same check the endpoint runs against the key owner's balance and the key's spend cap), and explain the inferva block returned after it (cost_usdg and every breakdown field). Use before large or repeated requests, when budgeting an agent run, when a request fails on funds or spend cap, or when the user asks what a request cost or where the money went.
---

# Cost check

Every INFERVA request has two numbers: the worst case the endpoint checks **before** generating, and the actual
charge it settles **after**, from real token counts. Both use the same formula and live parameters.

## Formula (all integers in micro USDG, 1 USDG = 1,000,000)

```
base        = ceil(tokens × price_per_1k / 1000)          provider cost
fee         = ceil(base × fee_bps / 10,000)                protocol fee, on top of the provider cost
to_sponsor  = floor(fee × sponsor_share_bps / 10,000)      share for the capacity sponsor
to_treasury = fee − to_sponsor                             the rest of the fee
total       = base + fee                                   what the key owner pays
```

`fee_bps` and `sponsor_share_bps` come from `GET https://dapp.inferva.xyz/api/params`. Never quote them from memory;
they are governable. Every account pays the same price for the same request.

**Worst case (before):** `tokens = ceil(prompt characters / 3) + max_tokens`, priced at the higher of the route's
input and output price. The prompt is the text of the messages the endpoint keeps (last `maxMessages`, each cut to
`maxCharsPerMessage`) joined with newlines; `max_tokens` is clamped to `maxOutputTokens` (limits from
`/api/agents/catalog`). The request is rejected with `402` unless the owner's USDG ≥ worst-case total, and, for a
capped key, unless spent-this-month + other in-flight holds + worst-case total ≤ the cap. It also needs a sponsored
capacity position with at least the worst-case `base` left, or it gets `503 capacity_exhausted`.

**Actual (after):** the same formula with real `prompt_tokens` and `completion_tokens`, each billed at its own
price (input vs output). It is usually far below the worst case.

## Steps

1. Run the estimate with the real request (or a close draft):
   ```bash
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --prompt "..." [--model auto] [--max-tokens 512] [--allowed m1,m2]
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --messages request.json
   ```
   It reads params, providers (per-model input/output prices and routing weights) and limits live, picks the route
   the endpoint would pick, and returns `{ route, maxTokens, worstTokens, quote, worstTotalUsdg, notes }`.
2. Compare `worstTotalUsdg` with what the owner holds and what the key has left of its cap. If it does not fit,
   lower `max_tokens`, trim the prompt, or pick a cheaper model id; do not just retry.
3. Send the request. Then explain the result:
   ```bash
   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --explain response.json
   ```
   This checks `cost_usdg = provider_cost + protocol_fee` and `protocol_fee = to_sponsor + to_treasury`, and returns plain-language lines plus the request id.

Functions: `estimateWorstCase()`, `routeFor()`, `prepareMessages()`, `expectedCost()`, `explainInfervaBlock()` in
`src/cost.ts`; `quote()` in `src/protocol.ts`.

## The `inferva` block

| Field | Meaning |
|---|---|
| `provider` | Name of the provider that served the request |
| `cost_usdg` | Total charged to the key owner |
| `breakdown.provider_cost` | `base`: tokens × the provider's price, repaid to the capacity sponsor |
| `breakdown.protocol_fee` | Fee on top of the provider cost; split into the next two fields |
| `breakdown.to_sponsor` | Share for the capacity sponsor whose position served the request |
| `breakdown.to_treasury` | Remainder of the fee |
| `capacity` | Sponsored capacity position drawn by `provider_cost` |
| `epoch` | Epoch the request settled in |
| `settlement.hash` / `prev_hash` | This record's hash and the previous record's hash |
| `receipt` | Public receipt page; the id after `/receipt/` is the request id |

With `stream: true`, the block is on the last chunk (the one with `finish_reason: "stop"` and `usage`). A stream
that delivered any content is charged for what it used, even if it was cut short; one that delivered nothing is not.

## Output

"Worst case for this request on <model> via <provider>: <worstTotalUsdg> USDG. It settled at <cost_usdg> USDG:
<provider_cost> provider cost + <protocol_fee> fee (<to_sponsor> to the sponsor, <to_treasury> to the treasury)." Use the real numbers from the script, never example values.

## Failure modes

- No routable provider for the model: the script says so (the endpoint would return 404).
- Model not on the key's allowed list: the script says so (403).
- Arithmetic in a returned block does not add up: report the `problems` and audit the receipt.
