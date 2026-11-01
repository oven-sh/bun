import { expect } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { run } from "./harness/run";
import { test } from "./supported";

// Whoever cuts a feature out of a build by a constant expects its files gone. The file of a Worker belongs to an executable where a `new Worker(..)` that may get it
// is reached: not where only dead code calls the function that holds it, where nobody imports that function, or where nobody calls it.
// The other way round counts for more: a Worker that some road can start is started, in an executable that has been moved away from its files.
const text = "THE JOB'S OWN TEXT";
const job = { "job.mjs": `console.log(${JSON.stringify(text)});` };
const written = `export function spawnJob() { return new Worker(new URL("./job.mjs", import.meta.url)); }`;
const behindDeadCode = `import { spawnJob } from "./spawn.mjs";
  const OFF = true;
  export function run() { if (OFF) { throw new Error("no job in this build"); } else { return spawnJob(); } }
  console.log("main");`;

const count = (held: Buffer, sought: string) => held.toString("latin1").split(sought).length - 1;

async function build(files: Record<string, string>, entry: string) {
  const dir = tempDir("aot-worker-behind-dead-code", { ...job, ...files });
  const elsewhere = tempDir("aot-worker-behind-dead-code-elsewhere", {});
  const executable = join(String(elsewhere), "program");
  const flags = ["build", "--compile", "--aot", entry, "--outfile", executable];
  const built = await run([bunExe(), ...flags], String(dir), bunEnv);
  expect(built.exitCode).toBe(0);
  const plain = await run([bunExe(), entry, "go"], String(dir), bunEnv);
  const ran = await run([executable, "go"], String(elsewhere), bunEnv);
  const held = readFileSync(executable);
  return {
    plain: plain.stdout.split("\n").sort().join("\n"),
    ran: ran.stdout.split("\n").sort().join("\n"),
    exitCode: ran.exitCode,
    text: count(held, text),
    name: count(held, "job.mjs"),
    [Symbol.dispose]() {
      dir[Symbol.dispose]();
      elsewhere[Symbol.dispose]();
    },
  };
}

test.each([
  [
    "only dead code calls the function, and the file is the default of a parameter",
    behindDeadCode,
    `const jobUrl = () => new URL("./job.mjs", import.meta.url);
     export function spawnJob(entry = jobUrl()) { return new Worker(entry); }`,
  ],
  ["only dead code calls the function", behindDeadCode, written],
  [
    "only dead code calls the function, and the file is a path",
    behindDeadCode,
    `export function spawnJob() { return new Worker("./job.mjs"); }`,
  ],
  ["nobody imports the function", `import "./spawn.mjs"; console.log("main");`, written],
  ["nobody calls the function", `import "./spawn.mjs"; console.log("main");`, written.replace("export ", "")],
])(
  "the executable doesn't hold the file of a Worker where %s",
  async (_, main, spawn) => {
    using program = await build({ "main.mjs": main, "spawn.mjs": spawn }, "main.mjs");
    expect(program).toMatchObject({ plain: "\nmain", ran: "\nmain", exitCode: 0, text: 0, name: 0 });
  },
  120_000,
);

test.each([
  [
    "the function may be called",
    `import { spawnJob } from "./spawn.mjs"; if (process.argv[2] === "go") spawnJob();`,
    written,
  ],
  [
    "the function goes out as a value",
    `import { spawnJob } from "./spawn.mjs"; const table = { go: spawnJob }; table[process.argv[2]]();`,
    written,
  ],
  ["a timer calls the function", `import { spawnJob } from "./spawn.mjs"; setTimeout(spawnJob, 1);`, written],
  ["an import() brings the function", `(await import("./spawn.mjs")).spawnJob();`, written],
  [
    "it is a static method under a computed name",
    `import { Pool } from "./spawn.mjs"; Pool[process.argv[2]]();`,
    `export class Pool { static go() { return new Worker(new URL("./job.mjs", import.meta.url)); } }`,
  ],
  [
    "a function that is called calls it through two more",
    `import { outer } from "./spawn.mjs"; outer();`,
    `function inner() { return new Worker(new URL("./job.mjs", import.meta.url)); }
     const middle = () => inner();
     export function outer() { return middle(); }`,
  ],
  [
    "the caller passes the file",
    `import { spawnJob } from "./spawn.mjs"; spawnJob(new URL("./job.mjs", import.meta.url));`,
    `export function spawnJob(entry) { return new Worker(entry); }`,
  ],
])(
  "the Worker starts where %s",
  async (_, main, spawn) => {
    using program = await build({ "main.mjs": main, "spawn.mjs": spawn }, "main.mjs");
    expect(program.plain).toBe("\n" + text);
    expect(program).toMatchObject({ ran: program.plain, exitCode: 0 });
    expect(program.text).toBeGreaterThan(0);
  },
  120_000,
);

test("an entry point's own export that nobody calls keeps the file", async () => {
  const main = `export function run() { return new Worker(new URL("./job.mjs", import.meta.url)); } console.log("main");`;
  using program = await build({ "main.mjs": main }, "main.mjs");
  expect(program).toMatchObject({ ran: "\nmain", exitCode: 0 });
  expect(program.text).toBeGreaterThan(0);
}, 120_000);
