import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { run } from "./harness/run";
import { test } from "./measures";

// first.cjs queues a job while it is loaded. In a test run the texts of the modules behind it then come one a turn, out of a line.
// reads.mjs asks for all its modules at once, so the line is as long as the graph. Where the first text was taken out of a vector,
// every text behind it moved: the cost of a load grew with the square of the line.
// The run measures itself with process.cpuUsage(), around the load alone.
const sizes = [500, 8_000];

function project(modules: number) {
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "first.cjs": `queueMicrotask(() => {});\nexports.x = 1;\n`,
    "reads.mjs":
      `import "./first.cjs";\n` +
      Array.from({ length: modules }, (_, k) => `import { v${k} } from "./m${k}.mjs";\n`).join("") +
      `export const seen = () => v0;\n`,
    "loads.test.mjs": `import { test } from "bun:test";
test("loads", async () => {
  const start = process.cpuUsage();
  const answer = (await import("./reads.mjs")).seen();
  const spent = process.cpuUsage(start);
  console.log("answers", answer, "microseconds", spent.user + spent.system);
});
`,
  };
  for (let k = 0; k < modules; k++) files[`m${k}.mjs`] = `export const v${k} = ${k};\n`;
  return files;
}

async function microseconds(modules: number, flags: string[]) {
  using dir = tempDir("aot-texts-one-a-turn", project(modules));
  const { stdout, stderr, exitCode } = await run([bunExe(), "test", ...flags, "./loads.test.mjs"], String(dir), bunEnv);
  const said = /^answers 0 microseconds (\d+)$/m.exec(stdout + stderr);
  expect({ said: said?.[0].replace(/\d+$/, ""), exitCode }).toEqual({ said: "answers 0 microseconds ", exitCode: 0 });
  return Number(said![1]);
}

test("what plain Bun answers", async () => {
  expect(await microseconds(sizes[0], [])).toBeGreaterThan(0);
});

test("a module costs the same in a larger graph", async () => {
  // The least of three runs: what else the machine does can only add.
  const least = async (modules: number) =>
    Math.min(...(await Promise.all([0, 1, 2].map(() => microseconds(modules, ["--aot"])))));
  const [small, large] = [(await least(sizes[0])) / sizes[0], (await least(sizes[1])) / sizes[1]];
  expect(large).toBeLessThanOrEqual(2 * small);
});
