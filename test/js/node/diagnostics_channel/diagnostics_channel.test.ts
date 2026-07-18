import { gc } from "bun";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { AsyncLocalStorage } from "node:async_hooks";
import dc, { channel, Channel, hasSubscribers, subscribe, tracingChannel, unsubscribe } from "node:diagnostics_channel";

describe("Channel", () => {
  // test-diagnostics-channel-has-subscribers.js
  test("can have subscribers", () => {
    const name = "channel1";
    const dc = channel(name);
    expect(hasSubscribers(name)).toBeFalse();

    dc.subscribe(() => {});
    expect(hasSubscribers(name)).toBeTrue();

    checkCalls();
  });

  // test-diagnostics-channel-symbol-named.js
  test("can have symbol as name", () => {
    const input = {
      foo: "bar",
    };

    const symbol = Symbol("channel2");

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(symbol);

    // Expect two successful publishes later
    dc.subscribe(
      mustCall((message, name) => {
        expect(name).toBe(symbol);
        expect(message).toStrictEqual(input);
      }),
    );

    dc.publish(input);

    expect(() => {
      // @ts-expect-error
      channel(null);
    }).toThrow(/"channel" argument must be of type string or symbol/);

    checkCalls();
  });

  // test-diagnostics-channel-sync-unsubscribe.js
  test("does not throw when unsubscribed", () => {
    const name = "channel3";
    const data = "some message";

    const onMessageHandler: any = mustCall(() => unsubscribe(name, onMessageHandler));

    subscribe(name, onMessageHandler);

    // This must not throw.
    channel(name).publish(data);

    checkCalls();
  });

  // test-diagnostics-channel-pub-sub.js
  test("can publish and subscribe", () => {
    const name = "channel4";
    const input = {
      foo: "bar",
    };

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(name);
    expect(dc).toBeInstanceOf(Channel);

    // No subscribers yet, should not publish
    expect(dc.hasSubscribers).toBeFalse();

    const subscriber = mustCall((message, name) => {
      expect(name).toBe(dc.name);
      expect(message).toStrictEqual(input);
    });

    // Now there's a subscriber, should publish
    subscribe(name, subscriber);
    expect(dc.hasSubscribers).toBeTrue();

    // The ActiveChannel prototype swap should not fail instanceof
    expect(dc).toBeInstanceOf(Channel);

    // Should trigger the subscriber once
    dc.publish(input);

    // Should not publish after subscriber is unsubscribed
    expect(unsubscribe(name, subscriber)).toBeTrue();
    expect(dc.hasSubscribers).toBeFalse();

    // unsubscribe() should return false when subscriber is not found
    expect(unsubscribe(name, subscriber)).toBeFalse();

    expect(() => {
      // @ts-expect-error
      subscribe(name, null);
    }).toThrow(/"subscription" argument must be of type/);

    // Reaching zero subscribers should not delete from the channels map as there
    // will be no more weakref to incRef if another subscribe happens while the
    // channel object itself exists.
    dc.subscribe(subscriber);
    dc.unsubscribe(subscriber);
    dc.subscribe(subscriber);

    checkCalls();
  });

  // test-diagnostics-channel-object-channel-pub-sub.js
  test("can publish and subscribe using object", () => {
    const name = "channel5";
    const input = {
      foo: "bar",
    };

    // Should not have named channel
    expect(hasSubscribers(name)).toBeFalse();

    // Individual channel objects can be created to avoid future lookups
    const dc = channel(name);
    expect(dc).toBeInstanceOf(Channel);
    expect(channel(name)).toBe(dc); // intentional object equality check

    // No subscribers yet, should not publish
    expect(dc.hasSubscribers).toBeFalse();

    const subscriber = mustCall((message, name) => {
      expect(name).toBe(dc.name);
      expect(message).toStrictEqual(input);
    });

    // Now there's a subscriber, should publish
    dc.subscribe(subscriber);
    expect(dc.hasSubscribers).toBeTrue();

    // The ActiveChannel prototype swap should not fail instanceof
    expect(dc).toBeInstanceOf(Channel);

    // Should trigger the subscriber once
    dc.publish(input);

    // Should not publish after subscriber is unsubscribed
    expect(dc.unsubscribe(subscriber)).toBeTrue();
    expect(dc.hasSubscribers).toBeFalse();

    // unsubscribe() should return false when subscriber is not found
    expect(dc.unsubscribe(subscriber)).toBeFalse();

    expect(() => {
      // @ts-expect-error
      subscribe(null);
    }).toThrow(/"channel" argument must be of type/);

    checkCalls();
  });

  // test-diagnostics-channel-safe-subscriber-errors.js
  // TODO: Needs support for 'uncaughtException' event
  test.todo("can handle subscriber errors", () => {
    const input = {
      foo: "bar",
    };
    const dc = channel("channel6");
    const error = new Error("This error should have been caught!");

    process.on(
      "uncaughtException",
      mustCall(err => {
        expect(err).toStrictEqual(error);
      }),
    );

    dc.subscribe(
      mustCall(() => {
        throw error;
      }),
    );

    // The failing subscriber should not stop subsequent subscribers from running
    dc.subscribe(mustCall(() => {}));

    // Publish should continue without throwing
    const fn = mustCall(() => {});
    dc.publish(input);
    fn();

    checkCalls();
  });

  // test-diagnostics-channel-bind-store.js
  // TODO: Needs support for 'uncaughtException' event
  test.todo("can use bind store", () => {
    let n = 0;
    const name = "channel7";
    const thisArg = new Date();
    const inputs = [{ foo: "bar" }, { baz: "buz" }];

    const dc = channel(name);

    // Bind a storage directly to published data
    const store1 = new AsyncLocalStorage();
    dc.bindStore(store1);
    let store1bound = true;

    // Bind a store with transformation of published data
    const store2 = new AsyncLocalStorage();
    dc.bindStore(
      store2,
      mustCall(data => {
        expect(data).toStrictEqual(inputs[n]);
        return { data };
      }, 4),
    );

    // Regular subscribers should see publishes from runStores calls
    dc.subscribe(
      mustCall(data => {
        if (store1bound) {
          expect(data).toStrictEqual(store1.getStore());
        }
        expect({ data }).toStrictEqual(store2.getStore());
        expect(data).toStrictEqual(inputs[n]);
      }, 4),
    );

    // Verify stores are empty before run
    expect(store1.getStore()).toBeUndefined();
    expect(store2.getStore()).toBeUndefined();

    dc.runStores(
      inputs[n],
      mustCall(function (a, b) {
        // Verify this and argument forwarding
        expect(this).toBe(thisArg);
        expect(a).toBe(1);
        expect(b).toBe(2);

        // Verify store 1 state matches input
        expect(store1.getStore()).toStrictEqual(inputs[n]);

        // Verify store 2 state has expected transformation
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });

        // Should support nested contexts
        n++;
        dc.runStores(
          inputs[n],
          mustCall(function () {
            // Verify this and argument forwarding
            expect(this).toBeUndefined();

            // Verify store 1 state matches input
            expect(store1.getStore()).toStrictEqual(inputs[n]);

            // Verify store 2 state has expected transformation
            expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
          }),
        );
        n--;

        // Verify store 1 state matches input
        expect(store1.getStore()).toStrictEqual(inputs[n]);

        // Verify store 2 state has expected transformation
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
      }),
      thisArg,
      1,
      2,
    );

    // Verify stores are empty after run
    expect(store1.getStore()).toBeUndefined();
    expect(store2.getStore()).toBeUndefined();

    // Verify unbinding works
    expect(dc.unbindStore(store1)).toBeTrue();
    store1bound = false;

    // Verify unbinding a store that is not bound returns false
    expect(dc.unbindStore(store1)).toBeFalse();

    n++;
    dc.runStores(
      inputs[n],
      mustCall(() => {
        // Verify after unbinding store 1 will remain undefined
        expect(store1.getStore()).toBeUndefined();

        // Verify still bound store 2 receives expected data
        expect(store2.getStore()).toStrictEqual({ data: inputs[n] });
      }),
    );

    // Contain transformer errors and emit on next tick
    const fail = new Error("fail");
    dc.bindStore(store1, () => {
      throw fail;
    });

    let calledRunStores = false;
    process.once(
      "uncaughtException",
      mustCall(err => {
        expect(calledRunStores).toBeTrue();
        expect(err).toStrictEqual(fail);
      }),
    );

    dc.runStores(
      inputs[n],
      mustCall(() => {}),
    );
    calledRunStores = true;

    checkCalls();
  });

  // test-diagnostics-channel-memory-leak.js
  test("references are not leaked", () => {
    function noop() {}

    const heapUsedBefore = process.memoryUsage().heapUsed;
    for (let i = 0; i < 1000; i++) {
      const name = `channel7-${i}`;
      subscribe(name, noop);
      unsubscribe(name, noop);
    }

    gc(true);
    const heapUsedAfter = process.memoryUsage().heapUsed;

    expect(heapUsedBefore).toBeGreaterThanOrEqual(heapUsedAfter);
  });
});

describe("Channel.prototype.withStoreScope", () => {
  test("is a function on both inactive and active channels", () => {
    const ch = channel("withStoreScope-shape");
    expect(typeof ch.withStoreScope).toBe("function");

    const disposable = ch.withStoreScope({});
    expect(typeof disposable[Symbol.dispose]).toBe("function");
    disposable[Symbol.dispose]();

    ch.subscribe(() => {});
    expect(typeof ch.withStoreScope).toBe("function");
  });

  test("enters bound stores for the duration of the scope", () => {
    const ch = channel("withStoreScope-stores");
    const store = new AsyncLocalStorage();
    const data = { hello: "world" };
    let published: unknown;

    ch.bindStore(store, d => ({ wrapped: d }));
    ch.subscribe(msg => {
      published = msg;
    });

    expect(store.getStore()).toBeUndefined();
    {
      using scope = ch.withStoreScope(data);
      void scope;
      expect(store.getStore()).toEqual({ wrapped: data });
      expect(published).toBe(data);
    }
    expect(store.getStore()).toBeUndefined();
  });
});

describe("BoundedChannel", () => {
  test("boundedChannel and BoundedChannel are exported", () => {
    expect(typeof dc.boundedChannel).toBe("function");
    expect(typeof dc.BoundedChannel).toBe("function");
    expect(dc.boundedChannel("bc-export")).toBeInstanceOf(dc.BoundedChannel);
  });

  test("creates start/end channels from a name", () => {
    const bc = dc.boundedChannel("bc-basic");

    expect(bc.start.name).toBe("tracing:bc-basic:start");
    expect(bc.end.name).toBe("tracing:bc-basic:end");
    expect(bc.hasSubscribers).toBeFalse();
    expect(typeof bc.subscribe).toBe("function");
    expect(typeof bc.unsubscribe).toBe("function");
    expect(typeof bc.run).toBe("function");
    expect(typeof bc.withScope).toBe("function");
  });

  test("start/end are non-enumerable own properties", () => {
    const bc = dc.boundedChannel("bc-shape");
    expect(Object.keys(bc)).toEqual([]);
    expect(Object.getOwnPropertyDescriptor(bc, "start")).toMatchObject({
      enumerable: false,
      configurable: false,
      writable: false,
    });
  });

  test("accepts explicit channel objects", () => {
    const start = channel("bc-custom:start");
    const end = channel("bc-custom:end");
    const bc = dc.boundedChannel({ start, end });

    expect(bc.start).toBe(start);
    expect(bc.end).toBe(end);
  });

  test("subscribe/unsubscribe wires start and end handlers", () => {
    const bc = dc.boundedChannel("bc-subscribe");
    const events: Array<{ type: string; message: unknown }> = [];

    const handlers = {
      start(message: unknown) {
        events.push({ type: "start", message });
      },
      end(message: unknown) {
        events.push({ type: "end", message });
      },
    };

    expect(bc.hasSubscribers).toBeFalse();
    bc.subscribe(handlers);
    expect(bc.hasSubscribers).toBeTrue();

    bc.start.publish({ v: 1 });
    bc.end.publish({ v: 2 });

    expect(events).toEqual([
      { type: "start", message: { v: 1 } },
      { type: "end", message: { v: 2 } },
    ]);

    expect(bc.unsubscribe(handlers)).toBeTrue();
    expect(bc.hasSubscribers).toBeFalse();
    expect(bc.unsubscribe(handlers)).toBeFalse();
  });

  test("run publishes start, invokes fn, then publishes end", () => {
    const bc = dc.boundedChannel("bc-run");
    const events: string[] = [];
    bc.subscribe({
      start: () => events.push("start"),
      end: () => events.push("end"),
    });

    const thisArg = { tag: "this" } as const;
    const result = bc.run(
      { ctx: true },
      function (this: unknown, a: number, b: number) {
        events.push("fn");
        expect(this).toBe(thisArg);
        return a + b;
      },
      thisArg,
      2,
      3,
    );

    expect(result).toBe(5);
    expect(events).toEqual(["start", "fn", "end"]);
  });

  test("run still publishes end and restores stores when fn throws", () => {
    const bc = dc.boundedChannel("bc-run-throw");
    const store = new AsyncLocalStorage();
    const events: string[] = [];

    bc.start.bindStore(store);
    bc.subscribe({
      start: () => events.push("start"),
      end: () => events.push("end"),
    });

    const boom = new Error("boom");
    expect(store.getStore()).toBeUndefined();
    expect(() =>
      bc.run({ ctx: true }, () => {
        events.push("fn");
        expect(store.getStore()).toEqual({ ctx: true });
        throw boom;
      }),
    ).toThrow(boom);

    expect(events).toEqual(["start", "fn", "end"]);
    expect(store.getStore()).toBeUndefined();
  });

  test("withScope is a no-op disposable when there are no subscribers", () => {
    const bc = dc.boundedChannel("bc-noop");
    const scope = bc.withScope({});
    expect(typeof scope[Symbol.dispose]).toBe("function");
    scope[Symbol.dispose]();
  });
});

describe("TracingChannel", () => {
  // Port tests from:
  // https://github.com/search?q=repo%3Anodejs%2Fnode+test-diagnostics-channel+AND+%2Ftracing%2F&type=code
  test.todo("TODO");

  test("has no own enumerable properties", () => {
    const tc = tracingChannel("tc-shape");
    expect(Object.keys(tc)).toEqual([]);
    expect({ ...tc }).toEqual({});
  });

  test("exposes start/end/asyncStart/asyncEnd as prototype accessors", () => {
    const tc = tracingChannel("tc-accessors");
    const proto = Object.getPrototypeOf(tc);

    for (const name of ["start", "end", "asyncStart", "asyncEnd"] as const) {
      expect(Object.getOwnPropertyDescriptor(tc, name)).toBeUndefined();
      const desc = Object.getOwnPropertyDescriptor(proto, name);
      expect(desc?.get).toBeFunction();
    }

    expect(Object.getOwnPropertyDescriptor(tc, "error")).toMatchObject({
      enumerable: false,
    });

    expect(tc.start.name).toBe("tracing:tc-accessors:start");
    expect(tc.end.name).toBe("tracing:tc-accessors:end");
    expect(tc.asyncStart.name).toBe("tracing:tc-accessors:asyncStart");
    expect(tc.asyncEnd.name).toBe("tracing:tc-accessors:asyncEnd");
    expect(tc.error.name).toBe("tracing:tc-accessors:error");
  });

  test.each(["start", "end", "asyncStart", "asyncEnd", "error"] as const)(
    "hasSubscribers reflects a subscriber on %s",
    name => {
      const tc = tracingChannel(`tc-hassubs-${name}`);
      expect(tc.hasSubscribers).toBeFalse();

      const sub = () => {};
      tc[name].subscribe(sub);
      expect(tc.hasSubscribers).toBeTrue();
      expect(tc[name].unsubscribe(sub)).toBeTrue();
      expect(tc.hasSubscribers).toBeFalse();
    },
  );

  test("constructed from explicit channel objects", () => {
    const chans = {
      start: channel("tc-obj:start"),
      end: channel("tc-obj:end"),
      asyncStart: channel("tc-obj:asyncStart"),
      asyncEnd: channel("tc-obj:asyncEnd"),
      error: channel("tc-obj:error"),
    };
    const tc = tracingChannel(chans);

    expect(tc.start).toBe(chans.start);
    expect(tc.end).toBe(chans.end);
    expect(tc.asyncStart).toBe(chans.asyncStart);
    expect(tc.asyncEnd).toBe(chans.asyncEnd);
    expect(tc.error).toBe(chans.error);
    expect(Object.keys(tc)).toEqual([]);
  });
});

const mocks = new Map();

function mustCall<T>(fn: (...args: any[]) => T, expected?: number) {
  const instance = mock(fn);
  mocks.set(instance, expected ?? 1);
  return instance;
}

function mustNotCall<T>(fn: (...args: any[]) => T) {
  return mustCall(fn, 0);
}

// FIXME: remove this and use `afterEach` instead
// Currently, `bun test` disallows `expect()` in `afterEach`
function checkCalls() {
  for (const [mock, expected] of mocks.entries()) {
    expect(mock).toHaveBeenCalledTimes(expected);
  }
  mocks.clear();
}

beforeEach(() => {
  mocks.clear();
});
