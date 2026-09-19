/**
 * Each .github/workflows/update-<name>.yml asks GitHub for the latest release
 * of a repository. It reads the `<NAME>_COMMIT` pin in
 * scripts/build/deps/<name>.ts with sed, and opens a pull request that rewrites
 * the pin, also with sed, to the commit of that release. That only works when:
 *
 * - The repository it asks is the one the dep is fetched from. update-lolhtml.yml
 *   broke this way. The dep moved to the oven-sh/lol-html fork, the workflow
 *   still asked cloudflare/lol-html, and each weekly run proposed an upstream
 *   commit that bun cannot build. A dep that is fetched from a fork has no
 *   update workflow.
 * - Its sed patterns match the pin line. A renamed constant, or a comment at the
 *   end of the line, makes each weekly run fail, and nobody watches those runs.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

test("each update workflow agrees with its dep file", () => {
  const checked: string[] = [];
  for (const workflow of new Bun.Glob("update-*.yml").scanSync(workflowsDir)) {
    const text = readFileSync(join(workflowsDir, workflow), "utf8");
    const depFile = text.match(/^\s*DEP_FILE=(scripts\/build\/deps\/[\w-]+\.ts)$/m)?.[1];
    if (!depFile) {
      // update-sqlite3.yml and update-vendor.yml do not bump a pin in scripts/build/deps/.
      expect({ workflow, readsADepFile: text.includes("scripts/build/deps/") }).toEqual({
        workflow,
        readsADepFile: false,
      });
      continue;
    }
    const dep = readFileSync(join(repoRoot, depFile), "utf8");

    const asks = new Set(Array.from(text.matchAll(/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\//g), m => m[1]));
    // The `s/<pattern>/` of each sed call: one reads the pin, one rewrites it.
    const sedPatterns = Array.from(text.matchAll(/\bsed [^'\n]*'s\/([^/\n]+)\//g), m => m[1]);

    expect({
      workflow,
      asks: [...asks],
      sedCalls: sedPatterns.length,
      sedPatternsThatMissThePin: sedPatterns.filter(pattern => !new RegExp(pattern, "m").test(dep)),
    }).toEqual({
      workflow,
      asks: [dep.match(/^\s*repo: "([^"]+)",$/m)?.[1]],
      sedCalls: 2,
      sedPatternsThatMissThePin: [],
    });
    checked.push(workflow);
  }
  expect(checked.length).toBeGreaterThan(0);
});
