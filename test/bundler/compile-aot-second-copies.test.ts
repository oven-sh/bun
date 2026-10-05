import { describe, expect, test } from "bun:test";
import { cpSync, readdirSync } from "fs";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

const everywhere = "useAOTGuardsAtEveryGuessedPlaceForTesting=1";
const withoutText = {
  BUN_COMPILE_OMIT_SOURCES_CONTENT: "1",
  BUN_COMPILE_OMIT_SOURCE_TEXT: "1",
  BUN_COMPILE_OMIT_BYTECODE: "1",
  BUN_COMPILE_COMPACT_POSITIONS: "1",
};
const copied = ["throwsItself", "callsOut", "inlines", "catchesItself", "typeErrors", "captures", "sites", "callsHost", "readsGetter", "readsAll", "readsAround", "spins"];

type Build = { folder: string; out: string; hasSecondCopy: (name: string) => boolean };
const builds = new Map<string, Promise<Build>>();
function built(options: string | null, env: Record<string, string> = {}) {
  const key = options + JSON.stringify(env);
  let build = builds.get(key);
  if (!build) builds.set(key, (build = compile(options, env)));
  return build;
}
const withoutImage = () => built(null);
async function compile(options: string | null, env: Record<string, string>): Promise<Build> {
  const folder = String(tempDir("compile-aot-second-copies", {}));
  cpSync(join(import.meta.dir, "fixtures", "compile-aot-second-copies"), join(folder, "src"), { recursive: true });
  const remarks = join(folder, "remarks.txt");
  await using build = Bun.spawn({
    cmd: [bunExe(), "build", "--compile", ...(options === null ? [] : ["--compile-aot"]), "src/entry.ts", "src/worker.ts", "--outfile", "out"],
    env: { ...bunEnv, ...env, BUN_AOT_OPTIONS: [`aotRemarksPath=${remarks}`, options].filter(Boolean).join(",") },
    cwd: folder,
    stdout: "pipe",
    stderr: "pipe",
  });
  expect([await build.stderr.text(), await build.exited]).toEqual([expect.not.stringContaining("error"), 0]);
  const withSecondCopy = new Set<string>();
  if (options !== null) {
    for (const line of (await Bun.file(remarks).text()).split("\n")) {
      const [name, remark] = line.split("\t");
      if (remark === "guards-over-whole-function") withSecondCopy.add(name);
    }
  }
  return { folder, out: join(folder, "out"), hasSecondCopy: name => withSecondCopy.has(name) };
}
async function run(build: Build, args: string[], env: Record<string, string> = {}, cwd = join(build.folder, "..")) {
  await using proc = Bun.spawn({ cmd: [build.out, ...args], env: { ...bunEnv, ...env }, cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}
const counting = (build: Build) => ({ BUN_JSC_useAOTOperationCounters: "1", BUN_JSC_aotTypeCoverageCountsPath: join(build.folder, "counts") });
const numbers = (line: string) => {
  const found = /\[born with number (\d+), given (\d+); exits: without number (\d+), departed (\d+); departures (\d+)\]/.exec(line)!;
  const [born, given, withoutNumber, departed, departures] = found.slice(1).map(Number);
  return { born, given, withoutNumber, departed, departures };
};
const recordsOf = (stdout: string, who: string) =>
  stdout.split("\n").filter(line => line.split(" ")[1] === who).map(line => line.replace(` ${who} `, " "));
const fromTheError = (stderr: string) => {
  const lines = stderr.split("\n");
  return lines.slice(lines.findIndex(line => /^\w*Error: /.test(line))).join("\n");
};

describe("compile/aot/SecondCopies", () => {
  test("the functions of the fixture have a second copy", async () => {
    const twice = await built(everywhere);
    expect(copied.filter(name => !twice.hasSecondCopy(name))).toEqual([]);
    expect(["attempt", "member", "main", "passes", "fails"].filter(name => twice.hasSecondCopy(name))).toEqual([]);
  });

  test("objects of another shape leave the first copy, and only they", async () => {
    const twice = await built(everywhere + ",useAOTOperationCounters=1");
    const withStrangers = await run(twice, [], counting(twice));
    const withoutStrangers = await run(twice, ["--no-strangers"], counting(twice));
    expect(numbers(withStrangers.stderr).withoutNumber - numbers(withoutStrangers.stderr).withoutNumber).toBeGreaterThan(60);
    expect(recordsOf(withoutStrangers.stdout, "stranger")).toEqual(recordsOf(withStrangers.stdout, "stranger"));
  });

  for (const [title, env] of [["with the text", {}], ["without the text", withoutText]] as const) {
    test(`stacks, positions, messages and call sites are the same in both copies, ${title}`, async () => {
      const expected = await run(await withoutImage(), []);
      expect(expected.exitCode).toBe(0);
      expect(expected.stdout.split("\n").length).toBeGreaterThan(170);
      expect(expected.stdout).toContain("(evaluating 'a.nothing.more')");
      expect(recordsOf(expected.stdout, "member").length).toBeGreaterThan(80);
      for (const options of ["", everywhere, ...[1, 2, 3].map(n => `${everywhere},failEveryNthAOTGuardForTesting=${n}`)]) {
        const actual = await run(await built(options, env), []);
        expect({ options, ...actual }).toEqual({ options, ...expected });
        expect({ options, records: recordsOf(actual.stdout, "stranger") }).toEqual({ options, records: recordsOf(actual.stdout, "member") });
      }
    });

    test(`an uncaught error is printed the same from both copies, ${title}`, async () => {
      const [reference, twice] = await Promise.all([withoutImage(), built(everywhere, env)]);
      for (const when of ["1", "2", "3", "4", "5"]) {
        const [expected, fromFirst, fromSecond] = await Promise.all([
          run(reference, ["--uncaught", when]),
          run(twice, ["--uncaught", when]),
          run(twice, ["--uncaught", "--stranger", when]),
        ]);
        expect(fromTheError(expected.stderr)).toContain("at typeErrors (");
        expect(expected.exitCode).toBe(1);
        expect([fromTheError(fromFirst.stderr), fromFirst.exitCode]).toEqual([fromTheError(expected.stderr), 1]);
        expect([fromSecond.stderr, fromSecond.exitCode]).toEqual([fromFirst.stderr, 1]);
      }
    });
  }

  test("a departure in one thread is not seen by the guards of another", async () => {
    const [reference, twice] = await Promise.all([withoutImage(), built(everywhere + ",useAOTOperationCounters=1,useAOTInlining=0")]);
    const [expected, actual] = await Promise.all([run(reference, ["--workers"]), run(twice, ["--workers"], counting(twice))]);
    const lines = actual.stdout.trim().split("\n");
    expect(lines.map(line => line.replace(/ \[.*$/, ""))).toEqual(expected.stdout.trim().split("\n"));
    expect(actual.exitCode).toBe(0);
    const departedOf = (thread: string) => lines.filter(line => line.startsWith(thread + " around")).map(line => numbers(line).departed);
    expect(departedOf("A")).toEqual([0, 50]);
    expect(departedOf("B")).toEqual([0, 0, 0]);
    expect(departedOf("main")).toEqual([0, 0, 50]);
    expect(departedOf("C")).toEqual([0, 0]);
    expect(departedOf("D")).toEqual([0]);
    for (const thread of ["A", "B", "C", "D"]) {
      const last = numbers(lines.findLast(line => line.startsWith(thread + " "))!);
      expect([thread, last.given, last.departures]).toEqual([thread, 1, thread === "A" ? 1 : 0]);
      expect(last.born).toBeGreaterThanOrEqual(50);
    }
  });

  test("a profile names the function and its lines, whichever copy runs", async () => {
    const [reference, twice] = await Promise.all([withoutImage(), built(everywhere)]);
    expect(twice.hasSecondCopy("spins")).toBe(true);
    const framesOf = async (build: Build, who: string) => {
      using dir = tempDir("compile-aot-second-copies-profile", {});
      const { exitCode } = await run(build, ["--spin", who], { BUN_OPTIONS: "--cpu-prof" }, String(dir));
      expect(exitCode).toBe(0);
      const profile = await Bun.file(join(String(dir), readdirSync(String(dir)).find(name => name.endsWith(".cpuprofile"))!)).json();
      const nodes = profile.nodes.filter((node: any) => node.callFrame.functionName === "spins");
      expect(nodes.length).toBeGreaterThan(0);
      const first = nodes[0].callFrame.lineNumber;
      for (const node of nodes) for (const tick of node.positionTicks ?? []) expect(tick.line - first).toBeWithin(0, 9);
      return [...new Set(nodes.map((node: any) => JSON.stringify([node.callFrame.url, node.callFrame.lineNumber, node.callFrame.columnNumber])))];
    };
    const expected = await framesOf(reference, "--member");
    expect(expected.length).toBe(1);
    expect(await framesOf(twice, "--member")).toEqual(expected);
    expect(await framesOf(twice, "--stranger")).toEqual(expected);
  });
});
