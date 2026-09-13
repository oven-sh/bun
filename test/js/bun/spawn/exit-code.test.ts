import { spawnSync } from "bun";
import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

it("process.exit(1) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-1.js"]);
  expect(exitCode).toBe(1);
});

it("await on a thrown value reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-await-throw-1.js"]);
  expect(exitCode).toBe(1);
});

it("unhandled promise rejection reports exit code 1", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-unhandled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("handled promise rejection reports exit code 0", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-handled-throw.js"]);
  expect(exitCode).toBe(1);
});

it("process.exit(0) works", () => {
  const { exitCode } = spawnSync([bunExe(), import.meta.dir + "/exit-code-0.js"]);
  expect(exitCode).toBe(0);
});

// https://github.com/oven-sh/bun/issues/22546
describe.concurrent("a fatal error during a top-level await ends the run", () => {
  // The error comes from a 1ms timer while the module awaits a chain of ten 5ms timers.
  // "after" is printed only when the module kept running past the error.
  const throws = `setTimeout(() => { throw new Error("boom"); }, 1);\n`;
  const rejects = `setTimeout(() => void Promise.reject(new Error("boom")), 1);\n`;
  const awaits = `
    for (let i = 0; i < 10; i++) await new Promise(resolve => setTimeout(resolve, 5));
    console.log("after");
  `;
  const exitListeners = `
    process.on("beforeExit", () => console.log("beforeExit"));
    process.on("exit", code => console.log("exit", code));
  `;

  async function run(files: Record<string, string>, ...args: string[]) {
    using dir = tempDir("tla-fatal-error", files);
    await using proc = Bun.spawn({
      cmd: [bunExe(), ...args],
      env: bunEnv,
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }

  it("an uncaught exception", async () => {
    const { stdout, stderr, exitCode } = await run({ "entry.mjs": exitListeners + throws + awaits }, "entry.mjs");
    expect(stderr).toContain("error: boom");
    expect({ stdout, exitCode }).toEqual({ stdout: "exit 1\n", exitCode: 1 });
  });

  it("an unhandled rejection", async () => {
    const { stdout, stderr, exitCode } = await run({ "entry.mjs": rejects + awaits }, "entry.mjs");
    expect(stderr).toContain("error: boom");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  it("the repro in #22546", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "entry.mjs": `
          import { setTimeout as sleep } from "node:timers/promises";

          let x = 1;
          async function erroringPromise() {
            return new Promise((_res, rej) => {
              rej("oops");
            });
          }

          async function main() {
            global.setTimeout(() => erroringPromise(), 1);

            while (x < 10) {
              x++;
              await sleep(5);
            }
            console.log("after");
          }

          await main();
        `,
      },
      "entry.mjs",
    );
    expect(stderr).toContain("oops");
    expect({ stdout, exitCode }).toEqual({ stdout: "", exitCode: 1 });
  });

  it("reportError(): as for the same code in an async function", async () => {
    const reports = `setTimeout(() => reportError(new Error("boom")), 1);\n`;
    const [topLevel, inFunction] = await Promise.all([
      run({ "entry.mjs": exitListeners + reports + awaits }, "entry.mjs"),
      run({ "entry.mjs": exitListeners + reports + `(async () => {${awaits}})();` }, "entry.mjs"),
    ]);
    expect(topLevel.stderr).toContain("error: boom");
    expect({ stdout: topLevel.stdout, exitCode: topLevel.exitCode }).toEqual({
      stdout: inFunction.stdout,
      exitCode: inFunction.exitCode,
    });
  });

  it("with the await's wakeup already queued from another thread", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "entry.mjs": `
          import { stat } from "node:fs/promises";
          ${exitListeners}
          const { promise, resolve } = Promise.withResolvers();
          setTimeout(() => {
            stat(".").then(resolve);
            // Give the thread pool time to finish stat() and queue its result before the error.
            const end = performance.now() + 100;
            while (performance.now() < end);
            throw new Error("boom");
          }, 1);
          await promise;
          console.log("after");
        `,
      },
      "entry.mjs",
    );
    expect(stderr).toContain("error: boom");
    expect({ stdout, exitCode }).toEqual({ stdout: "exit 1\n", exitCode: 1 });
  });

  const onUncaughtException = `process.on("uncaughtException", e => console.log("caught", e.message));\n`;
  const onUnhandledRejection = `process.on("unhandledRejection", e => console.log("caught", e.message));\n`;
  it.each([
    ["an 'uncaughtException' listener", onUncaughtException + throws, [], "caught boom\n"],
    ["an 'unhandledRejection' listener", onUnhandledRejection + rejects, [], "caught boom\n"],
    ["--unhandled-rejections=warn", rejects, ["--unhandled-rejections=warn"], ""],
  ])("is not fatal with %s", async (_, setup, flags, handled) => {
    const { stdout, exitCode } = await run({ "entry.mjs": exitListeners + setup + awaits }, ...flags, "entry.mjs");
    expect({ stdout, exitCode }).toEqual({ stdout: handled + "after\nbeforeExit\nexit 0\n", exitCode: 0 });
  });

  it("an error that a --preload left behind does not keep the entry from starting", async () => {
    const { stdout, stderr, exitCode } = await run(
      {
        "preload.mjs": `Promise.reject(new Error("boom")); console.log("preload");`,
        "entry.mjs": `console.log("entry");` + awaits,
      },
      "--preload",
      "./preload.mjs",
      "entry.mjs",
    );
    expect(stderr).toContain("error: boom");
    expect(stdout).toStartWith("preload\nentry\n");
    expect(exitCode).toBe(1);
  });
});
