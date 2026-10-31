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
import { built, slot, withoutDebugInformation } from "./harness/commands";
import {
  mark,
  whyInstructionsCannotBeCounted,
  type Counted,
  type Request,
} from "./instruction-counts/count-instructions";
import { describe, test, unsupported } from "./supported";

const sizes = [100, 300, 500];

const classOf = (i: number) => `class K { constructor() { this.v = ${i}; } get() { return this.v; } }\n`;
// The entry point calls `add` when the chain has run, so `c` is a constant in no module: each one computes and stores it when it starts, however it is written.
const esLeaf = "export let c = 1;\nexport function f(x) { return x + c; }\nexport function add(x) { c += x; }\n";
const esRest =
  "export let c = a.c + 1;\nexport function f(x) { return (x & 1) ? a.f(x) + c : c; }\nexport function add(x) { c += x; a.add(x); }\n";
const commonJsLeaf =
  '"use strict";\nexports.c = 1;\nexports.f = function (x) { return x + exports.c; };\nexports.add = function (x) { exports.c += x; };\n';
const commonJsRest =
  "exports.c = a.c + 1;\nexports.f = function (x) { return (x & 1) ? a.f(x) + exports.c : exports.c; };\nexports.add = function (x) { exports.c += x; a.add(x); };\n";
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
          `import { one, g } from "./k${i}.cjs";\nexport let c = a.c + one;\nexport function f(x) { return (x & 1) ? g(a.f(x)) + c : c; }\nexport function add(x) { c += x; a.add(x); }\n`
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
    `"use strict";\n${mark}\nconst a = require("./m${n - 1}${row.extension}");\n${mark}\nconsole.log(a.f(2));\na.add(process.argv.length);\n`;
  return files;
}

/** About as many modules: what the entry point imports, and graphs that it loads with import(), one behind the other, while a chain of jobs runs. Its first argument says how many of them it loads. */
function filesOfLargeProgram(modules: number, imports: number, levels = 12) {
  let state = 12345;
  const random = (below: number) => (state = (state * 1103515245 + 12345) % 2147483648) % below;
  const files: Record<string, string> = {};
  const shared = Math.floor(modules / 25);
  // The first graph holds half of what import() loads, as the graph of an application behind a small starter does.
  const small = Math.floor((modules - shared) / 2 / (imports - 1));
  const write = (name: string, requests: string[], runsNothing: boolean) => {
    const others = [...new Set(requests)].filter(other => other !== name);
    const list = `[${others.map((_, index) => `c${index}`).join(", ")}].length`;
    files[`${name}.mjs`] =
      others.map((other, index) => `import { c as c${index} } from "./${other}.mjs";\n`).join("") +
      (runsNothing
        ? `export function c() { return ${list}; }\n`
        : `export const c = () => ${list};\nglobalThis.ran = (globalThis.ran ?? 0) + 1;\n`);
  };
  for (let index = 0; index < shared; index++) {
    const below = index + 1 < shared ? [`s${index + 1}`, `s${Math.min(shared - 1, index + 1 + random(9))}`] : [];
    write(`s${index}`, below, index % 4 === 3);
  }
  const earlier: string[] = [];
  for (let graph = 0; graph < imports; graph++) {
    const width = Math.max(1, Math.floor(((graph ? small : modules - shared - small * (imports - 1)) - 1) / levels));
    const name = (level: number, place: number) => `g${graph}l${level}p${place}`;
    const own: string[] = [];
    write(
      `root${graph}`,
      Array.from({ length: Math.min(width, 8) }, (_, place) => name(0, place)),
      false,
    );
    for (let level = 0; level < levels; level++) {
      for (let place = 0; place < width; place++) {
        const requests: string[] = [];
        if (level + 1 < levels)
          requests.push(name(level + 1, place), name(level + 1, random(width)), name(level + 1, random(width)));
        // The root asks for eight modules of the first level, and they for the others.
        if (!level && place < 8) for (let other = place + 8; other < width; other += 8) requests.push(name(0, other));
        // A later module of its own level, one further down, which whoever stands between the two finds above itself, one that the entry point imports, and one that an earlier import() has loaded.
        if (place + 1 < width) requests.push(name(level, place + 1 + random(width - place - 1)));
        if (level + 2 < levels) requests.push(name(level + 2 + random(levels - level - 2), random(width)));
        requests.push(`s${random(shared)}`);
        if (earlier.length) requests.push(earlier[random(earlier.length)]);
        write(name(level, place), requests, (place + level) % 4 === 3);
        own.push(name(level, place));
      }
    }
    earlier.push(...own);
  }
  files["entry.mjs"] =
    `import { c } from "./s0.mjs";\nasync function later(index) {\n  switch (index) {\n` +
    Array.from(
      { length: imports },
      (_, graph) => `    case ${graph}: return (await import("./root${graph}.mjs")).c;\n`,
    ).join("") +
    `  }\n  return c;\n}\nconst count = Number(process.argv[2] ?? 0);\nlet isDone = false, turns = 0;\n` +
    `(async () => { while (!isDone) { turns++; await null; } })();\n` +
    `for (let index = 0; index < count; index++) await later(index);\nisDone = true;\n` +
    `console.log("ran", globalThis.ran, "turns", turns);\n`;
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

describe.concurrent("files that the entry point does not bring along", () => {
  // Each file has variables that do not start as zero: an enum, a static field, a number that a function reads early. They get their first words when the file is loaded.
  const fileBelowARoot = (name: string, next?: string) =>
    (next ? `import { use${next} } from "./${next}";\n` : "") +
    `export enum E${name} { First = 1, Second }\nexport class S${name} { static count = 2; }\nexport var v${name} = process.argv.length;\n` +
    `export function use${name}(): number { return E${name}.Second + S${name}.count + v${name}${next ? ` + use${next}()` : ""}; }\n`;
  const roots = 4;
  const filesOfRoots = (filesBelowARoot: number) => {
    const files: Record<string, string> = {};
    for (let root = 0; root < roots; root++)
      for (let i = 0; i < filesBelowARoot; i++)
        files[`r${root}m${i}.ts`] = fileBelowARoot(
          `r${root}m${i}`,
          i + 1 < filesBelowARoot ? `r${root}m${i + 1}` : undefined,
        );
    files["main.ts"] =
      `switch (process.argv[2]) {\n` +
      Array.from(
        { length: roots },
        (_, root) =>
          `  case "${root}":\n    import("./r${root}m0").then(all => console.log(all.user${root}m0()));\n    break;\n`,
      ).join("") +
      `}\n`;
    return files;
  };

  test("what fills their variables goes by the files that are loaded by name, not by the files below those", async () => {
    const counted: Statistics[] = [];
    for (const filesBelowARoot of [10, 100]) {
      await slot(async () => {
        using directory = tempDir("aot-static-modules-filled", filesOfRoots(filesBelowARoot));
        const { executable, statistics } = await build(String(directory), "main.ts");
        const ran = await run([executable, "1"], String(directory), bunEnv);
        expect({ stdout: ran.stdout, exitCode: ran.exitCode }).toEqual({
          stdout: `${filesBelowARoot * 7}\n`,
          exitCode: 0,
        });
        counted.push(statistics);
      });
    }
    const [few, many] = counted;
    expect({
      groups: many.GroupsOfFilesFilledWhenEntered,
      functionsThatFill: many.FunctionsThatFillVariablesOfFiles,
      bytesOfTables: many.ProgramTableBytesStatics,
    }).toEqual({
      groups: roots,
      functionsThatFill: few.FunctionsThatFillVariablesOfFiles,
      bytesOfTables: few.ProgramTableBytesStatics,
    });
    expect(few.FunctionsThatFillVariablesOfFiles).toBeLessThanOrEqual(roots);
  }, 600_000);
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

  // The module that calls import() waits for it, so no code of the program runs while the graph is loaded, whether that module is the entry point or was itself imported on demand.
  test.skipIf(!perf)(
    "an import() that a module imported on demand waits for costs what it costs in the entry point",
    async () => {
      const best: number[] = [];
      const numbers = [20, 420];
      const roots = 5;
      for (const n of numbers) {
        for (const entry of ["direct.mjs", "nested.mjs"]) {
          await slot(async () => {
            const files: Record<string, string> = {};
            for (let root = 0; root < roots; root++) {
              for (let i = 0; i < n; i++)
                files[`r${root}m${i}.mjs`] = i ? `import * as a from "./r${root}m${i - 1}.mjs";\n` + esRest : esLeaf;
            }
            const calls = Array.from(
              { length: roots },
              (_, root) => `sum += (await import("./r${root}m${n - 1}.mjs")).c;\n`,
            ).join("");
            files["direct.mjs"] = `let sum = 0;\n${calls}console.log("end");\n`;
            files["calls.mjs"] = `export let sum = 0;\n${calls}`;
            files["nested.mjs"] = `await import("./calls.mjs");\nconsole.log("end");\n`;
            using directory = tempDir("aot-static-modules-nested", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), entry);
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
      }
      const [fewDirect, fewNested, manyDirect, manyNested] = best;
      const perModule = (manyNested - manyDirect - (fewNested - fewDirect)) / ((numbers[1] - numbers[0]) * roots);
      console.log(
        `static-modules-slope: ${perModule.toFixed(1)} instructions more a module below an import() in a module imported on demand`,
      );
      expect(perModule).toBeLessThanOrEqual(100);
    },
    1_800_000,
  );

  // The steps in which such a graph is loaded show, so the loader takes them: down one way to the lowest level, and not through every module. Earlier loads have come to a module with nothing to run and to a CommonJS file that the graph imports too.
  test.skipIf(!perf)(
    "a graph that a module imported on demand imports without waiting is not loaded module by module",
    async () => {
      const best: number[] = [];
      const numbers = [100, 1300];
      const turns = `for (let i = 0; i < 12; i++) turns = turns.then(() => {});\n`;
      const lowest = `import { idle } from "./idle.mjs";\nimport { one } from "./file.cjs";\n`;
      for (const n of numbers) {
        for (const entry of ["direct.mjs", "fired.mjs"]) {
          await slot(async () => {
            const files: Record<string, string> = {
              "idle.mjs": "export function idle(x) { return x + 1; }\n",
              "file.cjs": '"use strict";\nexports.one = 1;\n',
              "first.mjs": `${lowest}export const c = idle(one);\n`,
              "boot.mjs": `${lowest}export const c = idle(one);\nexport const loaded = import("./t0.mjs");\n`,
              "direct.mjs": `await import("./first.mjs");\nawait import("./t0.mjs");\nconsole.log("end");\n`,
              "fired.mjs":
                `let turns = Promise.resolve();\n${turns}await import("./first.mjs");\n${turns}` +
                `await (await import("./boot.mjs")).loaded;\nconsole.log("end");\n`,
            };
            for (let i = 0; i < n; i++) {
              const below = [3 * i + 1, 3 * i + 2, 3 * i + 3].filter(j => j < n);
              files[`t${i}.mjs`] =
                (i === 4 ? lowest : "") +
                below.map(j => `import { c as c${j} } from "./t${j}.mjs";\n`).join("") +
                `export const c = ${["1", ...(i === 4 ? ["idle(one)"] : []), ...below.map(j => `c${j}`)].join(" + ")};\n` +
                `globalThis.ran = (globalThis.ran ?? 0) + 1;\n`;
            }
            using directory = tempDir("aot-static-modules-fired", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), entry);
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
      }
      const [fewDirect, fewFired, manyDirect, manyFired] = best;
      const perModule = (manyFired - manyDirect - (fewFired - fewDirect)) / (numbers[1] - numbers[0]);
      console.log(
        `static-modules-slope: ${perModule.toFixed(1)} instructions more a module below an import() that nobody waits for`,
      );
      expect(perModule).toBeLessThanOrEqual(400);
    },
    1_800_000,
  );

  // The modules of a large graph import each other many times over. Whoever goes through the graph looks at a module once, and passes over every further request for it.
  test.skipIf(!perf)(
    "a further request for a module of the graph costs an import() next to nothing",
    async () => {
      const best: number[] = [];
      const levels = 10;
      const width = 60;
      const numbers = [1, 21];
      for (const requests of numbers) {
        for (const entry of ["direct.mjs", "fired.mjs"]) {
          await slot(async () => {
            const files: Record<string, string> = {
              "small.mjs": "export const c = 1;\nglobalThis.ran = (globalThis.ran ?? 0) + 1;\n",
              "root.mjs":
                Array.from(
                  { length: width },
                  (_, place) => `import { c as c${place} } from "./l0p${place}.mjs";\n`,
                ).join("") +
                `export const c = ${Array.from({ length: width }, (_, place) => `c${place}`).join(" + ")};\n`,
              "direct.mjs": `await import("./small.mjs");\nawait import("./root.mjs");\nconsole.log("end");\n`,
              "fired.mjs": `const small = import("./small.mjs"), root = import("./root.mjs");\nawait small;\nawait root;\nconsole.log("end");\n`,
            };
            for (let level = 0; level < levels; level++) {
              for (let place = 0; place < width; place++) {
                const below =
                  level + 1 < levels ? Array.from({ length: requests }, (_, next) => (place + next) % width) : [];
                const hasFile = place % 3 === 1;
                if (hasFile) files[`l${level}p${place}.cjs`] = '"use strict";\nexports.one = 1;\n';
                files[`l${level}p${place}.mjs`] =
                  below.map(other => `import { c as c${other} } from "./l${level + 1}p${other}.mjs";\n`).join("") +
                  (hasFile ? `import { one } from "./l${level}p${place}.cjs";\n` : "") +
                  `export const c = (${["1", ...(hasFile ? ["one"] : []), ...below.map(other => `c${other}`)].join(" + ")}) % 1000;\n` +
                  `globalThis.ran = (globalThis.ran ?? 0) + 1;\n`;
              }
            }
            using directory = tempDir("aot-static-modules-requests", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), entry);
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
      }
      const [fewDirect, fewFired, manyDirect, manyFired] = best;
      const further = (numbers[1] - numbers[0]) * width * (levels - 1);
      console.log(
        `static-modules-slope: ${((manyDirect - fewDirect) / further).toFixed(1)} instructions a further request below an import() that is waited for, ${((manyFired - fewFired) / further).toFixed(1)} below one of two at once`,
      );
      expect((manyDirect - fewDirect) / further).toBeLessThanOrEqual(100);
      expect((manyFired - fewFired) / further).toBeLessThanOrEqual(150);
    },
    1_800_000,
  );

  // A large program loads most of its modules with import(), graph behind graph, while other jobs wait, so the steps in which `bun run` would load each graph are counted.
  // Many of its modules ask for a module of their own level, or for one that stands further up because something else asks for it too.
  test.skipIf(!perf)(
    "a module of a large graph costs an import() beside a chain of jobs next to nothing",
    async () => {
      const imports = 25;
      const numbers = [1000, 5000];
      const costs: number[] = [];
      for (const modules of numbers) {
        await slot(async () => {
          using directory = tempDir("aot-static-modules-large", filesOfLargeProgram(modules, imports));
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "entry.mjs");
          // The reference transpiles on one thread: the texts are read in the order in which they are asked for.
          const plain = await run([bunExe(), "run", "entry.mjs", String(imports)], String(directory), {
            ...bunEnv,
            BUN_FEATURE_FLAG_DISABLE_ASYNC_TRANSPILER: "1",
          });
          expect(plain.exitCode).toBe(0);
          const best: number[] = [];
          for (const loaded of [0, imports]) {
            let least = Infinity;
            for (let attempt = 0; attempt < 5; attempt++) {
              const counted = await run(
                [perf as string, "stat", "-x,", "-e", "instructions:u", executable, String(loaded)],
                String(elsewhere),
                bunEnv,
              );
              expect(counted.exitCode).toBe(0);
              // As many modules have run, and as many turns of the chain have passed.
              if (loaded) expect(counted.stdout).toBe(plain.stdout);
              least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
            }
            best.push(least);
          }
          costs.push(best[1] - best[0]);
        });
      }
      const perModule = (costs[1] - costs[0]) / (numbers[1] - numbers[0]);
      console.log(
        `static-modules-slope: ${(costs[1] / imports).toFixed(0)} instructions for each of ${imports} import() that load ${numbers[1]} modules beside a chain of jobs, ${perModule.toFixed(1)} a module`,
      );
      expect(perModule).toBeLessThanOrEqual(2000);
    },
    1_800_000,
  );

  // The first import() of a module walks the CommonJS files below it that ran with an earlier graph once, and runs none of them.
  test.skipIf(!perf)(
    "a file that has run costs a later import() over it next to nothing",
    async () => {
      const best: number[] = [];
      const numbers = [100, 2100];
      const roots = 20;
      for (const n of numbers) {
        for (const calls of [0, roots]) {
          await slot(async () => {
            const files = filesOf(rows.C, n);
            for (let root = 0; root < roots; root++)
              files[`root${root}.mjs`] = `import * as a from "./m${n - 1}.mjs";\nexport const c = a.c + ${root};\n`;
            files["main.mjs"] =
              `import * as a from "./m${n - 1}.mjs";\nlet sum = a.c;\nconst calls = process.argv.length > 99 ? ${roots} : ${calls};\n` +
              Array.from(
                { length: roots },
                (_, root) => `if (calls > ${root}) sum += (await import("./root${root}.mjs")).c;\n`,
              ).join("") +
              `console.log("end");\n`;
            using directory = tempDir("aot-static-modules-ran", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), "main.mjs");
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
      }
      const [fewWithout, fewWith, manyWithout, manyWith] = best;
      const perFile = (manyWith - manyWithout - (fewWith - fewWithout)) / ((numbers[1] - numbers[0]) * roots);
      console.log(
        `static-modules-slope: ${perFile.toFixed(1)} instructions a file that has run, for each import() over it`,
      );
      expect(perFile).toBeLessThanOrEqual(80);
    },
    1_800_000,
  );

  // What is loaded is not asked again whether it leads to a module that the loader has in its hands.
  test.skipIf(!perf)(
    "a module that is loaded costs a require() over it next to nothing while an import() waits",
    async () => {
      const best: number[] = [];
      const numbers = [100, 2100];
      const roots = 20;
      for (const n of numbers) {
        for (const calls of [0, roots]) {
          await slot(async () => {
            const files = filesOf(rows.C, n);
            for (let root = 0; root < roots; root++)
              files[`root${root}.mjs`] = `import * as a from "./m${n - 1}.mjs";\nexport const c = a.c + ${root};\n`;
            files["waits.mjs"] = `export const c = 1;\nglobalThis.ran = true;\n`;
            files["calls.cjs"] =
              `"use strict";\nexports.run = function (calls) {\n  let sum = 0;\n` +
              Array.from(
                { length: roots },
                (_, root) => `  if (calls > ${root}) sum += require("./root${root}.mjs").c;\n`,
              ).join("") +
              `  return sum;\n};\n`;
            files["main.mjs"] =
              `import * as a from "./m${n - 1}.mjs";\nimport { run } from "./calls.cjs";\n` +
              `const calls = process.argv.length > 99 ? ${roots} : ${calls};\nconst waits = import("./waits.mjs");\n` +
              `let sum = a.c + run(calls);\nsum += (await waits).c;\nconsole.log("end");\n`;
            using directory = tempDir("aot-static-modules-waits", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), "main.mjs");
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
      }
      const [fewWithout, fewWith, manyWithout, manyWith] = best;
      const perModule = (manyWith - manyWithout - (fewWith - fewWithout)) / ((numbers[1] - numbers[0]) * roots);
      console.log(
        `static-modules-slope: ${perModule.toFixed(1)} instructions a module that is loaded, for each require() over it while an import() waits`,
      );
      expect(perModule).toBeLessThanOrEqual(80);
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "an import() of an evaluated module costs the same however many came before it",
    async () => {
      const best: number[] = [];
      const numbers = [0, 1000, 2000];
      for (const calls of numbers) {
        await slot(async () => {
          using directory = tempDir("aot-static-modules-again", {
            "root.mjs": `export const c = 1;\nglobalThis.ran = true;\n`,
            "main.mjs":
              `let sum = (await import("./root.mjs")).c;\nconst calls = process.argv.length > 99 ? 1 : ${calls};\n` +
              `for (let call = 0; call < calls; call++) sum += (await import("./root.mjs")).c;\nconsole.log("end");\n`,
          });
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "main.mjs");
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
      const [none, some, many] = best;
      console.log(
        `static-modules-slope: ${((some - none) / 1000).toFixed(0)} instructions for each of the first thousand import(), ${((many - some) / 1000).toFixed(0)} for each of the second`,
      );
      expect(many - some).toBeLessThanOrEqual((some - none) * 1.1);
      expect((some - none) / 1000).toBeLessThanOrEqual(4500);
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "a first import() beside no other job costs little more than one of an evaluated module",
    async () => {
      const modules = 200;
      const files: Record<string, string> = {};
      for (let index = 0; index < modules; index++) files[`leaf${index}.mjs`] = `export const c = ${index};\n`;
      files["main.mjs"] =
        "async function later(index) {\n  switch (index) {\n" +
        Array.from(
          { length: modules },
          (_, index) => `    case ${index}: return (await import("./leaf${index}.mjs")).c;\n`,
        ).join("") +
        '  }\n}\nlet sum = 0;\nfor (let index = 0; index < Number(process.argv[2]); index++) sum += await later(index);\nconsole.log("end");\n';
      await slot(async () => {
        using directory = tempDir("aot-static-modules-first-import", files);
        using elsewhere = tempDir("aot-static-modules-elsewhere", {});
        const { executable } = await build(String(directory), "main.mjs");
        const best: number[] = [];
        for (const calls of [0, modules]) {
          let least = Infinity;
          for (let attempt = 0; attempt < 5; attempt++) {
            const counted = await run(
              [perf as string, "stat", "-x,", "-e", "instructions:u", executable, String(calls)],
              String(elsewhere),
              bunEnv,
            );
            expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({ stdout: "end\n", exitCode: 0 });
            least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
          }
          best.push(least);
        }
        const each = (best[1] - best[0]) / modules;
        console.log(`static-modules-slope: ${each.toFixed(0)} instructions for a first import()`);
        expect(each).toBeLessThanOrEqual(8000);
      });
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "a level of a graph costs a first import() beside a chain of jobs little more than the jobs of the chain",
    async () => {
      const graphs = 200;
      const each: number[] = [];
      for (const levels of [0, 2]) {
        const files: Record<string, string> = {};
        for (let index = 0; index < graphs; index++) {
          for (let level = 0; level <= levels; level++)
            files[`g${index}-${level}.mjs`] =
              level === levels
                ? `export const c = ${index};\n`
                : `import { c as below } from "./g${index}-${level + 1}.mjs";\nexport const c = below + 1;\n`;
        }
        files["main.mjs"] =
          "async function later(index) {\n  switch (index) {\n" +
          Array.from(
            { length: graphs },
            (_, index) => `    case ${index}: return (await import("./g${index}-0.mjs")).c;\n`,
          ).join("") +
          "  }\n}\nlet sum = 0, running = true;\n(async () => {\n  while (running) await null;\n})();\n" +
          'for (let index = 0; index < Number(process.argv[2]); index++) sum += await later(index);\nrunning = false;\nconsole.log("end");\n';
        await slot(async () => {
          using directory = tempDir("aot-static-modules-watched-import", files);
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "main.mjs");
          const best: number[] = [];
          for (const calls of [0, graphs]) {
            let least = Infinity;
            for (let attempt = 0; attempt < 5; attempt++) {
              const counted = await run(
                [perf as string, "stat", "-x,", "-e", "instructions:u", executable, String(calls)],
                String(elsewhere),
                bunEnv,
              );
              expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({ stdout: "end\n", exitCode: 0 });
              least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
            }
            best.push(least);
          }
          each.push((best[1] - best[0]) / graphs);
        });
      }
      const [leaf, deep] = each;
      console.log(
        `static-modules-slope: ${leaf.toFixed(0)} instructions for a first import() of a leaf beside a chain of jobs, ${((deep - leaf) / 2).toFixed(0)} more for each level`,
      );
      expect(leaf).toBeLessThanOrEqual(17500);
      expect((deep - leaf) / 2).toBeLessThanOrEqual(4600);
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "two first import() at once cost little more than one behind the other",
    async () => {
      const pairs = 200;
      const files: Record<string, string> = {};
      for (let index = 0; index < pairs; index++) {
        files[`a${index}.mjs`] = `export const c = ${index};\n`;
        files[`b${index}.mjs`] = `import { c as below } from "./c${index}.mjs";\nexport const c = below;\n`;
        files[`c${index}.mjs`] = "export const c = 1;\n";
      }
      files["main.mjs"] =
        "async function later(index) {\n  switch (index) {\n" +
        Array.from(
          { length: pairs },
          (_, index) =>
            `    case ${index}: return (await Promise.all([import("./a${index}.mjs"), import("./b${index}.mjs")])).length;\n`,
        ).join("") +
        '  }\n}\nlet sum = 0;\nfor (let index = 0; index < Number(process.argv[2]); index++) sum += await later(index);\nconsole.log("end");\n';
      await slot(async () => {
        using directory = tempDir("aot-static-modules-two-imports", files);
        using elsewhere = tempDir("aot-static-modules-elsewhere", {});
        const { executable } = await build(String(directory), "main.mjs");
        const best: number[] = [];
        for (const calls of [0, pairs]) {
          let least = Infinity;
          for (let attempt = 0; attempt < 5; attempt++) {
            const counted = await run(
              [perf as string, "stat", "-x,", "-e", "instructions:u", executable, String(calls)],
              String(elsewhere),
              bunEnv,
            );
            expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({ stdout: "end\n", exitCode: 0 });
            least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
          }
          best.push(least);
        }
        const each = (best[1] - best[0]) / pairs;
        console.log(`static-modules-slope: ${each.toFixed(0)} instructions for two first import() at once`);
        expect(each).toBeLessThanOrEqual(24500);
      });
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "a module that a require() finds in a graph that is being loaded costs no step of a load",
    async () => {
      const best: number[] = [];
      const numbers = [100, 1100];
      const levels = 40;
      for (const n of numbers) {
        await slot(async () => {
          const files: Record<string, string> = {};
          // The part that is required: each module imports up to eight others.
          for (let i = 0; i < n; i++) {
            const below = Array.from({ length: 8 }, (_, k) => 8 * i + k + 1).filter(j => j < n);
            files[`part${i}.mjs`] =
              below.map(j => `import { c as c${j} } from "./part${j}.mjs";\n`).join("") +
              `export const c = (1${below.map(j => ` + c${j}`).join("")}) % 1000;\nglobalThis.ran++;\n`;
          }
          // The way down is long, so the graph is still being loaded when the part is required, and it goes on below the place where the part hangs.
          for (let level = 0; level < levels; level++)
            files[`way${level}.mjs`] =
              (level + 1 < levels ? `import { c as below } from "./way${level + 1}.mjs";\n` : `const below = 0;\n`) +
              (level === levels - 10 ? `import { c as part } from "./part0.mjs";\n` : `const part = 0;\n`) +
              `export const c = below + part + 1;\nglobalThis.ran++;\n`;
          files["small.mjs"] = `export const c = 1;\nglobalThis.ran++;\n`;
          files["over.mjs"] =
            `import { c as below } from "./part0.mjs";\nexport const c = below + 1;\nglobalThis.ran++;\n`;
          files["main.mjs"] =
            `globalThis.ran = 0;\nconst small = import("./small.mjs"), graph = import("./way0.mjs");\n` +
            `let turns = Promise.resolve();\nfor (let turn = 0; turn < 12; turn++) turns = turns.then(() => {});\n` +
            `turns.then(() => { if (globalThis.ran > 1) throw new Error("the graph has run"); require("./over.mjs"); });\n` +
            `await small;\nawait graph;\nconsole.log("end", globalThis.ran);\n`;
          using directory = tempDir("aot-static-modules-found", files);
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "main.mjs");
          let least = Infinity;
          for (let attempt = 0; attempt < 5; attempt++) {
            const counted = await run(
              [perf as string, "stat", "-x,", "-e", "instructions:u", executable],
              String(elsewhere),
              bunEnv,
            );
            expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({
              stdout: `end ${n + levels + 2}\n`,
              exitCode: 0,
            });
            least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
          }
          best.push(least);
        });
      }
      const perModule = (best[1] - best[0]) / (numbers[1] - numbers[0]);
      console.log(
        `static-modules-slope: ${perModule.toFixed(0)} instructions a module that a require() finds in a graph that is being loaded`,
      );
      expect(perModule).toBeLessThanOrEqual(800);
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "a module costs the same whether one module or two thousand are imported beside it where the loader goes through the graph",
    async () => {
      const best: number[] = [];
      const numbers = [100, 200, 2100];
      for (const n of numbers) {
        await slot(async () => {
          const files: Record<string, string> = {};
          for (let i = 0; i < n; i++)
            files[`m${i}.mjs`] = `import { x } from "./calls.cjs";\nexport const c = x + ${i};\n`;
          files["root.mjs"] =
            Array.from({ length: n }, (_, i) => `import * as m${i} from "./m${i}.mjs";\n`).join("") +
            `export const c = ${Array.from({ length: n }, (_, i) => `m${i}.c`).join(" + ")};\n`;
          // The file requires a module that imports it, so the build leaves the order of the graph to the loader.
          files["calls.cjs"] =
            `"use strict";\nexports.x = process.argv.length;\n` +
            `exports.run = function (calls) { return calls ? require("./m0.mjs").c : 0; };\n`;
          files["main.mjs"] =
            `import { run } from "./calls.cjs";\nconst graph = import("./root.mjs");\n` +
            `let sum = run(process.argv.length > 99 ? 1 : 0);\nsum += (await graph).c;\nconsole.log("end");\n`;
          using directory = tempDir("aot-static-modules-beside", files);
          using elsewhere = tempDir("aot-static-modules-elsewhere", {});
          const { executable } = await build(String(directory), "main.mjs");
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
      const few = (best[1] - best[0]) / (numbers[1] - numbers[0]);
      const many = (best[2] - best[1]) / (numbers[2] - numbers[1]);
      console.log(
        `static-modules-slope: ${few.toFixed(0)} instructions a module beside a hundred others, ${many.toFixed(0)} beside two thousand, where the loader goes through the graph`,
      );
      expect(many).toBeLessThanOrEqual(few * 1.15);
    },
    1_800_000,
  );

  test.skipIf(!perf)(
    "a graph that is required costs the same while an import() of a module that no module imports waits",
    async () => {
      const best: number[] = [];
      const numbers = [100, 2100];
      for (const n of numbers) {
        for (const waits of [false, true]) {
          await slot(async () => {
            const files: Record<string, string> = {};
            for (let i = 0; i < n; i++) {
              const below = Array.from({ length: 8 }, (_, k) => 8 * i + k + 1).filter(j => j < n);
              files[`part${i}.mjs`] =
                below.map(j => `import { c as c${j} } from "./part${j}.mjs";\n`).join("") +
                `export const c = (1${below.map(j => ` + c${j}`).join("")}) % 1000;\nglobalThis.ran++;\n`;
            }
            files["waits.mjs"] = `export const c = 1;\nglobalThis.ran++;\n`;
            files["main.mjs"] =
              `globalThis.ran = 0;\n${waits ? `const waits = import("./waits.mjs");\n` : ""}` +
              `const sum = require("./part0.mjs").c;\n${waits ? `await waits;\n` : `globalThis.ran++;\n`}` +
              `console.log("end", globalThis.ran);\n`;
            using directory = tempDir("aot-static-modules-nobody-imports", files);
            using elsewhere = tempDir("aot-static-modules-elsewhere", {});
            const { executable } = await build(String(directory), "main.mjs");
            let least = Infinity;
            for (let attempt = 0; attempt < 5; attempt++) {
              const counted = await run(
                [perf as string, "stat", "-x,", "-e", "instructions:u", executable],
                String(elsewhere),
                bunEnv,
              );
              expect({ stdout: counted.stdout, exitCode: counted.exitCode }).toEqual({
                stdout: `end ${n + 1}\n`,
                exitCode: 0,
              });
              least = Math.min(least, Number(/^(\d+),/m.exec(counted.stderr)?.[1]));
            }
            best.push(least);
          });
        }
      }
      const [fewWithout, fewWith, manyWithout, manyWith] = best;
      const perModule = (manyWith - manyWithout - (fewWith - fewWithout)) / (numbers[1] - numbers[0]);
      console.log(
        `static-modules-slope: ${perModule.toFixed(1)} instructions more for a module of a graph that is required while an import() of a module that no module imports waits`,
      );
      expect(perModule).toBeLessThanOrEqual(30);
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
