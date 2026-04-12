// https://github.com/oven-sh/bun/issues/29211
//
// In a `node:worker_threads` worker, a message posted from the parent was
// being delivered to BOTH `parentPort` listeners AND the worker's global
// scope (`self.onmessage` / `self.addEventListener('message', …)`). Node only
// delivers parent messages via `parentPort`.
//
// Emscripten-generated pthread code (e.g. `z3-solver`) relies on this: its
// worker does
//
//   parentPort.on('message', (msg) => onmessage({ data: msg }));
//   self.onmessage = handleMessage;
//
// and expects `handleMessage` to run exactly once per incoming message. Under
// Bun it was running twice — once from the automatic `self.onmessage` dispatch
// and once from the explicit `onmessage({data: msg})` forwarding inside the
// parentPort listener — which tripped the `wasm-instantiate` run-dependency
// assertion inside z3's emscripten bootstrap.
//
// The fix lives in `src/js/node/worker_threads.ts`'s `fakeParentPort`: it now
// gives parentPort its own EventTarget and installs a capture-phase listener
// on `self` that stops immediate propagation, so parent messages never reach
// `self.onmessage` / user listeners on the global scope.

import { expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// Debug builds emit an ASAN warning on startup that writes to stderr. Strip
// it so the assertions can check for a clean stderr.
function cleanStderr(s: string): string {
  return s
    .split("\n")
    .filter(line => !line.includes("ASAN interferes with JSC signal handlers"))
    .join("\n")
    .trim();
}

test("parent messages do not fire self.onmessage in a node:worker_threads worker (#29211)", async () => {
  using dir = tempDir("issue-29211-self-onmessage", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      globalThis.self = globalThis;

      let handleMessageCalls = 0;
      let selfAddListenerCalls = 0;
      let globalAddListenerCalls = 0;

      function handleMessage(event) {
        handleMessageCalls++;
      }

      // z3-solver's exact pattern: install a parentPort listener that
      // manually forwards to the global onmessage, then set self.onmessage.
      parentPort.on('message', (msg) => {
        onmessage({ data: msg });
      });
      self.onmessage = handleMessage;

      // Additional user-style listeners on the global scope — in Node these
      // never fire for parent messages either, so they must be silent here.
      self.addEventListener('message', () => { selfAddListenerCalls++; });
      globalThis.addEventListener('message', () => { globalAddListenerCalls++; });

      parentPort.on('message', (msg) => {
        if (msg.cmd === 'report') {
          parentPort.postMessage({
            handleMessageCalls,
            selfAddListenerCalls,
            globalAddListenerCalls,
          });
        }
      });
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('message', (msg) => {
          if (msg && typeof msg.handleMessageCalls === 'number') resolve(msg);
        });
        w.postMessage({ n: 1 });
        w.postMessage({ n: 2 });
        w.postMessage({ n: 3 });
        w.postMessage({ cmd: 'report' });
      });
      await w.terminate();
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/main.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr: cleanStderr(stderr), exitCode }).toEqual({ stderr: "", exitCode: 0 });

  // Four parent messages were posted (three data + one 'report'). The
  // `parentPort.on('message', (msg) => onmessage({data:msg}))` forwarding
  // listener runs once per incoming parent message and manually calls
  // handleMessage, so handleMessage should run exactly 4 times — not 8
  // (the pre-fix behavior where `self.onmessage` also auto-fired on every
  // parent message, doubling every dispatch).
  //
  // Listeners on the global scope — via `self.addEventListener('message', …)`
  // or `globalThis.addEventListener('message', …)` — must never fire for
  // parent messages (Node semantics).
  expect(JSON.parse(stdout.trim())).toEqual({
    handleMessageCalls: 4,
    selfAddListenerCalls: 0,
    globalAddListenerCalls: 0,
  });
});

test("parentPort delivers each parent message exactly once to every listener variant (#29211)", async () => {
  using dir = tempDir("issue-29211-listener-variants", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';

      const counts = {
        on: 0,
        addEventListener: 0,
        onmessage: 0,
      };

      parentPort.on('message', () => { counts.on++; });
      parentPort.addEventListener('message', () => { counts.addEventListener++; });
      parentPort.onmessage = () => { counts.onmessage++; };

      parentPort.on('message', (msg) => {
        if (msg && msg.cmd === 'report') {
          parentPort.postMessage(counts);
        }
      });
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('message', (msg) => {
          if (msg && typeof msg.on === 'number') resolve(msg);
        });
        // Five data messages, then a report. The report message also counts
        // as a delivery for every 'message' listener that doesn't filter,
        // so each counter should see 6 total deliveries.
        for (let i = 0; i < 5; i++) w.postMessage({ n: i });
        w.postMessage({ cmd: 'report' });
      });
      await w.terminate();
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/main.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr: cleanStderr(stderr), exitCode }).toEqual({ stderr: "", exitCode: 0 });

  // Each listener variant must see exactly 6 deliveries — one per message
  // posted. Pre-fix, `parentPort.onmessage` was 0 (never fired at all
  // because the parentPort getter/setter aliased `self.onmessage` but the
  // parent message only went to the global event target, not through the
  // onmessage handler slot on the same target after an event handler was
  // assigned via the parentPort proxy).
  expect(JSON.parse(stdout.trim())).toEqual({
    on: 6,
    addEventListener: 6,
    onmessage: 6,
  });
});

test("parentPort.off removes a listener (#29211)", async () => {
  using dir = tempDir("issue-29211-off", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';

      let fired = 0;
      function handler(msg) {
        fired++;
        if (fired === 1) {
          parentPort.off('message', handler);
        }
        if (msg && msg.cmd === 'report') {
          parentPort.postMessage({ fired });
        }
      }
      parentPort.on('message', handler);

      // A second listener that stays live so we can receive the 'report'
      // command after 'handler' has unsubscribed.
      parentPort.on('message', (msg) => {
        if (msg && msg.cmd === 'report') {
          parentPort.postMessage({ fired });
        }
      });
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('message', (msg) => {
          if (msg && typeof msg.fired === 'number') resolve(msg);
        });
        w.postMessage({ n: 1 });
        w.postMessage({ n: 2 });
        w.postMessage({ n: 3 });
        w.postMessage({ cmd: 'report' });
      });
      await w.terminate();
      console.log(JSON.stringify(result));
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/main.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr: cleanStderr(stderr), exitCode }).toEqual({ stderr: "", exitCode: 0 });
  // `handler` should fire exactly once — it unsubscribes itself on the
  // first invocation — then stay silent for the remaining messages.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 1 });
});
