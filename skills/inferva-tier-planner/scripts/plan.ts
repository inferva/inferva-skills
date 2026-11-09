// Which stake moves the key owner to the next tier, from live parameters.
//
//   pnpm tsx skills/inferva-tier-planner/scripts/plan.ts --staked 2500
//   pnpm tsx skills/inferva-tier-planner/scripts/plan.ts --staked 0 --monthly-cost 40 --rate-limits <a,b,c,d>
import { fetchNetwork, fetchParams, type ApiOptions } from "../../../src/api.js";
import { isMain, num, parseFlags, runCli, str } from "../../../src/cli.js";
import { planTier } from "../../../src/tiers.js";

export async function plan(
  input: { stakedInfer: number; monthlyProviderCostUsdc?: number | null; rateLimits?: (number | null)[] | null },
  opts: ApiOptions = {},
) {
  const [{ params }, network] = await Promise.all([fetchParams(opts), fetchNetwork(opts).catch(() => null)]);
  const result = planTier({ ...input, params });
  return {
    ...result,
    network: network ? { load: network.load, capacity: network.capacity, congested: network.congested, openTiers: network.tiers.filter((t) => t.open).map((t) => t.name) } : null,
  };
}

if (isMain(import.meta.url)) {
  const f = parseFlags(process.argv.slice(2));
  void runCli(() => {
    const staked = num(f, "staked");
    if (staked === undefined) throw new Error("give --staked <INFER> (the key owner's current stake, 0 if none)");
    const rates = str(f, "rate-limits")?.split(",").map((x) => (x.trim() ? Number(x) : null)) ?? null;
    if (rates && (rates.length !== 4 || rates.some((r) => r !== null && !Number.isFinite(r)))) throw new Error("--rate-limits needs 4 comma-separated numbers: No tier, Tier 1, Tier 2, Tier 3");
    return plan({ stakedInfer: staked, monthlyProviderCostUsdc: num(f, "monthly-cost") ?? null, rateLimits: rates }, { baseUrl: str(f, "base-url") });
  });
}
