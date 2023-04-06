import { EventEmitter, on } from "node:events";
import { createTest } from "node-harness";

const { beforeAll, expect, assert, describe, it, createCallCheckCtx, createDoneDotAll } = createTest(import.meta.path);
// const NodeEventTarget = globalThis.EventTarget;

describe("node:events.on (EventEmitter AsyncIterator)", () => {
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
