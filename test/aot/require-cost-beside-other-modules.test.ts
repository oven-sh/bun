import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { built, spawned } from "./harness/commands";
import { test } from "./measures";

// A require() costs the same however many import() calls are pending, and so does one whose file throws, however many modules the
// program has. The program measures itself with process.cpuUsage(), which some systems count in steps of 16 milliseconds.
const sizes = [500, 8_000];
const step = 16_000;

function project(modules: number) {
  const names = Array.from({ length: modules }, (_, k) => `./m${k}.mjs`);
  const files: Record<string, string> = {
    "package.json": `{ "type": "module" }`,
    "throws.cjs": `throw new Error("thrown");\n`,
    "never.mjs": `import "./throws.cjs";\n`,
    "main.mjs": `const imports = [${names.map(name => `() => import("${name}")`).join(", ")}];
const requires = [${names.map(name => `() => require("${name}")`).join(", ")}];
const never = () => import("./never.mjs");
let caught = 0;
let start = process.cpuUsage();
for (let k = 0; k < 4_000; k++) {
  try {
    require("./throws.cjs");
  } catch (error) {
    caught += error.message === "thrown";
  }
}
const throwing = process.cpuUsage(start);
if (!caught) await never();
const calls = imports.map(load => load());
start = process.cpuUsage();
let sum = 0;
for (const load of requires) sum += load().v;
const requiring = process.cpuUsage(start);
for (const module of await Promise.all(calls)) sum += module.v;
console.log("answers", caught, sum, "microseconds", throwing.user + throwing.system, requiring.user + requiring.system);
`,
  };
  names.forEach((name, k) => (files[name.slice(2)] = `export const v = ${k};\n`));
  return files;
}

// The least of three runs: what else the machine does can only add.
async function microseconds(modules: number) {
  using dir = tempDir("aot-require-cost", project(modules));
  const executable = join(String(dir), isWindows ? "main.exe" : "main");
  const build = [bunExe(), "build", "--compile", "--aot", "./main.mjs", "--outfile", executable];
  built(await spawned(build, String(dir), bunEnv));
  const runs = [];
  for (let times = 0; times < 3; ++times) {
    const { stdout, exitCode } = await spawned([executable], String(dir), bunEnv);
    const said = /^answers (\d+) (\d+) microseconds (\d+) (\d+)$/m.exec(stdout);
    expect([said?.[1], said?.[2], exitCode]).toEqual(["4000", String(modules * (modules - 1)), 0]);
    runs.push([Number(said![3]), Number(said![4])]);
  }
  return { throwing: Math.min(...runs.map(run => run[0])), requiring: Math.min(...runs.map(run => run[1])) };
}

test("a require() costs the same beside more modules", async () => {
  const small = await microseconds(sizes[0]);
  const large = await microseconds(sizes[1]);
  expect(large.throwing).toBeLessThanOrEqual(2 * Math.max(small.throwing, step));
  expect(large.requiring).toBeLessThanOrEqual(2 * (sizes[1] / sizes[0]) * Math.max(small.requiring, 5_000));
});
