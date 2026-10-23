// The module graph is a fact of the build, so what a module costs when the program starts does not depend on how it is written.
// Each row is one chain of modules, every module reading two exports of the one below it:
//
//   A  ES modules import ES modules                 B  ES modules `require("./m.mjs")` each other
//   C  A, and each module imports two names of a CommonJS file of its own
//   E  CommonJS requires CommonJS                   T  E written as ES modules: what E is measured against
//   D  E bundled into one file by `bun build` first
//   L  E with the `require` in a function           P  E with one read of `__dirname`          H  E with `Object.keys()` of what it required
//
// A row is built with three numbers of modules. What is asked of it:
//   - it prints what the chain computes;
//   - the build counted the forms it is meant to have (`--explain=statistics`): modules without a "has it started" byte, CommonJS
//     modules whose exports are variables, no copies of exports for ES importers, nothing recorded for `module.children`;
//   - no operation of the run time is called once per module;
//   - on Linux x64, in a release build, where ptrace is allowed: the instructions between the two marks around the `require` of the top
//     of the chain grow by no more than the bound of the row with each module, and grow in a straight line.
//
//   AOT_SLOPE=<letters>     only these rows
import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isMusl, isWindows, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  mark,
  whyInstructionsCannotBeCounted,
  type Counted,
  type Request,
} from "./instruction-counts/count-instructions";
import { built, slot, withoutDebugInformation } from "./run-programs";
import { describe, test, unsupported } from "./supported-with-counted-calls";

const sizes = [100, 300, 500];

const classOf = (i: number) => `class K { constructor() { this.v = ${i}; } get() { return this.v; } }\n`;
const esLeaf = "export const c = 1;\nexport function f(x) { return x + c; }\n";
const esRest = "export const c = a.c + 1;\nexport function f(x) { return (x & 1) ? a.f(x) + c : c; }\n";
const commonJsLeaf = '"use strict";\nexports.c = 1;\nexports.f = function (x) { return x + exports.c; };\n';
const commonJsRest =
  "exports.c = a.c + 1;\nexports.f = function (x) { return (x & 1) ? a.f(x) + exports.c : exports.c; };\n";
const imports = (i: number) => `import * as a from "./m${i - 1}.mjs";\n`;
const requires = (i: number) => `"use strict";\nconst a = require("./m${i - 1}");\n`;

type Statistics = Record<string, number>;
type Row = {
  extension: ".mjs" | ".js";
  /** The text of module i; module 0 requests nothing. */
  module: (i: number) => string;
  /** Further files that module i brings along. */
  beside?: (i: number) => Record<string, string>;
  bundledFirst?: boolean;
  /** What the build must have counted, at least, for a chain of n modules. */
  atLeast: (n: number) => Statistics;
  /** What it must have counted exactly. */
  exactly?: Statistics;
  /** Instructions that one more module may cost at start. */
  bound: number;
  /** The same, above what another row costs. */
  above?: { row: string; by?: number; times?: number };
  /** The row asks the run time for something in every module, on purpose. */
  asksTheRunTime?: boolean;
};

const rows: Record<string, Row> = {
  A: {
    extension: ".mjs",
    module: i => (i ? imports(i) + esRest : esLeaf),
    atLeast: n => ({ ModulesWithoutState: n }),
    bound: 11,
  },
  B: {
    extension: ".mjs",
    module: i => (i ? `const a = require("./m${i - 1}.mjs");\n` + esRest : esLeaf),
    atLeast: n => ({ ModulesWithoutState: n, RequireSitesBound: n - 1 }),
    bound: 25,
  },
  C: {
    extension: ".mjs",
    module: i =>
      i
        ? imports(i) +
          `import { one, g } from "./k${i}.cjs";\nexport const c = a.c + one;\nexport function f(x) { return (x & 1) ? g(a.f(x)) + c : c; }\n`
        : esLeaf,
    beside: i =>
      i ? { [`k${i}.cjs`]: '"use strict";\nexports.one = 1;\nexports.g = function (x) { return x; };\n' } : {},
    atLeast: n => ({ ModulesWithoutState: 2 * n - 1, ModulesWithNames: n - 1 }),
    exactly: { Faces: 0 },
    bound: 45,
  },
  T: {
    extension: ".mjs",
    module: i => (i ? imports(i) + esRest : esLeaf) + "export " + classOf(i),
    atLeast: n => ({ ModulesWithoutState: n }),
    bound: 30,
  },
  E: {
    extension: ".js",
    module: i => (i ? requires(i) + commonJsRest : commonJsLeaf) + classOf(i) + "exports.K = K;\n",
    atLeast: n => ({ ModulesWithoutState: n, ModulesWithNames: n, RequireSitesBound: n - 1 }),
    bound: 45,
    above: { row: "T", times: 1.5 },
  },
  D: {
    extension: ".js",
    module: i => (i ? requires(i) + commonJsRest : commonJsLeaf) + classOf(i) + "exports.K = K;\n",
    bundledFirst: true,
    atLeast: n => ({ ModulesWithoutState: n, ModulesWithNames: n }),
    bound: 55,
    above: { row: "E", by: 10 },
  },
  L: {
    extension: ".js",
    module: i =>
      i
        ? `"use strict";\nfunction load() { return require("./m${i - 1}"); }\nconst a = load();\n` + commonJsRest
        : commonJsLeaf,
    // `load` returns what it required, so the exports of each module are an object, the first one of a layout of its own. Nearly all of the
    // bound is the price of a first object of a layout, not of the module.
    atLeast: n => ({ ModulesWithState: n - 1, ModulesWithValue: n - 1 }),
    bound: isMusl ? 1750 : 1600,
    asksTheRunTime: true,
  },
  P: {
    extension: ".js",
    module: i => (i ? requires(i) + commonJsRest : commonJsLeaf) + "exports.d = __dirname.length;\n",
    atLeast: n => ({ ModulesWithoutState: n, ModulesWithNames: n }),
    bound: 60,
    above: { row: "E", by: 15 },
  },
  H: {
    extension: ".js",
    module: i => (i ? requires(i) + commonJsRest + "exports.n = Object.keys(a).length;\n" : commonJsLeaf),
    atLeast: n => ({ ModulesWithoutState: n, ModulesWithValue: n - 1 }),
    // Nearly all of it is Object.keys itself and the first object of each layout.
    bound: 2400,
    asksTheRunTime: true,
  },
};

function filesOf(row: Row, n: number) {
  const files: Record<string, string> = {};
  for (let i = 0; i < n; i++) {
    files[`m${i}${row.extension}`] = row.module(i);
    Object.assign(files, row.beside?.(i));
  }
  files["main.cjs"] =
    `"use strict";\n${mark}\nconst a = require("./m${n - 1}${row.extension}");\n${mark}\nconsole.log(a.f(2));\n`;
  return files;
}

async function run(cmd: string[], cwd: string, env: Record<string, string | undefined>) {
  await using ran = Bun.spawn({
    cmd,
    cwd,
    env,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    timeout: 600_000,
    killSignal: "SIGKILL",
  });
  const [stdout, stderr, exitCode] = await Promise.all([ran.stdout.text(), ran.stderr.text(), ran.exited]);
  return { stdout, stderr, exitCode };
}

const statisticsIn = (text: string): Statistics =>
  Object.fromEntries(Array.from(text.matchAll(/^(\w+) (\d+)$/gm), ([, name, value]) => [name, Number(value)]));

async function build(folder: string, entry: string, flags: string[] = []) {
  const executable = join(folder, isWindows ? "program.exe" : "program");
  const compiled = await run(
    [
      bunExe(),
      "build",
      "--compile",
      "--aot",
      "--explain=statistics",
      ...withoutDebugInformation(),
      ...flags,
      entry,
      "--outfile",
      executable,
    ],
    folder,
    bunEnv,
  );
  built(compiled);
  return { executable, statistics: statisticsIn(compiled.stderr + compiled.stdout) };
}

async function operationsOf(executable: string, folder: string, printed: string) {
  const path = join(folder, "counts");
  const ran = await run([executable], folder, { ...bunEnv, BUN_DESTRUCT_VM_ON_EXIT: "1", BUN_JSC_aotCountsPath: path });
  expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({ stdout: printed, exitCode: 0 });
  const counts = new Map<string, number>();
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const [count, operation] = line.split("\toperation:");
    if (operation !== undefined) counts.set(operation, Number(count));
  }
  return counts;
}

async function countBetweenTheMarks(executable: string): Promise<number> {
  const request: Request = {
    command: [executable],
    env: { ...bunEnv, BUN_JSC_useGC: "0", BUN_JSC_crashIfInterpreterIsUsed: "1" },
    marksBeforeTheFirstWindow: 1,
    numberOfWindows: 1,
    functions: [],
  };
  await using child = Bun.spawn({
    cmd: [bunExe(), join(import.meta.dir, "instruction-counts", "count-in-a-child.ts")],
    env: bunEnv,
    stdin: new Blob([JSON.stringify(request)]),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([child.stdout.text(), child.stderr.text(), child.exited]);
  if (exitCode) throw new Error(stderr.trim());
  const counted: Omit<Counted, "windows"> & { windows: [string, number][][] } = JSON.parse(stdout);
  expect({ stderr: counted.stderr, exitCode: counted.exitCode }).toEqual({ stderr: "", exitCode: 0 });
  return counted.windows[0].reduce((sum, [, steps]) => sum + steps, 0);
}

const whyNotCounted =
  unsupported || isASAN || isDebug ? "the bounds are those of a release build" : await whyInstructionsCannotBeCounted();
if (whyNotCounted && !unsupported) console.warn(`static-modules-slope: no instructions are counted: ${whyNotCounted}.`);

type Measured = { perModule?: number };
const measured = new Map<string, Promise<Measured>>();

function measure(name: string): Promise<Measured> {
  let known = measured.get(name);
  if (!known) measured.set(name, (known = measureRow(name, rows[name])));
  return known;
}

async function measureRow(name: string, row: Row): Promise<Measured> {
  const operations: Map<string, number>[] = [];
  const instructions: number[] = [];
  for (const n of sizes) {
    await slot(async () => {
      using directory = tempDir(`aot-static-modules-${name}`, filesOf(row, n));
      const folder = String(directory);
      let entry = "main.cjs";
      if (row.bundledFirst) {
        entry = "bundle.js";
        built(await run([bunExe(), "build", "--target=bun", "main.cjs", "--outfile", entry], folder, bunEnv));
      }
      const { executable, statistics } = await build(folder, entry);
      const wanted = row.atLeast(n);
      const exactly = { RequiresRecorded: 0, ...row.exactly };
      expect({
        n,
        short: Object.entries(wanted)
          .filter(([statistic, least]) => !(statistics[statistic] >= least))
          .map(([statistic, least]) => `${statistic} >= ${least}, but the build counted ${statistics[statistic]}`),
      }).toEqual({ n, short: [] });
      expect({
        n,
        ...Object.fromEntries(Object.keys(exactly).map(statistic => [statistic, statistics[statistic]])),
      }).toEqual({ n, ...exactly });
      operations.push(await operationsOf(executable, folder, `${n}\n`));
      if (!whyNotCounted) instructions.push(await countBetweenTheMarks(executable));
    });
  }

  if (!row.asksTheRunTime) {
    const [few, , many] = operations;
    const more = sizes[2] - sizes[0];
    expect(
      [...many]
        .filter(([operation, count]) => count - (few.get(operation) ?? 0) >= more / 2)
        .map(
          ([operation, count]) =>
            `${operation}: ${few.get(operation) ?? 0} calls with ${sizes[0]} modules, ${count} with ${sizes[2]}`,
        ),
    ).toEqual([]);
  }
  if (whyNotCounted) return {};

  const lower = (instructions[1] - instructions[0]) / (sizes[1] - sizes[0]);
  const upper = (instructions[2] - instructions[1]) / (sizes[2] - sizes[1]);
  const perModule = (instructions[2] - instructions[0]) / (sizes[2] - sizes[0]);
  console.log(
    `static-modules-slope: ${name}: ${perModule.toFixed(1)} instructions a module (${instructions.join(", ")} with ${sizes.join(", ")} modules)`,
  );
  expect({ name, isStraight: Math.abs(upper - lower) <= Math.max(2, 0.15 * perModule), lower, upper }).toEqual({
    name,
    isStraight: true,
    lower,
    upper,
  });
  return { perModule };
}

const only = process.env.AOT_SLOPE;

describe.concurrent("what a module costs at start", () => {
  for (const [name, row] of Object.entries(rows)) {
    if (only && !only.includes(name)) continue;
    test(`row ${name}`, async () => {
      const { perModule } = await measure(name);
      if (perModule === undefined) return;
      expect(perModule).toBeLessThanOrEqual(row.bound);
      if (!row.above) return;
      const other = (await measure(row.above.row)).perModule!;
      expect(perModule).toBeLessThanOrEqual(other * (row.above.times ?? 1) + (row.above.by ?? 0));
    }, 1_800_000);
  }
});

describe.concurrent("modules that do not run", () => {
  // A file that only a dead function requires has no site that names it and no record.
  test("a chain that only a dead function requires is not in the executable", async () => {
    const counted: number[] = [];
    for (const n of [1, 200]) {
      await slot(async () => {
        const files = filesOf(rows.P, n);
        files["main.cjs"] =
          `"use strict";\nfunction never() { return require("./m${n - 1}.js"); }\nconsole.log("end");\n`;
        using directory = tempDir("aot-static-modules-dead", files);
        const { executable, statistics } = await build(String(directory), "main.cjs");
        expect(await run([executable], String(directory), bunEnv)).toEqual({
          stdout: "end\n",
          stderr: "",
          exitCode: 0,
        });
        counted.push(statistics.ModulesWithoutState + statistics.ModulesWithState);
      });
    }
    expect(counted[1]).toBe(counted[0]);
  }, 600_000);

  // Nothing loops over the modules of the executable when it starts: a chain that is there and is not loaded costs nothing.
  const perf = !whyNotCounted && Bun.which("perf");
  test.skipIf(!perf)(
    "a chain that no run loads costs nothing at start",
    async () => {
      const best: number[] = [];
      const numbers = [100, 2100];
      for (const n of numbers) {
        await slot(async () => {
          const files = filesOf(rows.P, n);
          files["main.cjs"] =
            `"use strict";\nglobalThis.load = () => require("./m${n - 1}.js");\nif (process.argv.length > 99) globalThis.load();\nconsole.log("end");\n`;
          using directory = tempDir("aot-static-modules-unloaded", files);
          // Bun lists the working directory and the directories above it when it starts, so the executable is started where the sources are not.
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "main.cjs");
          let least = Infinity;
          for (let attempt = 0; attempt < 5; attempt++) {
            const counted = await run(
              [perf as string, "stat", "-x,", "-e", "instructions:u", executable],
              String(elsewhere),
              bunEnv,
            );
            expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({ stdout: "end\n", exitCode: 0 });
            least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
          }
          best.push(least);
        });
      }
      expect((best[1] - best[0]) / (numbers[1] - numbers[0])).toBeLessThanOrEqual(50);
    },
    1_800_000,
  );

  // Bare requires nest one compiled frame a level.
  test("a chain of 20,000 requires at the top ends, and the native stack holds", async () => {
    await slot(async () => {
      const n = 20_000;
      using directory = tempDir("aot-static-modules-deep", filesOf(rows.P, n));
      const { executable } = await build(String(directory), "main.cjs");
      expect(await run([executable], String(directory), bunEnv)).toEqual({ stdout: `${n}\n`, stderr: "", exitCode: 0 });
    });
  }, 1_800_000);
});
