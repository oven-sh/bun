// What test/aot/fuzz promises about its own judging, held to with a stand-in for the compiler: a fuzzer that books a failure as "skipped", or never ends a run, looks like one that finds nothing.
//
//   a build that stops at a type error is asked of TypeScript: what TypeScript refuses too is skipped, what it accepts is a finding
//   what lies beside a program is what the flag says: no tsconfig.json at all, an empty one, the one of `bun init` with Bun's typings installed
//   a program that has to be the entry point of its build is never a module of a shared build
//   behind the end of a run a few failures are confirmed, the rest is listed, and nothing is built again
//   a build or a run that holds more memory than it may is ended and named, and whatever a bed started ends with the fuzzer
//   what plain Bun does not get through is not run again for every mode
import { expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "path";
import { ProductBed, projects, type Bed, type Judged, type Program } from "./fuzz/beds";
import { fuzz } from "./fuzz/fuzzer";
import { typeChecker, typingsOfBun } from "./fuzz/type-check";

const options = { baseFlags: [], validate: false, threads: 1, buildSeconds: 60, runSeconds: 60 };
const timeout = 300_000;

// Runs programs as Bun does and refuses every build with the same words.
function refusesEveryBuild(folder: string): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) ls -a > seen.txt; echo "error: TS2554: Expected 0 arguments, but got 1." >&2; exit 1;;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

test.skipIf(isWindows || !typeChecker())(
  "a build refused at a type error is a finding where TypeScript accepts the program",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    const bed = new ProductBed(refusesEveryBuild(String(folder)), options);
    const judge = async (text: string, flags: string[] = []) =>
      (await bed.judge(String(folder), [{ text, extension: "ts" }], flags))[0].verdict;
    expect(await judge(`const n: number = 1;\nconsole.log(n);\n`)).toEqual({
      kind: "build refused",
      detail: "TS2554: Expected 0 arguments, but got 1. | TypeScript accepts the program",
      signature: "TSN: Expected N arguments, but got N.",
    });
    expect(await judge(`const n: number = "text";\nconsole.log(n);\n`)).toEqual({
      kind: "skipped",
      why: "type error TS2554, as in TypeScript",
    });
    // The options of the project count: an element may be missing under those of `bun init`.
    const reads = `const list = [1];\nconst n: number = list[0];\nconsole.log(n);\n`;
    expect((await judge(reads, ["--beside-the-program=no-tsconfig"])).kind).toBe("build refused");
    if (typingsOfBun())
      expect((await judge(reads, ["--beside-the-program=as-bun-init-leaves-it"])).kind).toBe("skipped");
    // In a build that several programs share, each is judged by itself.
    const shared = await bed.judge(
      String(folder),
      [{ text: `console.log(1);\n`, extension: "ts" }],
      ["--in-the-company-of=1"],
    );
    expect(shared[0].verdict.kind).toBe("build refused");
  },
  timeout,
);

test.skipIf(isWindows)(
  "what lies beside a program is what the flag says",
  async () => {
    using folder = tempDir("aot-fuzzer-beside", {});
    const bed = new ProductBed(refusesEveryBuild(String(folder)), options);
    const seen = async (name: string) => {
      await bed.judge(
        String(folder),
        [{ text: `console.log(1);\n`, extension: "ts" }],
        name ? [`--beside-the-program=${name}`] : [],
      );
      return readFileSync(join(String(folder), "seen.txt"), "utf8").split("\n");
    };
    for (const [name, { tsconfig, hasTypings }] of Object.entries(projects)) {
      if (hasTypings && !typingsOfBun()) continue;
      const files = await seen(name);
      expect([name, files.includes("tsconfig.json"), files.includes("node_modules")]).toEqual([
        name,
        !!tsconfig,
        !!hasTypings,
      ]);
      if (tsconfig) expect(JSON.parse(readFileSync(join(String(folder), "tsconfig.json"), "utf8"))).toEqual(tsconfig);
      if (hasTypings)
        expect(existsSync(join(String(folder), "node_modules", "@types", "bun", "index.d.ts"))).toBe(true);
    }
  },
  timeout,
);

// A bed that builds nothing: it notes what it is asked and fails what its text says.
function standIn(judged: (programs: Program[]) => void, seconds = 0): Bed {
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
      await Bun.sleep(seconds * 1000);
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

const settings = (folder: string) => ({
  out: join(folder, "out"),
  work: join(folder, "work"),
  programsRoot: join(import.meta.dir, "programs"),
  known: [],
  minFreeBytes: 0,
  reduceSeconds: 0,
  attribute: false,
  firstSeed: 1,
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
    const started = Date.now();
    // Every program fails in words of its own, and the first build outlasts the run.
    const summary = await fuzz({
      ...settings(String(folder)),
      beds: [{ bed: standIn(() => void calls++, 9), jobs: 1 }],
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
    expect(Date.now() - started).toBeLessThan(60_000);
  },
  timeout,
);

test(
  "what is never the doing of a busy machine is stored behind the last call as it was drawn, with the programs beside it",
  async () => {
    using folder = tempDir("aot-fuzzer-late-stop", {});
    const bed = standIn(() => {}, 9);
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

const growsWithoutEnd = `const kept = []; for (;;) kept.push(new Array(1 << 14).fill(kept.length));`;

// Runs programs as Bun does; each of its builds holds more and more.
function everyBuildGrowsWithoutEnd(folder: string): string {
  const path = join(folder, "stand-in");
  writeFileSync(
    path,
    `#!/bin/sh\ncase "$1" in\nbuild) exec "${bunExe()}" -e '${growsWithoutEnd}';;\n*) exec "${bunExe()}" "$@";;\nesac\n`,
  );
  chmodSync(path, 0o755);
  return path;
}

test.skipIf(isWindows)(
  "a run that holds too much memory is skipped and such a build is a finding",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {});
    const bed = new ProductBed(everyBuildGrowsWithoutEnd(String(folder)), { ...options, memory: 256 * 2 ** 20 });
    const judge = async (text: string) => (await bed.judge(String(folder), [{ text, extension: "js" }], []))[0];
    expect((await judge(growsWithoutEnd)).verdict).toEqual({ kind: "skipped", why: "plain run takes too much memory" });
    const { verdict, compiled } = await judge(`console.log(1);\n`);
    expect(verdict).toEqual({ kind: "build hang", detail: "took too much memory", signature: "took too much memory" });
    expect(compiled!.build).toMatchObject({ timedOut: true, tookTooMuchMemory: true, signal: null, exitCode: null });
  },
  timeout,
);

test.skipIf(isWindows)(
  "what a bed started ends when the fuzzer is killed",
  async () => {
    using folder = tempDir("aot-fuzzer-judges", {
      "fuzzer.ts": `import { spawned } from ${JSON.stringify(join(import.meta.dir, "fuzz", "beds"))};
await spawned([process.execPath, "-e", 'require("fs").writeFileSync("pid", String(process.pid)); setInterval(() => {}, 1000);'], import.meta.dir, 120);`,
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
