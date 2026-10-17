import { expect } from "bun:test";
import { describe, test } from "./supported";
import { bunEnv, bunExe, isASAN, isLinux, tempDir } from "harness";
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

const growsAndThenMakesOneOfEachKind = {
  "helpers.ts": countsHelpers,
  "program.ts": `import { readdirSync, readFileSync } from "node:fs";
import { grow } from "./helpers";
function faultsOfTheHelper(): number {
  for (const task of readdirSync("/proc/self/task")) {
    try {
      if (readFileSync("/proc/self/task/" + task + "/comm", "utf8").trim() !== "JSCWarmUp") continue;
      const stat = readFileSync("/proc/self/task/" + task + "/stat", "utf8");
      return Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[7]);
    } catch {}
  }
  return -1;
}
function* numbers() {
  yield 1;
}
async function* laterNumbers() {
  yield 1;
}
const kept: unknown[] = [grow(400_000)];
await Bun.sleep(100);
const before = faultsOfTheHelper();
const buffer = new ArrayBuffer(64);
kept.push(
  new WeakMap(), new WeakSet(), new WeakRef(kept), new FinalizationRegistry(() => {}), new DataView(buffer), new Date(0), Symbol("a"), 10n ** 40n,
  new Proxy({}, {}), numbers.bind(null), [1].values(), new Map([[1, 1]]).entries(), new Set([1]).values(), "a".matchAll(/a/g), numbers(), laterNumbers(),
  new Intl.Collator("en"), new Intl.DateTimeFormat("en"), new Intl.NumberFormat("en"), new Intl.PluralRules("en"), new Intl.RelativeTimeFormat("en"),
  new Intl.ListFormat("en"), new Intl.Segmenter("en"), new Intl.DisplayNames("en", { type: "region" }), new Intl.Locale("en"),
  new Int8Array(buffer), new Uint8ClampedArray(buffer), new Int16Array(buffer), new Uint16Array(buffer), new Int32Array(buffer), new Uint32Array(buffer),
  new Float32Array(buffer), new Float64Array(buffer), new BigInt64Array(buffer), new BigUint64Array(buffer), new SharedArrayBuffer(8),
  new Boolean(true), new Number(1), new String("a"), Object(Symbol("b")), Object(1n), new AggregateError([]), new URLSearchParams("a=1"), new Headers(),
  new Request("http://localhost/"), new Response("a"), new Blob(["a"]), new TextDecoder(), new AbortController(), new EventTarget(), new Event("a"),
  new MessageChannel(), new FormData(), new ReadableStream(), new WritableStream(), new TransformStream(),
);
await Bun.sleep(100);
const after = faultsOfTheHelper();
console.log(before >= 0 && after >= 0 ? (after - before < 48 ? "no refill" : "refilled") : "no helper", kept.length);
process.exit(0);
`,
};

const growsAndThenAsksForLittle = {
  "helpers.ts": countsHelpers,
  "program.ts": `import { grow, helpers } from "./helpers";
const kept = [grow(400_000)];
const during = helpers();
for (let i = 0; i < 100; i++) {
  kept.push(grow(100));
  await Bun.sleep(20);
}
console.log(during, helpers(), kept.length);
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

if (isASAN) console.error("SKIPPED: warmed-blocks.test.ts: a Bun built with AddressSanitizer has no helper that warms blocks");

describe.skipIf(!isLinux || isASAN).concurrent("blocks are warmed for a compiled program", () => {
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

  test("the first block of a kind of cell is not a warmed one", async () => {
    using folder = tempDir("aot-warmed-blocks", growsAndThenMakesOneOfEachKind);
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "no refill 57\n", exitCode: 0 });
  }, 120_000);

  test("a heap that has grown and asks for little gives its helper up", async () => {
    using folder = tempDir("aot-warmed-blocks", growsAndThenAsksForLittle);
    const { stdout, exitCode } = await run([await build(String(folder))], String(folder), { BUN_JSC_warmUpMarkedBlockIdleTimeout: "0.2" });
    expect({ stdout, exitCode }).toEqual({ stdout: "1 0 101\n", exitCode: 0 });
  }, 120_000);

  test("a Worker has a helper of its own, which ends with it", async () => {
    using folder = tempDir("aot-warmed-blocks", growsInAWorker);
    const { stdout, exitCode } = await run([await build(String(folder), "worker.ts")], String(folder));
    expect({ stdout, exitCode }).toEqual({ stdout: "1 0 399999\n", exitCode: 0 });
  }, 120_000);
});
