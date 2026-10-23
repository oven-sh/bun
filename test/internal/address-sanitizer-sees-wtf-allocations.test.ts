import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN } from "harness";

// On Linux libpas serves WTF's fastMalloc in a build with AddressSanitizer too, and the sanitizer does not intercept libpas: it sees no use after free and no overflow
// of a string, of a Vector's buffer, of a hash table or of any fast-allocated object of WTF and JavaScriptCore, and says nothing. `Malloc=1` in the environment makes
// bmalloc hand every allocation to the system's allocator, which the sanitizer does intercept. A hunt for memory faults with a sanitizer build sets it.
// It is not the default: LeakSanitizer then sees what WTF, JavaScriptCore and WebCore never free as well.
test.skipIf(!isASAN)("with Malloc=1 AddressSanitizer reports a read of a freed WTF::StringImpl", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", `console.log("read", require("bun:internal-for-testing").readFreedStringUnderASAN());`],
    env: { ...bunEnv, Malloc: "1" },
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
