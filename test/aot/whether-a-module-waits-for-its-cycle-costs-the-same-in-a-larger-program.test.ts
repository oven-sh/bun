import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// Each read of require.cache below asks whether never.ts has run, and with it whether ring-a, which has run, still waits for its cycle. A walk through the whole program at each ask shows between the two sizes.
const sizes = [250, 1_000];

function project(modules: number) {
  const numbers = Array.from({ length: modules }, (_, index) => index);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "ring-a.ts": `import { two } from "./ring-b";\nexport const one = 1;\nexport const three = () => one + two();\n`,
    "ring-b.ts": `import { one } from "./ring-a";\nexport const two = () => one + one;\n`,
    "never.ts": `export const v = 0;\n`,
    "requires.test.ts": `import { test } from "bun:test";
const never = require.resolve("./never");
let sum = process.argv.length > 99 ? require("./never").v : 0;
${numbers.map(index => `sum += require("./m${index}").v;\nif (never in require.cache) sum = NaN;\n`).join("")}test("requires", () => {
  console.log("answers", sum);
});
`,
  };
  for (const index of numbers)
    files[`m${index}.ts`] = `import { one, three } from "./ring-a";\nexport const v = ${index} + one + three() - 3;\n`;
  return files;
}

async function required(cwd: string, flags: string[], env: Record<string, string | undefined>) {
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./requires.test.ts"], cwd, {
    ...bunEnv,
    ...env,
  });
  return {
    answers: stdout.split("\n").filter(line => line.startsWith("answers ")),
    counts: (stdout + stderr).match(/^ \d+ (pass|fail)$/gm),
    exitCode,
  };
}

const answersOf = (modules: number) => ({
  answers: [`answers ${(modules * (modules + 1)) / 2}`],
  counts: [" 1 pass", " 0 fail"],
  exitCode: 0,
});

test.concurrent("what plain Bun answers", async () => {
  using dir = tempDir("aot-cycles-that-wait", project(sizes[0]));
  expect(await required(String(dir), [], {})).toEqual(answersOf(sizes[0]));
});

const sought = new Map<number, number>();

test.concurrent.each(sizes)("%d modules", async modules => {
  using dir = tempDir("aot-cycles-that-wait", project(modules));
  const cwd = String(dir);
  const compiled = await required(cwd, ["--aot"], { [runtimeEnvironment.countsPath]: join(cwd, "counts-%p") });
  expect(compiled).toEqual(answersOf(modules));
  const lines = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:ModulesScannedForPendingCycles"));
  expect(lines.length).toBeGreaterThan(0);
  sought.set(
    modules,
    lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
});

test("an ask looks at as many modules in a larger program", () => {
  const [small, large] = sizes.map(modules => sought.get(modules)! / modules);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThanOrEqual(1.5 * small);
});
