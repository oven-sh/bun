import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "node:path";
import { run as spawned } from "./harness/run";
import { withoutCoreDump, withoutCrashReport } from "./run-programs";
import { describe, test } from "./supported";

// --aot-testing=CheckProofsAtRunTime builds the product's code and asks at run time what that code takes on trust. These tests plant false proofs to see that it finds them:
// --aot-testing=ProveEverything makes the compiler take every declared type for proven, and the programs hand over values that are not of their declared types.
const checked = "--aot-testing=CheckProofsAtRunTime";
const planted = "--aot-testing=ProveEverything";

const programs: Record<string, { text: string; printed: string; stop: RegExp }> = {
  "an object of another class": {
    text: `class Point {
  x = 1.5;
  label = "point";
}
class Other {
  label = "other";
  extra = 7;
}
function read(held: Point): string {
  return held.label + " " + held.x;
}
const values: unknown[] = [new Point(), new Other()];
let out = "";
for (let turn = 0; turn < 4; turn++) out += read(values[turn & 1] as Point) + "|";
console.log(out);
`,
    printed: "point 1.5|other undefined|point 1.5|other undefined|\n",
    stop: /^AOT validation: AssumedType f\d+ v\d+ object Object$/m,
  },
  "a string for a number": {
    text: `function twice(value: number): number {
  return value * 2;
}
const values: unknown[] = [1, "two", 3];
console.log(values.map(value => twice(value as number)).join());
`,
    printed: "2,NaN,6\n",
    stop: /^AOT validation: AssumedType f\d+ v\d+ string$/m,
  },
};

async function buildAndRun(cwd: string, name: string, flags: string[]) {
  const built = await spawned(
    [bunExe(), "build", "--compile", "--aot", ...flags, "program.ts", "--outfile", name],
    cwd,
  );
  expect(built.stderr).not.toContain("error:");
  expect(built.exitCode).toBe(0);
  return spawned(withoutCoreDump([join(cwd, name)]), cwd, { ...bunEnv, ...withoutCrashReport });
}

describe.concurrent.each(Object.entries(programs))(
  "%s where another type is declared",
  (_, { text, printed, stop }) => {
    test("is answered as in plain Bun by a build that checks its proofs", async () => {
      using folder = tempDir("aot-proofs-checked", { "program.ts": text });
      const { stdout, stderr, exitCode } = await buildAndRun(String(folder), "checked", [checked]);
      expect({ stdout, stderr, exitCode }).toEqual({ stdout: printed, stderr: "", exitCode: 0 });
    }, 120_000);

    test("is a named stop once the declared types are taken for proven", async () => {
      using folder = tempDir("aot-proofs-checked", { "program.ts": text });
      const { stdout, stderr, exitCode } = await buildAndRun(String(folder), "planted", [checked, planted]);
      expect(stderr).toMatch(stop);
      expect(stdout).toBe("");
      expect(exitCode).not.toBe(0);
    }, 120_000);

    test("is no named stop without the checks: the false proof is there", async () => {
      using folder = tempDir("aot-proofs-checked", { "program.ts": text });
      const { stdout, stderr } = await buildAndRun(String(folder), "unchecked", [planted]);
      expect(stderr).not.toContain("AOT validation:");
      expect(stdout).not.toBe(printed);
    }, 120_000);
  },
);
