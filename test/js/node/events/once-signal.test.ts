/**
 * This test runs under `bun test` and (via node:test/node:assert) under
 * `node --experimental-strip-types --test`. Running it under Node proves the
 * assertions encode real Node behaviour, so a green run under Bun means Bun
 * matches Node.
 *
 * `events.once()` is an `async function` in Node: a bad `options`, a bad
 * `options.signal`, or an already-aborted signal must produce a *rejected
 * promise*, never a synchronous throw. Bun's port had `once` as a plain
 * synchronous function, so all three validation paths threw at the call site
 * (and `once.constructor.name` was "Function" instead of "AsyncFunction").
 */
import assert from "node:assert";
import { EventEmitter, once } from "node:events";
import { test } from "node:test";

test("once() with already-aborted signal rejects (not a synchronous throw)", async () => {
  const ee = new EventEmitter();
  const p = once(ee, "foo", { signal: AbortSignal.abort() });
  assert.ok(p instanceof Promise);
  await assert.rejects(p, { name: "AbortError", code: "ABORT_ERR" });
});

test("once() with invalid options.signal rejects (not a synchronous throw)", async () => {
  for (const signal of [1, {}, "hi", null, false]) {
    const ee = new EventEmitter();
    const p = once(ee, "foo", { signal });
    assert.ok(p instanceof Promise);
    await assert.rejects(p, { code: "ERR_INVALID_ARG_TYPE" });
  }
});

test("once() with non-object options rejects (not a synchronous throw)", async () => {
  const ee = new EventEmitter();
  const p = once(ee, "foo", "hi");
  assert.ok(p instanceof Promise);
  await assert.rejects(p, { code: "ERR_INVALID_ARG_TYPE" });
});

test("once() with a signal aborted later still rejects (control)", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();
  const p = once(ee, "foo", { signal: ac.signal });
  assert.ok(p instanceof Promise);
  process.nextTick(() => ac.abort());
  await assert.rejects(p, { code: "ABORT_ERR" });
});

test("once is an async function (matches Node)", () => {
  assert.strictEqual(once.constructor.name, "AsyncFunction");
});
