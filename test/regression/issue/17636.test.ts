// https://github.com/oven-sh/bun/issues/17636
// @inquirer/prompts hang on stdin close: unsettled TLA + process.emit override bypassed

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// Each test spawns a child bun; under debug+ASAN concurrent spawns contend
// enough that the default 5s timeout isn't always sufficient.
const timeout = isDebug ? 30_000 : 10_000;

test.concurrent(
  "unsettled top-level await exits 13 once the event loop is idle instead of hanging",
  async () => {
    // stdin closes → readline closes → nothing left to settle the TLA.
    const source = `
    import * as readline from "node:readline";

    const rl = readline.createInterface({
      terminal: true,
      input: process.stdin,
      output: process.stdout,
    });
    rl.on("close", () => console.log("rl-closed"));
    process.on("beforeExit", c => console.log("beforeExit", c));
    process.on("exit", c => console.log("exit", c));

    await new Promise(() => {});
    console.log("unreachable");
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdin: new Blob([""]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["rl-closed", "beforeExit 0", "exit 13"]);
    expect(stderr).toContain("unsettled top-level await");
    expect(exitCode).toBe(13);
  },
  timeout,
);

test.concurrent(
  "monkey-patched process.emit observes 'beforeExit' and 'exit' on natural shutdown",
  async () => {
    const source = `
    const seen = [];
    const original = process.emit;
    process.emit = function (ev, ...args) {
      seen.push(ev + ":" + args[0]);
      return original.call(this, ev, ...args);
    };
    process.on("exit", () => console.log(JSON.stringify(seen)));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const seen = JSON.parse(stdout.trim());
    expect(seen).toEqual(["beforeExit:0", "exit:0"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test.concurrent(
  "signal-exit pattern rejects a pending TLA prompt on stdin close (inquirer flow)",
  async () => {
    // End-to-end reduction: patched process.emit observes 'exit', rejects
    // the prompt, and the .catch() microtask runs before the process dies.
    using dir = tempDir("issue-17636", {
      "index.mjs": `
      import * as readline from "node:readline";

      // Minimal stand-in for the part of \`signal-exit\` that inquirer
      // relies on: patch process.emit, call subscribers on 'exit'.
      const onExitHandlers = [];
      function onSignalExit(fn) { onExitHandlers.push(fn); }
      const originalEmit = process.emit;
      process.emit = function (ev, ...args) {
        const ret = originalEmit.call(this, ev, ...args);
        if (ev === "exit") {
          for (const fn of onExitHandlers) fn(args[0], null);
        }
        return ret;
      };

      // Inquirer's createPrompt, reduced.
      function prompt() {
        const rl = readline.createInterface({
          terminal: true,
          input: process.stdin,
          output: process.stdout,
        });
        return new Promise((resolve, reject) => {
          onSignalExit((code, signal) => {
            reject(new Error("User force closed the prompt with " + code + " " + signal));
          });
          rl.on("line", line => {
            rl.close();
            resolve(line);
          });
        });
      }

      await prompt().catch(e => {
        console.log("CAUGHT:" + e.message);
        process.exit(0);
      });
      console.log("unreachable");
    `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "index.mjs"],
      env: bunEnv,
      cwd: String(dir),
      stdin: new Blob([""]),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).toContain("unsettled top-level await");
    expect(stdout.trim()).toBe("CAUGHT:User force closed the prompt with 13 null");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test.concurrent(
  "Promise microtasks queued from an 'exit' listener run, but nextTick does not",
  async () => {
    // Node drains Promise microtasks once after 'exit'; nextTick is a
    // no-op once _exiting is set (queued callbacks are dropped).
    const source = `
    process.on("exit", code => {
      console.log("exit-listener:" + code);
      Promise.resolve().then(() => console.log("microtask:" + process.exitCode));
      process.nextTick(() => console.log("nexttick:SHOULD-NOT-RUN"));
    });
    process.exitCode = 5;
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["exit-listener:5", "microtask:5"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(5);
  },
  timeout,
);

test.concurrent(
  "Promise microtasks queued from a worker's 'exit' listener run",
  async () => {
    const source = `
    import { Worker } from "node:worker_threads";
    const w = new Worker(
      \`process.on("exit", c => {
         console.log("exit-listener:" + c);
         Promise.resolve().then(() => console.log("microtask:" + c));
       });\`,
      { eval: true },
    );
    await new Promise(r => w.on("exit", r));
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["exit-listener:0", "microtask:0"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test.concurrent(
  "explicit process.exitCode suppresses the unsettled-TLA warning and exit 13",
  async () => {
    // Node: if user code set an exit code, the TLA-unsettled path respects it
    // and does not overwrite with 13 or print the warning.
    const source = `
    process.exitCode = 7;
    await new Promise(() => {});
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).not.toContain("unsettled");
    expect(exitCode).toBe(7);
  },
  timeout,
);

test.concurrent(
  "beforeExit listener that settles the TLA lets execution resume (no exit 13)",
  async () => {
    // Node parity: a beforeExit handler can resolve the pending top-level
    // await, after which module evaluation continues past the await.
    const source = `
    let resolve;
    process.on("beforeExit", () => resolve("ok"));
    const v = await new Promise(r => { resolve = r; });
    console.log("resumed:" + v);
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("resumed:ok");
    expect(stderr).not.toContain("unsettled");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test.concurrent(
  "explicit process.exit() does not drain microtasks queued from an 'exit' listener",
  async () => {
    // Mirror of the natural-shutdown microtask test: on explicit process.exit()
    // Node drops them (and nextTick too); the drain is natural-shutdown only.
    const source = `
    process.on("exit", c => {
      console.log("exit-listener:" + c);
      Promise.resolve().then(() => console.log("LEAK-microtask"));
      process.nextTick(() => console.log("LEAK-nexttick"));
    });
    process.exit(3);
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["exit-listener:3"]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(3);
  },
  timeout,
);

test.concurrent(
  "fatal uncaught exception does not drain microtasks queued from an 'exit' listener",
  async () => {
    // Node drops them on this path too; only natural shutdown drains.
    const source = `
    process.on("exit", c => {
      console.log("exit-listener:" + c);
      Promise.resolve().then(() => console.log("LEAK-microtask"));
    });
    throw new Error("boom");
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["exit-listener:1"]);
    expect(stderr).toContain("boom");
    expect(exitCode).toBe(1);
  },
  timeout,
);

test.concurrent(
  "throw from a post-beforeExit task callback does not drain microtasks queued from an 'exit' listener",
  async () => {
    const source = `
    process.on("beforeExit", () => setImmediate(() => { throw new Error("boom"); }));
    process.on("exit", c => {
      console.log("exit-listener:" + c);
      Promise.resolve().then(() => console.log("LEAK-microtask"));
    });
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.split("\n").filter(Boolean)).toEqual(["exit-listener:1"]);
    expect(stderr).toContain("boom");
    expect(exitCode).toBe(1);
  },
  timeout,
);

test.concurrent(
  "beforeExit listener that rejects the TLA surfaces via uncaughtException (exit 1)",
  async () => {
    const source = `
    let reject;
    process.on("beforeExit", () => reject(new Error("boom")));
    await new Promise((_, r) => { reject = r; });
    console.log("unreachable");
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toBe("");
    expect(stderr).toContain("boom");
    expect(stderr).not.toContain("unsettled top-level await");
    expect(exitCode).toBe(1);
  },
  timeout,
);

test.concurrent(
  "beforeExit listener that rejects the TLA is swallowed by a user uncaughtException handler",
  async () => {
    const source = `
    let reject;
    process.on("uncaughtException", e => console.log("caught:" + e.message));
    process.on("beforeExit", () => reject(new Error("boom")));
    await new Promise((_, r) => { reject = r; });
  `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", source],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("caught:boom");
    expect(stderr).not.toContain("unsettled top-level await");
    expect(exitCode).toBe(0);
  },
  timeout,
);
