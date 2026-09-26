import { describe, expect, test } from "bun:test";
import { linkSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { bunEnv, bunExe, bunRun, isMacOS, spawnLookupLoop, tempDir } from "../../../harness"; // for expect().toSpawn()

describe("Bun.main", () => {
  test("can be overridden", () => {
    expect(Bun.main).toBeString();
    const override = { foo: "bar" };
    // types say Bun.main is a readonly string, but we want to write it
    // and check it can be set to a non-string
    (Bun as any).main = override;
    expect(Bun.main as any).toBe(override);
  });

  test.concurrent("override is reset when switching to a new test file", async () => {
    // `bun test` writes its summary to stderr, so check exitCode directly instead of .toSpawn().
    const { stderr, exitCode } = await bunRun([
      "test",
      join(import.meta.dir, "bun-main-test-fixture-1.ts"),
      join(import.meta.dir, "bun-main-test-fixture-2.ts"),
    ]);
    expect(stderr).toContain("1 pass");
    expect(exitCode).toBe(0);
  });

  // fcntl(F_GETPATH) names a file that has several hard links by the link that any process looked up
  // last. Linux names the link that was opened.
  test.skipIf(!isMacOS)(
    "names the hard link that was run while another process looks up a different link",
    async () => {
      using dir = tempDir("bun-main-hard-link", {
        original: { "original.js": `console.log(JSON.stringify([process.argv[1], Bun.main, import.meta.path]));` },
        linked: {},
      });
      const root = realpathSync(String(dir));
      const original = join(root, "original", "original.js");
      const link = join(root, "linked", "link.js");
      linkSync(original, link);

      await using lookups = await spawnLookupLoop(original);

      // Each run is one sample.
      const run = async () => {
        await using proc = Bun.spawn({ cmd: [bunExe(), link], env: bunEnv, stdout: "pipe", stderr: "pipe" });
        const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
        return JSON.stringify({ stdout: stdout.trim(), stderr, exitCode });
      };
      const seen: Record<string, number> = {};
      for (let batch = 0; batch < 8; batch++) {
        for (const result of await Promise.all(Array.from({ length: 8 }, run))) {
          seen[result] = (seen[result] ?? 0) + 1;
        }
      }
      expect(lookups.exitCode).toBeNull();
      expect(seen).toEqual({
        [JSON.stringify({ stdout: JSON.stringify([link, link, link]), stderr: "", exitCode: 0 })]: 64,
      });
    },
  );
});
