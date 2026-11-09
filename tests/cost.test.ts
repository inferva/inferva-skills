import { describe, expect, it } from "vitest";
import { estimateWorstCase, explainInfervaBlock, prepareMessages, routeFor, expectedCost, type InfervaBlock } from "../src/cost.js";
import { estimate, explain } from "../skills/inferva-cost-check/scripts/estimate.js";
import { LIMITS, PARAMS, PROVIDERS, mockFetch } from "./fixtures.js";

describe("routeFor", () => {
  it("auto picks the lowest blended price scaled by weight", () => {
    // c-cheap: 1.0 blended × (100/50) = 2.0; b-fast: 1.8; b-mini: 2.0; a-large: 3.0
    expect(routeFor("auto", PROVIDERS)?.model).toBe("b-fast");
  });
  it("an exact id routes to the provider serving it; unknown ids and paused providers do not route", () => {
    expect(routeFor("A-LARGE", PROVIDERS)?.providerId).toBe("prv_a");
    expect(routeFor("off", PROVIDERS)).toBeNull();
    expect(routeFor("nope", PROVIDERS)).toBeNull();
  });
  it("auto stays inside a key's allowed models", () => {
    expect(routeFor("auto", PROVIDERS, ["a-large", "c-cheap"])?.model).toBe("c-cheap");
  });
  it("prices input and output separately for the actual split", () => {
    const r = routeFor("b-fast", PROVIDERS)!;
    expect(r.worstPer1k).toBe(2600);
    expect(r.priceFor(1000, 0)).toBe(1000);
    expect(r.priceFor(0, 1000)).toBe(2600);
    expect(expectedCost(r, 500, 500, PARAMS).base).toBe(1800);
  });
});

describe("prepareMessages", () => {
  it("keeps the last N, cuts long text, maps roles and drops empty messages", () => {
    const msgs = [
      ...Array.from({ length: 25 }, (_, i) => ({ role: "user", content: `m${i}` })),
      { role: "system", content: [{ type: "text", text: "x".repeat(9000) }] },
      { role: "assistant", content: "" },
    ];
    const out = prepareMessages(msgs, LIMITS);
    expect(out).toHaveLength(19);
    expect(out[0]!.content).toBe("m7");
    expect(out.at(-1)!.role).toBe("user");
    expect(out.at(-1)!.content).toHaveLength(8000);
  });
});

describe("estimateWorstCase", () => {
  it("uses ceil(chars / 3) + max_tokens at the higher price", () => {
    const w = estimateWorstCase({ messages: [{ role: "user", content: "a".repeat(30) }], model: "b-fast", max_tokens: 90 }, { params: PARAMS, providers: PROVIDERS, limits: LIMITS });
    expect(w.worstTokens).toBe(100);
    expect(w.quote.base).toBe(260);
    expect(w.quote.fee).toBe(26);
    expect(w.worstTotalUsdg).toBeCloseTo(0.000286, 9);
    expect(w.quote.toSponsor + w.quote.toTreasury).toBe(26);
  });
  it("clamps max_tokens", () => {
    const w = estimateWorstCase({ messages: [{ content: "hi" }], max_tokens: 99_999 }, { params: PARAMS, providers: PROVIDERS, limits: LIMITS });
    expect(w.maxTokens).toBe(1024);
    expect(w.quote.total).toBe(w.quote.base + w.quote.fee);
    expect(w.notes.join(" ")).toMatch(/capped/);
  });
  it("mirrors the endpoint's rejections", () => {
    const ctx = { params: PARAMS, providers: PROVIDERS, limits: LIMITS };
    expect(() => estimateWorstCase({ messages: [] }, ctx)).toThrow(/messages/);
    expect(() => estimateWorstCase({ messages: [{ content: "" }] }, ctx)).toThrow(/400/);
    expect(() => estimateWorstCase({ messages: [{ content: "x" }], model: "nope" }, ctx)).toThrow(/404/);
    expect(() => estimateWorstCase({ messages: [{ content: "x" }], model: "a-large" }, { ...ctx, allowed: ["b-mini"] })).toThrow(/403/);
  });
});

const block: InfervaBlock = {
  provider: "Provider B",
  cost_usdg: 0.0011,
  breakdown: { provider_cost: 0.001, protocol_fee: 0.0001, to_sponsor: 0.00008, to_treasury: 0.00002 },
  capacity: "cap_x",
  epoch: 42,
  settlement: { hash: "a".repeat(64), prev_hash: "b".repeat(64) },
  receipt: "https://dapp.inferva.xyz/receipt/req_abc",
};

describe("explainInfervaBlock", () => {
  it("accepts a consistent block and extracts the request id", () => {
    const e = explainInfervaBlock(block);
    expect(e.ok).toBe(true);
    expect(e.requestId).toBe("req_abc");
    expect(e.lines[0]).toContain("0.0011 USDG");
  });
  it("flags arithmetic that does not add up", () => {
    const e = explainInfervaBlock({ ...block, cost_usdg: 0.002, breakdown: { ...block.breakdown, to_treasury: 0.1 } });
    expect(e.ok).toBe(false);
    expect(e.problems).toHaveLength(2);
  });
  it("explain() takes a whole response or the bare block", () => {
    expect(explain({ inferva: block }).ok).toBe(true);
    expect(() => explain({} as never)).toThrow(/no inferva block/);
  });
});

describe("estimate() reads everything live", () => {
  it("fetches params, providers and limits", async () => {
    const { fetch, calls } = mockFetch({
      "/api/params": { params: PARAMS, info: {} },
      "/api/providers": PROVIDERS,
      "/api/agents/catalog": { models: [], fee_bps: PARAMS.fee_bps, limits: LIMITS, window_days: 30 },
    });
    const out = await estimate({ messages: [{ role: "user", content: "hello" }], max_tokens: 10 }, { fetch });
    expect(calls.sort()).toEqual(["/api/agents/catalog", "/api/params", "/api/providers"]);
    expect(out.route.model).toBe("b-fast");
    expect(out.quote.total).toBe(out.quote.base + out.quote.fee);
  });
});
