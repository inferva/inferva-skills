import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { MAX_DESCRIPTION, loadSkills, parseSkillFile, validateMeta } from "../src/skills.js";

const REPO = join(import.meta.dirname, "..");
const ROOT = join(REPO, "skills");
const folders = readdirSync(ROOT, { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name);

const EXPECTED = ["inferva-connect", "inferva-cost-check", "inferva-error-recovery", "inferva-receipt-audit", "inferva-tier-planner"];

describe("every SKILL.md", () => {
  it("ships the v0.1 skill set", () => {
    expect(folders.sort()).toEqual(EXPECTED);
  });

  for (const folder of folders) {
    describe(folder, () => {
      const file = join(ROOT, folder, "SKILL.md");
      it("has a SKILL.md", () => expect(existsSync(file)).toBe(true));
      const { meta, body } = parseSkillFile(readFileSync(file, "utf8"));
      it("has valid frontmatter (name matches folder, description within limits)", () => {
        expect(validateMeta(meta, folder)).toEqual([]);
        expect(meta.description!.length).toBeGreaterThan(80);
        expect(meta.description!.length).toBeLessThanOrEqual(MAX_DESCRIPTION);
        expect(meta.description).toMatch(/Use (when|whenever|before)/);
      });
      it("has a body with steps and failure modes", () => {
        expect(body).toMatch(/^# /m);
        expect(body).toMatch(/## (Steps|By type)/);
        expect(body).toMatch(/## Failure modes/);
      });
      it("references only scripts that exist", () => {
        for (const m of body.matchAll(/skills\/([a-z-]+)\/scripts\/([a-z-]+\.ts)/g))
          expect(existsSync(join(ROOT, m[1]!, "scripts", m[2]!)), m[0]).toBe(true);
      });
    });
  }

  it("loadSkills() loads all of them", () => {
    expect(loadSkills(ROOT).map((s) => s.meta.name)).toEqual(EXPECTED);
  });
});

describe("parseSkillFile", () => {
  it("rejects a missing frontmatter block and unquoted YAML syntax", () => {
    expect(() => parseSkillFile("# no frontmatter")).toThrow();
    expect(() => parseSkillFile("---\nname: x\ndescription: a: b\n---\nbody")).toThrow(/quoted/);
  });
});

// No real-looking agent keys anywhere in the repo.
const FORBIDDEN = [/inf_sk_[A-Za-z0-9]{12,}/];
const SKIP = new Set(["node_modules", "dist", ".git", "pnpm-lock.yaml", "skills.test.ts"]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const p = join(dir, name);
    return statSync(p).isDirectory() ? files(p) : [p];
  });
}

describe("no secrets", () => {
  for (const file of files(REPO)) {
    it(relative(REPO, file), () => {
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) expect(re.test(text), `${re} in ${relative(REPO, file)}`).toBe(false);
    });
  }
});
