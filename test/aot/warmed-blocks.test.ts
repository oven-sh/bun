import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isLinux, tempDir } from "harness";
import { join } from "node:path";

// While a heap grows, a helper thread named JSCWarmUp touches the pages of fresh blocks so that the program's own thread does not take
// the page faults. In an ahead-of-time compiled program each heap has an address range of its own, so each has a helper of its own.
// The tests count the helpers by the names of the process's threads, which only Linux shows.

const countsHelpers = `import { readdirSync, readFileSync } from "node:fs";
export type Entry = { id: number; next: Entry | null };
export function grow(count: number): Entry | null {
  let head: Entry | null = null;
  for (let i = 0; i < count; i++) head = { id: i, next: head };
  return head;
}
export function helpers(): number {
  let count = 0;
  for (const task of readdirSync("/proc/self/task")) {
    try {
      if (readFileSync("/proc/self/task/" + task + "/comm", "utf8").trim() === "JSCWarmUp") count++;
    } catch {}
  }
  return count;
}
`;

const growsOnTheMainThread = {
  "helpers.ts": countsHelpers,
  "program.ts": `import { grow, helpers } from "./helpers";
const kept = grow(400_000);
console.log(helpers(), kept!.id);
`,
};

const growsInAWorker = {
  "helpers.ts": countsHelpers,
  "program.ts": `import { Worker } from "node:worker_threads";
import { grow, helpers } from "./helpers";
const kept = grow(400_000);
const before = helpers();
const worker = new Worker("./worker.ts");
worker.once("message", (during: number) => {
  worker.once("exit", async () => {
    for (let i = 0; i < 200 && helpers() > before; i++) await Bun.sleep(25);
    console.log(during - before, helpers() - before, kept!.id);
  });
  worker.postMessage("end");
});
`,
  "worker.ts": `import { parentPort } from "node:worker_threads";
import { grow, helpers } from "./helpers";
const kept = grow(400_000);
parentPort!.once("message", () => process.exit(kept!.id === 399_999 ? 0 : 1));
parentPort!.postMessage(helpers());
`,
};

async function run(cmd: string[], cwd: string, env: Record<string, string> = {}) {
  await using proc = Bun.spawn({ cmd, cwd, env: { ...bunEnv, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

async function build(cwd: string, ...more: string[]) {
  const built = await run([bunExe(), "build", "--compile", "--aot", "program.ts", ...more, "--outfile", "program"], cwd);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({ stderr: expect.not.stringMatching(/^error\b/m), exitCode: 0 });
  return join(cwd, "program");
}

describe.skipIf(!isLinux).concurrent("blocks are warmed for a compiled program", () => {
  test("a heap that grows has a helper", async () => {
    using folder = tempDir("aot-warmed-blocks", growsOnTheMainThread);
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "1 399999\n", exitCode: 0 });
  }, 120_000);

  test("it has none when the option is off", async () => {
    using folder = tempDir("aot-warmed-blocks", growsOnTheMainThread);
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder), { BUN_JSC_useWarmUpMarkedBlocks: "0" });
    expect({ stdout, exitCode }).toEqual({ stdout: "0 399999\n", exitCode: 0 });
  }, 120_000);

  test("a Worker has a helper of its own, which ends with it", async () => {
    using folder = tempDir("aot-warmed-blocks", growsInAWorker);
    const { stdout, exitCode } = await run([await build(String(folder), "worker.ts")], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "1 0 399999\n", exitCode: 0 });
  }, 120_000);
});
