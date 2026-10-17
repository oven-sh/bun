import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { unsupported, withoutDebugInformation } from "./run-programs";
import { compareAll, described, jailOfThisMachine, Tally, type Program, type Result, type Settings } from "./trimmed-against-whole/compare";
import { aotPrograms, repository, test262 } from "./trimmed-against-whole/corpora";
import { programsOfEveryLocale } from "./trimmed-against-whole/locales";
import { programsThatNameEverything, programsThatReachNames, reflect } from "./trimmed-against-whole/reach-names";

using probe = tempDir("trimmed-against-whole-probe", { "hello.ts": "console.log(1);" });
const probed = Bun.spawnSync({
  cmd: [bunExe(), "build", "--compile", "--compile-trim-runtime", "hello.ts", "--outfile", "hello"],
  cwd: String(probe),
  env: bunEnv,
  stderr: "pipe",
});
const hasIslands = probed.exitCode === 0 && !unsupported;

const doors = readFileSync(join(repository, "scripts/build/islands.doors"), "utf8");
const known = readFileSync(join(import.meta.dir, "trimmed-against-whole/known-differences.txt"), "utf8")
  .split("\n")
  .filter(line => line && !line.startsWith("#"))
  .map(line => line.split(" | "));

function isKnown(result: Result): boolean {
  const said = `${result.trimmed?.stdout}\n${result.trimmed?.stderr}`;
  return known.some(([kind, pattern]) => (kind === "program" ? pattern === `${result.corpus} ${result.name}` : new RegExp(pattern).test(said)));
}

function sample(programs: Program[], count: number, seed: string): Program[] {
  const rank = new Map(programs.map(program => [program, Bun.hash(`${seed} ${program.corpus} ${program.name}`)]));
  return programs.sort((one, other) => (rank.get(one)! < rank.get(other)! ? -1 : 1)).slice(0, count);
}

function* startedBefore(deadline: number, programs: Program[]) {
  for (const program of programs) {
    if (Date.now() > deadline) return;
    yield program;
  }
}

function settingsIn(scratch: string): Settings {
  return {
    bun: bunExe(),
    scratch: join(scratch, "scratch"),
    kept: join(scratch, "kept"),
    doors,
    jobs: 4,
    highestLoad: Infinity,
    leastMemory: 0,
    mostProcesses: 4000,
    jail: jailOfThisMachine(),
    buildSeconds: 180,
    runSeconds: 20,
    env: Object.fromEntries(["PATH", "SystemRoot", "ASAN_OPTIONS", "LSAN_OPTIONS"].map(name => [name, bunEnv[name]])),
    buildFlags: withoutDebugInformation(),
    findsFeature: true,
  };
}

async function expectSame(programs: Program[], minutes: number) {
  using scratch = tempDir("trimmed-against-whole", {});
  const tally = new Tally();
  const differing: Result[] = [];
  const failures: string[] = [];
  await compareAll(startedBefore(Date.now() + minutes * 60_000, programs), settingsIn(String(scratch)), result => {
    tally.add(result);
    if (result.verdict === "differs" && !isKnown(result)) differing.push(result);
    if (result.why === "the runner failed") failures.push(`${result.corpus} ${result.name}: ${result.detail}`);
  });
  console.log(String(tally));
  expect(differing.map(described).join("\n")).toBe("");
  expect(failures).toEqual([]);
  expect([...tally.rows.values()].reduce((same, row) => same + (row.get("same") ?? 0), 0)).toBeGreaterThan(0);
}

const inOneMode = (programs: Program[]) => programs.filter(program => !program.name.endsWith("(strict too)"));
const conformanceTests = () => inOneMode(test262(join(import.meta.dir, "trimmed-against-whole/test262")));

test.skipIf(!hasIslands)("a part that is left out of a program that uses it is found and named", async () => {
  using scratch = tempDir("trimmed-against-whole", {});
  const program: Program = { corpus: "control", name: "color", entry: "color.mjs", files: () => ({ "color.mjs": `console.log(Bun.color("red", "hex"));\n` }) };
  const results: Result[] = [];
  await compareAll([program], { ...settingsIn(String(scratch)), wronglyLeftOut: ["color"] }, result => results.push(result));
  expect(results).toEqual([expect.objectContaining({ verdict: "differs", why: "exit code 0 | 70", features: ["color"], door: expect.any(Number), world: "closed" })]);
  expect(results[0].whole).toEqual({ stdout: "#ff0000\n", stderr: "", exitCode: 0, signal: null });
}, 300_000);

test.skipIf(!hasIslands)("test262: the same 200 files on every commit", () => expectSame(conformanceTests(), 4), 900_000);

test.skipIf(!hasIslands)("each service of Intl alone in a program, for every locale", () => expectSame(programsOfEveryLocale(), 2), 900_000);

test.skipIf(!hasIslands)("other programs on every commit, chosen by the revision of this Bun", () => expectSame(sample([...aotPrograms(), ...programsThatNameEverything(reflect(bunExe()))], 400, Bun.revision), 2), 900_000);

test.skipIf(!hasIslands)("names reached by constant and computed keys: --corpus names --seed fixed", () => expectSame(programsThatReachNames(reflect(bunExe()), doors, "fixed", 30), 1), 900_000);

test.skipIf(!hasIslands)(`names reached by constant and computed keys: --corpus names --seed ${Bun.revision}`, () => expectSame(programsThatReachNames(reflect(bunExe()), doors, Bun.revision, 400), 1), 900_000);
