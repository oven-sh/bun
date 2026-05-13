// https://github.com/oven-sh/bun/issues/17636
//
// @inquirer/prompts (via signal-exit) expects the runtime to:
//   1. Stop waiting on a top-level await once the event loop has nothing
//      left that could settle it (Node exits 13 here; Bun used to
//      busy-spin at 100% CPU forever).
//   2. Route the 'exit' / 'beforeExit' events through the user-visible
//      `process.emit` so a monkey-patched emit (signal-exit) can observe
//      shutdown and reject the pending prompt promise.
//
// These tests cover the observable behaviour without depending on the
// @inquirer/prompts package itself.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, isDebug, tempDir } from "harness";

// All six tests spawn a child bun; under the ASAN debug build six
// concurrent processes contend enough that the default 5s timeout
// isn't always sufficient for the readline/stdin cases.
const timeout = isDebug ? 30_000 : 10_000;

test.concurrent(
  "unsettled top-level await exits 13 once the event loop is idle instead of hanging",
  async () => {
    // Reduced from inquirer's search() prompt: stdin closes, readline closes,
    // nothing is left to settle the awaited promise. Node prints a warning
    // and exits 13. Bun previously busy-looped in waitForPromise forever.
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
    // signal-exit's mechanism: replace process.emit to intercept the 'exit'
    // event. Bun was calling the internal C++ EventEmitter directly, so the
    // override never ran and signal-exit never fired its callbacks.
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
    // End-to-end reduction of issue #17636: a prompt library awaits a promise
    // at top level that is only settled by user input or by signal-exit's
    // onExit hook. When stdin closes, Node runs beforeExit -> detects the
    // unsettled TLA -> emits 'exit' through the patched process.emit ->
    // signal-exit rejects the prompt -> the user's .catch() runs.
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

    // The patched process.emit must observe 'exit', reject the prompt, and
    // the .catch() microtask must run before the process dies. Without the
    // fix the process hangs forever instead.
    expect(stderr).toContain("unsettled top-level await");
    expect(stdout.trim()).toBe("CAUGHT:User force closed the prompt with 13 null");
    expect(exitCode).toBe(0);
  },
  timeout,
);

test.concurrent(
  "Promise microtasks queued from an 'exit' listener run, but nextTick does not",
  async () => {
    // Node drains Promise microtasks once more after the 'exit' event so
    // that shutdown-time promise reactions observe the exit (needed for
    // the signal-exit -> inquirer rejection to reach its .catch()).
    // process.nextTick, however, is a no-op once _exiting is set and
    // anything already queued is dropped — running it would break
    // callbacks that guard on process._exiting (e.g. Node's
    // common.mustCall()).
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
