import { describe, expect, it } from "vitest";
import { parseRateLimitMessage, planTier } from "../src/tiers.js";
import { plan } from "../skills/inferva-tier-planner/scripts/plan.js";
import { PARAMS, mockFetch } from "./fixtures.js";

describe("planTier", () => {
  it("computes the stake gap to the next tier from params", () => {
    const p = planTier({ stakedInfer: 2500, params: PARAMS });
    expect(p.current.name).toBe("Tier 1");
    expect(p.next?.name).toBe("Tier 2");
    expect(p.next?.additionalStakeInfer).toBe(7500);
    expect(p.notes[0]).toMatch(/7500 more INFER.*discount 5% → 10%.*priority/);
  });
  it("includes rate limits and savings only when given", () => {
    const bare = planTier({ stakedInfer: 0, params: PARAMS });
    expect(bare.current.ratePerMin).toBeNull();
    expect(bare.notes.join(" ")).toMatch(/not in \/api\/params/);
    const full = planTier({ stakedInfer: 0, params: PARAMS, rateLimits: [1, 2, 3, 4], monthlyProviderCostUsdc: 100 });
    expect(full.notes[0]).toMatch(/rate limit 1 → 2 req\/min/);
    expect(full.ladder.map((t) => t.monthlySavingsUsdc)).toEqual([0, 5, 10, 20]);
  });
  it("follows governance: changing a threshold changes the plan", () => {
    const p = planTier({ stakedInfer: 2500, params: { ...PARAMS, tier1_stake: 5_000_000_000 } });
    expect(p.current.name).toBe("No tier");
    expect(p.next?.additionalStakeInfer).toBe(2500);
  });
  it("tops out at Tier 3 and rejects bad input", () => {
    expect(planTier({ stakedInfer: 1e9, params: PARAMS }).next).toBeNull();
    expect(() => planTier({ stakedInfer: -1, params: PARAMS })).toThrow();
  });
});

describe("parseRateLimitMessage", () => {
  it("reads the tier and rate from a 429 message", () => {
    expect(parseRateLimitMessage("Rate limit for Tier 1 is 12 requests per minute. Stake more INFER to raise it.")).toEqual({ tier: "Tier 1", ratePerMin: 12 });
    expect(parseRateLimitMessage("something else")).toBeNull();
  });
});

describe("plan() reads params and network live", () => {
  it("works with or without the network meter", async () => {
    const { fetch } = mockFetch({
      "/api/params": { params: PARAMS, info: {} },
      "/api/network": { capacity: 600, thresholdBps: 8000, load: 500, congested: true, tiers: [{ tier: 0, name: "No tier", ceiling: 480, admitted: 0, deferred: 3, open: false }, { tier: 1, name: "Tier 1", ceiling: 519, admitted: 0, deferred: 0, open: true }] },
    });
    const out = await plan({ stakedInfer: 0 }, { fetch });
    expect(out.network).toEqual({ load: 500, capacity: 600, congested: true, openTiers: ["Tier 1"] });
    const noNet = await plan({ stakedInfer: 0 }, { fetch: mockFetch({ "/api/params": { params: PARAMS, info: {} } }).fetch });
    expect(noNet.network).toBeNull();
  });
});
