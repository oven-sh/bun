// Opt-in test, like ./servers.test.ts. CI runs it as the unit `aot/servers/every-pass-changes-one-of-the-servers` of ../parts.mts.
//
// Whether a pass of the compiler does anything is asked of real programs, not of programs written for it: eight servers of ./app, the type
// checker of the typescript package (./typescript-check.ts) and a terminal program on a package that names its TypeScript under the "aot"
// condition (../typed-packages/small-renderer/terminal.ts). Each is built the way a user builds it, and the build's report says how often each
// pass changed something.
//
//   every pass        changes something in at least one of the programs, or stands in one of the two lists below: the passes that only look
//                     or only lay out, which never report a change, and the passes whose form none of these programs has. Each of the
//                     latter has a program of its own in ../passes-that-large-programs-seldom-need-change-small-ones.test.ts or a test of
//                     the engine. A listed pass that does change something fails the test as well, so the lists say what is so.
//   write barriers    a store of a cell into an object is followed by a write barrier unless the compiler shows that none is needed: the
//                     object is younger than any collection, or a later store into it has the barrier. The share of stores that go
//                     without is held for every program, and the number of barriers for the terminal program, whose whole text lies in
//                     this repository: the others change with the packages that are installed.
//
// To take a pass out: this test says by a run what the pass does to these programs. A pass that changes them is at work, whatever a
// benchmark says, and what it buys has to be asked of the programs (--aot-disable=pass:<name>).
//
//   AOT_SERVERS=1 bun test test/aot/servers/every-pass-changes-a-real-program.test.ts      about two minutes on eight cores
//   AOT_SERVERS_MODULES=<node_modules folder> ..                                            nothing is downloaded
//
// It prints one line a pass that begins with PASS: the changes by program.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, rmSync, symlinkSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { dirname, join } from "path";
import { readBuildReport, type BuildReport } from "../harness/build-report";
import { compileCommand, withReport } from "../harness/flags";
import { built, slot, spawned, unsupported } from "../run-programs";
import { installSmallRenderer } from "../typed-packages/small-renderer/install";
import { installPackages, requestedServers } from "./run-servers";

const servers = ["bun", "thin", "hono", "elysia", "node", "koa", "express", "fastify"];
const programs = [...servers, "typescript", "terminal"];

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
/** Two of them count what they decide. */
const statisticsOfPassesThatReportNoChange = {
  ElideStackChecks: "FunctionsEnteredWithoutStackCheck",
  NumberLiteralStrings: "LiteralStringsNumbered",
};

/** None of the programs has what they are for. */
const passesWithoutWorkInThesePrograms = ["RemoveDeadCountedLoops"];

/**
 * The barriers the terminal program is compiled with on Linux x64, within five percent. Without the removal of barriers: 221.
 * It counts places in the code, not barriers that run: a call that is inlined brings a copy of each of its barriers along,
 * and the share of stores without a barrier stays what it was.
 */
const barriersOfTheTerminalProgram = 199;
/** Of a hundred stores of cells, how many are compiled without a barrier. */
const percentWithoutBarrierAtLeast: Record<string, number> = {
  bun: 8,
  thin: 10,
  hono: 7,
  elysia: 10,
  node: 14,
  koa: 16,
  express: 15,
  fastify: 18,
  typescript: 10,
  terminal: 9,
};

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/every-pass-changes-a-real-program.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );

describe.skipIf(!requestedServers || !!unsupported)("compile/aot/every pass changes a real program", () => {
  const folders = {
    app: String(tempDir("aot-every-pass-servers", {})),
    typescript: String(tempDir("aot-every-pass-typescript", {})),
    terminal: String(tempDir("aot-every-pass-terminal", {})),
  };
  const reports = new Map<string, BuildReport>();
  afterAll(() => Object.values(folders).forEach(folder => rmSync(folder, { recursive: true, force: true })));

  function layOutTypeScript(folder: string) {
    cpSync(join(import.meta.dir, "typescript-check.ts"), join(folder, "typescript-check.ts"));
    mkdirSync(join(folder, "node_modules"));
    const modules = process.env.AOT_SERVERS_MODULES;
    symlinkSync(
      modules && existsSync(join(modules, "typescript"))
        ? join(modules, "typescript")
        : dirname(require.resolve("typescript/package.json")),
      join(folder, "node_modules", "typescript"),
      "junction",
    );
  }

  beforeAll(async () => {
    cpSync(join(import.meta.dir, "app"), folders.app, { recursive: true });
    await installPackages(folders.app);
    layOutTypeScript(folders.typescript);
    installSmallRenderer(folders.terminal);
    await Promise.all(
      programs.map(name =>
        slot(async () => {
          const folder = name === "typescript" || name === "terminal" ? folders[name] : folders.app;
          const entry = name === "typescript" ? "./typescript-check.ts" : `./${name}.ts`;
          const report = join(folder, `${name}.report.json`);
          const executable = join(folder, `${name}-compiled${isWindows ? ".exe" : ""}`);
          built(
            await spawned(
              [bunExe(), ...compileCommand, ...withReport(report, "summary"), "--define", 'process.env.NODE_ENV="production"', "--target=bun", entry, "--outfile", executable], // prettier-ignore
              folder,
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
    expect(idle.toSorted()).toEqual([...passesThatReportNoChange, ...passesWithoutWorkInThesePrograms].toSorted());
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
    // Whatever copies or removes code moves the counts, and the shares hardly: two points.
    expect(seen.filter(row => row.percentWithout < percentWithoutBarrierAtLeast[row.program] - 2)).toEqual([]);
    // The text of Bun's own modules differs a little from platform to platform, and so do the counts.
    if (isLinux && process.arch === "x64")
      expect(seen.find(row => row.program === "terminal")!.emitted).toBeLessThanOrEqual(
        barriersOfTheTerminalProgram * 1.05,
      );
  });
});
