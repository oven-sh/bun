// Fixed seeds of ../fuzz/unions-handed-to-validate.ts: generated types full of unions that no tag tells apart, and values of them that are made while the program runs: samples of one member, samples of one member
// with parts of another laid over them, and either with one place spoiled, dressed as live JavaScript values can be and written out as text. Each test builds one generated program with `bun build --compile --aot`,
// runs it, and runs a smaller part with a collection at every n-th allocation that leaves the fast path. The program judges itself by the value that went in: see the head of the generator.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { program } from "../fuzz/unions-handed-to-validate";
import { run } from "../harness/run";
import { test } from "../supported";

test.concurrent.each([1, 2, 3, 4, 5, 6, 7, 8])(
  "24 generated types, seed %d",
  async seed => {
    using dir = tempDir("unions-handed-to-validate", { "program.ts": program(seed, 24) });
    const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
    const { stderr: said, exitCode: built } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
      String(dir),
    );
    expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
    for (const [values, env] of [
      [120, {}],
      [4, { BUN_JSC_slowPathAllocsBetweenGCs: String(seed + 10) }],
    ] as const) {
      const { stdout, stderr, exitCode } = await run([outfile, String(values), String(seed)], String(dir), {
        ...bunEnv,
        ...env,
      });
      const lines = stdout.trim().split("\n");
      expect({ values, lines: lines.slice(0, -1) }).toEqual({ values, lines: [] });
      expect(lines.at(-1)).toEndWith(" answers that do not hold 0");
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
  },
  600_000,
);
