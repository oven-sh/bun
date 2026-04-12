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

test("transferred MessagePorts are still reachable via parentPort listeners (#29211)", async () => {
  using dir = tempDir("issue-29211-ports", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      parentPort.on('message', (_msg, ports) => {
        // Node passes ports as a second argument; the DOM-style MessageEvent
        // also exposes them via event.ports. We test both surfaces below via
        // addEventListener.
      });
      parentPort.addEventListener('message', (event) => {
        const incomingPort = event.ports && event.ports[0];
        if (!incomingPort) {
          parentPort.postMessage({ ok: false, reason: 'no port on event' });
          return;
        }
        incomingPort.start?.();
        incomingPort.addEventListener('message', (portEvent) => {
          parentPort.postMessage({ ok: true, echoed: portEvent.data });
        });
        incomingPort.postMessage('hello-from-worker');
      });
    `,
    "main.mjs": String.raw`
      import { Worker, MessageChannel } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const { port1, port2 } = new MessageChannel();
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        port1.on('message', (data) => {
          // Echo back so the worker receives something on the transferred
          // port and we can assert end-to-end delivery.
          port1.postMessage('reply:' + data);
        });
        w.on('message', resolve);
        w.postMessage({ cmd: 'use-port' }, [port2]);
      });
      port1.close();
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
  // The transferred port must reach the parentPort listener via `event.ports`
  // and must be usable for round-trip messaging. Before the port-preservation
  // fix, `event.ports` was an empty array and the transferred MessagePort was
  // silently dropped.
  expect(JSON.parse(stdout.trim())).toEqual({ ok: true, echoed: "reply:hello-from-worker" });
});

test("parentPort.addEventListener accepts an EventListenerObject (#29211)", async () => {
  using dir = tempDir("issue-29211-listener-object", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      const listener = {
        fired: 0,
        handleEvent(event) {
          this.fired++;
          if (event.data && event.data.cmd === 'report') {
            parentPort.postMessage({ fired: this.fired });
          }
        },
      };
      parentPort.addEventListener('message', listener);
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('message', resolve);
        w.postMessage({ n: 1 });
        w.postMessage({ n: 2 });
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
  // Three parent messages — the EventListenerObject's `handleEvent` should
  // run once per message (3 times). Pre-fix, the wrapper unconditionally
  // invoked `listener.$call` which throws on a non-function.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 3 });
});

test("parentPort.addEventListener with AbortSignal exits cleanly after abort (#29211)", async () => {
  using dir = tempDir("issue-29211-abort-signal", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      // Add a parentPort listener tied to an AbortSignal, then abort it
      // immediately. After abort, the worker should have zero parentPort
      // listeners and should exit naturally when its module finishes — it
      // must NOT hang waiting for messages. Before the AbortSignal-leak
      // fix, the capture forwarder installed on 'self' when the listener
      // was registered stayed attached after the native EventTarget removed
      // the wrapped listener, keeping the event loop alive forever.
      const ac = new AbortController();
      parentPort.addEventListener('message', () => {}, { signal: ac.signal });
      ac.abort();
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const exitCode = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('exit', resolve);
        // If the worker hangs, this timer fires first and we terminate it
        // ourselves — producing a distinguishing exit code of -1.
        setTimeout(() => { w.terminate(); resolve(-1); }, 3000).unref();
      });
      console.log(JSON.stringify({ exitCode }));
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
  // The worker must exit naturally (exit code 0), not be killed by the
  // 3-second timeout (which would report -1). Pre-fix, the capture
  // forwarder stayed installed after AbortSignal detached the wrapped
  // listener, pinning the event loop and forcing the terminate fallback.
  expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 0 });
});

test("parentPort listener for non-message events does not block parent messages (#29211)", async () => {
  // Regression for a gating bug in `parentPortAddEventListener`: registering
  // a listener for a non-message event (e.g. via `parentPort.once('close',
  // …)` or `.on('error', …)`) used to bump `listenerCount`, which in turn
  // installed the capture-phase `message` forwarder on `self`. The forwarder
  // re-dispatched every incoming message on `parentPortTarget` — but that
  // target had no 'message' listener, so all parent messages were silently
  // dropped. Only listeners for 'message' / 'messageerror' should install
  // the forwarder.
  using dir = tempDir("issue-29211-non-message-event", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      // Register a non-message listener FIRST. This must not affect message
      // delivery.
      parentPort.on('close', () => {});
      let received = 0;
      parentPort.on('message', (msg) => {
        received++;
        if (msg && msg.cmd === 'report') {
          parentPort.postMessage({ received });
        }
      });
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('message', (msg) => {
          if (msg && typeof msg.received === 'number') resolve(msg);
        });
        w.postMessage({ n: 1 });
        w.postMessage({ n: 2 });
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
  // All three parent messages should reach the 'message' listener — the
  // earlier 'close' listener must not route anything into the forwarder.
  expect(JSON.parse(stdout.trim())).toEqual({ received: 3 });
});
