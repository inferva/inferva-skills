import { describe, expect, it } from "vitest";
import type { ChainRecord } from "../src/api.js";
import type { InfervaBlock } from "../src/cost.js";
import { settlementPayload, sha256Hex } from "../src/protocol.js";
import { auditReceipt, verifyChain, verifyReceipt } from "../src/receipts.js";
import { receiptId } from "../skills/inferva-receipt-audit/scripts/verify.js";
import { GENESIS, RECORD_1, mockFetch, receiptFor } from "./fixtures.js";

async function chain(n: number): Promise<ChainRecord[]> {
  const out: ChainRecord[] = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const r = { ...RECORD_1, seq: i, id: `req_${i}`, tokens: 100 + i, created_at: RECORD_1.created_at + i, prev_hash: prev, hash: "" };
    r.hash = await sha256Hex(settlementPayload(r, prev));
    prev = r.hash;
    out.push(r);
  }
  return out;
}

const kept: InfervaBlock = {
  provider: "Basalt Inference",
  cost_usdg: 0.000381,
  breakdown: { provider_cost: 0.000346, protocol_fee: 0.000035, to_sponsor: 0.000014, to_treasury: 0.000021 },
  capacity: RECORD_1.capacity_id,
  epoch: RECORD_1.epoch,
  settlement: { hash: RECORD_1.hash, prev_hash: RECORD_1.prev_hash },
  receipt: `https://dapp.inferva.xyz/receipt/${RECORD_1.id}`,
};

describe("verifyReceipt", () => {
  it("verifies a real first record against genesis and the kept response", async () => {
    const v = await verifyReceipt(receiptFor(RECORD_1), kept);
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.ok).toBe(true);
  });
  it("detects a tampered field, a broken link and a kept-response mismatch", async () => {
    const v = await verifyReceipt(receiptFor({ ...RECORD_1, fee: 1 }, null, { seq: 2, id: "req_2", prev_hash: "f".repeat(64) }), { ...kept, cost_usdg: 1 });
    const failed = v.checks.filter((c) => !c.ok).map((c) => c.name);
    expect(failed).toEqual(expect.arrayContaining(["hash", "next link", "kept cost", "fee split"]));
    expect(v.ok).toBe(false);
  });
  it("still verifies an older record that carries a discount and the legacy to_stakers column", async () => {
    const old = { ...RECORD_1, discount: 17, to_stakers: 17, to_sponsor: 14, to_treasury: 4, priority: 1, hash: "" };
    old.hash = await sha256Hex(settlementPayload(old, old.prev_hash));
    const cost = (old.base - old.discount + old.fee) / 1e6;
    const v = await verifyReceipt(receiptFor(old), { ...kept, cost_usdg: cost, settlement: { hash: old.hash, prev_hash: old.prev_hash } });
    expect(v.checks.filter((c) => !c.ok)).toEqual([]);
    expect(v.checks.find((c) => c.name === "kept cost")!.detail).toMatch(/base − discount \+ fee/);
  });
  it("checks the prev link against the previous record", async () => {
    const [a, b] = await chain(2);
    expect((await verifyReceipt(receiptFor(b!, { seq: 1, id: a!.id, hash: a!.hash }))).ok).toBe(true);
    expect((await verifyReceipt(receiptFor(b!, { seq: 1, id: a!.id, hash: "e".repeat(64) }))).ok).toBe(false);
  });
});

describe("auditReceipt", () => {
  it("fetches /api/receipts/<id>", async () => {
    const { fetch, calls } = mockFetch({ [`/api/receipts/${RECORD_1.id}`]: receiptFor(RECORD_1) });
    const out = await auditReceipt(RECORD_1.id, null, { fetch });
    expect(calls).toEqual([`/api/receipts/${RECORD_1.id}`]);
    expect(out.ok).toBe(true);
  });
  it("surfaces a 404 as an error", async () => {
    await expect(auditReceipt("req_missing", null, { fetch: mockFetch({}).fetch })).rejects.toThrow(/404/);
  });
});

describe("verifyChain", () => {
  const serve = (records: ChainRecord[]) =>
    mockFetch({
      "/api/chain": (u: URL) => {
        const after = Number(u.searchParams.get("after"));
        const limit = Number(u.searchParams.get("limit"));
        return { genesis: GENESIS, records: records.filter((r) => r.seq > after).slice(0, limit) };
      },
    });

  it("walks every page from genesis", async () => {
    const records = await chain(5);
    const { fetch, calls } = serve(records);
    const out = await verifyChain({ fetch, pageSize: 2 });
    expect(out).toMatchObject({ ok: true, checked: 5, complete: true, tip: { seq: 5 } });
    expect(calls).toHaveLength(3);
  });
  it("stops at the first tampered record", async () => {
    const records = await chain(4);
    records[2] = { ...records[2]!, tokens: 999 };
    const out = await verifyChain({ fetch: serve(records).fetch });
    expect(out.ok).toBe(false);
    expect(out.firstProblem?.seq).toBe(3);
    expect(out.checked).toBe(2);
  });
  it("respects maxRecords", async () => {
    const out = await verifyChain({ fetch: serve(await chain(5)).fetch, maxRecords: 3 });
    expect(out).toMatchObject({ ok: true, checked: 3, complete: false });
  });
});

describe("receiptId", () => {
  it("accepts ids and both URL forms", () => {
    expect(receiptId("req_1")).toBe("req_1");
    expect(receiptId("https://dapp.inferva.xyz/receipt/req_2")).toBe("req_2");
    expect(receiptId("https://dapp.inferva.xyz/api/receipts/req_3?x=1")).toBe("req_3");
  });
});
