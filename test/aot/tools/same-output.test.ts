// ./same-output.ts says whether two builds of Bun compile a program to the same IR and the same machine code.
import { expect } from "bun:test";
import { chmodSync, writeFileSync } from "fs";
import { bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { describe, test } from "../supported";
import { compareProgram, functionsOf } from "./same-output";

describe("same-output", () => {
  test("a Bun generates the same output as itself", async () => {
    using folder = tempDir("aot-same-output", {
      "program.ts": `function add(values: number[]): number {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
}
console.log(add([1, 2, 3]), [..."abc"].map(letter => letter.toUpperCase()).join(""));
`,
    });
    expect(
      await compareProgram(bunExe(), bunExe(), join(String(folder), "program.ts"), join(String(folder), "work")),
    ).toBeUndefined();
  }, 120_000);

  test.skipIf(isWindows)(
    "a flag that changes the code is reported",
    async () => {
      using folder = tempDir("aot-same-output-flag", {
        "program.ts": `class Point {
  constructor(public x: number, public y: number) {}
}
let sum = 0;
for (let i = 0; i < 1000; i++) sum += new Point(i, 1).x;
console.log(sum);
`,
      });
      const program = join(String(folder), "program.ts");
      // The wrapper adds a flag to every build, so it stands in for a Bun whose compiler does something else.
      const wrapper = join(String(folder), "other-bun");
      writeFileSync(wrapper, `#!/bin/sh\nexec "${bunExe()}" "$@" --aot-heat=everything-is-cold\n`);
      chmodSync(wrapper, 0o755);
      const difference = await compareProgram(bunExe(), wrapper, program, join(String(folder), "work"));
      expect(difference?.functions.length).toBeGreaterThan(0);
    },
    120_000,
  );

  test("functions of one name are told apart", () => {
    const code = Buffer.from([1, 2, 3, 4]);
    const map = [
      "F\t0\t0\t2\t0\t0\t0\tf\tmain\t0\t/a/b.ts\t7",
      "F\t1\t2\t2\t0\t0\t0\tf\tmain\t0\t/a/b.ts\t7",
      "T\t0\tstub",
    ].join("\n");
    expect([...functionsOf(map, code).keys()]).toEqual(["f (main) b.ts:7", "f (main) b.ts:7 #2"]);
  });
});
