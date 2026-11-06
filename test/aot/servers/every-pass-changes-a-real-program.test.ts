// Whether a pass of the compiler does anything is asked of real programs, not of programs written for it: two servers of ./app and a
// terminal program on a package that names its TypeScript under the "aot" condition (../typed-packages/small-renderer/terminal.ts). Each is
// built the way a user builds it, and the build's report says how often each pass changed something.
//
//   every pass        changes something in at least one of the programs, or stands in the list below: the passes that only look or only
//                     lay out, which never report a change. A listed pass that does change something fails the test as well, so the
//                     list says what is so.
//   write barriers    a store of a cell into an object is followed by a write barrier unless the compiler shows that none is needed: the
//                     object is younger than any collection, or a later store into it has the barrier. The number of barriers is
//                     held for every program. The share of stores that go without is printed and not held: it falls where code
//                     that needed few barriers is no longer compiled, and the program has fewer barriers all the same.
//   rounds            the passes run over a function in rounds until a round changes nothing, and a limit ends the rounds that do not
//                     end by themselves. Two passes that undo each other never come to rest: in every function where they meet, every
//                     round up to the limit runs all the passes that look again behind a change, and the code is none the better.
//                     The number of functions that end at the limit is held for every program.
//
// To take a pass out: this test says by a run what the pass does to these programs. A pass that changes them is at work, whatever a
// benchmark says, and what it buys has to be asked of the programs (--aot-disable=pass:<name>).
//
// It prints one line a pass that begins with PASS: the changes by program; and one that begins with ROUNDS.
import { afterAll, expect } from "bun:test";
import { rmSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { readBuildReport, type BuildReport } from "../harness/build-report";
import { built, slot, spawned } from "../harness/commands";
import { compileCommand, withReport } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { installSmallRenderer } from "../typed-packages/small-renderer/install";
import { copyApp } from "./run-servers";

const programs = ["thin", "elysia", "terminal"];

/** They read the program, check it, or decide where things lie, and hand the result to others. */
const passesThatReportNoChange = [
  "AnalyzeFlow",
  "BuildCallGraph",
  "CheckLockedBuiltinWrites",
  "CheckPlacement",
  "CheckRegExpLiterals",
  "ComputeEffectSummaries",
  "ElideStackChecks",
  "EstimateHeat",
  "GenerateCode",
  "NumberLiteralStrings",
  "PlanSlots",
  "SummarizeForInlining",
  "VerifyProgram",
];
/** ExpandLongArrayLiterals finds work in the server on Fastify alone, whose build takes longer than the three together. */
const passesWithoutWorkHere = ["ExpandLongArrayLiterals"];
/** Two of them count what they decide. */
const statisticsOfPassesThatReportNoChange = {
  ElideStackChecks: "FunctionsEnteredWithoutStackCheck",
  NumberLiteralStrings: "LiteralStringsNumbered",
};

/**
 * The barriers the terminal program is compiled with on Linux x64, within five percent. Without the removal of barriers: 221.
 * It counts places in the code, not barriers that run: a call that is inlined brings a copy of each of its barriers along,
 * and the share of stores without a barrier stays what it was.
 */
/** The write barriers that each program is compiled with on Linux x64. A number here only ever goes down. */
const barriersAtMost: Record<string, number> = {
  thin: 519,
  elysia: 2353,
  terminal: 199,
};
/**
 * The functions of each program whose rounds end at the limit, on Linux x64: chains of calls that are inlined a level a round.
 * The bound is twice that and two. A pair of passes that undid each other took the servers to five times as many.
 */
const functionsAtLimitOfRounds: Record<string, number> = {
  thin: 0,
  elysia: 19,
  terminal: 0,
};
/** The whole text of the terminal program lies in this repository, and its number is small: it is held where it was read. */
const isHeldHere = (program: string) => program !== "terminal" || (isLinux && process.arch === "x64");

describe("every pass changes a real program", () => {
  const work = String(tempDir("aot-every-pass", {}));
  const terminal = String(tempDir("aot-every-pass-terminal", {}));
  const app = join(work, "app");
  const reports = new Map<string, BuildReport>();
  afterAll(() => [work, terminal].forEach(folder => rmSync(folder, { recursive: true, force: true })));

  beforeAll(async () => {
    installSmallRenderer(terminal);
    await copyApp(app);
    await Promise.all(
      programs.map(name =>
        slot(async () => {
          const report = join(work, `${name}.report.json`);
          const executable = join(work, `${name}-compiled${isWindows ? ".exe" : ""}`);
          built(
            await spawned(
              [bunExe(), ...compileCommand, ...withReport(report, "summary"), "--define", 'process.env.NODE_ENV="production"', "--target=bun", `./${name}.ts`, "--outfile", executable], // prettier-ignore
              name === "terminal" ? terminal : app,
              bunEnv,
            ),
          );
          rmSync(executable, { force: true });
          reports.set(name, readBuildReport(report));
        }),
      ),
    );
  }, 900_000);

  test("every pass changes one of the programs, or is listed as one that does not", () => {
    const names = reports.get(programs[0])!.passes.map(pass => pass.name);
    const changesOf = (pass: string, program: string) =>
      reports.get(program)!.passes.find(record => record.name === pass)?.changes ?? 0;
    for (const pass of names)
      console.log(`PASS ${pass}: ${programs.map(program => `${program} ${changesOf(pass, program)}`).join(", ")}`);
    const idle = names.filter(pass => programs.every(program => changesOf(pass, program) === 0));
    expect(idle.toSorted()).toEqual([...passesThatReportNoChange, ...passesWithoutWorkHere].toSorted());
    for (const [pass, statistic] of Object.entries(statisticsOfPassesThatReportNoChange))
      expect({ pass, counts: programs.some(program => reports.get(program)!.statistics[statistic] > 0) }).toEqual({
        pass,
        counts: true,
      });
  });

  test("the programs are compiled with no more write barriers than before", () => {
    const seen = programs.map(program => {
      const {
        BarriersEmitted: emitted,
        BarriersOnUnmarkableOwners: young,
        BarriersCoveredLater: covered,
      } = reports.get(program)!.statistics;
      return { program, emitted, percentWithout: Math.floor((100 * (young + covered)) / (emitted + young + covered)) };
    });
    console.log(
      `BARRIERS ${seen.map(row => `${row.program} ${row.emitted} (${row.percentWithout}% without)`).join(", ")}`,
    );
    // The text of Bun's own modules differs a little from platform to platform, and so do the counts: five in a hundred.
    expect(seen.filter(row => isHeldHere(row.program) && row.emitted > barriersAtMost[row.program] * 1.05)).toEqual([]);
  });

  test("the rounds of the passes end by themselves in all but a few functions", () => {
    const seen = programs.map(program => ({
      program,
      atLimit: reports.get(program)!.statistics.MaxOptimizationRoundsHits ?? 0,
    }));
    console.log(`ROUNDS ${seen.map(row => `${row.program} ${row.atLimit}`).join(", ")}`);
    expect(seen.filter(row => row.atLimit > functionsAtLimitOfRounds[row.program] * 2 + 2)).toEqual([]);
  });
});
