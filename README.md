# INFERVA Skills

Agent Skills that help AI agents use [INFERVA](https://inferva.xyz) well: connect, check cost, recover from errors
and audit what they paid.

**INFERVA** is one OpenAI-compatible endpoint that agents pay through. Each request is routed to a provider, metered,
charged in USDG to the account that owns the agent key, and written to a hash-chained settlement log. The protocol fee
on each request is split between the capacity sponsor whose prepaid capacity served it and the treasury. INFERVA is
launching on Robinhood Chain.

- Website: https://inferva.xyz
- Docs: https://docs.inferva.xyz
- App and endpoint: https://dapp.inferva.xyz (OpenAI-compatible base URL `https://dapp.inferva.xyz/v1`)
- GitHub: https://github.com/inferva

## Skills

| Skill | What it does | Helper |
|---|---|---|
| [`inferva-connect`](skills/inferva-connect/SKILL.md) | Point an OpenAI-compatible client at `https://dapp.inferva.xyz/v1` with an `inf_sk_` key; choose `auto` or a model id from `/v1/models`; know the request limits | none |
| [`inferva-cost-check`](skills/inferva-cost-check/SKILL.md) | Worst-case cost before a request (the endpoint's own check), and the `inferva` block after it: `cost_usdg` and every breakdown field | `scripts/estimate.ts` |
| [`inferva-error-recovery`](skills/inferva-error-recovery/SKILL.md) | What to do for every error type: insufficient funds, spend cap, rate limit, congestion, capacity, revoked key, provider error, settlement busy | none |
| [`inferva-receipt-audit`](skills/inferva-receipt-audit/SKILL.md) | Recompute a receipt's SHA-256 hash, check both chain links and the kept response, or walk the whole settlement chain from genesis | `scripts/verify.ts` |

No skill hardcodes a fee, fee share or price. Helpers read them live from the public routes (`/api/params`,
`/api/providers`, `/api/agents/catalog`, `/api/network`, `/api/receipts/:id`, `/api/chain`), because governance and
providers can change them.

## Install

Each skill is a folder with a `SKILL.md` (YAML frontmatter `name` + `description`, then instructions). Agents load
the descriptions up front and read a skill's body only when it is relevant.

### Claude Code

```bash
git clone https://github.com/inferva/inferva-skills.git
cd inferva-skills && pnpm install

# personal skills, available in every project
mkdir -p ~/.claude/skills
cp -r skills/* ~/.claude/skills/

# or per project
mkdir -p .claude/skills && cp -r /path/to/inferva-skills/skills/* .claude/skills/
```

The helper scripts import from `src/`, so run them from the repo checkout
(`pnpm tsx skills/<skill>/scripts/<script>.ts ...`) or use the built CLIs after `pnpm build`
(`node dist/skills/<skill>/<script>.js ...`). A copied skill folder still works as instructions without the helper.

### Other agents

- Any agent that supports Agent Skills (a `skills/` directory of `SKILL.md` folders): copy or symlink `skills/*` into
  its skills directory.
- Agents without skill support: paste the `SKILL.md` body into the system prompt or a tool description, or load
  them programmatically:

```ts
import { loadSkills, skillIndex } from "@inferva/skills";
const skills = loadSkills("node_modules/@inferva/skills/skills");
const index = skillIndex(skills); // one line per skill, for the system prompt
```

## Helpers

```bash
pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --prompt "Summarise this report" --max-tokens 512
pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --explain response.json
pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --id req_... --kept response.json
pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --chain
```

All of them print JSON. They need no key: every route they read is public. Pass `--base-url` to point at another
deployment.

The same functions are exported from the package (`estimateWorstCase`, `routeFor`, `explainInfervaBlock`,
`quote`, `verifyReceipt`, `verifyChain`, `settlementPayload`, ...), each taking an optional `fetch`.

## Develop

```bash
pnpm install
pnpm test       # offline, fetch is mocked; includes a frontmatter check for every SKILL.md
pnpm typecheck
pnpm build
```

## Security

- Never commit, log or print an `inf_sk_` key. Keep it in an environment variable on the server side.
- Anyone holding a key can spend the owner's USDG up to the key's spend cap. Set a cap and an allowed-models list
  per key in **Endpoint & keys**, and revoke or rotate a leaked key there.

## License

[MIT](LICENSE) © INFERVA
