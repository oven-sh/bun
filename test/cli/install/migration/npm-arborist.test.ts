import { describe, expect, setDefaultTimeout, test } from "bun:test";
import { arboristFixtures, fixture, readLock, run } from "./migration-harness";

setDefaultTimeout(1000 * 60 * 5);

// Every lockfile under npm-arborist/ is migrated and round-tripped through --frozen-lockfile; the report is snapshotted.
describe("package-lock.json migration fixes", () => {
  describe("arborist fixtures", () => {
    // Snapshot matchers are unsupported inside a concurrent group, so these stay sequential.
    test.each(arboristFixtures.map(f => f.name))("%s", async name => {
      using dir = fixture(name);
      const { stderr, exitCode } = await run(dir, "pm", "migrate");
      const report = [stderr.replace(/^\[[\d.]+m?s\] /gm, "").trimEnd(), `bun pm migrate exit code: ${exitCode}`];
      if (exitCode === 0) {
        const { text } = await readLock(dir);
        const check = await run(dir, "install", "--frozen-lockfile", "--lockfile-only");
        report.push(`bun install --frozen-lockfile exit code: ${check.exitCode}`, "", text);
      }
      expect(report.join("\n")).toMatchSnapshot();
    });
  });
});
