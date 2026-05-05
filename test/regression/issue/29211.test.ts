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

test.concurrent("parent messages do not fire self.onmessage in a node:worker_threads worker (#29211)", async () => {
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
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort delivers each parent message exactly once to every listener variant (#29211)", async () => {
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
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.off removes a listener (#29211)", async () => {
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

  // `handler` should fire exactly once — it unsubscribes itself on the
  // first invocation — then stay silent for the remaining messages.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 1 });
  expect(exitCode).toBe(0);
});

test.concurrent("transferred MessagePorts are still reachable via parentPort listeners (#29211)", async () => {
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

  // The transferred port must reach the parentPort listener via `event.ports`
  // and must be usable for round-trip messaging. Before the port-preservation
  // fix, `event.ports` was an empty array and the transferred MessagePort was
  // silently dropped.
  expect(JSON.parse(stdout.trim())).toEqual({ ok: true, echoed: "reply:hello-from-worker" });
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.addEventListener accepts an EventListenerObject (#29211)", async () => {
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

  // Three parent messages — the EventListenerObject's `handleEvent` should
  // run once per message (3 times). Pre-fix, the wrapper unconditionally
  // invoked `listener.$call` which throws on a non-function.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 3 });
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.addEventListener with AbortSignal exits cleanly after abort (#29211)", async () => {
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

  // The worker must exit naturally (exit code 0), not be killed by the
  // 3-second timeout (which would report -1). Pre-fix, the capture
  // forwarder stayed installed after AbortSignal detached the wrapped
  // listener, pinning the event loop and forcing the terminate fallback.
  expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 0 });
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort listener for non-message events does not block parent messages (#29211)", async () => {
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

  // All three parent messages should reach the 'message' listener — the
  // earlier 'close' listener must not route anything into the forwarder.
  expect(JSON.parse(stdout.trim())).toEqual({ received: 3 });
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.removeListener unsubscribes through the wrapped-listener slot (#29211)", async () => {
  // `parentPort.on('message', fn)` wraps `fn` into a callback (setting
  // `fn[wrappedListener] = callback`) and registers the callback. A matching
  // `parentPort.removeListener('message', fn)` must resolve the wrapped
  // callback before calling `removeEventListener`, or `handler` stays
  // subscribed and its loop-ref is never released.
  using dir = tempDir("issue-29211-removelistener", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      let fired = 0;
      function handler(msg) {
        fired++;
        if (msg && msg.cmd === 'remove-me') {
          parentPort.removeListener('message', handler);
          // A second live listener reports the count that 'handler' saw
          // for each subsequent 'report' command. Pre-fix, this ran AFTER
          // handler itself had also fired again on every subsequent
          // message, so 'fired' would keep climbing.
          parentPort.on('message', (msg2) => {
            if (msg2 && msg2.cmd === 'report') parentPort.postMessage({ fired });
          });
          parentPort.postMessage({ acked: true });
        }
      }
      parentPort.on('message', handler);
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      w.on('error', e => { console.error('worker error', e); process.exit(2); });
      const result = await new Promise((resolve) => {
        let acked = false;
        w.on('message', (msg) => {
          if (msg && msg.acked) {
            acked = true;
            // After removal is confirmed, post some data messages followed
            // by a report to see whether 'handler' keeps firing.
            w.postMessage({ n: 1 });
            w.postMessage({ n: 2 });
            w.postMessage({ cmd: 'report' });
          } else if (acked && msg && typeof msg.fired === 'number') {
            resolve(msg);
          }
        });
        w.postMessage({ cmd: 'remove-me' });
      });
      console.log(JSON.stringify(result));
      process.exit(0);
    `,
  });

  await using proc = Bun.spawn({
    cmd: [bunExe(), String(dir) + "/main.mjs"],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  // `handler` fired exactly once — for the 'remove-me' command that removed
  // it. After that it should be detached, so 'fired' must stay at 1 even
  // though three more messages were posted. Pre-fix, `removeListener`
  // bypassed the wrapped-listener lookup, `handler` stayed subscribed, and
  // 'fired' reached 4.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 1 });
  expect(exitCode).toBe(0);
});

test.concurrent("parentPort.on twice + off once leaves exactly one listener firing (#29211)", async () => {
  // Registering the same `fn` twice with `on` registers two listeners (Node
  // `EventEmitter` semantics — duplicates allowed). `removeListener(fn)`
  // removes ONE instance per call. Pre-fix, `injectFakeEmitter.on` stashed
  // the wrapped callback on the listener function itself; the second `on`
  // overwrote that slot, orphaning the first wrapper. After one `off`,
  // only the second wrapper was evicted, the orphan kept firing, AND the
  // forwarder-held loop ref could never be released.
  using dir = tempDir("issue-29211-dup-on", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      let fired = 0;
      function handler() { fired++; }
      parentPort.on('message', handler);
      parentPort.on('message', handler);
      parentPort.on('message', (msg) => {
        if (msg && msg.cmd === 'remove-one') {
          parentPort.removeListener('message', handler);
          parentPort.postMessage({ removed: true });
        } else if (msg && msg.cmd === 'report') {
          parentPort.postMessage({ fired });
        }
      });
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const result = await new Promise((resolve, reject) => {
        let removed = false;
        w.on('error', reject);
        w.on('message', (msg) => {
          if (msg && msg.removed) {
            removed = true;
            w.postMessage({ n: 1 });
            w.postMessage({ cmd: 'report' });
          } else if (removed && msg && typeof msg.fired === 'number') {
            resolve(msg);
          }
        });
        // Two pre-removal messages: 'handler' fires twice (x2 registrations) = 4
        w.postMessage({ n: 1 });
        w.postMessage({ n: 2 });
        w.postMessage({ cmd: 'remove-one' });
        // After removal ack, main posts two more — handler should fire once
        // each (only one registration left). Final total: 4 + 2 = 6.
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

  // Count per message while both registrations of `handler` are active:
  //   {n:1} → 2, {n:2} → 4, {cmd:'remove-one'} → 6 (then one reg removed).
  // After the removal ack, main posts {n:1} and {cmd:'report'}, each firing
  // the single remaining registration: → 7 → 8.
  //
  // Pre-fix: the second `on(handler)` overwrote the first wrapper slot and
  // orphaned the first registration; the only `removeListener` call deleted
  // the second wrapper, leaving the orphan still firing forever. Post-fix:
  // Node-style LIFO removal leaves exactly one live registration.
  expect(JSON.parse(stdout.trim())).toEqual({ fired: 8 });
  expect(exitCode).toBe(0);
});

test.concurrent(
  "parentPort.addEventListener with signal, then remove + re-add without signal, abort doesn't evict new (#29211)",
  async () => {
    // The AbortSignal abort handler must capture the specific registration
    // it was created for — not just (type, listener). Otherwise: add-with-signal,
    // explicit remove, add-without-signal, abort → the stale abort handler
    // silently removes the UNSIGNALED listener.
    using dir = tempDir("issue-29211-abort-stale", {
      "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      let fired = 0;
      function handler() { fired++; }

      const ac = new AbortController();
      // 1. Register with signal.
      parentPort.addEventListener('message', handler, { signal: ac.signal });
      // 2. Explicitly remove it.
      parentPort.removeEventListener('message', handler);
      // 3. Re-register WITHOUT a signal.
      parentPort.addEventListener('message', handler);
      // 4. Now abort. The stale closure from step 1 must not touch step 3.
      ac.abort();

      parentPort.addEventListener('message', (event) => {
        if (event.data && event.data.cmd === 'report') {
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

    // All 4 messages reach 'handler' (the unsignaled re-registration). Pre-fix,
    // fired would be 0 because the stale abort handler from step 1 evicted
    // the step-3 registration.
    expect(JSON.parse(stdout.trim())).toEqual({ fired: 4 });
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "parentPort addEventListener after on/off does not leak via wrappedListener slot (#29211)",
  async () => {
    // Cross-API interaction: `on` → `off` → `addEventListener` → `removeListener`
    // must cleanly remove the direct registration. Pre-fix, `removeListener`
    // followed the stale `fn[wrappedListener]` slot from the earlier `on`
    // cycle, missed the direct `addEventListener` registration, and left
    // the forwarder pinning the event loop.
    using dir = tempDir("issue-29211-cross-api-remove", {
      "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      function handler() {}
      // Go through the emitter wrapping layer first so (with the old code)
      // handler[wrappedListener] would be set to a stale wrapper.
      parentPort.on('message', handler);
      parentPort.off('message', handler);
      // Register directly via addEventListener.
      parentPort.addEventListener('message', handler);
      // Remove via the EventEmitter-style API — should still find and
      // remove the direct registration.
      parentPort.removeListener('message', handler);
    `,
      "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const exitCode = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('exit', resolve);
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

    // Worker must exit naturally (exit code 0). Pre-fix, the forwarder
    // pinned the event loop because removeListener followed a stale slot
    // and never decremented the listener count for the direct registration.
    expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 0 });
    expect(exitCode).toBe(0);
  },
);

test.concurrent("parentPort.onmessageerror alone does not keep the event loop alive (#29211)", async () => {
  // Registering only a `messageerror` handler on parentPort must NOT install
  // the capture-phase `message` forwarder on `self`. Pre-fix, both forwarders
  // were installed as a pair — so a worker that only cared about
  // `messageerror` would pin `m_messageEventCount` on the global scope
  // forever and hang after its module finished executing.
  using dir = tempDir("issue-29211-onmessageerror-only", {
    "worker.mjs": String.raw`
      import { parentPort } from 'node:worker_threads';
      parentPort.onmessageerror = () => {};
    `,
    "main.mjs": String.raw`
      import { Worker } from 'node:worker_threads';
      const w = new Worker(new URL('./worker.mjs', import.meta.url));
      const exitCode = await new Promise((resolve, reject) => {
        w.on('error', reject);
        w.on('exit', resolve);
        // Hard watchdog: if the worker hangs, terminate and surface -1 so
        // the test assertion below distinguishes a natural exit from a
        // leaked event-loop ref.
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

  expect(JSON.parse(stdout.trim())).toEqual({ exitCode: 0 });
  expect(exitCode).toBe(0);
});
