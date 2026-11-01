// test/aot/fuzz/fuzzilli/run-batch.ts builds many programs into one executable. A program that prints something else there than under `bun run` waits for a build of its own, and is judged there.
// A run that ends by its time judges what still waits, however few they are.
//
// The flags of the driver go to the build with --aot alone. `--define MARK=1` makes one of eight programs print something else in that executable and nowhere else.
//
// With `--checks-the-run-time` the executable runs once more with the checks of the run time switched on through the environment. What they report is kept, with the program that ran.
// One of eight programs stands in for them: where the variable is set it writes a line as they write it and ends the process as they do.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { slot, spawned, withoutCoreDump, withoutCrashReport } from "./harness/commands";
import { describe, test } from "./supported";

const plain = (value: number) => `const printValue = console.log;\nprintValue("v", ${value});\nexport {};\n`;
const asksForTheMark = `const printValue = console.log;\n// @ts-ignore\nprintValue("mark", typeof MARK);\nexport {};\n`;
const reportsWhereTheChecksAreOn = `import { writeSync } from "node:fs";
const printValue = console.log;
printValue("reports", 1);
if (process.env.BUN_JSC_validateAOTRuntime === "1") {
  writeSync(2, "AOT validation: StandsInForAReport f0 v0\\n");
  process.abort();
}
export {};
`;

describe("compile/aot/the driver of generated programs", () => {
  test("judges a program that still waits when the time is over", async () => {
    using folder = tempDir("aot-the-driver-judges-what-waits", {
      ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`programs/p${index}.ts`, plain(index)])),
      "programs/p7.ts": asksForTheMark,
      "work/.keep": "",
    });
    const within = (name: string) => join(String(folder), name);
    const run = await slot(() =>
      spawned(
        [
          bunExe(),
          join(import.meta.dir, "fuzz", "fuzzilli", "run-batch.ts"),
          ...[
            "--bun",
            bunExe(),
            "--programs",
            within("programs"),
            "--work",
            within("work"),
            "--finds",
            within("finds"),
          ],
          ...["--count", "8", "--group", "1", "--together", "4", "--batches", "0", "--seconds", "1"],
          ...["--milliseconds", "5000"],
          "--flags=--aot-threads=1 --define MARK=1",
        ],
        String(folder),
        bunEnv,
        240_000,
      ),
    );
    expect(run.stdout).toContain(`"taken":8,`);
    expect(run.stdout).toContain(`"same":7,"prints something else beside the others":1`);
    const kept = readdirSync(within("finds")).filter(name => name.startsWith("stdout-"));
    expect(kept).toHaveLength(1);
    const [size] = readdirSync(within(join("finds", kept[0])));
    const report = readFileSync(within(join("finds", kept[0], size, "report.txt")), "utf8");
    expect(report).toContain("compiled: mark number");
    expect(report).toContain("bun run:  mark undefined");
    expect(run.exitCode).toBe(0);
  }, 300_000);

  test("keeps what the checks of the run time report, with the program that ran", async () => {
    using folder = tempDir("aot-the-driver-keeps-reports-of-the-run-time", {
      ...Object.fromEntries(Array.from({ length: 7 }, (_, index) => [`programs/p${index}.ts`, plain(index)])),
      "programs/p7.ts": reportsWhereTheChecksAreOn,
      "work/.keep": "",
    });
    const within = (name: string) => join(String(folder), name);
    const run = await slot(() =>
      spawned(
        withoutCoreDump([
          bunExe(),
          join(import.meta.dir, "fuzz", "fuzzilli", "run-batch.ts"),
          ...[
            "--bun",
            bunExe(),
            "--programs",
            within("programs"),
            "--work",
            within("work"),
            "--finds",
            within("finds"),
          ],
          ...["--count", "8", "--group", "1", "--together", "4", "--batches", "1", "--checks-the-run-time", "100"],
          ...["--milliseconds", "5000"],
          "--flags=--aot-threads=1",
        ]),
        String(folder),
        { ...bunEnv, ...withoutCrashReport },
        240_000,
      ),
    );
    expect(run.stdout).toContain(`"same":8,`);
    expect(run.stdout).toContain(`"the checks of the run time report nothing":4`);
    expect(run.stdout).toContain(`"run-time-check":1`);
    const kept = readdirSync(within("finds")).filter(name => !/^(?:counters-|index\.txt$)/.test(name));
    expect(kept).toEqual([expect.stringMatching(/^run-time-check-[0-9a-f]{8}$/)]);
    const [size] = readdirSync(within(join("finds", kept[0])));
    const read = (name: string) => readFileSync(within(join("finds", kept[0], size, name)), "utf8");
    expect(read("report.txt")).toContain("the executable runs with BUN_JSC_validateAOTRuntime=1");
    expect(read("report.txt")).toContain("AOT validation: StandsInForAReport f0 v0");
    expect(read("program.ts")).toBe(reportsWhereTheChecksAreOn);
    expect(run.exitCode).toBe(0);
  }, 300_000);
});
