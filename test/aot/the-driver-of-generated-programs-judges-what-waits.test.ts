// test/aot/fuzz/fuzzilli/run-batch.ts builds many programs into one executable. A program that prints something else there than under `bun run` waits for a build of its own, and is judged there.
// A run that ends by its time judges what still waits, however few they are.
//
// The flags of the driver go to the build with --aot alone. `--define MARK=1` makes one of eight programs print something else in that executable and nowhere else.
//
// With `--checks-the-run-time` the executable runs once more with the checks of the run time switched on through the environment. What they report is kept, with the program that ran.
// One of eight programs stands in for them: where the variable is set it writes a line as they write it and ends the process as they do.
//
// `this` of a module is `undefined` in the executable and `null` under `bun run`. The driver passes over that difference, and over no other `null` that became `undefined`:
// a generator lays statements into the body of a method as they are, and the `this` of such a method is not the module's.
//
// The two runs spell the text of a function differently, and the driver passes over that. A program that prints the word "function", as `typeof` does, shows no such text.
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
const aNullBecomesUndefinedBesideAMethod = `const printValue = console.log;
class Holder {
  value = 1;
  get() {
return this.value;
  }
}
printValue("held", new Holder().get());
// @ts-ignore
printValue("fault", typeof MARK === "number" ? undefined : null);
export {};
`;
const readsThisOfTheModule = `const printValue = console.log;
const kept: (() => unknown)[] = [];
class Made {
  get at() {
kept.push(() => this);
    return 1;
  }
}
// @ts-ignore
class Derived extends (kept.push(() => this), Made) {}
printValue("at", new Derived().at);
printValue("module", typeof this);
printValue("kept", kept.map(look => typeof look()).join());
export {};
`;
const aNumberChangesBesideAPrintedTypeof = `const printValue = console.log;
function helper() {
  return 1;
}
printValue("kind", typeof helper, helper());
// @ts-ignore
printValue("fault", typeof MARK === "number" ? 2 : 1);
export {};
`;
const printsTheTextOfAFunction = `const printValue = console.log;
const record = { method() { return 1; } };
printValue("text", String(record.method));
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

  test("passes over `this` of the module and keeps another null that became undefined", async () => {
    using folder = tempDir("aot-the-driver-knows-this-of-the-module", {
      "programs/p0.ts": aNullBecomesUndefinedBesideAMethod,
      "programs/p1.ts": readsThisOfTheModule,
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
          ...["--count", "2", "--group", "1", "--batches", "1"],
          ...["--milliseconds", "5000"],
          "--flags=--aot-threads=1 --define MARK=1",
        ],
        String(folder),
        bunEnv,
        240_000,
      ),
    );
    expect(run.stdout).toContain(`"taken":2,`);
    expect(run.stdout).toContain(`"documented difference":1`);
    const kept = readdirSync(within("finds")).filter(name => !/^(?:counters-|index\.txt$)/.test(name));
    expect(kept).toEqual([expect.stringMatching(/^stdout-[0-9a-f]{8}$/)]);
    const [size] = readdirSync(within(join("finds", kept[0])));
    const read = (name: string) => readFileSync(within(join("finds", kept[0], size, name)), "utf8");
    expect(read("report.txt")).toContain("compiled: fault undefined");
    expect(read("report.txt")).toContain("bun run:  fault null");
    expect(read("program.ts")).toBe(aNullBecomesUndefinedBesideAMethod);
    expect(run.exitCode).toBe(0);
  }, 300_000);

  test("passes over the text of a function and keeps what else differs where `typeof` says function", async () => {
    using folder = tempDir("aot-the-driver-knows-the-text-of-a-function", {
      "programs/p0.ts": aNumberChangesBesideAPrintedTypeof,
      "programs/p1.ts": printsTheTextOfAFunction,
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
          ...["--count", "2", "--group", "1", "--batches", "1"],
          ...["--milliseconds", "5000"],
          "--flags=--aot-threads=1 --define MARK=1",
        ],
        String(folder),
        bunEnv,
        240_000,
      ),
    );
    expect(run.stdout).toContain(`"taken":2,`);
    expect(run.stdout).toContain(`"function text":1`);
    const kept = readdirSync(within("finds")).filter(name => !/^(?:counters-|index\.txt$)/.test(name));
    expect(kept).toEqual([expect.stringMatching(/^stdout-[0-9a-f]{8}$/)]);
    const [size] = readdirSync(within(join("finds", kept[0])));
    const read = (name: string) => readFileSync(within(join("finds", kept[0], size, name)), "utf8");
    expect(read("report.txt")).toContain("compiled: fault 2");
    expect(read("report.txt")).toContain("bun run:  fault 1");
    expect(read("program.ts")).toBe(aNumberChangesBesideAPrintedTypeof);
    expect(run.exitCode).toBe(0);
  }, 300_000);
});
