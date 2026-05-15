// Issue #30827: `async_hooks.createHook({...}).enable()` was a no-op in Bun.
// This file covers the partial implementation that now fires init/before/
// after/destroy for timers (setTimeout / setInterval / setImmediate).
//
// The hook registration permanently wraps the global timer functions, so
// every test spawns a fresh subprocess via `bunExe() -e '…'` to keep them
// isolated — a hook registered by one test would otherwise leak into the
// next one.

import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

async function runScript(script: string) {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", script],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { stdout, stderr, exitCode };
}

test.concurrent("createHook fires init+destroy for setImmediate cancelled with clearImmediate", async () => {
  // Log from a DIFFERENT callback than the timer whose after/destroy we
  // want to observe — otherwise the log runs inside that timer's
  // before/after window and misses its own trailing events.
  const { stdout, stderr, exitCode } = await runScript(`
      const async_hooks = require('async_hooks');
      const events = [];
      async_hooks.createHook({
        init: (id, type) => events.push(['init', type]),
        before: (id) => events.push(['before']),
        after: (id) => events.push(['after']),
        destroy: (id) => events.push(['destroy']),
      }).enable();

      const t = setImmediate(() => { events.push(['ran']); });
      clearImmediate(t);

      setTimeout(() => {
        // Schedule the print outside the setTimeout's before/after scope.
        setImmediate(() => setImmediate(() => {
          console.log(JSON.stringify(events));
        }));
      }, 20);
    `);
  expect(stderr).toBe("");
  // The setImmediate was cleared before it could run, so we never see
  // ran for it — but we do see init + destroy.
  const parsed = JSON.parse(stdout.trim());
  expect(parsed).toContainEqual(["init", "Immediate"]);
  expect(parsed).toContainEqual(["destroy"]);
  expect(parsed).not.toContainEqual(["ran"]);
  // The Immediate's destroy appears before the setTimeout's before
  // (destroy is queued on nextTick after clearImmediate, which runs
  // before the event loop reaches the 20ms timeout).
  const destroyIdx = parsed.findIndex(e => e[0] === "destroy");
  const beforeIdx = parsed.findIndex(e => e[0] === "before");
  expect(destroyIdx).toBeLessThan(beforeIdx);
  expect(exitCode).toBe(0);
});

test.concurrent("createHook fires init+before+after+destroy for setTimeout that fires", async () => {
  const { stdout, stderr, exitCode } = await runScript(`
      const async_hooks = require('async_hooks');
      const events = [];
      let timeoutId = null;
      async_hooks.createHook({
        init: (id, type) => {
          if (type === 'Timeout' && timeoutId == null) timeoutId = id;
          events.push(['init', id, type]);
        },
        before: (id) => events.push(['before', id]),
        after: (id) => events.push(['after', id]),
        destroy: (id) => events.push(['destroy', id]),
      }).enable();

      setTimeout(() => {
        events.push(['cb', timeoutId]);
        // Let after + destroy flush before printing.
        setImmediate(() => setImmediate(() => {
          console.log(JSON.stringify(events));
        }));
      }, 10);
    `);
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout.trim());
  const cbEvent = parsed.find(e => e[0] === "cb");
  expect(cbEvent).toBeDefined();
  const timeoutId = cbEvent[1];
  // Init for the outer setTimeout precedes before+cb+after for the same id.
  const initIdx = parsed.findIndex(e => e[0] === "init" && e[1] === timeoutId);
  const beforeIdx = parsed.findIndex(e => e[0] === "before" && e[1] === timeoutId);
  const cbIdx = parsed.findIndex(e => e[0] === "cb");
  const afterIdx = parsed.findIndex(e => e[0] === "after" && e[1] === timeoutId);
  const destroyIdx = parsed.findIndex(e => e[0] === "destroy" && e[1] === timeoutId);
  expect(initIdx).toBeGreaterThanOrEqual(0);
  expect(beforeIdx).toBeGreaterThan(initIdx);
  expect(cbIdx).toBeGreaterThan(beforeIdx);
  expect(afterIdx).toBeGreaterThan(cbIdx);
  expect(destroyIdx).toBeGreaterThan(afterIdx);
  expect(exitCode).toBe(0);
});

test.concurrent("createHook matches the issue #30827 expected output for Immediate+Timeout", async () => {
  // Reproduces the issue body verbatim (modulo `process._rawDebug` — Bun
  // doesn't implement it, so we use `console.log`). Expected Node output
  // was: init 2 Immediate / init 3 Timeout / destroy 2 / before 3 /
  // after 3 / destroy 3. We print from a nested setImmediate so the
  // setTimeout's own after/destroy can be observed first.
  const { stdout, stderr, exitCode } = await runScript(`
      const async_hooks = require('async_hooks');
      const out = [];
      async_hooks.createHook({
        init:    (id, provider) => out.push('init ' + provider),
        before:  (id) => out.push('before'),
        after:   (id) => out.push('after'),
        destroy: (id) => out.push('destroy'),
      }).enable();

      const timerId1 = setImmediate(() => {
        out.push('setImmediate-cb');
      });
      clearImmediate(timerId1);

      setTimeout(() => {
        setImmediate(() => setImmediate(() => {
          console.log(out.join('\\n'));
        }));
      }, 20);
    `);
  expect(stderr).toBe("");
  const lines = stdout.trim().split("\n");
  // The cleared setImmediate never runs.
  expect(lines).not.toContain("setImmediate-cb");
  // The sequence must contain: init Immediate, init Timeout, destroy
  // (of the Immediate), before, after (of the Timeout) — in that order.
  const initImm = lines.indexOf("init Immediate");
  const initTim = lines.indexOf("init Timeout");
  const firstDestroy = lines.indexOf("destroy");
  const firstBefore = lines.indexOf("before");
  const firstAfter = lines.indexOf("after");
  expect(initImm).toBeGreaterThanOrEqual(0);
  expect(initTim).toBeGreaterThanOrEqual(0);
  expect(firstDestroy).toBeGreaterThanOrEqual(0);
  expect(firstBefore).toBeGreaterThanOrEqual(0);
  expect(firstAfter).toBeGreaterThanOrEqual(0);
  expect(initImm).toBeLessThan(firstDestroy);
  expect(initTim).toBeLessThan(firstDestroy);
  expect(firstDestroy).toBeLessThan(firstBefore);
  expect(firstBefore).toBeLessThan(firstAfter);
  expect(exitCode).toBe(0);
});

test.concurrent("createHook fires init+before+after per tick for setInterval", async () => {
  // Log from two nested setImmediates so every before/after pair is
  // observed before the print — including after/destroy of the interval.
  const { stdout, stderr, exitCode } = await runScript(`
    const async_hooks = require('async_hooks');
    const events = [];
    const intervalAsyncId = { value: null };
    async_hooks.createHook({
      init: (id, type) => {
        if (type === 'Timeout' && intervalAsyncId.value == null) {
          intervalAsyncId.value = id;
        }
        events.push(['init', id, type]);
      },
      before: (id) => events.push(['before', id]),
      after: (id) => events.push(['after', id]),
      destroy: (id) => events.push(['destroy', id]),
    }).enable();

    let ticks = 0;
    const id = setInterval(() => {
      events.push(['tick', ++ticks]);
      if (ticks === 3) {
        clearInterval(id);
        setTimeout(() => {
          setImmediate(() => setImmediate(() => {
            console.log(JSON.stringify({ events, intervalId: intervalAsyncId.value }));
          }));
        }, 10);
      }
    }, 5);
  `);
  expect(stderr).toBe("");
  const { events, intervalId } = JSON.parse(stdout.trim());
  // Each interval tick has a matching before/after pair scoped to the
  // interval's own async id.
  const tickIndices = events.map((e, i) => (e[0] === "tick" ? i : -1)).filter(i => i !== -1);
  expect(tickIndices).toHaveLength(3);
  for (const tickIdx of tickIndices) {
    // The tick must be bracketed by a before/after pair for the interval
    // — but the body of the tick may itself spawn other timers (before
    // `after` fires) so we scan outward rather than expecting immediate
    // neighbours.
    const beforeIdx = findLastIndex(events.slice(0, tickIdx), e => e[0] === "before" && e[1] === intervalId);
    const afterIdx = events.findIndex((e, i) => i > tickIdx && e[0] === "after" && e[1] === intervalId);
    expect(beforeIdx).toBeGreaterThanOrEqual(0);
    expect(afterIdx).toBeGreaterThan(tickIdx);
  }
  // The interval had exactly one init (it's not re-initialized per tick).
  const intervalInits = events.filter(e => e[0] === "init" && e[1] === intervalId);
  expect(intervalInits).toHaveLength(1);
  // After clearInterval, destroy must fire for the interval.
  expect(events).toContainEqual(["destroy", intervalId]);
  expect(exitCode).toBe(0);
});

// Array.prototype.findLastIndex polyfill for clarity in the interval test.
function findLastIndex<T>(arr: T[], pred: (e: T) => boolean): number {
  for (let i = arr.length - 1; i >= 0; i--) {
    if (pred(arr[i])) return i;
  }
  return -1;
}

test.concurrent("createHook can be disabled to stop emitting events", async () => {
  const { stdout, stderr, exitCode } = await runScript(`
    const async_hooks = require('async_hooks');
    const events = [];
    const h = async_hooks.createHook({
      init: (id, type) => events.push(['init', type]),
    });
    h.enable();
    setTimeout(() => {}, 5);     // should emit init
    h.disable();
    setTimeout(() => {}, 10);    // should NOT emit init
    setTimeout(() => {
      console.log(JSON.stringify(events));
    }, 30);
  `);
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout.trim());
  // Exactly one init: the first setTimeout. The one after .disable() plus
  // the tail setTimeout (which fires the log) are both while the hook is
  // disabled.
  const inits = parsed.filter(e => e[0] === "init");
  expect(inits).toEqual([["init", "Timeout"]]);
  expect(exitCode).toBe(0);
});

test.concurrent(
  "createHook: mismatched clear APIs are no-ops (clearTimeout(Immediate) / clearImmediate(Timeout))",
  async () => {
    // Node pairs clearTimeout/clearInterval ↔ Timeout and clearImmediate ↔
    // Immediate strictly — mismatched clears do NOT cancel the timer and
    // therefore must not emit a `destroy` event. The `kTimerKind` guard
    // inside `installTimerHooks` pins this behavior.
    const { stdout, stderr, exitCode } = await runScript(`
      const async_hooks = require('async_hooks');
      const events = [];
      async_hooks.createHook({
        init: (id, type) => events.push(['init', id, type]),
        before: (id) => events.push(['before', id]),
        after: (id) => events.push(['after', id]),
        destroy: (id) => events.push(['destroy', id]),
      }).enable();

      const imm = setImmediate(() => { events.push(['imm ran']); });
      clearTimeout(imm);   // wrong API — must be a no-op, imm still fires

      const tim = setTimeout(() => { events.push(['tim ran']); }, 10);
      clearImmediate(tim); // wrong API — must be a no-op, tim still fires

      setTimeout(() => {
        setImmediate(() => setImmediate(() => {
          console.log(JSON.stringify(events));
        }));
      }, 50);
    `);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim());
    // Both timers STILL FIRE because the clears used the wrong API.
    expect(parsed).toContainEqual(["imm ran"]);
    expect(parsed).toContainEqual(["tim ran"]);
    // Crucially: for each timer there must be exactly ONE destroy (fired
    // after the timer ran), not two (one spurious from the wrong-API clear
    // plus one after firing). Find the async ids from init events and count.
    const immEvent = parsed.find(e => e[0] === "init" && e[2] === "Immediate");
    const timEvent = parsed.find(e => e[0] === "init" && e[2] === "Timeout");
    expect(immEvent).toBeDefined();
    expect(timEvent).toBeDefined();
    const immId = immEvent![1];
    const timId = timEvent![1];
    const destroysForImm = parsed.filter(e => e[0] === "destroy" && e[1] === immId);
    const destroysForTim = parsed.filter(e => e[0] === "destroy" && e[1] === timId);
    expect(destroysForImm).toHaveLength(1);
    expect(destroysForTim).toHaveLength(1);
    expect(exitCode).toBe(0);
  },
);

test.concurrent(
  "createHook fires events for require('node:timers').setTimeout regardless of module-load order",
  async () => {
    // `node:timers` snapshots the global timer functions into its default
    // export at evaluation time. A dependency `require()`ing the module
    // BEFORE the user enables hooks would otherwise leave those exports
    // pointing at the unwrapped natives. `installTimerHooks` writes its
    // wrappers back into the module's exports to close this gap.
    const { stdout, stderr, exitCode } = await runScript(`
    // Load node:timers FIRST so it snapshots the natives before .enable().
    const timers = require('node:timers');
    const async_hooks = require('async_hooks');
    const events = [];
    async_hooks.createHook({
      init: (id, type) => events.push(['init', id, type]),
      before: (id) => events.push(['before', id]),
      after: (id) => events.push(['after', id]),
      destroy: (id) => events.push(['destroy', id]),
    }).enable();

    // Call via the module export — must still emit lifecycle events.
    timers.setTimeout(() => { events.push(['timers-cb']); }, 10);

    // Give the timer room to fire, then print.
    setTimeout(() => {
      setImmediate(() => setImmediate(() => {
        console.log(JSON.stringify(events));
      }));
    }, 40);
  `);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim());
    // The module-export call must fire init.
    const timersCbIdx = parsed.findIndex(e => e[0] === "timers-cb");
    expect(timersCbIdx).toBeGreaterThanOrEqual(0);
    // Walk backwards from the callback invocation: the nearest prior
    // 'before' is the before for the timers.setTimeout timer. If the
    // wrapper was bypassed, timers-cb would sit outside any before/after.
    const beforeTimersIdx = findLastIndex(parsed.slice(0, timersCbIdx), e => e[0] === "before");
    expect(beforeTimersIdx).toBeGreaterThanOrEqual(0);
    const timerAsyncId = parsed[beforeTimersIdx][1];
    // And the matching after must be just past the callback.
    const afterIdx = parsed.findIndex((e, i) => i > timersCbIdx && e[0] === "after" && e[1] === timerAsyncId);
    expect(afterIdx).toBeGreaterThan(timersCbIdx);
    expect(exitCode).toBe(0);
  },
);

test.concurrent("createHook: references captured before .enable() bypass the hook layer", async () => {
  // Known limitation, documented in `installTimerHooks`: wrapping is
  // installed on `globalThis` lazily on the first `.enable()`. A caller
  // that captured the original reference earlier keeps the unwrapped
  // function. Pinning this here so a future opt-in to lower-level
  // interception is a conscious choice, not an accidental regression.
  const { stdout, stderr, exitCode } = await runScript(`
    const async_hooks = require('async_hooks');
    // Capture BEFORE enabling the hook.
    const capturedSetTimeout = setTimeout;

    const events = [];
    async_hooks.createHook({
      init: (id, type) => events.push(['init', type]),
      before: (id) => events.push(['before']),
      after: (id) => events.push(['after']),
      destroy: (id) => events.push(['destroy']),
    }).enable();

    // Called via the captured reference — bypasses the hook wrapper.
    capturedSetTimeout(() => { events.push(['captured-cb']); }, 10);

    // Also call via the global so we can confirm the wrapper is active.
    setTimeout(() => {
      setImmediate(() => setImmediate(() => {
        console.log(JSON.stringify(events));
      }));
    }, 40);
  `);
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout.trim());
  // The captured-reference callback ran…
  expect(parsed).toContainEqual(["captured-cb"]);
  // …but no lifecycle events were emitted for it. The only inits we see
  // are for the timers created after .enable() via the wrapped global
  // (the outer setTimeout(…, 40) and the two nested setImmediates).
  const inits = parsed.filter(e => e[0] === "init");
  // Nothing should be "Immediate" pre-.enable() capture; we only created
  // a setTimeout via the captured reference. If the wrapper had run for
  // that call, inits would contain TWO "Timeout" entries (captured + tail)
  // instead of one.
  const timeoutInits = inits.filter(e => e[1] === "Timeout");
  expect(timeoutInits).toHaveLength(1);
  expect(exitCode).toBe(0);
});

test.concurrent("createHook: util.promisify(setTimeout) still resolves after .enable() (no regression)", async () => {
  // Regression guard: `internal/promisify.ts` defines
  // `Symbol.for("nodejs.util.promisify.custom")` on the native
  // `globalThis.setTimeout`/`setImmediate`/`setInterval` at load time. Our
  // wrapper is a brand-new function; if it doesn't forward that symbol
  // onto itself, `util.promisify(setTimeout)` falls back to the generic
  // errback wrapper which calls `setTimeout(delay, nodeCallback)` —
  // wrong arg order — and the promise never resolves.
  const { stdout, stderr, exitCode } = await runScript(`
    const util = require('node:util');
    const async_hooks = require('async_hooks');
    async_hooks.createHook({ init: () => {} }).enable();

    const sleep = util.promisify(setTimeout);
    const sleepImm = util.promisify(setImmediate);

    (async () => {
      const t1 = Date.now();
      const value = await Promise.race([
        sleep(30, 'hello'),
        new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT')), 1000)),
      ]);
      const elapsed = Date.now() - t1;
      const immValue = await Promise.race([
        sleepImm('world'),
        new Promise((_, r) => setTimeout(() => r(new Error('TIMEOUT imm')), 1000)),
      ]);
      console.log(JSON.stringify({ value, immValue, elapsedAtLeast25: elapsed >= 25 }));
    })();
  `);
  expect(stderr).toBe("");
  const parsed = JSON.parse(stdout.trim());
  expect(parsed.value).toBe("hello");
  expect(parsed.immValue).toBe("world");
  expect(parsed.elapsedAtLeast25).toBe(true);
  expect(exitCode).toBe(0);
});

test.concurrent("createHook validates hook shape (preserved pre-existing behavior)", async () => {
  // This is the only async_hooks.createHook test that existed before
  // #30827 — keep it green. `ERR_ASYNC_CALLBACK` must be thrown for any
  // non-function hook property.
  const { stdout, stderr, exitCode } = await runScript(`
    const async_hooks = require('async_hooks');
    const assert = require('assert');
    const bad = [null, -1, 1, {}, []];
    for (const name of ['init', 'before', 'after', 'destroy', 'promiseResolve']) {
      for (const value of bad) {
        assert.throws(
          () => async_hooks.createHook({ [name]: value }),
          { code: 'ERR_ASYNC_CALLBACK', name: 'TypeError' },
        );
      }
    }
    console.log('ok');
  `);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("ok");
  expect(exitCode).toBe(0);
});
