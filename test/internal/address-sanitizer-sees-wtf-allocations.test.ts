import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// WTF's fastMalloc has to end in the allocator that AddressSanitizer intercepts. Where another allocator serves it (libpas did, on Linux: bmalloc looked for the
// sanitizer's run time by dlsym, which does not find one that is linked statically), the sanitizer sees no use after free and no overflow of a string, of a Vector's
// buffer, of a hash table or of any fast-allocated object of WTF and JavaScriptCore, and says nothing. `Malloc=1` in the environment forces the system's allocator: not here.
test.skipIf(!isASAN)("AddressSanitizer reports a read of a freed WTF::StringImpl", async () => {
  const { Malloc, ...env } = bunEnv;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("read", require("bun:internal-for-testing").readFreedStringUnderASAN());`],
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toContain("AddressSanitizer: heap-use-after-free");
  expect(stdout).toBe("");
  expect(exitCode).not.toBe(0);
});

test.skipIf(isASAN)("the hook does nothing in a build without AddressSanitizer", () => {
  expect(require("bun:internal-for-testing").readFreedStringUnderASAN()).toBeUndefined();
});
