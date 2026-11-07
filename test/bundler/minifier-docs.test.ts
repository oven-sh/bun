// docs/bundler/minifier.mdx shows an Input and an Output for each transformation of the minifier.
// scripts/minifier-docs.ts generates the Output blocks with `bun build`. This test generates them again with the bun
// under test.
import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { buildWith, generated, pagePath } from "../../scripts/minifier-docs.ts";

test("docs/bundler/minifier.mdx shows what `bun build` prints", async () => {
  using dir = tempDir("minifier-docs", {});
  const page = readFileSync(pagePath, "utf8").replaceAll("\r\n", "\n");
  const { text, stale, problems, sections } = await generated(page, String(dir), buildWith(bunExe(), bunEnv));

  expect(problems).toEqual([]);
  expect(sections).toBeGreaterThan(50);
  const update = "bun bd scripts/minifier-docs.ts --write";
  expect(page, `Out of date: ${stale.join(", ")}. If the new Output is right, run \`${update}\`.`).toBe(text);
});
