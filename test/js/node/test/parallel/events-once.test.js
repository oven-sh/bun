import { test, expect } from "bun:test";
const { once, EventEmitter, listenerCount } = require("events");
const { deepStrictEqual, fail, rejects, strictEqual } = require("assert");
// const { kEvents } = require("internal/event_target");

test("onceAnEvent", async () => {
  const ee = new EventEmitter();

  process.nextTick(() => {
    ee.emit("myevent", 42);
  });

  const [value] = await once(ee, "myevent");
  strictEqual(value, 42);
  strictEqual(ee.listenerCount("error"), 0);
  strictEqual(ee.listenerCount("myevent"), 0);
});

test("onceAnEventWithInvalidOptions", async () => {
  const ee = new EventEmitter();

  await Promise.all(
    [1, "hi", null, false, () => {}, Symbol(), 1n].map(options => {
      expect.toThrowWithCode(() => once(ee, "myevent", options), "ERR_INVALID_ARG_TYPE");
    }),
  );
});

test("onceAnEventWithTwoArgs", async () => {
  const ee = new EventEmitter();

  process.nextTick(() => {
    ee.emit("myevent", 42, 24);
  });

  const value = await once(ee, "myevent");
  deepStrictEqual(value, [42, 24]);
});

test("catchesErrors", async () => {
  const ee = new EventEmitter();

  const expected = new Error("kaboom");
  let err;
  process.nextTick(() => {
    ee.emit("error", expected);
  });

  try {
    await once(ee, "myevent");
  } catch (_e) {
    err = _e;
  }
  strictEqual(err, expected);
  strictEqual(ee.listenerCount("error"), 0);
  strictEqual(ee.listenerCount("myevent"), 0);
});

test("catchesErrorsWithAbortSignal", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();
  const signal = ac.signal;

  const expected = new Error("boom");
  let err;
  process.nextTick(() => {
    ee.emit("error", expected);
  });

  try {
    const promise = once(ee, "myevent", { signal });
    strictEqual(ee.listenerCount("error"), 1);
    strictEqual(listenerCount(signal, "abort"), 1);

    await promise;
  } catch (e) {
    err = e;
  }
  strictEqual(err, expected);
  strictEqual(ee.listenerCount("error"), 0);
  strictEqual(ee.listenerCount("myevent"), 0);
  strictEqual(listenerCount(signal, "abort"), 0);
});

test("stopListeningAfterCatchingError", async () => {
  const ee = new EventEmitter();

  const expected = new Error("kaboom");
  let err;
  process.nextTick(() => {
    ee.emit("error", expected);
    ee.emit("myevent", 42, 24);
  });

  try {
    await once(ee, "myevent");
  } catch (_e) {
    err = _e;
  }
  process.removeAllListeners("multipleResolves");
  strictEqual(err, expected);
  strictEqual(ee.listenerCount("error"), 0);
  strictEqual(ee.listenerCount("myevent"), 0);
});

test("onceError", async () => {
  const ee = new EventEmitter();

  const expected = new Error("kaboom");
  process.nextTick(() => {
    ee.emit("error", expected);
  });

  const promise = once(ee, "error");
  strictEqual(ee.listenerCount("error"), 1);
  const [err] = await promise;
  strictEqual(err, expected);
  strictEqual(ee.listenerCount("error"), 0);
  strictEqual(ee.listenerCount("myevent"), 0);
});

test("onceWithEventTarget", async () => {
  const et = new EventTarget();
  const event = new Event("myevent");
  process.nextTick(() => {
    et.dispatchEvent(event);
  });
  const [value] = await once(et, "myevent");
  strictEqual(value, event);
});

test("onceWithEventTargetError", async () => {
  const et = new EventTarget();
  const error = new Event("error");
  process.nextTick(() => {
    et.dispatchEvent(error);
  });

  const [err] = await once(et, "error");
  strictEqual(err, error);
});

test("onceWithInvalidEventEmmiter", async () => {
  const ac = new AbortController();
  expect.toThrowWithCode(() => once(ac, "myevent"), "ERR_INVALID_ARG_TYPE");
});

test("prioritizesEventEmitter", async () => {
  const ee = new EventEmitter();
  ee.addEventListener = fail;
  ee.removeAllListeners = fail;
  process.nextTick(() => ee.emit("foo"));
  await once(ee, "foo");
});

test("abortSignalBefore", async () => {
  const ee = new EventEmitter();
  ee.on("error", () => expect(false).toEqual(true));
  const abortedSignal = AbortSignal.abort();

  await Promise.all(
    [1, {}, "hi", null, false].map(signal => {
      expect.toThrowWithCode(() => once(ee, "foo", { signal }), "ERR_INVALID_ARG_TYPE");
    }),
  );

  expect(() => once(ee, "foo", { signal: abortedSignal })).toThrow();
});

test("abortSignalAfter", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();
  ee.on("error", () => expect(false).toEqual(true));
  const r = rejects(once(ee, "foo", { signal: ac.signal }), {
    name: "AbortError",
  });
  process.nextTick(() => ac.abort());
  return r;
});

test("abortSignalAfterEvent", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();
  process.nextTick(() => {
    ee.emit("foo");
    ac.abort();
  });
  const promise = once(ee, "foo", { signal: ac.signal });
  strictEqual(listenerCount(ac.signal, "abort"), 1);
  await promise;
  strictEqual(listenerCount(ac.signal, "abort"), 0);
});

test("abortSignalRemoveListener", async () => {
  const ee = new EventEmitter();
  const ac = new AbortController();

  try {
    process.nextTick(() => ac.abort());
    await once(ee, "test", { signal: ac.signal });
  } catch {
    strictEqual(ee.listeners("test").length, 0);
    strictEqual(ee.listeners("error").length, 0);
  }
});

test.skip("eventTargetAbortSignalBefore", async () => {
  const et = new EventTarget();
  const abortedSignal = AbortSignal.abort();

  await Promise.all(
    [1, {}, "hi", null, false].map(signal => {
      return rejects(once(et, "foo", { signal }), {
        code: "ERR_INVALID_ARG_TYPE",
      });
    }),
  );

  return rejects(once(et, "foo", { signal: abortedSignal }), {
    name: "AbortError",
  });
});

test.skip("eventTargetAbortSignalBeforeEvenWhenSignalPropagationStopped", async () => {
  const et = new EventTarget();
  const ac = new AbortController();
  const { signal } = ac;
  signal.addEventListener("abort", e => e.stopImmediatePropagation(), { once: true });

  process.nextTick(() => ac.abort());
  return rejects(once(et, "foo", { signal }), {
    name: "AbortError",
  });
});

test("eventTargetAbortSignalAfter", async () => {
  const et = new EventTarget();
  const ac = new AbortController();
  const r = rejects(once(et, "foo", { signal: ac.signal }), {
    name: "AbortError",
  });
  process.nextTick(() => ac.abort());
  return r;
});

test("eventTargetAbortSignalAfterEvent", async () => {
  const et = new EventTarget();
  const ac = new AbortController();
  process.nextTick(() => {
    et.dispatchEvent(new Event("foo"));
    ac.abort();
  });
  await once(et, "foo", { signal: ac.signal });
});
