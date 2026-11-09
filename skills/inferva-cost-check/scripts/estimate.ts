// Worst-case cost before a request, and an explanation of the `inferva` block after it.
//
//   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --model auto --max-tokens 512 --prompt "Summarise this..."
//   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --messages request.json [--allowed m1,m2]
//   pnpm tsx skills/inferva-cost-check/scripts/estimate.ts --explain response.json
import { readFileSync } from "node:fs";
import { fetchCatalog, fetchParams, fetchProviders, type ApiOptions } from "../../../src/api.js";
import { isMain, num, parseFlags, runCli, str } from "../../../src/cli.js";
import { estimateWorstCase, explainInfervaBlock, type ChatMessage, type InfervaBlock } from "../../../src/cost.js";

export async function estimate(
  req: { messages: ChatMessage[]; model?: string; max_tokens?: number },
  opts: ApiOptions & { allowed?: string[] | null } = {},
) {
  const [{ params }, providers, catalog] = await Promise.all([fetchParams(opts), fetchProviders(opts), fetchCatalog(opts)]);
  return estimateWorstCase(req, { params, providers, limits: catalog.limits, allowed: opts.allowed });
}

export function explain(response: { inferva?: InfervaBlock } | InfervaBlock) {
  const block = "inferva" in response && response.inferva ? response.inferva : (response as InfervaBlock);
  if (!block || typeof block !== "object" || !("breakdown" in block)) throw new Error("no inferva block found (a streamed reply carries it on the last chunk)");
  return explainInfervaBlock(block);
}

if (isMain(import.meta.url)) {
  const f = parseFlags(process.argv.slice(2));
  const opts = { baseUrl: str(f, "base-url") };
  void runCli(async () => {
    const explainPath = str(f, "explain");
    if (explainPath) return explain(JSON.parse(readFileSync(explainPath, "utf8")));
    const file = str(f, "messages");
    const prompt = str(f, "prompt");
    let req: { messages: ChatMessage[]; model?: string; max_tokens?: number };
    if (file) {
      const body = JSON.parse(readFileSync(file, "utf8"));
      req = Array.isArray(body) ? { messages: body } : body;
    } else if (prompt) req = { messages: [{ role: "user", content: prompt }] };
    else throw new Error("give --prompt, --messages <file.json> or --explain <response.json>");
    if (str(f, "model")) req.model = str(f, "model");
    if (num(f, "max-tokens") !== undefined) req.max_tokens = num(f, "max-tokens");
    const allowed = str(f, "allowed")?.split(",").map((m) => m.trim()).filter(Boolean) ?? null;
    return estimate(req, { ...opts, allowed });
  });
}
