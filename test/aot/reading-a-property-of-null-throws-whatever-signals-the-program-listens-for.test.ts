import { expect } from "bun:test";
import { bunEnv, bunExe, isASAN, isLinux, isWindows, tempDir } from "harness";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterAll } from "./harness/default-timeout";
import { compiler, readers, sender } from "./harness/reads-of-null";
import { withoutCoreDump } from "./harness/without-core-dump";
import { describe, test } from "./supported";

// Compiled code turns a fault at one of its own null checks into a TypeError, so SIGSEGV and SIGBUS are signals that both the
// program and its compiled code may want to hear of.

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

// Each program names its signal by a constant. Under a name that the build doesn't know process.on() may listen for any event of process, and the build takes six times as long.
const listenersComeAndGo = (signal: string) => `${readers}const name = ${JSON.stringify(signal)};
const listener = () => console.log("listener");
const other = () => console.log("other");
let caught = 0;
${steps
  .map(
    ([label, code]) => `${code}
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 3](); } catch (error) { if (error instanceof TypeError) caught++; }
console.log(${JSON.stringify(label)}, caught);
`,
  )
  .join("")}`;

const anotherProcessSends = (signal: string) => `${readers}const name = ${JSON.stringify(signal)};
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
for (let i = 0; i < 10; i++) try { readers[i & 3](); } catch (error) { if (error instanceof TypeError) caught++; }
console.log("listening", caught);
process.off(name, listener);
process.once(name, listener);
const last = heard.promise;
send();
await last;
caught = 0;
for (let i = 0; i < 10; i++) try { readers[i & 3](); } catch (error) { if (error instanceof TypeError) caught++; }
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
  for (let i = 0; ; i++) try { readers[i & 3](); } catch {}
}
`;

async function run(cmd: string[], cwd: string) {
  await using proc = Bun.spawn({
    cmd: withoutCoreDump(cmd),
    cwd,
    env: { ...bunEnv, BUN_CRASH_REPORT_URL: "", BUN_ENABLE_CRASH_REPORTING: "0" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode, signalCode: proc.signalCode };
}

const signals = isWindows ? ["SIGSEGV"] : ["SIGSEGV", "SIGBUS"];

// One executable for the programs of one thread. Each is a file of its own in it, and the first argument says which one runs.
const programs: Record<string, string> = {
  ...Object.fromEntries(signals.map(signal => [`listeners-${signal}`, listenersComeAndGo(signal)])),
  ...Object.fromEntries(signals.map(signal => [`sends-${signal}`, anotherProcessSends(signal)])),
};
const directory = String(
  tempDir("aot-signals-the-program-listens-for", {
    ...Object.fromEntries(Object.entries(programs).map(([name, text]) => [name + ".ts", text])),
    "main.ts": Object.keys(programs)
      .map(name => `if (process.argv[2] === ${JSON.stringify(name)}) await import("./${name}.ts");\n`)
      .join(""),
    "worker.ts": aWorkerReadsAllTheWhile,
    "sender.c": sender,
  }),
);
afterAll(() => rmSync(directory, { recursive: true, force: true }));

const builds = new Map<string, Promise<string>>();
const build = (file: string) =>
  builds.getOrInsertComputed(file, async () => {
    const executable = join(directory, file.replace(/\.ts$/, isWindows ? ".exe" : ""));
    const built = await run([bunExe(), "build", "--compile", "--aot", file, "--outfile", executable], directory);
    expect({ stderr: built.stderr, exitCode: built.exitCode }).toMatchObject({ exitCode: 0 });
    return executable;
  });

describe.concurrent("reading a property of null throws a TypeError", () => {
  test("while listeners of a signal come and go", async () => {
    const executable = await build("main.ts");
    for (const signal of signals) {
      expect(await run([executable, "listeners-" + signal], directory)).toEqual({
        stdout: steps.map(([label]) => `${label} 10\n`).join(""),
        stderr: "",
        exitCode: 0,
        signalCode: null,
      });
    }
  }, 120_000);

  // A build that tests for null in front of the load raises no signal, and the case above would hold whatever the program listened for.
  test.skipIf(!isLinux || isASAN || !compiler)(
    "and in that program a read of null raises the signal",
    async () => {
      const [executable, built] = await Promise.all([
        build("main.ts"),
        run([compiler!, "-w", "-o", "sender", "sender.c"], directory),
      ]);
      expect(built).toMatchObject({ exitCode: 0 });
      const counted = await run([join(directory, "sender"), executable, "listeners-SIGSEGV"], directory);
      const reads = steps.length * 10;
      const raised = Number(counted.stdout.trimEnd().split("\n").at(-1));
      expect({ raised, isEnough: raised >= reads / 2 && raised <= reads, exitCode: counted.exitCode }).toEqual({
        raised,
        isEnough: true,
        exitCode: 0,
      });
    },
    120_000,
  );

  test.skipIf(isWindows)(
    "and a signal that another process sends does what it does without --aot",
    async () => {
      const executable = await build("main.ts");
      for (const signal of signals) {
        const compiled = await run([executable, "sends-" + signal], directory);
        expect(compiled).toEqual(await run([bunExe(), "main.ts", "sends-" + signal], directory));
        expect(compiled).toMatchObject({
          stdout: `heard ${signal}\nheard ${signal}\nlistening 10\nheard ${signal}\nno longer listening 10\n`,
          stderr: "",
        });
      }
    },
    120_000,
  );

  test("in a worker while the main thread adds and removes listeners", async () => {
    expect(await run([await build("worker.ts")], directory)).toEqual({
      stdout: "done\n",
      stderr: "",
      exitCode: 0,
      signalCode: null,
    });
  }, 120_000);
});
