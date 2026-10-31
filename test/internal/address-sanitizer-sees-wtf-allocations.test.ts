import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";
import { run } from "../aot/harness/run";

test.skipIf(!isASAN)("AddressSanitizer reports a read of a freed WTF::StringImpl", async () => {
  const { Malloc: _, ...env } = bunEnv;
  const { stdout, stderr, exitCode } = await run(
    [bunExe(), "-e", `console.log("read", require("bun:internal-for-testing").readFreedStringUnderASAN());`],
    undefined,
    env,
  );
  expect(stderr).toContain("AddressSanitizer: heap-use-after-free");
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});

test.skipIf(isASAN)("the hook does nothing in a build without AddressSanitizer", () => {
  expect(require("bun:internal-for-testing").readFreedStringUnderASAN()).toBeUndefined();
});
