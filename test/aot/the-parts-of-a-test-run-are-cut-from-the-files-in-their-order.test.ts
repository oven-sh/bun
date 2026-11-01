// `bun test --aot --parallel --timings` over layers compiles the test files as parts, a few files each, and a worker process holds one part and runs its files.
// The parts are cut from the list of files in its order, the slowest first: a part is full when it takes the mean of the parts, or holds twice the files of a part cut by number.
// So the slow files stand alone in the first parts, and the last parts hold many quick ones, which lets the workers end together.
// They were dealt, each file to the part with the least so far: parts of equal time, in which a slow file may come last.
//
// Which part is ready first is a race between builds. Which files share a process is not: each file says which process runs it.
import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./supported";

const testFile = (name: string) =>
  `import { test } from "bun:test";\ntest("${name}", () => {\n  console.error("RUNS", "${name}", process.pid);\n});\n`;

async function partsOf(times: Record<string, number | undefined>, filesOfPart: number) {
  const names = Object.keys(times);
  using dir = tempDir("aot-parts-cut-in-order", {
    "package.json": `{ "name": "p" }`,
    ...Object.fromEntries(names.map(name => [`${name}.test.ts`, testFile(name)])),
    "timings.json": JSON.stringify({
      version: 1,
      files: Object.fromEntries(
        names.filter(name => times[name] !== undefined).map(name => [`${name}.test.ts`, times[name]]),
      ),
    }),
  });
  const env = { ...bunEnv, BUN_DEBUG_TEST_AOT_WORDS: `TestRunLayers:2,TestRunPartFiles:${filesOfPart}` };
  const { stderr, exitCode } = await run(
    [bunExe(), "test", "--aot", "--parallel=1", "--timings=timings.json"],
    String(dir),
    env,
  );
  const byProcess = Map.groupBy(stderr.matchAll(/^RUNS (\w+) (\d+)$/gm), match => match[2]);
  const parts = [...byProcess.values()].map(ran => ran.map(match => match[1]).join(" "));
  return { parts: parts.sort(), exitCode };
}

test.concurrent(
  "the slow files stand alone, the quick ones together, each part's slowest first",
  async () => {
    // No time for c: a file nobody has timed may be slow: it comes first and counts as one of the slowest tenth, 5,000 ms.
    // Four parts by number. Full at their mean, 2,740 ms, or with four files.
    expect(await partsOf({ a: 10, b: 20, c: undefined, d: 900, e: 30, f: 5000, g: 1 }, 2)).toEqual({
      parts: ["c", "d e b a", "f", "g"],
      exitCode: 0,
    });
  },
  240_000,
);

test.concurrent(
  "files that take the same are cut by time",
  async () => {
    // Three parts by number. Full at their mean, 200 ms.
    expect(await partsOf({ a: 100, b: 100, c: 100, d: 100, e: 100, f: 100 }, 2)).toEqual({
      parts: ["a b", "c d", "e f"],
      exitCode: 0,
    });
  },
  240_000,
);
