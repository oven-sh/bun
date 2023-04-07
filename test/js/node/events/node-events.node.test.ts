import { EventEmitter, getEventListeners, on, once } from "node:events";
import { createTest } from "node-harness";

const { beforeAll, expect, assert, strictEqual, describe, it, createCallCheckCtx, createDoneDotAll } = createTest(
  import.meta.path,
);
// const NodeEventTarget = globalThis.EventTarget;

describe("node:events.on() (EventEmitter AsyncIterator)", () => {
  it("should return an async iterator", async () => {
    const ee = new EventEmitter();
    const iterable = on(ee, "foo");

    ee.emit("foo", "bar");
    // 'bar' is a spurious event, we are testing
    // that it does not show up in the iterable
    ee.emit("bar", 24);
    ee.emit("foo", 42);

    const expected = [["bar"], [42]];

    for await (const event of iterable) {
      const current = expected.shift();

      assert.deepStrictEqual(current, event);

      if (expected.length === 0) {
        break;
      }
    }

    assert.strictEqual(ee.listenerCount("foo"), 0);
    assert.strictEqual(ee.listenerCount("error"), 0);
  });

  it("should throw an error when the first argument is not an EventEmitter", () => {
    expect(() => on({} as any, "foo")).toThrow();
  });

  it("should throw an error when an error event is emitted", async () => {
    const ee = new EventEmitter();
    const _err = new Error("kaboom");

    const iterable = on(ee, "foo");

    ee.emit("error", _err);

    let looped = false;
    let thrown = false;

    try {
      // eslint-disable-next-line no-unused-vars
      for await (const event of iterable) {
        looped = true;
      }
    } catch (err) {
      thrown = true;
      assert.strictEqual(err, _err);
    }
    assert.strictEqual(thrown, true);
    assert.strictEqual(looped, false);
  });

  it("should throw when error emitted after successful events", async () => {
    const ee = new EventEmitter();
    const _err = new Error("kaboom");
    const iterable = on(ee, "foo");

    ee.emit("foo", 42);
    ee.emit("error", _err);

    const expected = [[42]] as (number[] | undefined[])[];

    const current = [] as (number[] | undefined[])[];
    const received = [] as (number[] | undefined[])[];
    let thrownErr: any;

    try {
      for await (const event of iterable) {
        const _expected = expected.shift();
        if (_expected !== undefined) current.push(_expected);
        received.push(event);
      }
    } catch (err) {
      thrownErr = err;
    }

    assert.deepStrictEqual(current, received);
    assert.strictEqual(ee.listenerCount("foo"), 0);
    assert.strictEqual(ee.listenerCount("error"), 0);

    expect(thrownErr).toBeInstanceOf(Error);
    assert.strictEqual(thrownErr, _err);
  });

  it("should throw when error thrown from inside loop", async () => {
    const ee = new EventEmitter();
    const _err = new Error("kaboom");

    const iterable = on(ee, "foo");

    ee.emit("foo", 42);

    let looped = false;
    let thrown = false;

    try {
      // eslint-disable-next-line no-unused-vars
      for await (const event of iterable) {
        assert.deepStrictEqual(event, [42]);
        looped = true;
        throw _err;
      }
    } catch (err) {
      thrown = true;
      assert.strictEqual(err, _err);
    }

    assert.strictEqual(thrown, true);
    assert.strictEqual(looped, true);
    assert.strictEqual(ee.listenerCount("foo"), 0);
    assert.strictEqual(ee.listenerCount("error"), 0);
  });

  it("should allow for async iteration via .next()", async done => {
    const ee = new EventEmitter();
    const iterable = on(ee, "foo");

    process.nextTick(() => {
      ee.emit("foo", "bar");
      ee.emit("foo", 42);
      // @ts-ignore
      iterable.return();
    });

    const results = await Promise.all([iterable.next(), iterable.next(), iterable.next()]);
    assert.deepStrictEqual(results, [
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

    assert.deepStrictEqual(await iterable.next(), {
      value: undefined,
      done: true,
    });

    done();
  });

  it("it should fulfill subsequent deferred promises with `undefined` when the emitter emits an error", async done => {
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

    assert.strictEqual(ee.listeners("error").length, 0);

    done();
  });

  describe(".throw()", () => {
    let ee: EventEmitter;
    let iterable: AsyncIterableIterator<any>;

    beforeAll(() => {
      ee = new EventEmitter();
      iterable = on(ee, "foo");
    });

    it("should throw a `TypeError` when calling without args", async () => {
      expect(() => {
        iterable.throw!();
      }).toThrow(TypeError);

      assert.strictEqual(ee.listenerCount("foo"), 1);
      assert.strictEqual(ee.listenerCount("error"), 1);
    });

    it("should throw when called with an error", async () => {
      const _err = new Error("kaboom");

      ee.emit("foo", "bar");
      ee.emit("foo", 42);
      iterable.throw!(_err);

      const expected = [["bar"], [42]];

      let thrown = false;
      let looped = false;

      try {
        for await (const event of iterable) {
          assert.deepStrictEqual(event, expected.shift());
          looped = true;
        }
      } catch (err) {
        thrown = true;
        assert.strictEqual(err, _err);
      }

      assert.strictEqual(looped, true);
      assert.strictEqual(thrown, true);
      assert.strictEqual(ee.listenerCount("foo"), 0);
      assert.strictEqual(ee.listenerCount("error"), 0);
    });
  });

  it("should add an error listener when the iterable is created", () => {
    const ee = new EventEmitter();
    on(ee, "foo");
    assert.strictEqual(ee.listenerCount("error"), 1);
  });

  it("should throw when called with an aborted signal", () => {
    const ee = new EventEmitter();
    const abortedSignal = AbortSignal.abort();
    [1, {}, null, false, "hi"].forEach((signal: any) => {
      assert.throws(() => on(ee, "foo", { signal }), Error);
    });
    assert.throws(() => on(ee, "foo", { signal: abortedSignal }), {
      name: "AbortError",
    });
  });

  it("should NOT THROW an `AbortError` AFTER done iterating over events", async _done => {
    let _doneCalled = false;
    const done = (err?: Error) => {
      if (_doneCalled) return;
      _doneCalled = true;
      _done(err);
    };

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

    foo()
      .catch(err => done(err))
      .finally(() => {
        clearInterval(i);
        if (!_doneCalled) expect(true).toBe(true);
        done();
      });
  });

  it("should THROW an `AbortError` BEFORE done iterating over events", async _done => {
    let _doneCalled = false;
    const done = (err?: Error) => {
      if (_doneCalled) return;
      _doneCalled = true;
      _done(err);
    };

    let count = 0;

    const createDone = createDoneDotAll(done);
    const { mustCall, closeTimers } = createCallCheckCtx(createDone());
    const finalDone = createDone();

    const ee = new EventEmitter();
    const ac = new AbortController();

    const i = setInterval(() => ee.emit("foo", "foo"), 10);

    setTimeout(() => ac.abort(), 50);

    async function foo() {
      for await (const f of on(ee, "foo", { signal: ac.signal })) {
        assert.deepStrictEqual(f, ["foo"]);
      }
    }

    foo()
      .then(() => done(new Error("Should not be called")))
      .catch(
        mustCall(error => {
          assert.strictEqual(error.name, "AbortError");
        }),
      )
      .finally(() => {
        clearInterval(i);
        closeTimers();
        if (!_doneCalled) finalDone();
      });
  });

  // TODO: Uncomment tests for NodeEventTarget and Web EventTarget

  // async function eventTarget() {
  //   const et = new EventTarget();
  //   const tick = () => et.dispatchEvent(new Event("tick"));
  //   const interval = setInterval(tick, 0);
  //   let count = 0;
  //   for await (const [event] of on(et, "tick")) {
  //     count++;
  //     assert.strictEqual(event.type, "tick");
  //     if (count >= 5) {
  //       break;
  //     }
  //   }
  //   assert.strictEqual(count, 5);
  //   clearInterval(interval);
  // }

  // async function nodeEventTarget() {
  //   const et = new NodeEventTarget();
  //   const tick = () => et.dispatchEvent(new Event("tick"));
  //   const interval = setInterval(tick, 0);
  //   let count = 0;
  //   for await (const [event] of on(et, "tick")) {
  //     count++;
  //     assert.strictEqual(event.type, "tick");
  //     if (count >= 5) {
  //       break;
  //     }
  //   }
  //   assert.strictEqual(count, 5);
  //   clearInterval(interval);
  // }

  // async function eventTargetAbortableOnBefore() {
  //   const et = new EventTarget();
  //   const abortedSignal = AbortSignal.abort();
  //   [1, {}, null, false, "hi"].forEach(signal => {
  //     assert.throws(() => on(et, "foo", { signal }), {
  //       code: "ERR_INVALID_ARG_TYPE",
  //     });
  //   });
  //   assert.throws(() => on(et, "foo", { signal: abortedSignal }), {
  //     name: "AbortError",
  //   });
  // }

  // async function eventTargetAbortableOnAfter() {
  //   const et = new EventTarget();
  //   const ac = new AbortController();

  //   const i = setInterval(() => et.dispatchEvent(new Event("foo")), 10);

  //   async function foo() {
  //     for await (const f of on(et, "foo", { signal: ac.signal })) {
  //       assert(f);
  //     }
  //   }

  //   foo()
  //     .catch(
  //       common.mustCall(error => {
  //         assert.strictEqual(error.name, "AbortError");
  //       }),
  //     )
  //     .finally(() => {
  //       clearInterval(i);
  //     });

  //   process.nextTick(() => ac.abort());
  // }

  // async function eventTargetAbortableOnAfter2() {
  //   const et = new EventTarget();
  //   const ac = new AbortController();

  //   const i = setInterval(() => et.dispatchEvent(new Event("foo")), 10);

  //   async function foo() {
  //     for await (const f of on(et, "foo", { signal: ac.signal })) {
  //       assert(f);
  //       // Cancel after a single event has been triggered.
  //       ac.abort();
  //     }
  //   }

  //   foo()
  //     .catch(
  //       common.mustCall(error => {
  //         assert.strictEqual(error.name, "AbortError");
  //       }),
  //     )
  //     .finally(() => {
  //       clearInterval(i);
  //     });
  // }
});

describe("node:events.once()", () => {
  it("should resolve with the first event", async () => {
    const ee = new EventEmitter();

    setImmediate(() => {
      ee.emit("myevent", 42);
    });

    const [value] = await once(ee, "myevent");
    assert.strictEqual(value, 42);
    assert.strictEqual(ee.listenerCount("error"), 0);
    assert.strictEqual(ee.listenerCount("myevent"), 0);
  });

  it("should allow passing `null` for `options` arg", async () => {
    const ee = new EventEmitter();

    setImmediate(() => {
      ee.emit("myevent", 42);
    });

    // @ts-ignore
    const [value] = await once(ee, "myevent", null);
    assert.strictEqual(value, 42);
  });

  it("should return two args when two args are emitted", async () => {
    const ee = new EventEmitter();

    setImmediate(() => {
      ee.emit("myevent", 42, 24);
    });

    const value = await once(ee, "myevent");
    assert.deepStrictEqual(value, [42, 24]);
  });

  it("should throw an error when an error is emitted", async () => {
    const ee = new EventEmitter();

    const expected = new Error("kaboom");
    setImmediate(() => {
      ee.emit("error", expected);
    });

    let err;
    try {
      await once(ee, "myevent");
    } catch (_e) {
      err = _e;
    }

    assert.strictEqual(err, expected);
    assert.strictEqual(ee.listenerCount("error"), 0);
    assert.strictEqual(ee.listenerCount("myevent"), 0);
  });

  it("should throw an error when an error is emitted when `AbortSignal` is attached", async () => {
    const ee = new EventEmitter();
    const ac = new AbortController();
    const signal = ac.signal;

    const expected = new Error("boom");
    let err;
    setImmediate(() => {
      ee.emit("error", expected);
    });

    const promise = once(ee, "myevent", { signal });
    strictEqual(ee.listenerCount("error"), 1);

    // TODO: Uncomment when getEventListeners is working properly
    // strictEqual(getEventListeners(signal, "abort").length, 1);

    try {
      await promise;
    } catch (e) {
      err = e;
    }

    strictEqual(err, expected);
    strictEqual(ee.listenerCount("error"), 0);
    strictEqual(ee.listenerCount("myevent"), 0);
    // strictEqual(getEventListeners(signal, "abort").length, 0);
  });

  it("should stop listening if we throw an error", async () => {
    const ee = new EventEmitter();

    const expected = new Error("kaboom");
    let err;

    setImmediate(() => {
      ee.emit("error", expected);
      ee.emit("myevent", 42, 24);
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

  it("should return error instead of throwing if event is error", async () => {
    const ee = new EventEmitter();

    const expected = new Error("kaboom");
    setImmediate(() => {
      ee.emit("error", expected);
    });

    const promise = once(ee, "error");
    strictEqual(ee.listenerCount("error"), 1);
    const [err] = await promise;
    strictEqual(err, expected);
    strictEqual(ee.listenerCount("error"), 0);
    strictEqual(ee.listenerCount("myevent"), 0);
  });

  it("should throw on invalid signal option", async done => {
    const ee = new EventEmitter();
    ee.on("error", err => {
      done(new Error("should not be called", { cause: err }));
    });
    let iters = 0;
    for (const signal of [1, {}, "hi", null, false]) {
      let threw = false;
      try {
        await once(ee, "foo", { signal });
      } catch (e) {
        threw = true;
        expect(e).toBeInstanceOf(TypeError);
      }
      expect(threw).toBe(true);
      iters++;
    }
    expect(iters).toBe(5);
    done();
  });

  it("should throw `AbortError` when signal is already aborted", async done => {
    const ee = new EventEmitter();
    ee.on("error", err => done(new Error("should not be called", { cause: err })));
    const abortedSignal = AbortSignal.abort();

    expect(() => on(ee, "foo", { signal: abortedSignal })).toThrow(/aborted/);

    // let threw = false;
    // try {
    //   await once(ee, "foo", { signal: abortedSignal });
    // } catch (e) {
    //   threw = true;
    //   expect(e).toBeInstanceOf(Error);
    //   expect((e as Error).name).toBe("AbortError");
    // }

    // expect(threw).toBe(true);
    done();
  });

  it("should throw `AbortError` when signal is aborted before event is emitted", async done => {
    const ee = new EventEmitter();
    ee.on("error", err => done(new Error("should not be called", { cause: err })));
    const ac = new AbortController();
    const signal = ac.signal;

    const promise = once(ee, "foo", { signal });
    ac.abort();

    let threw = false;
    try {
      await promise;
    } catch (e) {
      threw = true;
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe("AbortError");
    }

    expect(threw).toBe(true);
    done();
  });

  it("should not throw `AbortError` when signal is aborted after event is emitted", async () => {
    const ee = new EventEmitter();
    const ac = new AbortController();
    const signal = ac.signal;

    setImmediate(() => {
      ee.emit("foo");
      ac.abort();
    });

    const promise = once(ee, "foo", { signal });
    // TODO: Uncomment when getEventListeners is working properly
    // strictEqual(getEventListeners(signal, "abort").length, 1);

    await promise;
    expect(true).toBeTruthy();
    // strictEqual(getEventListeners(signal, "abort").length, 0);
  });

  it("should remove listeners when signal is aborted", async () => {
    const ee = new EventEmitter();
    const ac = new AbortController();

    const promise = once(ee, "foo", { signal: ac.signal });
    strictEqual(ee.listenerCount("foo"), 1);
    strictEqual(ee.listenerCount("error"), 1);

    setImmediate(() => {
      ac.abort();
    });

    try {
      await promise;
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as Error).name).toBe("AbortError");

      strictEqual(ee.listenerCount("foo"), 0);
      strictEqual(ee.listenerCount("error"), 0);
    }
  });

  // TODO: Uncomment event target tests once we have EventTarget support for once()

  // async function onceWithEventTarget() {
  //   const et = new EventTarget();
  //   const event = new Event("myevent");
  //   process.nextTick(() => {
  //     et.dispatchEvent(event);
  //   });
  //   const [value] = await once(et, "myevent");
  //   strictEqual(value, event);
  // }

  // async function onceWithEventTargetError() {
  //   const et = new EventTarget();
  //   const error = new Event("error");
  //   process.nextTick(() => {
  //     et.dispatchEvent(error);
  //   });

  //   const [err] = await once(et, "error");
  //   strictEqual(err, error);
  // }

  // async function eventTargetAbortSignalBefore() {
  //   const et = new EventTarget();
  //   const abortedSignal = AbortSignal.abort();

  //   await Promise.all(
  //     [1, {}, "hi", null, false].map(signal => {
  //       return rejects(once(et, "foo", { signal }), {
  //         code: "ERR_INVALID_ARG_TYPE",
  //       });
  //     }),
  //   );

  //   return rejects(once(et, "foo", { signal: abortedSignal }), {
  //     name: "AbortError",
  //   });
  // }

  // async function eventTargetAbortSignalAfter() {
  //   const et = new EventTarget();
  //   const ac = new AbortController();
  //   const r = rejects(once(et, "foo", { signal: ac.signal }), {
  //     name: "AbortError",
  //   });
  //   process.nextTick(() => ac.abort());
  //   return r;
  // }

  // async function eventTargetAbortSignalAfterEvent() {
  //   const et = new EventTarget();
  //   const ac = new AbortController();
  //   process.nextTick(() => {
  //     et.dispatchEvent(new Event("foo"));
  //     ac.abort();
  //   });
  //   await once(et, "foo", { signal: ac.signal });
  // }
});
