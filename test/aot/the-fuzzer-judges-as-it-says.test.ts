// What test/aot/fuzz promises about its own judging, held to with a stand-in for the compiler: a fuzzer that books a failure as "skipped", or never ends a run, looks like one that finds nothing.
//
//   a build that stops at a type error is asked of TypeScript: what TypeScript refuses too is skipped, what it accepts is a finding
//   what lies beside a program is what the flag says: no tsconfig.json at all, an empty one, the one of `bun init` with Bun's typings installed
//   a program that has to be the entry point of its build is never a module of a shared build
//   behind the end of a run a few failures are confirmed, the rest is listed, and nothing is built again
//   a build or a run that holds more memory than it may is ended and named, and whatever a bed started ends with the fuzzer
//   a program that a bed runs reaches no process but itself, whatever it signals
//   what plain Bun does not get through is not run again for every mode
//   a program of several files lies in a folder of its own, by itself and in a shared build, and TypeScript is asked about all its files
//   a finding in several files is tried in one file first; where it takes the files, files are cut first, then lines
//   a shared build is one program of many modules, but in the mode each-a-program: there the compiler runs once for each program, as it does for a program alone
//   of two long lines that differ, what is shown begins a little in front of where they part
import { expect, test as one } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { tmpdir } from "os";
import { join } from "path";
import {
  ProductBed,
  compare,
  projects,
  spawned,
  standsApart,
  wholeText,
  type Bed,
  type Judged,
  type Program,
  type Verdict,
} from "./fuzz/beds";
import { fuzz } from "./fuzz/fuzzer";
import { reduceFiles, type Whole } from "./fuzz/reduce";
import { allSources, type Generated } from "./fuzz/sources";
import { typeChecker, typingsOfBun } from "./fuzz/type-check";
import { memoryLimitOfAKnownProgram } from "./harness/memory-limit";

const options = { baseFlags: [], validate: false, threads: 1, buildSeconds: 60, runSeconds: 60 };
const timeout = 300_000;
// The cases stand side by side: each has folders of its own, and none waits for the clock.
const test = one.concurrent;
// A case that is skipped stays one of them: `one.skip` is a case by itself, and the cases behind it wait until those in front of it have ended.
const unless = (condition: boolean) => one.concurrent.skipIf(condition);
/** A folder for one call of a bed: calls that share none need not wait for one another. */
const within = (folder: unknown, name: string) => (
  mkdirSync(join(String(folder), name), { recursive: true }),
  join(String(folder), name)
);

// The first case, though the list above names it near its end: it alone builds with the compiler, and its two builds begin here so that the other cases run beside them. Where Bun is built
// without optimization, the longer one takes 49 of the 60 seconds that it may take on one thread, and 28 on the four threads that fuzz/run.ts gives a build.
test(
  "in the mode each-a-program every program of a shared build is a program of its own",
  async () => {
    using folder = tempDir("aot-fuzzer-each-a-program", {});
    const bed = new ProductBed(bunExe(), { ...options, threads: 4 });
    const programs: Program[] = [
      { text: `console.log("first", [1, 2].length);\n`, extension: "js" },
      { text: `const n: number = 2;\nconsole.log("second", n);\n`, extension: "ts" },
      { text: `import { third } from "./other";\nconsole.log(third);\nprocess.exitCode = 3;\n`, extension: "ts", files: { "other.ts": `export const third = "third";\n` } }, // prettier-ignore
    ];
    const runsOfTheCompiler = async (name: string) => {
      const { flags } = bed.modes(programs[0]).find(mode => mode.name === name)!;
      const judged = await bed.judge(within(folder, name), programs, [...flags, "--aot-report=report.json"]);
      // The whole verdict: one that is not "same" says what the build or the run said.
      expect(judged.map(({ verdict }) => verdict)).toEqual([{ kind: "same" }, { kind: "same" }, { kind: "same" }]);
      expect(judged.map(({ compiled }) => [compiled!.run!.stdout, compiled!.run!.exitCode])).toEqual([["first 2\n", 0], ["second 2\n", 0], ["third\n", 3]]); // prettier-ignore
      return JSON.parse(readFileSync(join(String(folder), name, "report.json"), "utf8")).statistics.EngineRuns;
    };
    // One more for the file that starts them.
    expect(await Promise.all([runsOfTheCompiler("default"), runsOfTheCompiler("each-a-program")])).toEqual([
      1,
      programs.length + 1,
    ]);
  },
  timeout,
);

// The second case, for the same reason: it keeps one processor busy for seconds. It is asked in a process of its own, started as a bed starts a Bun, and the other cases run beside it.
// It loads every generator, and what they hold makes each collection of their process longer: nothing of that stays behind in this one.
unless(isWindows)(
  "every source makes a program",
  async () => {
    const { stdout, stderr, exitCode, signal } = await spawned(
      [bunExe(), join(import.meta.dir, "the-fuzzer-judges-as-it-says.fixture.ts")],
      import.meta.dir,
      timeout / 1000,
      { TMPDIR: tmpdir() },
      memoryLimitOfAKnownProgram,
    );
    // It prints how many sources it asked, and then a line for each of them that made no program.
    const [asked, ...madeNoProgram] = stdout.trim().split("\n");
    expect({ madeNoProgram, stderr, exitCode, signal }).toEqual({
      madeNoProgram: [],
      stderr: "",
      exitCode: 0,
      signal: null,
    });
    expect(parseInt(asked)).toBeGreaterThan(300);
  },
  timeout,
);

// Runs programs as Bun does and refuses every build with the same words.
function refusesEveryBuild(folder: string, words = "TS2554: Expected 0 arguments, but got 1."): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) ls -a > seen.txt; find . -type f | sort > files.txt; echo "error: ${words}" >&2; exit 1;;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}
// What a bed makes of those words: a finding where TypeScript accepts the program, nothing where TypeScript refuses it too.
const aFinding: Verdict = {
  kind: "build refused",
  detail: "TS2554: Expected 0 arguments, but got 1. | TypeScript accepts the program",
  signature: "TSN: Expected N arguments, but got N.",
};
const asInTypeScript: Verdict = { kind: "skipped", why: "type error TS2554, as in TypeScript" };

unless(isWindows || !typeChecker())(
  "a build refused at a type error is a finding where TypeScript accepts the program",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    const bed = new ProductBed(refusesEveryBuild(String(folder)), options);
    let asked = 0;
    const judge = async (text: string, flags: string[] = []) =>
      (await bed.judge(within(folder, `question-${asked++}`), [{ text, extension: "ts" }], flags))[0].verdict;
    // The options of the project count: an element may be missing under those of `bun init`.
    const reads = `const list = [1];\nconst n: number = list[0];\nconsole.log(n);\n`;
    const [accepted, refused, withoutOptions, asBunInitLeavesIt, shared] = await Promise.all([
      judge(`const n: number = 1;\nconsole.log(n);\n`),
      judge(`const n: number = "text";\nconsole.log(n);\n`),
      judge(reads, ["--beside-the-program=no-tsconfig"]),
      typingsOfBun() ? judge(reads, ["--beside-the-program=as-bun-init-leaves-it"]) : undefined,
      // In a build that several programs share, each is judged by itself.
      judge(`console.log(1);\n`, ["--in-the-company-of=1"]),
    ]);
    expect({ accepted, refused, withoutOptions, asBunInitLeavesIt, shared }).toEqual({
      accepted: aFinding,
      refused: asInTypeScript,
      withoutOptions: aFinding,
      asBunInitLeavesIt: typingsOfBun() ? asInTypeScript : undefined,
      shared: aFinding,
    });
  },
  timeout,
);

unless(isWindows)(
  "what lies beside a program is what the flag says",
  async () => {
    using folder = tempDir("aot-fuzzer-beside", {});
    const bed = new ProductBed(refusesEveryBuild(String(folder), "it builds nothing"), options);
    const asked = Object.entries(projects).filter(([, { hasTypings }]) => !hasTypings || typingsOfBun());
    const found = await Promise.all(
      asked.map(async ([name, { tsconfig }]) => {
        const where = within(folder, name);
        const [{ plain, verdict }] = await bed.judge(
          where,
          [{ text: `console.log(1);\n`, extension: "ts" }],
          [`--beside-the-program=${name}`],
        );
        const seen = readFileSync(join(where, "seen.txt"), "utf8").split("\n");
        return {
          name,
          // The program ran plain, and the build was asked and said its words.
          printed: plain.stdout,
          exitCode: plain.exitCode,
          verdict,
          hasTsconfig: seen.includes("tsconfig.json"),
          tsconfig: tsconfig && JSON.parse(readFileSync(join(where, "tsconfig.json"), "utf8")),
          hasModules: seen.includes("node_modules"),
          hasTypings: existsSync(join(where, "node_modules", "@types", "bun", "index.d.ts")),
        };
      }),
    );
    expect(found).toEqual(
      asked.map(([name, { tsconfig, hasTypings }]) => ({
        name,
        printed: "1\n",
        exitCode: 0,
        verdict: { kind: "build error", detail: "error: it builds nothing", signature: "error: it builds nothing" },
        hasTsconfig: !!tsconfig,
        tsconfig,
        hasModules: !!hasTypings,
        hasTypings: !!hasTypings,
      })),
    );
  },
  timeout,
);

// A bed that builds nothing: it notes what it is asked and fails what its text says. A build of so many seconds moves the clock of the case on by as much: nobody waits.
function standIn(judged: (programs: Program[]) => void, seconds = 0, clock = { now: 0 }): Bed {
  const run = { stdout: "", stderr: "", exitCode: 0, signal: null, timedOut: false };
  return {
    name: "product",
    binary: "stand-in",
    batch: 8,
    buildsAlone: true,
    accepts: () => true,
    allows: () => true,
    modes: () => [{ name: "default", flags: [] }],
    withoutFlowResults: [],
    disabling: () => [],
    switches: async () => ({ flowResults: [], passes: [] }),
    async judge(_folder, programs): Promise<Judged[]> {
      judged(programs);
      clock.now += seconds * 1000;
      return programs.map((program, index) => ({
        plain: run,
        verdict: seconds
          ? {
              kind: "different output",
              detail: `plain ${Bun.hash.crc32(program.text).toString(36).replace(/\d/g, "")} compiled x`,
              signature: `values ${index}`,
            }
          : { kind: "same" },
      }));
    },
  };
}

// The runs of these cases draw from generators alone, so each is given a folder without programs: that spares it three walks through the twelve thousand files of ./parallel.
// The clock of a run stands still unless its case hands over one that moves: such a run ends by the number of its programs, however long the machine takes for them.
const settings = (folder: string) => ({
  out: join(folder, "out"),
  work: join(folder, "work"),
  programsRoot: join(folder, "no-programs"),
  known: [],
  minFreeBytes: 0,
  reduceSeconds: 0,
  attribute: false,
  firstSeed: 1,
  now: () => 0,
});

test(
  "a program that is the entry point of its build shares it with no other",
  async () => {
    using folder = tempDir("aot-fuzzer-alone", {});
    const builds: Program[][] = [];
    const summary = await fuzz({
      ...settings(String(folder)),
      beds: [{ bed: standIn(programs => builds.push(programs)), jobs: 1 }],
      sources: ["workers-ended-in-the-middle", "numbers-across-their-borders"],
      seconds: 60,
      programs: 64,
    });
    const isItsOwnWorker = (program: Program) => program.text.includes("new Worker(new URL(import.meta.url)");
    expect(summary.programs).toBe(64);
    expect(builds.filter(build => build.some(isItsOwnWorker)).length).toBeGreaterThan(10);
    expect(builds.filter(build => build.some(isItsOwnWorker) && build.length > 1)).toEqual([]);
    expect(builds.some(build => build.length > 1)).toBe(true);
  },
  timeout,
);

test(
  "behind the last call of a run nothing is built again and what failed is listed",
  async () => {
    using folder = tempDir("aot-fuzzer-late", {});
    let calls = 0;
    const clock = { now: 0 };
    // Every program fails in words of its own, and the first build outlasts the run.
    const summary = await fuzz({
      ...settings(String(folder)),
      now: () => clock.now,
      beds: [{ bed: standIn(() => void calls++, 9, clock), jobs: 1 }],
      sources: ["numbers-across-their-borders"],
      seconds: 6,
      batch: 8,
    });
    const out = join(String(folder), "out");
    const listed = readFileSync(join(out, "failures.tsv"), "utf8").trim().split("\n").length;
    const notConfirmed = readFileSync(join(out, "not-confirmed.tsv"), "utf8").trim().split("\n").length;
    expect(listed).toBe(8);
    // The last call comes a third of the run behind its end, so the one build that outlasted the run leaves nothing to confirm.
    expect(notConfirmed).toBe(8);
    expect(summary.status).toContain("not confirmed 8");
    expect(readdirSync(join(out, "findings"))).toEqual([]);
    expect(calls).toBe(1);
  },
  timeout,
);

test(
  "what is never the doing of a busy machine is stored behind the last call as it was drawn, with the programs beside it",
  async () => {
    using folder = tempDir("aot-fuzzer-late-stop", {});
    const clock = { now: 0 };
    const bed = standIn(() => {}, 9, clock);
    const judge = bed.judge.bind(bed);
    bed.judge = async (where, programs, flags) =>
      (await judge(where, programs, flags)).map((each, index) =>
        index
          ? { ...each, verdict: { kind: "same" as const } }
          : { ...each, verdict: { kind: "crash" as const, detail: "stopped", signature: "stopped" } },
      );
    bed.store = (where, programs) => (writeFileSync(join(where, "count.txt"), String(programs.length)), "commands\n");
    await fuzz({
      ...settings(String(folder)),
      now: () => clock.now,
      beds: [{ bed, jobs: 1 }],
      sources: ["numbers-across-their-borders"],
      seconds: 6,
      batch: 8,
    });
    const [name, ...rest] = readdirSync(join(String(folder), "out", "findings"));
    expect(rest).toEqual([]);
    expect(name).toStartWith("crash-not-tried-again-");
    expect(readFileSync(join(String(folder), "out", "findings", name, "count.txt"), "utf8")).toBe("8");
  },
  timeout,
);

test(
  "a program that plain Bun does not get through is tried in one mode only",
  async () => {
    using folder = tempDir("aot-fuzzer-plain", {});
    let judged = 0;
    const bed: Bed = {
      ...standIn(() => {}),
      batch: 1,
      modes: () => ["default", "validate", "erased"].map(name => ({ name, flags: [] })),
      judge: async (_folder, programs) =>
        programs.map(() => {
          judged++;
          return {
            plain: { stdout: "", stderr: "", exitCode: null, signal: null, timedOut: true },
            verdict: { kind: "skipped", why: "plain run too slow" },
          };
        }),
    };
    const summary = await fuzz({
      ...settings(String(folder)),
      beds: [{ bed, jobs: 1 }],
      sources: ["numbers-across-their-borders"],
      seconds: 60,
      programs: 8,
      batch: 1,
    });
    expect(summary.programs).toBe(8);
    expect(judged).toBe(8);
  },
  timeout,
);

// It comes to hold 512 MB of its own, twice what it may, and stands still there: where nobody ended it, a program that grew without end would take all the memory of the machine.
const holdsTwiceWhatItMay = `const kept = []; while (kept.length < 4096) kept.push(new Array(1 << 14).fill(kept.length)); for (;;);`;

// Runs programs as Bun does; each of its builds comes to hold twice what it may.
function everyBuildHoldsTooMuch(folder: string): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) exec "${bunExe()}" -e '${holdsTwiceWhatItMay}';;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

// Beside the others: the memory is watched on a thread of its own (harness/memory-watcher.ts), so whoever keeps the thread of this file busy unbinds no child.
unless(isWindows)(
  "a run that holds too much memory is skipped and such a build is a finding",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    // A program may hold 256 MB more than Bun says it holds when it prints a line: 26 MB as Bun ships, 245 MB with AddressSanitizer. 256 MB for Bun and the program together left 11 MB there.
    const asked = [bunExe(), "-e", "console.log(process.memoryUsage.rss())"];
    const heldByBun = Number((await spawned(asked, String(folder), options.runSeconds)).stdout);
    expect(heldByBun).toBeGreaterThan(2 ** 20);
    const bed = new ProductBed(everyBuildHoldsTooMuch(String(folder)), {
      ...options,
      memory: heldByBun + 256 * 2 ** 20,
    });
    const judge = async (text: string) => (await bed.judge(String(folder), [{ text, extension: "js" }], []))[0];
    expect((await judge(holdsTwiceWhatItMay)).verdict).toEqual({
      kind: "skipped",
      why: "plain run takes too much memory",
    });
    const { verdict, compiled } = await judge(`console.log(1);\n`);
    expect(verdict).toEqual({ kind: "build hang", detail: "took too much memory", signature: "took too much memory" });
    expect(compiled!.build).toMatchObject({ timedOut: true, tookTooMuchMemory: true, signal: null, exitCode: null });
  },
  timeout,
);

unless(isWindows)(
  "what a bed started ends when the fuzzer is killed",
  async () => {
    // What it starts may run for as long as this case may take: the end of the fuzzer ends it, never its own time.
    using folder = tempDir("aot-fuzzer-judges", {
      "fuzzer.ts": `import { spawned } from ${JSON.stringify(join(import.meta.dir, "fuzz", "beds"))};
await spawned([process.execPath, "-e", 'require("fs").writeFileSync("pid", String(process.pid)); setInterval(() => {}, 1000);'], import.meta.dir, ${timeout / 1000});`,
    });
    const written = join(String(folder), "pid");
    await using fuzzer = Bun.spawn({
      cmd: [bunExe(), "fuzzer.ts"],
      cwd: String(folder),
      env: bunEnv,
      stdio: ["ignore", "inherit", "inherit"],
    });
    while (!existsSync(written) || !readFileSync(written, "utf8")) await Bun.sleep(20);
    const pid = Number(readFileSync(written, "utf8"));
    const isAlive = () => {
      try {
        return process.kill(pid, 0);
      } catch {
        return false;
      }
    };
    try {
      expect(isAlive()).toBe(true);
      fuzzer.kill("SIGKILL");
      await fuzzer.exited;
      for (let waited = 0; isAlive() && waited < 10_000; waited += 20) await Bun.sleep(20);
      expect(isAlive()).toBe(false);
    } finally {
      if (isAlive()) process.kill(pid, "SIGKILL");
    }
  },
  timeout,
);

unless(!standsApart())(
  "a program that a bed runs reaches no process but itself, whatever it signals",
  async () => {
    using folder = tempDir("aot-fuzzer-apart", {});
    // It signals only where it is the first process of a world of its own: nowhere else is a program that was started number 1.
    const signals = `if (process.pid !== 1) process.exit(7);
for (const whom of [0, -1, ${process.pid}, ${process.ppid}]) {
  try {
    process.kill(whom, "SIGKILL");
    console.log("sent");
  } catch (error) {
    console.log(error.code);
  }
}`;
    const run = await spawned([bunExe(), "-e", signals], String(folder), 60, undefined, undefined, true);
    // Its group is itself, and the first process of a world is not ended from inside. Nobody else is there.
    const expected = [0, -1, process.pid, process.ppid].map(whom => (whom === 0 || whom === 1 ? "sent" : "ESRCH"));
    expect(run).toMatchObject({ exitCode: 0, signal: null, stdout: expected.join("\n") + "\n" });
  },
  timeout,
);

const inThreeFiles = (second: string): Program => ({
  extension: "ts",
  text: `import { twice } from "./declared-2";\nexport const one: number = 1;\nprint(String(twice(4)));\n`,
  files: {
    "declared-1.ts": `import { one } from "./main";\nexport function plusOne(n: number): number {\n  return n + one;\n}\n`,
    "declared-2.ts": second,
  },
});
const twice = `import { plusOne } from "./declared-1";\nexport function twice(n: number): number {\n  print("twice");\n  return plusOne(n) * 2;\n}\n`;

unless(isWindows || !typeChecker())(
  "a program of several files lies in a folder of its own and is judged as a whole",
  async () => {
    using folder = tempDir("aot-fuzzer-files", {});
    const bed = new ProductBed(refusesEveryBuild(String(folder)), options);
    // The error lies in a file that the first one imports.
    const wrong = twice.replace("return plusOne(n) * 2", `return plusOne("n") * 2`);
    // What another version of TypeScript makes of JavaScript says nothing about the build.
    const { "declared-2.ts": typed, ...rest } = inThreeFiles(twice).files!;
    const besideJavaScript = { ...rest, "declared-2.js": typed.replaceAll(/: number/g, "") };
    const [[alone], [withAnError], [mixed], shared] = await Promise.all([
      bed.judge(within(folder, "alone"), [inThreeFiles(twice)], []),
      bed.judge(within(folder, "wrong"), [inThreeFiles(wrong)], []),
      bed.judge(within(folder, "mixed"), [{ ...inThreeFiles(twice), files: besideJavaScript }], []),
      bed.judge(
        within(folder, "shared"),
        [{ text: `console.log(1);\n`, extension: "ts" }, inThreeFiles(twice), inThreeFiles(wrong)],
        [],
      ),
    ]);
    expect(alone.plain).toMatchObject({ stdout: "twice\n10\n", exitCode: 0 });
    expect(
      readFileSync(join(String(folder), "alone", "files.txt"), "utf8")
        .split("\n")
        .filter(file => /^\.\/p/.test(file)),
    ).toEqual(["./program/declared-1.ts", "./program/declared-2.ts", "./program/main.ts"]);
    expect(alone.verdict).toEqual(aFinding);
    expect(withAnError.verdict).toEqual(asInTypeScript);
    expect(mixed).toMatchObject({
      plain: { stdout: "twice\n10\n", exitCode: 0 },
      verdict: { kind: "skipped", why: "type error TS2554, beside JavaScript" },
    });
    expect(shared.map(({ plain }) => [plain.stdout, plain.exitCode])).toEqual([["1\n", 0], ["twice\n10\n", 0], ["twice\nNaN\n", 0]]); // prettier-ignore
    expect(shared.map(each => each.verdict)).toEqual([aFinding, aFinding, asInTypeScript]);
    // Nothing of a program stays behind for the next one.
    const left = (name: string) => readdirSync(join(String(folder), name)).filter(file => /^p(rogram$|\d)/.test(file));
    expect(["alone", "wrong", "mixed", "shared"].map(left)).toEqual([[], [], [], []]);
  },
  timeout,
);

test("files are cut first, then lines", async () => {
  const whole: Whole = {
    text: `import { a } from "./declared-1";\nimport { b, unused } from "./declared-2";\nimport { c } from "./declared-3";\nconsole.log(a());\nconsole.log(b());\nconsole.log(c());\n`,
    files: {
      "declared-1.ts": `export function a() {\n  return 1;\n}\n`,
      "declared-2.ts": `import { helper } from "./declared-4";\nexport function b() {\n  return helper() + 1;\n}\nexport function unused() {\n  return 3;\n}\n`,
      "declared-3.ts": `import { helper } from "./declared-4";\nexport function c() {\n  return helper();\n}\n`,
      "declared-4.ts": `export function helper() {\n  return 2;\n}\nexport const more = 4;\n`,
    },
  };
  const parser = new Bun.Transpiler({ loader: "ts" });
  const asked: number[] = [];
  // It shows as long as b() is called in another file than the one that declares it, and every import finds its file and its name.
  const shows = ({ text, files = {} }: Whole) => {
    const all: Record<string, string> = { "main.ts": text, ...files };
    for (const each of Object.values(all))
      for (const [, names, from] of each.matchAll(/import\s*\{\s*([^}]*?)\s*\}\s*from\s*"\.\/([\w-]+)"/g))
        for (const name of names.split(/\s*,\s*/).filter(Boolean))
          if (!new RegExp(`export (function|const) ${name}\\b`).test(all[from + ".ts"] ?? "")) return false;
    for (const each of Object.values(all))
      for (const [, name] of each.matchAll(/\b(a|b|c|helper)\(\)(?! \{)/g))
        if (!new RegExp(`(function|[{,]) ${name}\\b`).test(each)) return false;
    return /\bb\(\)/.test(text) && !/function b\b/.test(text);
  };
  const reduced = await reduceFiles(whole, {
    entry: "main.ts",
    width: 4,
    seconds: 60,
    parses(candidate) {
      try {
        return (parser.transformSync(candidate), true);
      } catch {
        return false;
      }
    },
    fails: async candidates => (
      asked.push(...candidates.map(each => Object.keys(each.files ?? {}).length)),
      candidates.map(shows)
    ),
  });
  const dense = (text: string) => text.replace(/[\s;]/g, "");
  expect(dense(reduced.text)).toBe(`import{b}from"./declared-2"b()`);
  // Without a body it is an overload, which parses.
  expect(Object.entries(reduced.files!).map(([path, text]) => [path, dense(text)])).toEqual([
    ["declared-2.ts", "exportfunctionb()"],
  ]);
  // Candidates with fewer files come before any that only has fewer lines.
  expect(asked.slice(0, 4)).toEqual([3, 3, 3, 3]);
});

// The seeds and notes of those programs of which something does not hold. One list for each question, however many programs it is asked of: CI has the collector run at every call of
// expect(), and a call for each of some hundred programs takes seconds there.
const except = (programs: (Generated | undefined)[], holds: (program: Generated) => boolean) =>
  programs.filter(program => !holds(program!)).map(program => `${program!.seed}: ${program!.notes}`);

test(
  "a finding in several files is tried in one file first",
  async () => {
    // No case here draws from the programs of ./parallel.
    using noPrograms = tempDir("aot-fuzzer-no-programs", {});
    const sources = await allSources(String(noPrograms), new Set(), true);
    const source = "numbers-across-their-borders-in-several-files";
    // A bed that takes one file a program is given no other.
    expect(
      sources[source](
        1,
        standIn(() => {}),
      ),
    ).toBeUndefined();
    expect(Object.keys(sources[source](1, { ...standIn(() => {}), takesSeveralFiles: true })!.files!)).not.toEqual([]);
    // As a module it would print another `this`, compiled and plain, than as the script that it is.
    const asksForThis = "a-class-definition-throws-and-the-program-goes-on";
    const takesFiles = { ...standIn(() => {}), takesSeveralFiles: true };
    expect(sources[asksForThis](54301000265, takesFiles)!.text).toContain(`show("after", this);`);
    expect(sources[asksForThis + "-in-several-files"](54301000265, takesFiles)).toBeUndefined();
    const drawn = Array.from({ length: 400 }, (_, seed) => sources[source](seed, takesFiles));
    // TypeScript and JavaScript import from each other.
    const mixed = drawn
      .slice(0, 40)
      .filter(program => program && Object.keys(program.files!).some(path => path.endsWith(".js")));
    expect(mixed.length).toBeGreaterThan(4);
    // Some of the JavaScript has a declaration file beside it, and that is no file of the program's own making.
    const declared = drawn.slice(0, 200).flatMap(program =>
      Object.keys(program?.files ?? {})
        .filter(path => path.endsWith(".d.ts"))
        .map(path => ({
          isBesideJavaScript: program!.files![path.replace(/\.d\.ts$/, ".js")] !== undefined,
          text: program!.files![path],
          notes: program!.notes,
        })),
    );
    expect(declared.length).toBeGreaterThan(4);
    expect(
      declared.filter(
        ({ isBesideJavaScript, text, notes }) =>
          !isBesideJavaScript ||
          !text.includes("export declare ") ||
          !notes.includes("beside declarations that say too little"),
      ),
    ).toEqual([]);
    expect(except(mixed, program => program.extension === "ts" && program.notes.includes("in JavaScript"))).toEqual([]);
    // Where a declaration file is not valid, the program says that such files are not checked.
    const unchecked = drawn.filter(program => program?.files!["tsconfig.json"]);
    expect(unchecked.length).toBeGreaterThan(2);
    const notValid = /Missing|Absent|NotDeclared|notDeclared|declaredTwice|InvalidRing|invalidArguments|invalidMember/;
    expect(
      except(unchecked, ({ files, notes }) => {
        const { skipLibCheck, strict } = JSON.parse(files!["tsconfig.json"]).compilerOptions;
        const declarations = Object.entries(files!).filter(([path]) => path.endsWith(".d.ts")).map(([, text]) => text); // prettier-ignore
        return (
          skipLibCheck === true &&
          strict === true &&
          notValid.test(declarations.join("")) &&
          notes.includes("under skipLibCheck")
        );
      }),
    ).toEqual([]);
    // Some JavaScript with declarations is a package, and whoever imported the file imports the package.
    const withPackages = drawn.filter(program =>
      Object.keys(program?.files ?? {}).some(path => path.startsWith("node_modules/")),
    );
    expect(withPackages.length).toBeGreaterThan(4);
    const packagesOf = ({ files }: Program) =>
      Object.keys(files!).flatMap(path => /^node_modules\/([\w-]+)\/package\.json$/.exec(path)?.[1] ?? []);
    const typeOf = ({ files }: Program, name: string): string =>
      JSON.parse(files![`node_modules/${name}/package.json`]).type;
    expect(
      except(
        withPackages,
        program =>
          program.notes.includes("as packages") &&
          packagesOf(program).every(
            name =>
              program.files![`node_modules/${name}/index.js`] !== undefined &&
              program.files![`node_modules/${name}/index.d.ts`] !== undefined &&
              wholeText(program).includes(`from "${name}"`) &&
              !wholeText(program).includes(`from "./${name}"`) &&
              /^(import|export) /m.test(program.files![`node_modules/${name}/index.js`]) ===
                (typeOf(program, name) === "module"),
          ),
      ),
    ).toEqual([]);
    const kinds = withPackages.flatMap(program => packagesOf(program!).map(name => typeOf(program!, name)));
    expect([...new Set(kinds)].sort()).toEqual(["commonjs", "module"]);
    // Some TypeScript says too little about itself, and the checker is told to keep quiet there.
    const quiet = drawn.slice(0, 200).filter(program => program?.notes.includes("under @ts-nocheck"));
    expect(quiet.length).toBeGreaterThan(4);
    expect(
      except(quiet, ({ files }) =>
        Object.entries(files!).some(([path, text]) => path.endsWith(".ts") && text.startsWith("// @ts-nocheck\n")),
      ),
    ).toEqual([]);
    // The first file of some imports through a file that only hands on what the others export.
    const barrels = drawn.slice(0, 60).filter(program => program?.files!["barrel.ts"]);
    expect(barrels.length).toBeGreaterThan(4);
    expect(
      except(
        barrels,
        ({ text, files }) =>
          text.includes(`from "./barrel";`) &&
          !/from "\.\/declared-/.test(text) &&
          /^(export (\*|(type )?\{[^}]*\}) from "(\.\/)?declared-\d+";\n)+$/.test(files!["barrel.ts"]),
      ),
    ).toEqual([]);
    // The smallest of them that has three files or more is what is cut down.
    const firstSeed = drawn.reduce(
      (best, program, seed) =>
        program &&
        Object.keys(program.files!).length > 2 &&
        (best < 0 || wholeText(program).length < wholeText(drawn[best]!).length)
          ? seed
          : best,
      -1,
    );
    const stored = async (fails: (program: Program) => boolean) => {
      using folder = tempDir("aot-fuzzer-files-first", {});
      const bed = { ...standIn(() => {}), takesSeveralFiles: true };
      const judge = bed.judge.bind(bed);
      bed.judge = async (where, programs, flags) =>
        (await judge(where, programs, flags)).map((each, index) =>
          fails(programs[index])
            ? { ...each, verdict: { kind: "crash" as const, detail: "stopped", signature: "stopped" } }
            : each,
        );
      await fuzz({
        ...settings(String(folder)),
        beds: [{ bed, jobs: 1 }],
        sources: [source],
        firstSeed,
        seconds: 60,
        programs: 1,
        batch: 1,
        reduceSeconds: 20,
      });
      const [name, ...rest] = readdirSync(join(String(folder), "out", "findings"));
      expect(rest).toEqual([]);
      const finding = join(String(folder), "out", "findings", name);
      return {
        files: readdirSync(finding).sort(),
        reduced: existsSync(join(finding, "reduced")) ? readdirSync(join(finding, "reduced")).sort() : [],
        original: readdirSync(join(finding, "original")).length,
        ...JSON.parse(readFileSync(join(finding, "finding.json"), "utf8")),
      };
    };
    const [anywhere, acrossFiles] = await Promise.all([
      stored(() => true),
      stored(program => Object.keys(program.files ?? {}).length > 0),
    ]);
    expect(anywhere).toMatchObject({ source, failsInOneFile: true, reduced: [] });
    expect(anywhere.files).toContain("reduced.ts");
    expect(anywhere.original).toBeGreaterThan(1);
    expect(acrossFiles).toMatchObject({ source, failsInOneFile: false });
    expect(acrossFiles.reduced).toContain("main.ts");
    expect(acrossFiles.reduced.length).toBe(2);
  },
  timeout,
);

test("of two long lines that differ, what is shown begins a little in front of where they part", () => {
  const ran = (stdout: string) => ({ stdout, stderr: "", exitCode: 0, signal: null, timedOut: false });
  const detail = (plain: string, compiled: string) => {
    const verdict = compare(
      standIn(() => {}),
      { text: "", extension: "js" },
      ran(plain),
      { build: ran(""), run: ran(compiled) },
    );
    return verdict.kind === "different output" ? verdict.detail : verdict.kind;
  };
  const alike = "x".repeat(300);
  expect(detail(`first\n${alike}one tail\n`, `first\n${alike}another tail\n`)).toBe(
    `at character 300 of the line plain "..${"x".repeat(40)}one tail" compiled "..${"x".repeat(40)}another tail"`,
  );
  expect(detail(`${alike}\n`, `${alike}more\n`)).toBe(
    `at character 300 of the line plain "..${"x".repeat(40)}" compiled "..${"x".repeat(40)}more"`,
  );
  expect(detail("a 1\n", "a 2\n")).toBe(`plain "a 1" compiled "a 2"`);
  expect(detail("a\n", "a\nb\n")).toBe(`plain "" compiled "b"`);
});
