import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// Coverage for the WebKit df289ce551 sync (oven-sh/WebKit#539). The case pins
// an observable behavior difference between the previous JSC and the new one.
// The previous engine crashes or returns a wrong value, so it runs in a child.

test("an eliminated arguments object is not rematerialized from slots a later varargs call overwrote (26aa84fcd5)", async () => {
  // Port of JSTests/stress/arguments-elimination-load-varargs-kills-promoted-recoveries.js.
  //
  // `a` and `b` are strict-mode `arguments` objects from two inlined
  // `Function.prototype.apply` calls. The DFG eliminates `a` to a
  // PhantomClonedArguments whose recovery points at the stack slots of the
  // first inlined frame. The second call lowers to LoadVarargs and reuses
  // those slots. Before the fix, OSR availability kept the stale recovery, so
  // the exit into the catch block rebuilt `a` from `values2`. At this
  // iteration count the old engine returns `values2`'s elements ("bad value:
  // [object Object],1,2,3,4,5"); with more iterations it reads a bogus length
  // and aborts in operationMaterializeObjectInOSR ("MemoryExhaustion").
  const source = `
      "use strict";
      function shouldBe(actual, expected) {
        if (actual !== expected) throw new Error("bad value: " + actual + ", expected: " + expected);
      }

      function five(values1, values2) {
        let result = null;
        for (let i = 0; i < 5; ++i) {
          function arg() { "use strict"; return arguments; }
          const a = arg.apply(undefined, values1);
          const b = arg.apply(undefined, values2);
          try {
            (3881)(b);
          } catch (error) {
            a.toString();
            result = a;
          }
        }
        return result;
      }

      function eight(values1, values2) {
        let result = null;
        for (let i = 0; i < 5; ++i) {
          function arg() { "use strict"; return arguments; }
          const a = arg.apply(undefined, values1);
          const b = arg.apply(undefined, values2);
          try {
            (3881)(b);
          } catch (error) {
            a.toString();
            result = a;
          }
        }
        return result;
      }

      function filled(length, value) {
        const result = [];
        for (let i = 0; i < length; ++i) result.push(value);
        return result;
      }

      const fiveMarker = { marker: "five" };
      const eightMarker = { marker: "eight" };
      const seedArray = [{ marker: "seed" }, 1, 2, 3, 4, 5];

      const firstFive = filled(5, fiveMarker);
      const overwriteFive = filled(30, fiveMarker);
      overwriteFive[22] = 9;

      const firstEight = filled(8, eightMarker);
      const overwriteEight = filled(30, eightMarker);
      overwriteEight[20] = 9;

      const testLoopCount = 500;
      for (let i = 0; i < testLoopCount; ++i) {
        five(firstFive, overwriteFive);
        eight(firstEight, overwriteEight);
      }

      const seedValues = filled(30, seedArray);
      seedValues[20] = 9;
      for (let i = 0; i < testLoopCount; ++i) eight(firstEight, seedValues);

      const recoveredEight = eight(firstEight, seedValues);
      shouldBe(recoveredEight.length, firstEight.length);
      for (let i = 0; i < firstEight.length; ++i) shouldBe(recoveredEight[i], eightMarker);

      const recoveredFive = five(firstFive, overwriteFive);
      shouldBe(recoveredFive.length, firstFive.length);
      for (let i = 0; i < firstFive.length; ++i) shouldBe(recoveredFive[i], fiveMarker);
      shouldBe(recoveredFive[5], undefined);
      console.log("ok");
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: {
      ...bunEnv,
      // The upstream test's options: tier up fast and deterministically.
      BUN_JSC_thresholdForJITAfterWarmUp: "10",
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
