/**
 * Each .github/workflows/update-<name>.yml asks GitHub for the latest release
 * of a repository, and opens a pull request that sets the `<NAME>_COMMIT` pin
 * in scripts/build/deps/<name>.ts to the commit of that release. That only
 * works when the repository it asks is the one the dep is fetched from.
 *
 * update-lolhtml.yml broke this way. The dep moved to the oven-sh/lol-html
 * fork, the workflow still asked cloudflare/lol-html, and each weekly run
 * proposed an upstream commit that bun cannot build. A dep that is fetched
 * from a fork has no update workflow.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "..", "..", "..");
const workflowsDir = join(repoRoot, ".github", "workflows");

test("each update workflow asks the repository that its dep is fetched from", () => {
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

    const asks = new Set(Array.from(text.matchAll(/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\//g), m => m[1]));
    const fetches = readFileSync(join(repoRoot, depFile), "utf8").match(/^\s*repo: "([^"]+)",$/m)?.[1];
    expect({ workflow, asks: [...asks] }).toEqual({ workflow, asks: [fetches] });
    checked.push(workflow);
  }
  expect(checked.length).toBeGreaterThan(0);
});
