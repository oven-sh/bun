import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runtimeEnvironment } from "./harness/flags";
import { run } from "./harness/run";
import { test } from "./measures";

// The modules of a cycle with a top-level await keep their records. Each require() below asks what has run. A look at every record at each ask shows between the two sizes.
const sizes = [50, 800];
const required = Array.from({ length: 500 }, (_, index) => index);

function project(ring: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "requires.test.ts": `import { test } from "bun:test";
import { f0 } from "./ring-0";
let sum = f0(5);
${required.map(index => `sum += require("./m${index}").v;\n`).join("")}test("requires", () => {
  console.log("answers", sum);
});
`,
  };
  for (let index = 0; index < ring; index++) {
    const next = (index + 1) % ring;
    files[`ring-${index}.ts`] = `import { f${next} } from "./ring-${next}";
${next ? "" : "await 0;\n"}export const f${index} = (depth: number): number => (depth ? f${next}(depth - 1) + 1 : 0);
`;
  }
  for (const index of required) files[`m${index}.ts`] = `export const v = ${index};\n`;
  return files;
}

async function load(cwd: string, flags: string[], env: Record<string, string | undefined>) {
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

const answers = {
  answers: [`answers ${5 + (required.length * (required.length - 1)) / 2}`],
  counts: [" 1 pass", " 0 fail"],
  exitCode: 0,
};

test.concurrent("what plain Bun answers", async () => {
  using dir = tempDir("aot-records-that-stay", project(sizes[0]));
  expect(await load(String(dir), [], {})).toEqual(answers);
});

const sought = new Map<number, number>();

test.concurrent.each(sizes)("a cycle of %d modules", async ring => {
  using dir = tempDir("aot-records-that-stay", project(ring));
  const cwd = String(dir);
  expect(await load(cwd, ["--aot"], { [runtimeEnvironment.countsPath]: join(cwd, "counts-%p") })).toEqual(answers);
  const lines = readdirSync(cwd)
    .filter(name => name.startsWith("counts-"))
    .flatMap(name => readFileSync(join(cwd, name), "utf8").split("\n"))
    .filter(line => line.endsWith("\tsought:ModulesScannedForEvaluationStatus"));
  expect(lines.length).toBeGreaterThan(0);
  sought.set(
    ring,
    lines.reduce((sum, line) => sum + Number(line.split("\t")[0]), 0),
  );
});

test("an ask looks at as many modules beside a larger cycle", () => {
  const [small, large] = sizes.map(ring => sought.get(ring)!);
  expect(small).toBeGreaterThan(0);
  expect(large).toBeLessThanOrEqual(1.5 * small);
});
