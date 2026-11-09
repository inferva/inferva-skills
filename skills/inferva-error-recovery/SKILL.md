---
name: inferva-error-recovery
description: Decide what to do on every error the INFERVA endpoint returns, by HTTP status and error.type - insufficient_funds, spend_cap_reached, rate_limit_exceeded, congestion_deferred, capacity_exhausted, settlement_busy, provider_error, invalid_api_key (revoked or rotated key), model_not_found, model_not_allowed, invalid_request_error. Use whenever a call to https://dapp.inferva.xyz/v1 fails, before retrying, or when an agent loop keeps hitting the same error.
---

# Error recovery

Errors from `/v1/chat/completions` are JSON: `{"error": {"message": "...", "type": "..."}}`. Switch on `type`, not
on the message text. The message carries the live numbers (cost, balance, cap, limit); quote it to the user.

**Charging rule:** a request that returns any error below is not charged. Funds, the key's cap and capacity are
checked against the worst case before generation; the final charge uses real token counts. Exception: in a stream,
content already delivered is charged even if the stream ends early.

## By type

| Status | `type` | What happened | What to do |
|---|---|---|---|
| 400 | `invalid_request_error` | No `messages` array, or no message has text | Fix the request. Do not retry unchanged. |
| 401 | `invalid_api_key` | Missing `Authorization: Bearer inf_sk_...`, unknown key, revoked key, or the owner account is gone | Check the env var is set and sent. If it was revoked or rotated, a rotation issues a new secret with the same name and limits and revokes the old one at once: ask the owner for the new key from **Endpoint & keys**. Never retry in a loop. |
| 402 | `insufficient_funds` | The owner's USDG cannot cover the worst case ("can cost up to …") or the actual cost ("costs … and the key owner has …"), or the balance moved during the request | Lower `max_tokens`, trim the prompt or pick a cheaper model (estimate with `inferva-cost-check`). Otherwise the owner must add USDG. "Balance changed" can be retried once. |
| 402 | `spend_cap_reached` | The key's monthly spend cap is used up, or this request's worst case does not fit in what is left (in-flight requests on the same key hold their worst case) | If the message says the cap is reached: stop using this key until the reset date it names (start of the next UTC month), or ask the owner to raise the cap. If it says "has X USDG left": shrink the request to fit, or wait for parallel requests to finish. |
| 403 | `model_not_allowed` | The key has an allowed-models list and this id is not on it | Use one of the models the message lists, or `auto` (which stays inside the list). |
| 404 | `model_not_found` | No active provider serves that id (or none serves any model the key may use) | Re-read `GET /v1/models` and pick a listed id, or use `auto`. |
| 429 | `rate_limit_exceeded` | The account (all its keys together) sent 10 requests in the last 60 s. The limit is the same for every account | Wait for `Retry-After` (seconds). Spread calls out or batch work into fewer requests. |
| 429 | `congestion_deferred` | The gateway is at capacity (admitted requests in the last minute ≥ `congestion_capacity_rpm`). Every caller shares the same lane. Header `x-inferva-load: load/capacity` | Wait `Retry-After` seconds (it is computed from when load drops back under capacity), then retry. `GET /api/network` shows the live load. |
| 502 | `provider_error` | The provider could not complete the request; not charged | Retry once after a short pause. If it repeats, pick a different model id (another provider) or `auto`. |
| 503 | `capacity_exhausted` | No sponsored capacity position has room for this request's provider cost | Smaller requests may still fit (less `max_tokens`). Otherwise wait, or the owner can sponsor capacity in the app. Retry with backoff; "used up by another request" can be retried immediately once. |
| 503 | `settlement_busy` | The settlement log was contended | Retry after a short backoff. |
| 500 | `server_error` / `"error": "Something went wrong"` | Unexpected error (note: this body may be a plain string, not an object) | Retry once with backoff, then stop and report. |

## Retry policy

- Retry only: `429` (after `Retry-After`), `502` (once, then switch model), `503` (backoff), `500` (once), and
  `402 insufficient_funds` with "Balance changed" (once).
- Never blindly retry `400`, `401`, `403`, `404`, `402 spend_cap_reached` or a real shortfall: the same request will
  fail the same way and wastes the rate limit.
- Use exponential backoff with jitter for `503`/`500`, capped at a few attempts. Respect `Retry-After` exactly for
  `429`; it is in seconds.
- Count rate-limit hits. Repeated `rate_limit_exceeded` means the workload needs fewer, larger calls.

## Streaming

With `stream: true` the HTTP status is 200 once the stream starts. Errors after that arrive as an SSE event
`data: {"error": {"message", "type"}}` followed by `data: [DONE]`. Handle the same types as above. Pre-generation
errors (auth, funds, cap, rate limit, capacity, routing) still come back as normal HTTP errors before any stream.

## Output

Tell the user what failed in one line using the message's own numbers, what you did (waited N s, switched model,
shrunk the request), and what only the owner can fix (add USDG, raise the cap, issue a new key).

## Failure modes

- Do not hide a `401` behind retries: a revoked key needs a human.
- Do not "fix" a `402` by removing `max_tokens`: that raises the worst case to the maximum.
- Do not switch to another key the user did not give you to get around a spend cap.
