// Fixed seeds of ../fuzz/live-values-handed-to-validate.ts: generated types, and samples of them that are dressed up as live JavaScript values can be: behind proxies, with accessors that answer otherwise the
// second time or change what is being read, with holes, other prototypes, other storage, from another realm. Each test builds one generated program with `bun build --compile --aot` and runs a part of its
// dressed samples, and a smaller part with a collection at every n-th allocation that leaves the fast path. The program judges itself: see the head of the generator.
import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { program } from "../fuzz/live-values-handed-to-validate";
import { run } from "../harness/run";
import { test } from "../supported";

test.concurrent.each([1, 2, 3, 4, 5, 6])(
  "8 generated types, seed %d",
  async seed => {
    using dir = tempDir("live-values-handed-to-validate", { "program.ts": program(seed, 8) });
    const outfile = join(String(dir), "program" + (isWindows ? ".exe" : ""));
    const { stderr: said, exitCode: built } = await run(
      [bunExe(), "build", "--compile", "--aot", "./program.ts", "--outfile", outfile],
      String(dir),
    );
    expect({ said: built ? said : "", built }).toEqual({ said: "", built: 0 });
    for (const [oneIn, env] of [
      [6, {}],
      [150, { BUN_JSC_slowPathAllocsBetweenGCs: String(seed + 10) }],
    ] as const) {
      const { stdout, stderr, exitCode } = await run([outfile, String(oneIn), String(seed)], String(dir), {
        ...bunEnv,
        ...env,
      });
      const lines = stdout.trim().split("\n");
      expect({ oneIn, lines: lines.slice(0, -1) }).toEqual({ oneIn, lines: [] });
      expect(lines.at(-1)).toEndWith(" answers that do not hold 0");
      expect({ stderr, exitCode }).toEqual({ stderr: "", exitCode: 0 });
    }
  },
  600_000,
);
