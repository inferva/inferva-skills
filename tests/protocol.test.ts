import { describe, expect, it } from "vitest";
import { quote, settlementPayload, sha256Hex } from "../src/protocol.js";
import { PARAMS, RECORD_1 } from "./fixtures.js";

describe("quote", () => {
  it("matches a real settled record (192 tokens at 1.8 USDG per 1M) under the sponsor share it was settled with", () => {
    const q = quote(192, 1800, { ...PARAMS, sponsor_share_bps: 4000 });
    expect(q).toMatchObject({ base: RECORD_1.base, fee: RECORD_1.fee, toSponsor: RECORD_1.to_sponsor, toTreasury: RECORD_1.to_treasury });
    expect(q.total).toBe(q.base + q.fee);
  });
  it("gives the sponsor its share of the fee, rounded down, and the treasury the remainder", () => {
    const q = quote(1_000_000, 1000, PARAMS);
    expect(q.base).toBe(1_000_000);
    expect(q.fee).toBe(100_000);
    expect(q.toSponsor).toBe(80_000);
    expect(q.toTreasury).toBe(20_000);
    expect(q.total).toBe(1_100_000);
    const odd = quote(192, 1800, PARAMS);
    expect(odd.fee).toBe(35);
    expect(odd.toSponsor).toBe(28);
    expect(odd.toSponsor + odd.toTreasury).toBe(odd.fee);
  });
});

describe("settlement hash", () => {
  it("recomputes a real record's hash from the canonical payload", async () => {
    const payload = settlementPayload(RECORD_1, RECORD_1.prev_hash);
    expect(payload.split("|")).toHaveLength(12);
    expect(payload.startsWith(`${"0".repeat(64)}|req_`)).toBe(true);
    expect(await sha256Hex(payload)).toBe(RECORD_1.hash);
  });
});
