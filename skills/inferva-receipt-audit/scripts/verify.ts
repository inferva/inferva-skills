// Verify a receipt, or walk the whole settlement chain from genesis.
//
//   pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --id req_... [--kept response.json]
//   pnpm tsx skills/inferva-receipt-audit/scripts/verify.ts --chain [--max 1000]
import { readFileSync } from "node:fs";
import { isMain, num, parseFlags, runCli, str } from "../../../src/cli.js";
import type { InfervaBlock } from "../../../src/cost.js";
import { auditReceipt, verifyChain } from "../../../src/receipts.js";

/** Accept a request id, an app receipt URL (…/receipt/<id>) or an API receipt URL (…/api/receipts/<id>). */
export function receiptId(input: string) {
  const m = /\/(?:api\/receipts|receipt)\/([^/?#]+)/.exec(input);
  return m ? decodeURIComponent(m[1]!) : input.trim();
}

if (isMain(import.meta.url)) {
  const f = parseFlags(process.argv.slice(2));
  const baseUrl = str(f, "base-url");
  void runCli(async () => {
    if (f.chain) return verifyChain({ baseUrl, maxRecords: num(f, "max") });
    const keptPath = str(f, "kept");
    let kept: InfervaBlock | null = null;
    if (keptPath) {
      const body = JSON.parse(readFileSync(keptPath, "utf8"));
      kept = body.inferva ?? body;
    }
    const id = str(f, "id") ?? (kept?.receipt ? receiptId(kept.receipt) : undefined);
    if (!id) throw new Error("give --id <request id or receipt URL>, --kept <response.json>, or --chain");
    return auditReceipt(receiptId(id), kept, { baseUrl });
  });
}
