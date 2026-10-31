import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, isLinux, isMacOS, isWindows, tempDir } from "harness";
import { availableParallelism, totalmem } from "node:os";
import { join } from "node:path";
import { built, unsupported, withoutCoreDump, withoutCrashReport } from "../aot/harness/commands";

// A build keeps two to three processors busy and writes an executable the size of Bun. As scripts/runner.node.ts does
// for files that build executables, one test works for every three processors and every three gigabytes of the machine.
const memory = Math.min(totalmem(), process.constrainedMemory() || Infinity);
const fits = Math.min(Math.ceil(availableParallelism() / 3), Math.floor(memory / (3 * 2 ** 30)));
const atOnce = Math.max(1, Number(process.env.AOT_PROGRAMS_JOBS) || fits);
// Where one test works at a time, the tests run in series. Side by side, the time limit of a test also runs while it
// waits for its turn, and a debug build of Bun compiles for minutes.
const sideBySide = atOnce > 1;
const timeout = isDebug && sideBySide ? 600_000 : 120_000;
const testCompiled = test.skipIf(isWindows || !!unsupported).concurrentIf(sideBySide);
const crashIfInterpreted = { ...bunEnv, BUN_JSC_crashIfInterpreterIsUsed: "1" };

type Limit = { signal?: AbortSignal; killSignal?: "SIGKILL" };
let free = atOnce;
const waiting: (() => void)[] = [];
/** Does the work of a test when its turn comes. `work` gives `limit` to each command that it starts. */
async function inTurn<T>(work: (limit: Limit) => Promise<T>): Promise<T> {
  // bun:test kills nothing that a concurrent test leaves running. There this limit kills the commands of a test ten
  // seconds before its time is up, and a test that is that late starts none. So a command that hangs fails its test,
  // leaves no process behind and lets the next test work.
  const limit: Limit = sideBySide ? { signal: AbortSignal.timeout(timeout - 10_000), killSignal: "SIGKILL" } : {};
  if (free > 0) free--;
  else await new Promise<void>(resolve => waiting.push(resolve));
  try {
    return await work(limit);
  } finally {
    const next = waiting.shift();
    if (next) next();
    else free++;
  }
}

async function run(cmd: string[], cwd: string | undefined, env: Record<string, string | undefined>, limit: Limit) {
  await using proc = Bun.spawn({ cmd, cwd, env, stdout: "pipe", stderr: "pipe", ...limit });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (limit.signal?.aborted && proc.signalCode === "SIGKILL")
    throw new Error(`killed at the limit of its test: ${cmd.join(" ")}\n${stdout}${stderr}`);
  return { stdout, stderr, exitCode, signal: proc.signalCode };
}

async function build(folder: string, limit: Limit, flags: string[] = []) {
  const cmd = [bunExe(), "build", "--compile", "--aot", ...flags, "program.mjs", "--outfile", "program"];
  built(await run(cmd, folder, bunEnv, limit));
  return join(folder, "program");
}

test.skipIf(!!unsupported).concurrentIf(sideBySide)(
  "BUN_JSC_crashIfInterpreterIsUsed names the code and crashes",
  async () => {
    const { stdout, stderr, exitCode, signal } = await inTurn(limit =>
      run(
        withoutCoreDump([bunExe(), "-e", "console.log(1)"]),
        undefined,
        { ...crashIfInterpreted, ...withoutCrashReport },
        limit,
      ),
    );
    expect(stderr).toMatch(/^crashIfInterpreterIsUsed: Module .*\[eval\] at .*\[eval\]:1$/m);
    // CRASH() of the engine is abort() on Linux and a trap instruction in a release build for macOS. Windows has no
    // signals: there the exit code says it.
    const crashSignal = isWindows ? null : isLinux ? "SIGABRT" : isMacOS && !isDebug ? "SIGTRAP" : expect.any(String);
    // The crash comes before the code runs.
    expect({ stdout, signal }).toEqual({ stdout: "", signal: crashSignal });
    expect(exitCode).not.toBe(0);
  },
  timeout,
);

testCompiled(
  "a compiled program started with BUN_INSPECT does not crash on Bun's debugger module",
  () =>
    inTurn(async limit => {
      // The debugger's module runs on a thread of its own, so the program waits until the test says that it has run.
      using folder = tempDir("crash-if-interpreter", {
        "program.mjs": `await Bun.stdin.text(); console.log("done");`,
      });
      const program = await build(String(folder), limit, ["--compile-inspector"]);
      // The last thing that the module does is to connect to BUN_INSPECT_NOTIFY.
      const { promise: moduleRan, resolve } = Promise.withResolvers<boolean>();
      using listener = Bun.listen({
        hostname: "127.0.0.1",
        port: 0,
        socket: { open: () => resolve(true), data() {} },
      });
      await using proc = Bun.spawn({
        cmd: [program],
        env: {
          ...crashIfInterpreted,
          BUN_INSPECT: "ws://127.0.0.1:0/crash-if-interpreter",
          BUN_INSPECT_NOTIFY: `tcp://127.0.0.1:${listener.port}`,
        },
        stdin: "pipe",
        stdout: "pipe",
        stderr: "pipe",
        ...limit,
      });
      const hasModuleRun = await Promise.race([moduleRan, proc.exited.then(() => false)]);
      await proc.stdin.end();
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ hasModuleRun, stdout, stderr, signal: proc.signalCode, exitCode }).toEqual({
        hasModuleRun: true,
        stdout: "done\n",
        stderr: "",
        signal: null,
        exitCode: 0,
      });
    }),
  timeout,
);

function runCompiled(files: Record<string, string>, isExecutable: boolean, env: Record<string, string> = {}) {
  return inTurn(async limit => {
    using folder = tempDir("crash-if-interpreter", files);
    const cmd = isExecutable ? [await build(String(folder), limit)] : [bunExe(), "run", "--debug-aot", "program.mjs"];
    return await run(withoutCoreDump(cmd), String(folder), { ...crashIfInterpreted, ...env }, limit);
  });
}

/** The error that ends an import of code outside the executable, and its code on the next line. `name` is a pattern. */
const notInExecutable = (name: string) =>
  String.raw`^error: Cannot load '${name}': it isn't in this executable, which only runs code that was compiled into it\. Pass the file to bun compile as another entry point, or build with --aot-allow-code-from-disk\.\n code: "ERR_MODULE_NOT_FOUND"$`;

const forms: [string, boolean][] = [
  ["bun run --aot", false],
  ["an executable", true],
];
const text = "export default 6; export function f() { return 7 }";
const importing = (url: string) => ({
  "program.mjs": `const url = ${url}; const made = await import(url); console.log(made.default, made.f());`,
});

testCompiled.each(forms)(
  "a module in a data: URL that the program spells out runs: %s",
  async (_form, isExecutable) => {
    // Nothing on stderr: the build took the URL for a constant, and nothing was reported when the program ran.
    expect(await runCompiled(importing(`"data:text/javascript,${text}"`), isExecutable)).toEqual({
      stdout: "6 7\n",
      stderr: "",
      signal: null,
      exitCode: 0,
    });
  },
  timeout,
);

describe.each([
  ["a data: URL", `"data:text/javascript," + process.env.TEXT`, RegExp.escape(`data:text/javascript,${text}`)],
  [
    "a blob: URL",
    `URL.createObjectURL(new Blob([process.env.TEXT], { type: "text/javascript" }))`,
    "blob:[0-9a-f-]{36}",
  ],
])("a module made from a string at run time: %s", (_kind, url, name) => {
  testCompiled.each(forms)(
    "is refused by an error, which is no crash: %s",
    async (_form, isExecutable) => {
      const { stdout, stderr, exitCode, signal } = await runCompiled(importing(url), isExecutable, { TEXT: text });
      // A Bun that runs with --disallow-code-generation-from-strings=strict in force answers with that flag's error.
      expect(stderr).toMatch(
        new RegExp(
          String.raw`^EvalError: Code generation from strings disallowed for this context|${notInExecutable(name)}`,
          "m",
        ),
      );
      expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
      expect({ stdout, signal, exitCode }).toEqual({ stdout: "", signal: null, exitCode: 1 });
    },
    timeout,
  );
});

testCompiled(
  "a file that a computed name with a constant start can reach is compiled",
  async () => {
    const { stdout, stderr, exitCode, signal } = await runCompiled(
      {
        "on-disk.mjs": "export default 1;",
        "program.mjs": `const made = await import("./on-" + ["disk"][0] + ".mjs"); console.log(made.default);`,
      },
      false,
    );
    // The build says that the name is no constant, so the file is compiled for the start of its name alone.
    expect(stderr).toContain("warn: TS100064: this import path isn't a constant.");
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, signal, exitCode }).toEqual({ stdout: "1\n", signal: null, exitCode: 0 });
  },
  timeout,
);

const namedAtRunTime = {
  "on-disk.mjs": "export default 1;",
  "program.mjs": `const made = await import(process.cwd() + process.env.LATE); console.log(made.default);`,
};

testCompiled.each(forms)(
  "a file that is loaded by a name made at run time is refused by an error, which is no crash: %s",
  async (_form, isExecutable) => {
    const { stdout, stderr, exitCode, signal } = await runCompiled(namedAtRunTime, isExecutable, {
      LATE: "/on-disk.mjs",
    });
    expect(stderr).toMatch(new RegExp(notInExecutable(String.raw`[^']*on-disk\.mjs`), "m"));
    expect(stderr).not.toContain("crashIfInterpreterIsUsed: ");
    expect({ stdout, signal, exitCode }).toEqual({ stdout: "", signal: null, exitCode: 1 });
  },
  timeout,
);
