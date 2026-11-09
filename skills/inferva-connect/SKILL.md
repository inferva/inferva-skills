---
name: inferva-connect
description: Point an OpenAI-compatible client or SDK at the INFERVA endpoint (https://dapp.inferva.xyz/v1) with an inf_sk_ agent key, and choose between model "auto" and a specific model id from GET /v1/models. Use when an agent or app needs to send chat completions through INFERVA, when setting a base URL and API key, when picking a model, or when a key, base URL or streaming setup is not working.
---

# Connect to INFERVA

INFERVA is one OpenAI-compatible endpoint that agents pay through. Each request is routed to a provider, metered,
charged in USDG to the account that owns the key, and written to a hash-chained settlement log.

## What you need

- Base URL: `https://dapp.inferva.xyz/v1`
- An agent key that starts with `inf_sk_`. The account owner creates it in the app (https://dapp.inferva.xyz) under
  **Endpoint & keys**. The full secret is shown once; only a short prefix is stored for display.
- USDG on the owner's account (requests are paid from it) and sponsored capacity on the network (checked per request).

Keep the key server-side, in an environment variable such as `INFERVA_KEY`. Never print it, log it, commit it or
send it to a browser. Anyone holding it can spend the owner's balance (up to the key's spend cap, if one is set).

## Steps

1. Read the key from the environment. If it is missing, ask the user to create one in **Endpoint & keys**; do not
   invent or reuse one from elsewhere.
2. List models: `GET https://dapp.inferva.xyz/v1/models` (no auth needed). It returns `auto` plus every model an
   active provider serves, with `owned_by` (the provider) and `price_per_1k_usdg`.
3. Choose the model:
   - `auto` (the default when `model` is omitted): the router picks the best-priced routable provider, where price is
     the provider's blended input/output price scaled by its routing weight. Good default when any model will do.
     If the key has an allowed-models list, `auto` only picks from that list.
   - A specific id from step 2: use it when the task needs a particular model, or when you need the same model on
     every call (reproducibility, evals). The best-priced routable provider serving that id handles it.
   - Model ids are matched lower-case. An id nobody serves returns `404 model_not_found`.
4. Configure the client: base URL `https://dapp.inferva.xyz/v1`, API key = the `inf_sk_` key.
5. Send `POST /v1/chat/completions` with `messages` (and optionally `model`, `max_tokens`, `stream`).
6. Read the `inferva` block on the response (see `inferva-cost-check`) and keep `id` and `inferva.settlement` if you
   want to audit later (see `inferva-receipt-audit`).

## Examples

```bash
curl https://dapp.inferva.xyz/v1/chat/completions \
  -H "Authorization: Bearer $INFERVA_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "auto", "messages": [{"role": "user", "content": "Hello"}]}'
```

```ts
import OpenAI from "openai";
const client = new OpenAI({ baseURL: "https://dapp.inferva.xyz/v1", apiKey: process.env.INFERVA_KEY });
const res = await client.chat.completions.create({ model: "auto", messages: [{ role: "user", content: "Hello" }] });
console.log(res.choices[0].message.content, (res as any).inferva?.cost_usdg);
```

```python
from openai import OpenAI
import os
client = OpenAI(base_url="https://dapp.inferva.xyz/v1", api_key=os.environ["INFERVA_KEY"])
res = client.chat.completions.create(model="auto", messages=[{"role": "user", "content": "Hello"}])
print(res.choices[0].message.content, res.model_extra.get("inferva", {}).get("cost_usdg"))
```

## Request behaviour to plan around

Read the current limits live from `GET https://dapp.inferva.xyz/api/agents/catalog` → `limits`
(`maxMessages`, `maxCharsPerMessage`, `maxOutputTokens`). The endpoint:

- uses only the last `maxMessages` messages and cuts each to `maxCharsPerMessage` characters;
- accepts `content` as a string or an array of parts with `text` (non-text parts are ignored);
- sends every role other than `assistant` (including `system`) as `user`, so put instructions in the first user turn;
- clamps `max_tokens` to `maxOutputTokens` (and uses that cap when `max_tokens` is omitted);
- supports `stream: true` (server-sent events in the `chat.completion.chunk` shape). The final chunk carries `usage`
  and the `inferva` block; errors during a stream arrive as a `data: {"error": ...}` event.

## Failure modes

- `401 invalid_api_key`: missing header, unknown key, or a revoked/rotated key. See `inferva-error-recovery`.
- `404 model_not_found` / `403 model_not_allowed`: re-read `/v1/models` and the key's allowed models.
- Anything about funds, caps, rate limits or capacity: `inferva-error-recovery`. Every account has the same rate
  limit (10 requests per minute across all its keys).
- Do not hardcode prices or limits from an earlier run; providers and governance can change them.
