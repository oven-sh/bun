import { afterAll, expect } from "bun:test";
import { rmSync, writeFileSync } from "fs";
import { bunEnv, bunExe, isLinux, isWindows, tempDir } from "harness";
import { join } from "path";
import { built, limitOfARun, slots, spawned } from "../harness/commands";
import { raiseDefaultTimeout } from "../harness/default-timeout";
import { buildEnvironment, compileCommand } from "../harness/flags";
import { beforeAll, describe, test } from "../supported";
import { functionsOfProgram } from "./functions-of-a-map";
import { copyApp } from "./run-servers";

const wordOf = (order: string) => `DelayFlowRules:${order}`;

// A slot of the harness stands for one core, which a small build keeps busy for a second. A build of a server takes 45 s of processor time on as many threads as it gets, and
// 80 s under a delayed order. Six of them at once on a runner with few cores had one core each, and the last was killed at the limit of a run.
const coresOfABuild = 4;
const atOnce = Math.max(1, Math.floor(slots / coresOfABuild));
// The runner may have fewer cores to give than the machine shows.
const limit = limitOfARun * atOnce;
let free = atOnce;
const waiting: (() => void)[] = [];
async function slot<T>(work: () => Promise<T>): Promise<T> {
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

const shareHeldInEveryOrder = 99;

// `row`: the file builds the executable under that one order alone and holds it against the test runs under all of them: a row of the table. All 2 N builds of a large
// server in one process came near what CI gives a file. The least of the table is the least of its rows. What is asked of the table as a whole wants no `row`.
export function holdLeastShare(
  name: string,
  leastShareAtLeast: number,
  numberOfOrders: number,
  openRow?: number,
  row?: number,
) {
  const orders = ["usual", "0", "1", "2", "3"].slice(0, numberOfOrders);
  const ordersOfExecutables = row === undefined ? orders : [orders[row - 1]];
  if (row !== undefined && openRow !== undefined)
    throw new Error("what is the same under every order is asked of the whole table");
  raiseDefaultTimeout(120_000);
  describe.skipIf(!isLinux || process.arch !== "x64")(
    "a test run compiles what an executable compiles, whatever the order of the rules of flow",
    () => {
      const work = String(tempDir(`aot-${name}-both-ways-every-order`, {}));
      const app = join(work, "app");
      let all: { executable: string; testRun: string; percent: number; functions: number }[] = [];
      let sameInEveryOrder = { ofExecutables: 0, ofTestRuns: 0, ofBoth: 0, percent: 0 };
      afterAll(() => rmSync(work, { recursive: true, force: true }));

      beforeAll(async () => {
        await copyApp(app);
        const map = (kind: string, order: string) => join(work, `${kind}.${order}.map`);
        const environment = (kind: string, order: string) => ({
          ...bunEnv,
          PORT: "0",
          BUN_FEATURE_FLAG_INTERNAL_FOR_TESTING: "1",
          [buildEnvironment.mapFilePath]: map(kind, order),
        });
        writeFileSync(
          join(app, `${name}.test.ts`),
          `import { test } from "bun:test";\nimport "./${name}.ts";\ntest("is loaded", () => process.exit(0));\n`,
        );
        await Promise.all([
          ...ordersOfExecutables.map(order =>
            slot(async () => {
              const executable = join(work, `compiled-${order}${isWindows ? ".exe" : ""}`);
              const flags = order === "usual" ? [] : [`--aot-testing=${wordOf(order)}`];
              built(await spawned([bunExe(), ...compileCommand, ...flags, "--target=bun", `./${name}.ts`, "--outfile", executable], app, environment("executable", order), limit)); // prettier-ignore
              rmSync(executable, { force: true });
            }),
          ),
          ...orders.map(order =>
            slot(async () => {
              const words = order === "usual" ? {} : { BUN_DEBUG_TEST_AOT_WORDS: `testing=${wordOf(order)}` };
              const command = [bunExe(), "test", "--aot", `./${name}.test.ts`];
              const run = await spawned(command, app, { ...environment("test-run", order), ...words }, limit);
              expect({ order, stderr: run.exitCode ? run.stderr : "", exitCode: run.exitCode }).toEqual({
                order,
                stderr: "",
                exitCode: 0,
              });
            }),
          ),
        ]);
        const ofTestRuns = orders.map(order => functionsOfProgram(map("test-run", order)));
        const ofExecutables = ordersOfExecutables.map(order => functionsOfProgram(map("executable", order)));
        all = ordersOfExecutables.flatMap((executable, position) => {
          const ofExecutable = ofExecutables[position];
          return ofTestRuns.map((ofTestRun, index) => ({
            executable,
            testRun: orders[index],
            percent: (100 * [...ofExecutable].filter(it => ofTestRun.has(it)).length) / ofExecutable.size,
            functions: ofExecutable.size,
          }));
        });
        const inEvery = (builds: Set<string>[]) => [...builds[0]].filter(row => builds.every(build => build.has(row)));
        const withoutBytes = (row: string) => row.slice(0, row.lastIndexOf(" "));
        const inEveryExecutable = inEvery(ofExecutables);
        const inEveryTestRun = new Map(inEvery(ofTestRuns).map(row => [withoutBytes(row), row]));
        const inBoth = inEveryExecutable.filter(row => inEveryTestRun.has(withoutBytes(row)));
        sameInEveryOrder = {
          ofExecutables: inEveryExecutable.length,
          ofTestRuns: inEveryTestRun.size,
          ofBoth: inBoth.length,
          percent: (100 * inBoth.filter(row => inEveryTestRun.get(withoutBytes(row)) === row).length) / inBoth.length,
        };
      }, 1_800_000);

      const holdLeast = () =>
        expect({
          name,
          percent: Math.min(Math.floor(Math.min(...all.map(it => it.percent))), leastShareAtLeast),
        }).toEqual({ name, percent: leastShareAtLeast });

      test(name, () => {
        const isBothUsual = (it: { executable: string; testRun: string }) =>
          it.executable === "usual" && it.testRun === "usual";
        const others = all.filter(it => !isBothUsual(it));
        const mean = others.reduce((sum, it) => sum + it.percent, 0) / others.length;
        const least = all.reduce((a, b) => (b.percent < a.percent ? b : a));
        console.log(
          `LEAST ${name}: ${least.percent.toFixed(1)}% (the executable under the order ${least.executable}, the test run under ${least.testRun}; ${orders.length} orders each)`,
        );
        const usualWithUsual = all.find(isBothUsual)?.percent ?? NaN;
        const usual = `usual with usual ${usualWithUsual.toFixed(1)}%`;
        const meanOfOthers = `the mean of the other ${others.length} pairings ${mean.toFixed(1)}%`;
        console.log(
          openRow === undefined
            ? `  held by nothing: ${usual}, ${meanOfOthers}`
            : `  held: ${usual}; held by nothing: the least, ${meanOfOthers}`,
        );
        console.log(
          `  the same under every order: ${sameInEveryOrder.ofExecutables} functions of the executable, ${sameInEveryOrder.ofTestRuns} of the test run, ${sameInEveryOrder.ofBoth} of both; of those ${sameInEveryOrder.percent.toFixed(2)}% are the same in both`,
        );
        console.log(
          `  by executable (${ordersOfExecutables.join(" ")}), each against the test runs (${orders.join(" ")}): ${ordersOfExecutables
            .map(order =>
              all
                .filter(it => it.executable === order)
                .map(it => it.percent.toFixed(1))
                .join(" "),
            )
            .join(" | ")}`,
        );
        expect(Math.min(...all.map(it => it.functions))).toBeGreaterThan(500);
        if (openRow === undefined) return holdLeast();
        expect(sameInEveryOrder.ofBoth).toBeGreaterThan(500);
        expect({
          name,
          usualWithUsual: Math.min(Math.floor(usualWithUsual), shareHeldInEveryOrder),
          sameInEveryOrder: Math.min(Math.floor(sameInEveryOrder.percent), shareHeldInEveryOrder),
        }).toEqual({ name, usualWithUsual: shareHeldInEveryOrder, sameInEveryOrder: shareHeldInEveryOrder });
      });
      if (openRow !== undefined)
        test.todo(`${name}: TODO(${openRow}): the code doesn't depend on the order in which rules run`, holdLeast);
    },
  );
}
