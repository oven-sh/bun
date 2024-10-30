import { test, expect } from "bun:test";
const common = require("../common");
const assert = require("assert");
const { on, EventEmitter, listenerCount } = require("events");

test("basic", async () => {
  const ee = new EventEmitter();
  process.nextTick(() => {
    ee.emit("foo", "bar");
    // 'bar' is a spurious event, we are testing
    // that it does not show up in the iterable
    ee.emit("bar", 24);
    ee.emit("foo", 42);
  });

  const iterable = on(ee, "foo");

  const expected = [["bar"], [42]];

  for await (const event of iterable) {
    const current = expected.shift();

    expect(current).toStrictEqual(event);

    if (expected.length === 0) {
      break;
    }
  }
  expect(ee.listenerCount("foo")).toBe(0);
  expect(ee.listenerCount("error")).toBe(0);
});

test("invalidArgType", async () => {
  assert.throws(
    () => on({}, "foo"),
    common.expectsError({
      code: "ERR_INVALID_ARG_TYPE",
      name: "TypeError",
    }),
  );

  const ee = new EventEmitter();

  [1, "hi", null, false, () => {}, Symbol(), 1n].map(options => {
    return assert.throws(
      () => on(ee, "foo", options),
      common.expectsError({
        code: "ERR_INVALID_ARG_TYPE",
        name: "TypeError",
      }),
    );
  });
});

test("error", async () => {
  const ee = new EventEmitter();
  const _err = new Error("kaboom");
  process.nextTick(() => {
    ee.emit("error", _err);
  });

  const iterable = on(ee, "foo");
  let looped = false;
  let thrown = false;

  try {
    // eslint-disable-next-line no-unused-vars
    for await (const event of iterable) {
      looped = true;
    }
  } catch (err) {
    thrown = true;
    expect(err).toStrictEqual(_err);
  }
  expect(thrown).toBe(true);
  expect(looped).toBe(false);
});

test("errorDelayed", async () => {
  const ee = new EventEmitter();
  const _err = new Error("kaboom");
  process.nextTick(() => {
    ee.emit("foo", 42);
    ee.emit("error", _err);
  });

  const iterable = on(ee, "foo");
  const expected = [[42]];
  let thrown = false;

  try {
    for await (const event of iterable) {
      const current = expected.shift();
      assert.deepStrictEqual(current, event);
    }
  } catch (err) {
    thrown = true;
    expect(err).toStrictEqual(_err);
  }
  expect(thrown).toBe(true);
  expect(ee.listenerCount("foo")).toBe(0);
  expect(ee.listenerCount("error")).toBe(0);
});

test("throwInLoop", async () => {
  const ee = new EventEmitter();
  const _err = new Error("kaboom");

  process.nextTick(() => {
    ee.emit("foo", 42);
  });

  try {
    for await (const event of on(ee, "foo")) {
      assert.deepStrictEqual(event, [42]);
      throw _err;
    }
  } catch (err) {
    expect(err).toStrictEqual(_err);
  }

  expect(ee.listenerCount("foo")).toBe(0);
  expect(ee.listenerCount("error")).toBe(0);
});

test("next", async () => {
  const ee = new EventEmitter();
  const iterable = on(ee, "foo");

  process.nextTick(function () {
    ee.emit("foo", "bar");
    ee.emit("foo", 42);
    iterable.return();
  });

  const results = await Promise.all([iterable.next(), iterable.next(), iterable.next()]);

  expect(results).toStrictEqual([
    {
      value: ["bar"],
      done: false,
    },
    {
      value: [42],
      done: false,
    },
    {
      value: undefined,
      done: true,
    },
  ]);

  expect(await iterable.next()).toStrictEqual({
    value: undefined,
    done: true,
  });
});

test("nextError", async () => {
  const ee = new EventEmitter();
  const iterable = on(ee, "foo");
  const _err = new Error("kaboom");
  process.nextTick(function () {
    ee.emit("error", _err);
  });
  const results = await Promise.allSettled([iterable.next(), iterable.next(), iterable.next()]);
  assert.deepStrictEqual(results, [
    {
      status: "rejected",
      reason: _err,
    },
    {
      status: "fulfilled",
      value: {
        value: undefined,
        done: true,
      },
    },
    {
      status: "fulfilled",
      value: {
        value: undefined,
        done: true,
      },
    },
  ]);
  expect(ee.listeners("error").length).toBe(0);
});

test("iterableThrow", async () => {
  const ee = new EventEmitter();
  const iterable = on(ee, "foo");

  process.nextTick(() => {
    ee.emit("foo", "bar");
    ee.emit("foo", 42); // lost in the queue
    iterable.throw(_err);
  });

  const _err = new Error("kaboom");
  let thrown = false;

  assert.throws(
    () => {
      // No argument
      iterable.throw();
    },
    {
      message: 'The "EventEmitter.AsyncIterator" argument must be' + " of type Error. Received: undefined",
      name: "TypeError",
    },
  );

  const expected = [["bar"], [42]];

  try {
    for await (const event of iterable) {
      assert.deepStrictEqual(event, expected.shift());
    }
  } catch (err) {
    thrown = true;
    assert.strictEqual(err, _err);
  }
  assert.strictEqual(thrown, true);
  assert.strictEqual(expected.length, 0);
  assert.strictEqual(ee.listenerCount("foo"), 0);
  assert.strictEqual(ee.listenerCount("error"), 0);
});

test("eventTarget", async () => {
  const et = new EventTarget();
  const tick = () => et.dispatchEvent(new Event("tick"));
  const interval = setInterval(tick, 0);
  let count = 0;
  for await (const [event] of on(et, "tick")) {
    count++;
    assert.strictEqual(event.type, "tick");
    if (count >= 5) {
      break;
    }
  }
  assert.strictEqual(count, 5);
  clearInterval(interval);
});

test("errorListenerCount", async () => {
  const et = new EventEmitter();
  on(et, "foo");
  assert.strictEqual(et.listenerCount("error"), 1);
});

test.skip("nodeEventTarget", async () => {
  const et = new NodeEventTarget();
  const tick = () => et.dispatchEvent(new Event("tick"));
  const interval = setInterval(tick, 0);
  let count = 0;
  for await (const [event] of on(et, "tick")) {
    count++;
    assert.strictEqual(event.type, "tick");
    if (count >= 5) {
      break;
    }
  }
  assert.strictEqual(count, 5);
  clearInterval(interval);
});

test("abortableOnBefore", async () => {
  const ee = new EventEmitter();
  const abortedSignal = AbortSignal.abort();
  [1, {}, null, false, "hi"].forEach(signal => {
    assert.throws(() => on(ee, "foo", { signal }), {
      code: "ERR_INVALID_ARG_TYPE",
    });
  });
  assert.throws(() => on(ee, "foo", { signal: abortedSignal }), {
    name: "AbortError",
  });
});

test("eventTargetAbortableOnBefore", async () => {
  const et = new EventTarget();
  const abortedSignal = AbortSignal.abort();
  [1, {}, null, false, "hi"].forEach(signal => {
    assert.throws(() => on(et, "foo", { signal }), {
      code: "ERR_INVALID_ARG_TYPE",
    });
  });
  assert.throws(() => on(et, "foo", { signal: abortedSignal }), {
    name: "AbortError",
  });
});

test("abortableOnAfter", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();

  const i = setInterval(() => ee.emit("foo", "foo"), 10);

  async function foo() {
    for await (const f of on(ee, "foo", { signal: ac.signal })) {
      assert.strictEqual(f, "foo");
    }
  }

  foo()
    .catch(
      common.mustCall(error => {
        assert.strictEqual(error.name, "AbortError");
      }),
    )
    .finally(() => {
      clearInterval(i);
    });

  process.nextTick(() => ac.abort());
});

test("eventTargetAbortableOnAfter", async () => {
  const et = new EventTarget();
  const ac = new AbortController();

  const i = setInterval(() => et.dispatchEvent(new Event("foo")), 10);

  async function foo() {
    for await (const f of on(et, "foo", { signal: ac.signal })) {
      assert(f);
    }
  }

  foo()
    .catch(
      common.mustCall(error => {
        assert.strictEqual(error.name, "AbortError");
      }),
    )
    .finally(() => {
      clearInterval(i);
    });

  process.nextTick(() => ac.abort());
});

test("eventTargetAbortableOnAfter2", async () => {
  const et = new EventTarget();
  const ac = new AbortController();

  const i = setInterval(() => et.dispatchEvent(new Event("foo")), 10);

  async function foo() {
    for await (const f of on(et, "foo", { signal: ac.signal })) {
      assert(f);
      // Cancel after a single event has been triggered.
      ac.abort();
    }
  }

  foo()
    .catch(
      common.mustCall(error => {
        assert.strictEqual(error.name, "AbortError");
      }),
    )
    .finally(() => {
      clearInterval(i);
    });
});

test("abortableOnAfterDone", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();

  const i = setInterval(() => ee.emit("foo", "foo"), 1);
  let count = 0;

  async function foo() {
    for await (const f of on(ee, "foo", { signal: ac.signal })) {
      assert.strictEqual(f[0], "foo");
      if (++count === 5) break;
    }
    ac.abort(); // No error will occur
  }

  foo().finally(() => {
    clearInterval(i);
  });
});

test("abortListenerRemovedAfterComplete", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();

  const i = setInterval(() => ee.emit("foo", "foo"), 1);
  try {
    // Below: either the kEvents map is empty or the 'abort' listener list is empty

    // Return case
    const endedIterator = on(ee, "foo", { signal: ac.signal });
    expect(listenerCount(ac.signal, "abort")).toBeGreaterThan(0);
    endedIterator.return();
    expect(listenerCount(ac.signal, "abort")).toBe(0);

    // Throw case
    const throwIterator = on(ee, "foo", { signal: ac.signal });
    expect(listenerCount(ac.signal, "abort")).toBeGreaterThan(0);
    throwIterator.throw(new Error());
    expect(listenerCount(ac.signal, "abort")).toBe(0);

    // Abort case
    on(ee, "foo", { signal: ac.signal });
    expect(listenerCount(ac.signal, "abort")).toBeGreaterThan(0);
    ac.abort(new Error());
    expect(listenerCount(ac.signal, "abort")).toBe(0);
  } finally {
    clearInterval(i);
  }
});
