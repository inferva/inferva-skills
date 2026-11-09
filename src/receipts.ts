// Receipt and settlement-chain verification. Hashes are recomputed locally; stored hashes are never trusted.

import { fetchChainPage, fetchReceipt, type ApiOptions, type ChainRecord, type Receipt } from "./api.js";
import type { InfervaBlock } from "./cost.js";
import { settlementPayload, sha256Hex, toMicro } from "./protocol.js";

export type Check = { name: string; ok: boolean; detail: string };

export async function recomputeHash(r: ChainRecord) {
  return sha256Hex(settlementPayload(r, r.prev_hash));
}

const pass = (name: string, detail: string): Check => ({ name, ok: true, detail });
const fail = (name: string, detail: string): Check => ({ name, ok: false, detail });

/** Verify one receipt: its own hash, both links, and (optionally) the `inferva` block the agent kept. */
export async function verifyReceipt(receipt: Receipt, kept?: InfervaBlock | null): Promise<{ ok: boolean; checks: Check[] }> {
  const r = receipt.record;
  const checks: Check[] = [];
  const hash = await recomputeHash(r);
  checks.push(hash === r.hash ? pass("hash", `recomputed ${hash}`) : fail("hash", `recomputed ${hash}, record says ${r.hash}`));

  if (receipt.prev) checks.push(receipt.prev.hash === r.prev_hash ? pass("prev link", `prev_hash matches record #${receipt.prev.seq} (${receipt.prev.id})`) : fail("prev link", `prev_hash ${r.prev_hash} ≠ hash of record #${receipt.prev.seq} ${receipt.prev.hash}`));
  else checks.push(r.prev_hash === receipt.genesis ? pass("prev link", "first record: prev_hash is the genesis value") : fail("prev link", `no earlier record, but prev_hash ${r.prev_hash} ≠ genesis ${receipt.genesis}`));

  if (receipt.next) checks.push(receipt.next.prev_hash === r.hash ? pass("next link", `record #${receipt.next.seq} (${receipt.next.id}) points back to this hash`) : fail("next link", `record #${receipt.next.seq} prev_hash ${receipt.next.prev_hash} ≠ this hash ${r.hash}`));
  else checks.push(pass("next link", "latest record so far (no successor yet)"));

  if (kept) {
    checks.push(kept.settlement?.hash === r.hash ? pass("kept hash", "matches the hash returned with the response") : fail("kept hash", `response said ${kept.settlement?.hash}, log says ${r.hash}`));
    checks.push(kept.settlement?.prev_hash === r.prev_hash ? pass("kept prev_hash", "matches") : fail("kept prev_hash", `response said ${kept.settlement?.prev_hash}, log says ${r.prev_hash}`));
    const charged = r.base - r.discount + r.fee;
    checks.push(toMicro(kept.cost_usdc) === charged ? pass("kept cost", `${kept.cost_usdc} USDC = base − discount + fee`) : fail("kept cost", `response said ${kept.cost_usdc} USDC, record charges ${charged / 1e6}`));
    checks.push(kept.capacity === r.capacity_id ? pass("kept capacity", r.capacity_id) : fail("kept capacity", `response said ${kept.capacity}, log says ${r.capacity_id}`));
    checks.push(kept.epoch === r.epoch ? pass("kept epoch", String(r.epoch)) : fail("kept epoch", `response said ${kept.epoch}, log says ${r.epoch}`));
  }
  const split = r.to_stakers + r.to_sponsor + r.to_treasury;
  checks.push(split === r.fee ? pass("fee split", "to_stakers + to_sponsor + to_treasury = fee") : fail("fee split", `split ${split} ≠ fee ${r.fee}`));
  return { ok: checks.every((c) => c.ok), checks };
}

/** Fetch a receipt by request id and verify it. */
export async function auditReceipt(id: string, kept?: InfervaBlock | null, o?: ApiOptions) {
  const receipt = await fetchReceipt(id, o);
  return { id, record: receipt.record, ...(await verifyReceipt(receipt, kept)) };
}

export type ChainAudit = {
  ok: boolean;
  checked: number;
  genesis: string;
  tip: { seq: number; id: string; hash: string } | null;
  firstProblem: { seq: number; id: string; problem: string } | null;
  complete: boolean;
};

/** Walk the settlement chain from genesis, recomputing every hash and link. Stops at the first problem. */
export async function verifyChain(o: ApiOptions & { maxRecords?: number; pageSize?: number } = {}): Promise<ChainAudit> {
  const max = o.maxRecords ?? Infinity;
  const pageSize = Math.min(Math.max(o.pageSize ?? 200, 1), 200);
  let after = 0;
  let checked = 0;
  let genesis = "";
  let prevHash: string | null = null;
  let tip: ChainAudit["tip"] = null;
  const seen = new Set<string>();
  for (;;) {
    const page = await fetchChainPage(after, pageSize, o);
    genesis ||= page.genesis;
    if (prevHash === null) prevHash = page.genesis;
    for (const r of page.records) {
      const problem = (msg: string): ChainAudit => ({ ok: false, checked, genesis, tip, firstProblem: { seq: r.seq, id: r.id, problem: msg }, complete: false });
      if (r.prev_hash !== prevHash) return problem(`prev_hash ${r.prev_hash} ≠ previous hash ${prevHash}`);
      if (seen.has(r.prev_hash)) return problem("prev_hash reused (fork)");
      const hash = await recomputeHash(r);
      if (hash !== r.hash) return problem(`recomputed ${hash}, stored ${r.hash}`);
      seen.add(r.prev_hash);
      prevHash = r.hash;
      tip = { seq: r.seq, id: r.id, hash: r.hash };
      checked++;
      if (checked >= max) return { ok: true, checked, genesis, tip, firstProblem: null, complete: false };
    }
    if (page.records.length < pageSize) return { ok: true, checked, genesis, tip, firstProblem: null, complete: true };
    after = page.records[page.records.length - 1]!.seq;
  }
}
