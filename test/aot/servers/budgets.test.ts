// What the servers under ./app and ./tanstack cost, held against ./budgets.json, which only goes down.
// Opt-in by hand, like ./servers.test.ts. CI runs one unit per server: `aot/servers/budgets-of-<name>` in ../parts.mts.
//
// Each server is built twice: the way a user builds it, for the size of its code, and with a counter on each side of each branch
// (../harness/counted-run.ts). The counted server answers a fixed number of rounds, one request of each route of ./answers.ts a
// round, every answer compared. All numbers are exact counts: no clock, the same on any machine at any load.
// "typescript" is no server: ./typescript-check.ts, the type checker of the typescript package; its round is one check of a fixed text.
//
//   codeBytes            the machine code in the image
//   bytesAValue          the bytes of machine code for one value of the program as the compiler first reads it, in source functions
//                        of 10 to 300 values, with all the versions and copies that are made of them
//   tests                the tests that the compiler put in front of what it expects (a type, a layout, a filled slot ..): how many
//                        run in a round, and how many take the side that it laid out as the less likely one. Only those that
//                        fail are held against the budget: an access by name that becomes a tested slot adds a test and is a gain.
//   typeTests            the type tests among them
//   alwaysFailing        the tests that run every round and fail every time: they cost the test and the slow side and buy nothing.
//                        In Bun's own modules they are listed by module, kind and position, and the aim is none.
//                        In packages and in the program itself they are counted.
//   uneven               the tests whose counts are no whole number a round: something other than the requests decides them
//   accessesByName       the accesses in a round that look a property up by its name or by a key instead of loading a slot
//   runtimeOperations    the calls in a round out of compiled code and its stubs into functions of the run time, by function;
//                        their sum is held against the budget
//   allocated            the cells and bytes that compiled code and its stubs allocate in a round
//   closures             the function objects made in a round, and those made once: by the start and by what only the first rounds do
//   calls                the calls of compiled functions in a round, and those among them that enter a function which the compiler took
//                        for cold, for run once, or for reachable only behind a test that fails: it gave them its slowest code
//
// A number that is over its budget by more than 2% and by more than 3 fails the test, which then names the places that are new: how a stream
// is cut into pieces moves a few calls and cells from run to run. Whoever means to accept it edits ./budgets.json, where a reviewer sees it.
//
//   AOT_SERVERS=1 bun test test/aot/servers/budgets.test.ts             all (about three minutes on eight cores, and three more for "typescript")
//   AOT_SERVERS=node,hono ..                                            only these
//   AOT_SERVERS_MODULES=<node_modules folder> ..                        nothing is downloaded
//   AOT_BUDGETS=lower ..                                                writes every number that got better into ./budgets.json,
//                                                                       but only if no number of any server got worse: what one
//                                                                       change buys with another number is no floor for the next
//   AOT_BUDGETS=accept ..                                               writes every number as measured
//   AOT_BUDGETS_TABLE=<folder> ..                                       also writes <folder>/<server>.tsv: every test by position
//   AOT_BUDGETS_FILE=<file> ..                                          another file in place of ./budgets.json
//
// Each server prints one line that begins with BUDGET: within, better or worse, and by which numbers; and one that begins with
// NUMBERS: all that may only fall, as measured, for whoever compares one Bun with another.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, tempDir } from "harness";
import { dirname, join } from "path";
import {
  alwaysFailing,
  buildCounted,
  codeOf,
  countScript,
  countServer,
  entryThatExitsWhenTold,
  run,
  testsAddedByTheCompiler,
  type CountedTest,
  type CountedWork,
  type Exchange,
} from "../harness/counted-run";
import { unsupported } from "../run-programs";
import { routes } from "./answers";
import { filterRequested, installPackages, requestedServers } from "./run-servers";

interface Budget {
  codeBytes: number;
  bytesAValue?: number;
  tests: { executed: number; failed: number };
  typeTests: { executed: number; failed: number };
  /** `bunAtMost` is there where the budget is lower than the places listed: the list is that of a later Bun than the number. */
  alwaysFailing: { bun: Record<string, string[]>; bunAtMost?: number; packages: number; program: number };
  uneven: number;
  calls: { all: number; ofFunctionsNotExpectedToRun: number };
  accessesByName: number;
  runtimeOperations: Record<string, number>;
  allocated: { cells: number; bytes: number };
  closures: { aRound: number; once: number };
}
/** A number that the file does not have yet has no budget; AOT_BUDGETS=lower writes it. */
type Later = "calls" | "accessesByName" | "runtimeOperations" | "allocated" | "closures";
type StoredBudget = Omit<Budget, Later> & Partial<Pick<Budget, Later>>;

const servers = filterRequested([
  "bun",
  "node",
  "koa",
  "express",
  "hono",
  "fastify",
  "elysia",
  "tanstack",
  "typescript",
]);
const budgetsPath = process.env.AOT_BUDGETS_FILE ?? join(import.meta.dir, "budgets.json");
const budgets: Record<string, StoredBudget> = existsSync(budgetsPath)
  ? JSON.parse(readFileSync(budgetsPath, "utf8"))
  : {};
const mode = process.env.AOT_BUDGETS;
const measuresThisPlatform = isLinux && process.arch === "x64";
const measuresThisBuild = !isDebug && !isASAN;

const exchanges: Exchange[] = routes.map(route => ({
  method: route.method,
  path: route.path,
  body: route.request,
  expected: { status: route.status ?? 200, type: route.type, body: route.expectedBody },
}));

const sum = (tests: CountedTest[]) => ({
  executed: tests.reduce((total, test) => total + test.executed, 0),
  failed: tests.reduce((total, test) => total + test.failed, 0),
});

const placeOf = (test: CountedTest) => `${test.kind} ${test.position}`;

function measured(
  { codeBytes, bytesAValue }: Awaited<ReturnType<typeof codeOf>>,
  { tests, uneven, calls, accessesByName, runtimeOperations, allocated, closures }: CountedWork,
): Budget {
  const added = tests.filter(test => testsAddedByTheCompiler.has(test.kind));
  const failing = alwaysFailing(added);
  const bun: Record<string, string[]> = {};
  for (const test of failing) if (test.owner === "bun") (bun[test.path] ??= []).push(placeOf(test));
  return {
    codeBytes,
    bytesAValue,
    tests: sum(added),
    typeTests: sum(added.filter(test => test.kind === "TypeTest")),
    alwaysFailing: {
      bun,
      packages: failing.filter(test => test.owner === "packages").length,
      program: failing.filter(test => test.owner === "program").length,
    },
    uneven: uneven.filter(test => testsAddedByTheCompiler.has(test.kind)).length,
    calls: {
      all: Object.values(calls).reduce((total, count) => total + count, 0),
      ofFunctionsNotExpectedToRun: calls.cold + calls.once + calls.behindFailedTest,
    },
    accessesByName,
    runtimeOperations,
    allocated,
    closures: { aRound: closures.each, once: closures.once },
  };
}

const countOf = (byModule: Record<string, string[]>) =>
  Object.values(byModule).reduce((total, places) => total + places.length, 0);

const total = (counts: Record<string, number> | undefined) =>
  counts && Object.values(counts).reduce((sum, count) => sum + count, 0);

const numbersOf = (budget: StoredBudget) => ({
  "codeBytes": budget.codeBytes,
  "bytesAValue": budget.bytesAValue,
  "tests.failed": budget.tests.failed,
  "typeTests.failed": budget.typeTests.failed,
  "alwaysFailing.bun": budget.alwaysFailing.bunAtMost ?? countOf(budget.alwaysFailing.bun),
  "alwaysFailing.packages": budget.alwaysFailing.packages,
  "alwaysFailing.program": budget.alwaysFailing.program,
  "uneven": budget.uneven,
  "calls.ofFunctionsNotExpectedToRun": budget.calls?.ofFunctionsNotExpectedToRun,
  "accessesByName": budget.accessesByName,
  "runtimeOperations": total(budget.runtimeOperations),
  "allocated.cells": budget.allocated?.cells,
  "allocated.bytes": budget.allocated?.bytes,
  "closures.aRound": budget.closures?.aRound,
  "closures.once": budget.closures?.once,
});

/** The budget with every number that got better, or, with `onlyWhatIsMissing`, with only the numbers that it did not have yet. */
function lowered(budget: StoredBudget, now: Budget, onlyWhatIsMissing: boolean): Budget {
  const lower = (a: number | undefined, b: number) => (a === undefined ? b : onlyWhatIsMissing ? a : Math.min(a, b));
  const written = (a: number | undefined, b: number) => (onlyWhatIsMissing ? (a ?? b) : b);
  const { bun, bunAtMost } = budget.alwaysFailing;
  const keepsItsPlaces = onlyWhatIsMissing || countOf(now.alwaysFailing.bun) > (bunAtMost ?? countOf(bun));
  return {
    codeBytes: lower(budget.codeBytes, now.codeBytes),
    bytesAValue: now.bytesAValue === undefined ? budget.bytesAValue : lower(budget.bytesAValue, now.bytesAValue),
    tests: {
      executed: written(budget.tests.executed, now.tests.executed),
      failed: lower(budget.tests.failed, now.tests.failed),
    },
    typeTests: {
      executed: written(budget.typeTests.executed, now.typeTests.executed),
      failed: lower(budget.typeTests.failed, now.typeTests.failed),
    },
    alwaysFailing: {
      bun: keepsItsPlaces ? bun : now.alwaysFailing.bun,
      ...(keepsItsPlaces && bunAtMost !== undefined ? { bunAtMost } : {}),
      packages: lower(budget.alwaysFailing.packages, now.alwaysFailing.packages),
      program: lower(budget.alwaysFailing.program, now.alwaysFailing.program),
    },
    uneven: lower(budget.uneven, now.uneven),
    calls: {
      all: written(budget.calls?.all, now.calls.all),
      ofFunctionsNotExpectedToRun: lower(
        budget.calls?.ofFunctionsNotExpectedToRun,
        now.calls.ofFunctionsNotExpectedToRun,
      ),
    },
    accessesByName: lower(budget.accessesByName, now.accessesByName),
    runtimeOperations:
      !budget.runtimeOperations ||
      (!onlyWhatIsMissing && total(now.runtimeOperations)! <= total(budget.runtimeOperations)!)
        ? now.runtimeOperations
        : budget.runtimeOperations,
    allocated: {
      cells: lower(budget.allocated?.cells, now.allocated.cells),
      bytes: lower(budget.allocated?.bytes, now.allocated.bytes),
    },
    closures: {
      aRound: lower(budget.closures?.aRound, now.closures.aRound),
      once: lower(budget.closures?.once, now.closures.once),
    },
  };
}

function writeTable(name: string, tests: CountedTest[], uneven: CountedTest[]) {
  const folder = process.env.AOT_BUDGETS_TABLE;
  if (!folder) return;
  mkdirSync(folder, { recursive: true });
  const row = (test: CountedTest, isWhole: boolean) =>
    [
      test.owner,
      test.path,
      test.position,
      test.kind,
      test.executed,
      test.failed,
      test.failedEveryTime,
      isWhole ? "" : "uneven",
      test.functions.join(" "),
    ].join("\t");
  const head =
    "owner\tpath\tposition\tkind\texecuted a round\tfailed a round\tfailed by copies that never pass\t\tcompiled functions that hold a copy";
  writeFileSync(
    join(folder, `${name}.tsv`),
    [head, ...tests.map(test => row(test, true)), ...uneven.map(test => row(test, false))].join("\n") + "\n",
  );
}

if (!requestedServers)
  console.error(
    "SKIPPED: test/aot/servers/budgets.test.ts: it installs packages from npm. Set AOT_SERVERS=1 to run it",
  );
else if (!measuresThisPlatform)
  console.error("SKIPPED: test/aot/servers/budgets.test.ts: the budgets are those of Linux on x64");
else if (!measuresThisBuild)
  console.error("SKIPPED: test/aot/servers/budgets.test.ts: the budgets are those of a release build");

const skipped = !requestedServers || !measuresThisPlatform || !measuresThisBuild || !!unsupported;

describe.skipIf(skipped)("compile/aot/servers/budgets", () => {
  const app = String(tempDir("aot-servers-budgets", {}));
  const tanstack = String(tempDir("aot-servers-budgets-tanstack", {}));
  const typescript = String(tempDir("aot-servers-budgets-typescript", {}));
  const flags = ["--define", 'process.env.NODE_ENV="production"', "--target=bun"];
  const measuredNow: Record<string, Budget> = {};
  let somethingGotWorse = false;
  afterAll(() => {
    for (const folder of [app, tanstack, typescript]) rmSync(folder, { recursive: true, force: true });
    for (const [name, now] of Object.entries(measuredNow))
      if (mode === "lower") budgets[name] = lowered(budgets[name], now, somethingGotWorse);
    if (mode) writeFileSync(budgetsPath, JSON.stringify(budgets, null, 2) + "\n");
  });

  beforeAll(async () => {
    if (servers.some(name => name !== "tanstack" && name !== "typescript")) {
      cpSync(join(import.meta.dir, "app"), app, { recursive: true });
      await installPackages(app);
    }
    if (servers.includes("tanstack")) {
      cpSync(join(import.meta.dir, "tanstack"), tanstack, { recursive: true });
      cpSync(join(import.meta.dir, "app", "shared.ts"), join(tanstack, "src", "utils", "shared.ts"));
      await installPackages(tanstack);
      const vite = await run([bunExe(), "node_modules/vite/bin/vite.js", "build"], tanstack, bunEnv);
      expect({ output: vite.stdout + vite.stderr, exitCode: vite.exitCode }).toEqual({
        output: expect.any(String),
        exitCode: 0,
      });
    }
    if (servers.includes("typescript")) {
      cpSync(join(import.meta.dir, "typescript-check.ts"), join(typescript, "typescript-check.ts"));
      mkdirSync(join(typescript, "node_modules"));
      const modules = process.env.AOT_SERVERS_MODULES;
      symlinkSync(
        modules && existsSync(join(modules, "typescript"))
          ? join(modules, "typescript")
          : dirname(require.resolve("typescript/package.json")),
        join(typescript, "node_modules", "typescript"),
      );
    }
  }, 900_000);

  test.each(servers)(
    "%s",
    async name => {
      const folder = name === "tanstack" ? tanstack : name === "typescript" ? typescript : app;
      const source = name === "tanstack" ? "serve.ts" : name === "typescript" ? "typescript-check.ts" : `${name}.ts`;
      const code = await codeOf(folder, `./${source}`, flags);
      const build = await buildCounted(
        folder,
        name === "typescript" ? `./${source}` : entryThatExitsWhenTold(folder, source),
        flags,
      );
      const work =
        name === "typescript"
          ? await countScript(build, folder, "2322 2345 2322\n", { warmUp: 5, units: 20 })
          : await countServer(build, folder, exchanges);
      rmSync(build.executable);
      writeTable(name, work.tests, work.uneven);

      const now = measured(code, work);
      console.error(`NUMBERS ${name} ${JSON.stringify(numbersOf(now))}`);
      const budget = budgets[name];
      if (mode === "accept" || !budget) {
        budgets[name] = now;
        expect(["accept", "lower"]).toContain(mode);
        console.error(`BUDGET ${name}: written`);
        return;
      }
      measuredNow[name] = now;

      const allowed = numbersOf(budget);
      const numbers = Object.entries(numbersOf(now)).filter(([, value]) => value !== undefined) as [
        keyof typeof allowed,
        number,
      ][];
      const worse = numbers.filter(
        ([what, value]) => value > (allowed[what] ?? Infinity) * 1.02 && value > allowed[what]! + 3,
      );
      somethingGotWorse ||= worse.length > 0;
      const newPlaces = Object.entries(now.alwaysFailing.bun).flatMap(([path, places]) =>
        places.filter(place => !budget.alwaysFailing.bun[path]?.includes(place)).map(place => `${path} ${place}`),
      );
      const better = numbers.filter(([what, value]) => value < (allowed[what] ?? -Infinity));
      const operationsCalledMore = Object.entries(now.runtimeOperations)
        .filter(([operation, count]) => count > (budget.runtimeOperations?.[operation] ?? 0))
        .map(([operation, count]) => `${operation}: ${count}, it was ${budget.runtimeOperations?.[operation] ?? 0}`);
      const details: Partial<Record<keyof typeof allowed, string[]>> = {
        "alwaysFailing.bun": newPlaces,
        "runtimeOperations": operationsCalledMore,
      };
      const moved = (those: typeof numbers, withDetails = false) =>
        those
          .map(
            ([what, value]) =>
              `${what} ${allowed[what]} -> ${value}${withDetails && details[what]?.length ? ` (${details[what].join("; ")})` : ""}`,
          )
          .join(", ");
      console.error(
        `BUDGET ${name}: ${[worse.length ? `WORSE: ${moved(worse, true)}` : "", better.length ? `better: ${moved(better)}` : ""].filter(Boolean).join("; ") || "within"}`,
      );
      expect({
        worse: worse.map(([what, value]) => `${what}: ${value}, the budget is ${allowed[what]}`),
        testsOfBunsOwnModulesThatNowAlwaysFail: worse.some(([what]) => what === "alwaysFailing.bun") ? newPlaces : [],
        operationsCalledMore: worse.some(([what]) => what === "runtimeOperations") ? operationsCalledMore : [],
      }).toEqual({ worse: [], testsOfBunsOwnModulesThatNowAlwaysFail: [], operationsCalledMore: [] });
    },
    900_000,
  );
});
