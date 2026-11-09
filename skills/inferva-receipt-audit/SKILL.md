---
name: inferva-receipt-audit
description: Verify an INFERVA settlement receipt or the whole settlement chain by recomputing SHA-256 hashes locally from the canonical payload (prev_hash|id|payer|provider|model|tokens|base|discount|fee|capacity_id|epoch|created_at), checking both chain links and comparing against the inferva block an agent kept from its response. Use when the user wants proof of what a request cost, wants to audit an agent's spend, has a receipt URL or request id, or asks whether the settlement log is intact.
---

# Receipt audit

Every settled request writes one record to a single hash chain. A record's hash covers the hash of the record before
it, starting from a genesis value, so changing any past record breaks every hash after it. Verification never trusts
the stored `hash` column: it recomputes.

## The payload

Fields joined with `|` in this exact order, then SHA-256, lower-case hex:

```
prev_hash|id|payer|provider|model|tokens|base|discount|fee|capacity_id|epoch|created_at
```

- `prev_hash`: hash of the previous record, or the genesis value (`genesis` in the API) for the first record.
- `provider` is the provider **id** (e.g. `prv_...`), not its display name.
- `base`, `discount`, `fee` are integers in micro USDG; `tokens` is total tokens; `created_at` is Unix ms.
- `discount` is 0 on current records. It stays in the payload, so older records that carry a value still verify
  exactly as before.
- Numbers are written as plain integers (no separators, no decimals).

`to_sponsor`, `to_treasury` and token splits are on the record but not in the hash; the audit checks that
`to_sponsor + to_treasury = fee` separately. Records also carry two legacy columns, `to_stakers` and `priority`,
which are 0 on current records; `to_stakers` is kept in that sum so older records still balance.

## Public routes (no auth)

- `GET https://dapp.inferva.xyz/api/receipts/<request id>` → `{ record, prev, next, genesis }`
- `GET https://dapp.inferva.xyz/api/chain?after=<seq>&limit=<n>` → `{ genesis, records }` in order (pages up to 200)
- The `inferva.receipt` URL on a response is the human page; the id after `/receipt/` is the request id.

## Steps

1. Get the request id: the response `id`, or the tail of `inferva.receipt`.
2. Verify the receipt, ideally with the response the agent kept:
   ```bash
   pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --id <req_... | receipt URL> [--kept response.json]
   ```
   Checks: recomputed hash = record hash; `prev_hash` = previous record's hash (or genesis); the next record's
   `prev_hash` = this hash; fee split adds up; and with `--kept`: the kept `settlement.hash`, `prev_hash`,
   `cost_usdg`, `capacity` and `epoch` match the log.
3. To audit the whole log (or the first N records):
   ```bash
   pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --chain [--max 1000]
   ```
   Walks from genesis, recomputes every hash, checks every link and that no `prev_hash` is reused (no fork). Stops at
   the first problem and reports its `seq` and `id`.

Functions: `verifyReceipt()`, `auditReceipt()`, `verifyChain()`, `recomputeHash()` in `src/receipts.ts`;
`settlementPayload()` and `sha256Hex()` in `src/protocol.ts`.

## Output

"Receipt <id> verifies: hash recomputed from the payload matches, it links to record #<n-1> and record #<n+1> links
back to it, and it matches the cost and hash returned with the response." On any failed check, name the check and
show both values; do not summarise a failure as "probably fine".

## Failure modes

- `404 Receipt not found`: wrong id, or the request failed and was never charged (failed requests write no record).
- A hash mismatch on one record and every later link: the record was changed after settlement. Report it.
- `--kept` mismatch with a valid chain: the response you kept is not the one that settled (wrong file or id).
- Today the log lives on the app ledger; anchoring the latest hash onchain each epoch is planned. Do not claim the
  chain is onchain.
