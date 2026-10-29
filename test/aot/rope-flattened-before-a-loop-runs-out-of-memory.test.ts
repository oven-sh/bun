// A loop in a try block slices a rope. The compiler flattens the rope once, before the loop, under the exception handler of the loop.
// When that runs out of memory, the finally and catch blocks see the variables as they were before the first iteration.
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { describe, test } from "./supported";

const program = `function f(a, t) {
  let s = String(a);
  try {
    if (a & 1) {
      try {
        let c = 1;
        do {
          s = t.slice(1) + "q";
        } while (--c > 0);
      } finally {
      }
    }
  } catch (thrown) {
    console.log(thrown.constructor.name);
  }
  return s.length;
}
console.log(f(1, "xy"), f(2, "xy"));
console.log(f(1, "ab".repeat(2 ** 29) + "cd".repeat(2 ** 28)));
`;

describe("compile/aot/rope-flattened-before-a-loop-runs-out-of-memory", () => {
  // A limit on address space is how the test makes memory scarce. AddressSanitizer reserves more than any such limit allows.
  test.skipIf(!isLinux || isASAN)("the handler reads the value from before the loop", async () => {
    using dir = tempDir("aot-rope-flattened-before-a-loop", { "main.js": program });
    const cwd = String(dir);
    built(
      await spawned([bunExe(), "build", "--compile", "--aot", "main.js", "--outfile", join(cwd, "main")], cwd, bunEnv),
    );
    const ran = await spawned(["sh", "-c", "ulimit -v 2097152 && exec ./main"], cwd, bunEnv);
    expect(ran).toEqual({ stdout: "2 1\nRangeError\n1\n", stderr: "", exitCode: 0, signal: null });
  });
});
