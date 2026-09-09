import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/41609
//
// The FTL dropped the in-bounds check of `codePointAt` and `String.prototype.at`
// when their result was only compared against `undefined`. The abstract
// interpreter folded the compare to `false`, the access node lost its last user,
// and DCE removed the node together with the speculation inside it. The
// optimized code then never saw the end of the string.
//
// Each probe warms up with in-bounds indices only, so no out-of-bounds exit is
// profiled before the FTL compiles it. It then reads at `length`.
test("optimized code keeps the bounds check of a string access whose result is dead", async () => {
  const source = `
      function shouldBe(actual, expected, what) {
        if (actual !== expected) throw new Error(what + ": got " + actual + ", expected " + expected);
      }

      function codePointAtIsUndefined(string, index) {
        return string.codePointAt(index) === undefined;
      }
      function atIsUndefined(string, index) {
        return string.at(index) === undefined;
      }
      function charCodeAtIsNaN(string, index) {
        const c = string.charCodeAt(index);
        return c !== c;
      }

      // The shape from the issue: @csstools/css-tokenizer's endOfFile() inlined
      // into a tokenizer step.
      function endOfFile(reader) {
        return void 0 === reader.source.codePointAt(reader.cursor);
      }
      function step(reader) {
        if (endOfFile(reader)) {
          reader.atEnd = true;
          return null;
        }
        reader.cursor++;
        return 1;
      }

      const latin1 = "Hello, World!";
      const utf16 = "こんにちは世界";

      // With the JIT thresholds below, the FTL compiles the probes after a few
      // hundred calls. 1000 leaves margin and stays fast on a debug build.
      for (let i = 0; i < 1000; ++i) {
        let index = i % latin1.length;
        shouldBe(codePointAtIsUndefined(latin1, index), false, "codePointAt latin1 in bounds");
        shouldBe(atIsUndefined(latin1, index), false, "at latin1 in bounds");
        shouldBe(charCodeAtIsNaN(latin1, index), false, "charCodeAt latin1 in bounds");
        index = i % utf16.length;
        shouldBe(codePointAtIsUndefined(utf16, index), false, "codePointAt utf16 in bounds");
        shouldBe(atIsUndefined(utf16, index), false, "at utf16 in bounds");
        shouldBe(charCodeAtIsNaN(utf16, index), false, "charCodeAt utf16 in bounds");
        step({ source: latin1, cursor: index % latin1.length, atEnd: false });
      }

      for (let i = 0; i < 10; ++i) {
        shouldBe(codePointAtIsUndefined(latin1, latin1.length), true, "codePointAt latin1 at length");
        shouldBe(atIsUndefined(latin1, latin1.length), true, "at latin1 at length");
        shouldBe(charCodeAtIsNaN(latin1, latin1.length), true, "charCodeAt latin1 at length");
        shouldBe(codePointAtIsUndefined(utf16, utf16.length), true, "codePointAt utf16 at length");
        shouldBe(atIsUndefined(utf16, utf16.length), true, "at utf16 at length");
        shouldBe(charCodeAtIsNaN(utf16, utf16.length), true, "charCodeAt utf16 at length");

        const reader = { source: latin1, cursor: latin1.length, atEnd: false };
        shouldBe(step(reader), null, "step at end");
        shouldBe(reader.atEnd, true, "reader.atEnd");
      }
      console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: {
      ...bunEnv,
      // Tier up fast and deterministically, like the JSTests stress harness.
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
      BUN_JSC_thresholdForOptimizeAfterWarmUp: "100",
      BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "1000",
      BUN_JSC_useConcurrentJIT: "false",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout).toBe("ok\n");
  expect(exitCode).toBe(0);
});
