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

export function holdLeastShare(name: string, leastShareAtLeast: number, numberOfOrders: number) {
  const orders = ["usual", "0", "1", "2", "3"].slice(0, numberOfOrders);
  raiseDefaultTimeout(120_000);
  describe.skipIf(!isLinux || process.arch !== "x64")(
    "a test run compiles what an executable compiles, whatever the order of the rules of flow",
    () => {
      const work = String(tempDir(`aot-${name}-both-ways-every-order`, {}));
      const app = join(work, "app");
      let all: { executable: string; testRun: string; percent: number; functions: number }[] = [];
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
        await Promise.all(
          orders.flatMap(order => [
            slot(async () => {
              const executable = join(work, `compiled-${order}${isWindows ? ".exe" : ""}`);
              const flags = order === "usual" ? [] : [`--aot-testing=${wordOf(order)}`];
              built(await spawned([bunExe(), ...compileCommand, ...flags, "--target=bun", `./${name}.ts`, "--outfile", executable], app, environment("executable", order), limit)); // prettier-ignore
              rmSync(executable, { force: true });
            }),
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
          ]),
        );
        const ofTestRuns = orders.map(order => functionsOfProgram(map("test-run", order)));
        all = orders.flatMap(executable => {
          const ofExecutable = functionsOfProgram(map("executable", executable));
          return ofTestRuns.map((ofTestRun, index) => ({
            executable,
            testRun: orders[index],
            percent: (100 * [...ofExecutable].filter(it => ofTestRun.has(it)).length) / ofExecutable.size,
            functions: ofExecutable.size,
          }));
        });
      }, 1_800_000);

      test(name, () => {
        const isBothUsual = (it: { executable: string; testRun: string }) =>
          it.executable === "usual" && it.testRun === "usual";
        const others = all.filter(it => !isBothUsual(it));
        const mean = others.reduce((sum, it) => sum + it.percent, 0) / others.length;
        const least = all.reduce((a, b) => (b.percent < a.percent ? b : a));
        console.log(
          `LEAST ${name}: ${least.percent.toFixed(1)}% (the executable under the order ${least.executable}, the test run under ${least.testRun}; ${orders.length} orders each)`,
        );
        console.log(
          `  held by nothing: usual with usual ${all.find(isBothUsual)!.percent.toFixed(1)}%, the mean of the other ${others.length} pairings ${mean.toFixed(1)}%`,
        );
        console.log(
          `  by executable (${orders.join(" ")}), each against the test runs (${orders.join(" ")}): ${orders
            .map(order =>
              all
                .filter(it => it.executable === order)
                .map(it => it.percent.toFixed(1))
                .join(" "),
            )
            .join(" | ")}`,
        );
        expect(Math.min(...all.map(it => it.functions))).toBeGreaterThan(500);
        expect({ name, percent: Math.min(Math.floor(least.percent), leastShareAtLeast) }).toEqual({
          name,
          percent: leastShareAtLeast,
        });
      });
    },
  );
}
