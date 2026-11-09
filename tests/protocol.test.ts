import { describe, expect, it } from "vitest";
import { quote, settlementPayload, sha256Hex, tierCeiling, tierFor, tierLadder } from "../src/protocol.js";
import { PARAMS, RECORD_1 } from "./fixtures.js";

describe("quote", () => {
  it("matches a real settled record (192 tokens at 1.8 USDC per 1M, no tier)", () => {
    const q = quote(192, 1800, 0, PARAMS);
    expect(q).toMatchObject({ base: RECORD_1.base, discount: 0, fee: RECORD_1.fee, toSponsor: RECORD_1.to_sponsor });
    expect(q.total).toBe(q.base - q.discount + q.fee);
    expect(q.toStakers + q.toSponsor + q.toTreasury).toBe(q.fee);
  });
  it("applies the discount to the provider cost only", () => {
    const q = quote(1_000_000, 1000, 1000, PARAMS);
    expect(q.base).toBe(1_000_000);
    expect(q.discount).toBe(100_000);
    expect(q.fee).toBe(100_000);
    expect(q.total).toBe(1_000_000);
  });
});

describe("tiers", () => {
  it("places stakes on the ladder from params", () => {
    expect(tierFor(0, PARAMS).name).toBe("No tier");
    expect(tierFor(PARAMS.tier1_stake, PARAMS).level).toBe(1);
    expect(tierFor(PARAMS.tier2_stake - 1, PARAMS).level).toBe(1);
    expect(tierFor(PARAMS.tier3_stake * 2, PARAMS).level).toBe(3);
  });
  it("sets priority from Tier 2 and raises the congestion ceiling per tier", () => {
    const ladder = tierLadder(PARAMS);
    expect(ladder.map((t) => t.priority)).toEqual([false, false, true, true]);
    expect(ladder.map((t) => t.congestionCeiling)).toEqual([480, 519, 559, 600]);
    expect(tierCeiling(3, PARAMS)).toBe(PARAMS.congestion_capacity_rpm);
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
