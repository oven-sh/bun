import { expect } from "bun:test";
import { bunEnv, bunExe, isWindows, tempDir } from "harness";
import { join } from "node:path";
import { describe, test } from "./supported";

// Compiled code turns a fault at one of its own null checks into a TypeError, so SIGSEGV and SIGBUS are signals that both the
// program and its compiled code may want to hear of.
const readers = `function readX(point: { x: number } | null): number { return point!.x; }
function readXPlusOne(point: { x: number } | null): number { return point!.x + 1; }
const readers = [readX, readXPlusOne];
const none: { x: number } | null = JSON.parse("null");
`;

const steps: [label: string, code: string][] = [
  ["no listener yet", ""],
  ["on", "process.on(name, listener);"],
  ["off", "process.off(name, listener);"],
  ["once", "process.once(name, listener);"],
  ["removeAllListeners(name)", "process.removeAllListeners(name);"],
  ["one of two is left", "process.on(name, listener); process.on(name, other); process.off(name, listener);"],
  ["removeAllListeners()", "process.removeAllListeners();"],
  ["prependListener", "process.prependListener(name, listener);"],
  ["removeListener", "process.removeListener(name, listener);"],
];

const listenersComeAndGo = `${readers}const name = process.argv[2] as NodeJS.Signals;
const listener = () => console.log("listener");
const other = () => console.log("other");
let caught = 0;
${steps
  .map(
    ([label, code]) => `${code}
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log(${JSON.stringify(label)}, caught);
`,
  )
  .join("")}`;

const anotherProcessSends = `${readers}const name = process.argv[2] as NodeJS.Signals;
const send = () => void Bun.spawnSync(["kill", "-" + name.slice(3), String(process.pid)]);
let heard = Promise.withResolvers<void>();
const listener = (signal: string) => {
  console.log("heard", signal);
  heard.resolve();
  heard = Promise.withResolvers<void>();
};
let caught = 0;
process.on(name, listener);
for (let turn = 0; turn < 2; turn++) {
  const next = heard.promise;
  send();
  await next;
}
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("listening", caught);
process.off(name, listener);
process.once(name, listener);
const last = heard.promise;
send();
await last;
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 1](none); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("no longer listening", caught);
send();
await Bun.sleep(30_000);
console.log("never printed");
`;

const aWorkerReadsAllTheWhile = `${readers}if (Bun.isMainThread) {
  const worker = new Worker(new URL(import.meta.url));
  await new Promise(resolve => worker.addEventListener("message", resolve, { once: true }));
  const listener = () => {};
  const end = performance.now() + 1000;
  while (performance.now() < end) {
    for (let i = 0; i < 1000; i++) {
      process.on("SIGSEGV", listener);
      process.on("SIGBUS", listener);
      process.off("SIGSEGV", listener);
      process.off("SIGBUS", listener);
    }
  }
  console.log("done");
  process.exit(0);
} else {
  postMessage("started");
  for (let i = 0; ; i++) try { readers[i & 1](none); } catch {}
}
`;

const withoutCoreDump = isWindows ? [] : ["sh", "-c", 'ulimit -c 0; exec "$0" "$@"'];

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd: [...withoutCoreDump, ...cmd],
    cwd,
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

async function build(directory: string, file: string) {
  const executable = join(directory, file.replace(/\.ts$/, isWindows ? ".exe" : ""));
  const built = await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", executable], directory);
  expect({ stderr: built.stderr, exitCode: built.exitCode }).toMatchObject({ exitCode: 0 });
  return executable;
}

const signals = isWindows ? ["SIGSEGV"] : ["SIGSEGV", "SIGBUS"];

describe.concurrent("reading a property of null throws a TypeError", () => {
  test("while listeners of a signal come and go", async () => {
    using directory = tempDir("aot-listeners-come-and-go", { "main.ts": listenersComeAndGo });
    const executable = await build(String(directory), "main.ts");
    for (const signal of signals) {
      expect(await run([executable, signal], String(directory))).toEqual({
        stdout: steps.map(([label]) => `${label} 10\n`).join(""),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  }, 120_000);

  test.skipIf(isWindows)(
    "and a signal that another process sends does what it does without --aot",
    async () => {
      using directory = tempDir("aot-another-process-sends", { "main.ts": anotherProcessSends });
      const executable = await build(String(directory), "main.ts");
      for (const signal of signals) {
        const compiled = await run([executable, signal], String(directory));
        expect(compiled).toEqual(await run([bunExe(), "main.ts", signal], String(directory)));
        expect(compiled).toMatchObject({
          stdout: `heard ${signal}\nheard ${signal}\nlistening 10\nheard ${signal}\nno longer listening 10\n`,
          stderr: "",
        });
      }
    },
    120_000,
  );

  test("in a worker while the main thread adds and removes listeners", async () => {
    using directory = tempDir("aot-a-worker-reads-all-the-while", { "main.ts": aWorkerReadsAllTheWhile });
    const executable = await build(String(directory), "main.ts");
    expect(await run([executable], String(directory))).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);
});
