import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import path from "node:path";
import { itBundled } from "./expectBundled";

// This file is inside test/bundler/, so this registers; the spawned run below asserts that it did.
describe("bundler", () => {
  itBundled("harness/RegisteredFromBundlerDir", {
    files: {
      "/entry.js": /* js */ `console.log("registered");`,
    },
    run: { stdout: "registered" },
  });
});

async function runBunTest(cwd: string, ...args: string[]) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "test", ...args],
    cwd,
    env: {
      ...bunEnv,
      // A developer's shell may carry these; they would change what the child registers.
      BUN_BUNDLER_TEST_FILTER: undefined,
      BUN_BUNDLER_TEST_USE_ESBUILD: undefined,
      BUN_BUNDLER_TEST_DEBUG: undefined,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { output: stdout + stderr, exitCode };
}

describe("itBundled must be called from a test file in test/bundler/", () => {
  // itBundled() registers nothing on Windows until #34552 lands (see the isWindows return in itBundled).
  test.skipIf(isWindows).concurrent("a test file in test/bundler/ registers its tests", async () => {
    const { output, exitCode } = await runBunTest(
      import.meta.dir,
      import.meta.path,
      "-t",
      "harness/RegisteredFromBundlerDir",
    );
    expect(output).toMatch(/^ 1 pass$/m);
    expect(output).toMatch(/^ 0 fail$/m);
    expect(exitCode).toBe(0);
  });

  test.concurrent.each(["itBundled", "itBundled.skip", "itBundled.only"])(
    "%s in a test file outside test/bundler/ fails the file instead of registering nothing",
    async register => {
      using dir = tempDir("expect-bundled-location", {
        "misplaced.test.ts": /* ts */ `
          import { itBundled } from ${JSON.stringify(path.join(import.meta.dir, "expectBundled.ts"))};
          ${register}("harness/Misplaced", { files: { "/entry.js": "" } });
        `,
      });
      const { output, exitCode } = await runBunTest(String(dir), "misplaced.test.ts");
      expect(output).toContain(
        `itBundled("harness/Misplaced") was called from ${path.join(String(dir), "misplaced.test.ts")}. ` +
          "All bundler tests must be placed in test/bundler/",
      );
      expect(output).toMatch(/^ 0 pass$/m);
      expect(exitCode).toBe(1);
    },
  );
});
