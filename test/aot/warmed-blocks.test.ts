import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, tempDirWithBunTypes as tempDir } from "harness";
import { join } from "node:path";
import { run as runCommand } from "./harness/run";
import { describe, test } from "./supported";

// While a heap grows under plain Bun, a helper thread named JSCWarmUp touches the pages of fresh blocks so that the program's own
// thread does not take the page faults. An ahead-of-time compiled program has no such helper: the blocks that it held ready cost
// more memory than the page faults cost time. The tests count the helpers by the names of the process's threads, which only Linux shows.

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
  worker.once("exit", () => console.log(before, during, helpers(), kept!.id));
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
  const { stdout, stderr, exitCode } = await runCommand(cmd, cwd, { ...bunEnv, ...env });
  return { stdout, stderr, exitCode };
}

async function build(cwd: string, ...more: string[]) {
  const built = await run(
    [bunExe(), "build", "--compile", "--aot", "program.ts", ...more, "--outfile", "program"],
    cwd,
  );
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toEqual({
    stderr: expect.not.stringMatching(/^error\b/m),
    exitCode: 0,
  });
  return join(cwd, "program");
}

if (isASAN)
  console.error("SKIPPED: warmed-blocks.test.ts: a Bun built with AddressSanitizer has no helper that warms blocks");

describe.skipIf(!isLinux || isASAN).concurrent("no blocks are warmed for a compiled program", () => {
  test("a heap that grows has a helper under plain Bun and none in a compiled program", async () => {
    using folder = tempDir("aot-warmed-blocks", growsOnTheMainThread);
    const plain = await run([bunExe(), "run", "program.ts"], String(folder));
    expect({ stdout: plain.stdout, exitCode: plain.exitCode }).toEqual({ stdout: "1 399999\n", exitCode: 0 });
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "0 399999\n", exitCode: 0 });
  }, 120_000);

  test("a Worker whose heap grows has none either", async () => {
    using folder = tempDir("aot-warmed-blocks", growsInAWorker);
    const { stdout, exitCode } = await run([await build(String(folder), "worker.ts")], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "0 0 0 399999\n", exitCode: 0 });
  }, 120_000);
});
