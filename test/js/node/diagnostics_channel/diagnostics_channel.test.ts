import { $, gc, SQL } from "bun";
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel, Channel, hasSubscribers, subscribe, tracingChannel, unsubscribe } from "node:diagnostics_channel";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { types } from "node:util";
import vm from "node:vm";

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
    expect(dc.hasSubscribers).toBeFalse();
    expect(hasSubscribers(name)).toBeFalse();

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
    const store2 = new AsyncLocalStorage<{ data: any }>();
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
        expect({ data }).toStrictEqual(store2.getStore()!);
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
  //
  // Node's version compares process.memoryUsage().heapUsed before the loop with
  // the value after a collection. In Bun, heapUsed is the size measured by the
  // most recent collection, so the first read dates from some earlier point in
  // this file and the two numbers are not comparable. The entries the module
  // keeps per channel also go away in FinalizationRegistry callbacks, after the
  // collection. So check what the node test is after directly: once
  // unsubscribed, nothing holds the channels.
  test("subscribe() with no function leaves the channel as it was", () => {
    type Internals = Channel & { _subscribers?: unknown[]; _stores?: unknown };
    const state = (dc: Internals) => ({
      hasSubscribers: dc.hasSubscribers,
      moduleHasSubscribers: hasSubscribers(dc.name),
      isInactive: Object.getPrototypeOf(dc) === Channel.prototype,
      _subscribers: dc._subscribers,
      _stores: dc._stores,
    });
    const inactive = {
      hasSubscribers: false,
      moduleHasSubscribers: false,
      isInactive: true,
      _subscribers: undefined,
      _stores: undefined,
    };
    const entryPoints: Record<string, (name: string, subscription: any) => void> = {
      "channel.subscribe()": (name, subscription) => channel(name).subscribe(subscription),
      "subscribe()": (name, subscription) => subscribe(name, subscription),
      "tracingChannel.subscribe()": (name, subscription) => {
        const others = ["end", "asyncStart", "asyncEnd", "error"].map(event => channel(`${name}:${event}`));
        tracingChannel({
          start: channel(name),
          end: others[0],
          asyncStart: others[1],
          asyncEnd: others[2],
          error: others[3],
        }).subscribe({ start: subscription });
      },
    };

    for (const [entryPoint, subscribeTo] of Object.entries(entryPoints)) {
      for (const [kind, subscription] of Object.entries({ number: 5, string: "fn", object: {}, symbol: Symbol() })) {
        const name = `no-function:${entryPoint}:${kind}`;
        const dc = channel(name) as Internals;
        expect(() => subscribeTo(name, subscription)).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", name: "TypeError" }),
        );
        expect(state(dc)).toEqual(inactive);

        // The channel still works: it becomes active with a function and inactive without it.
        const subscriber = mock();
        dc.subscribe(subscriber);
        dc.publish(kind);
        expect(subscriber.mock.calls).toEqual([[kind, name]]);
        dc.unsubscribe(subscriber);
        expect(state(dc)).toEqual(inactive);
      }
    }

    // A TracingChannel subscribes the events in order and does not undo the ones before the one that throws.
    const tc = tracingChannel("no-function:tracing");
    const start = () => {};
    expect(() => tc.subscribe({ start, end: 7 as any, asyncStart: () => {} })).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }),
    );
    expect([tc.start.hasSubscribers, tc.end.hasSubscribers, tc.asyncStart.hasSubscribers]).toEqual([
      true,
      false,
      false,
    ]);
    tc.start.unsubscribe(start);

    // A channel that has a subscriber keeps it.
    const active = channel("no-function:active") as Internals;
    const subscriber = mock();
    active.subscribe(subscriber);
    expect(() => active.subscribe(5 as any)).toThrow(expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE" }));
    expect(active._subscribers).toEqual([subscriber]);
    active.publish("message");
    expect(subscriber.mock.calls).toEqual([["message", "no-function:active"]]);
    active.unsubscribe(subscriber);
  });

  test("publish() calls the subscribers there were when it started", () => {
    const dc = channel("changed-during-publish");
    const calls: string[] = [];
    const once = () => {
      calls.push("once");
      dc.unsubscribe(once);
    };
    const second = () => calls.push("second");
    const adds = () => {
      calls.push("adds");
      dc.subscribe(added);
    };
    const added = () => calls.push("added");
    dc.subscribe(once);
    dc.subscribe(second);
    dc.subscribe(adds);

    dc.publish(undefined);
    expect(calls).toEqual(["once", "second", "adds"]);
    dc.unsubscribe(adds);
    calls.length = 0;
    dc.publish(undefined);
    expect(calls).toEqual(["second", "added"]);
  });

  test("unsubscribe() does not modify the array in _subscribers", () => {
    const dc = channel("frozen-subscribers") as Channel & { _subscribers: Function[] };
    const first = () => {};
    const second = () => {};
    dc.subscribe(first);
    dc.subscribe(second);
    const frozen = Object.freeze([first, second]) as Function[];
    dc._subscribers = frozen;
    expect(dc.unsubscribe(first)).toBe(true);
    expect(dc._subscribers).toEqual([second]);
    expect(frozen).toEqual([first, second]);
  });

  test("unsubscribe() from a list too long to pass as arguments", () => {
    const dc = channel("many-subscribers") as Channel & { _subscribers: Function[] };
    const first = () => {};
    const other = () => {};
    dc.subscribe(first);
    dc._subscribers = [first, ...new Array(1_000_000).fill(other)];
    expect(dc.unsubscribe(first)).toBe(true);
    expect(dc._subscribers.length).toBe(1_000_000);
  });

  test("subscribe() after _subscribers was replaced", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { channel } = require("node:diagnostics_channel");
          const values = {
            number: 5, string: "abc", boolean: true, object: {}, null: null, undefined: undefined,
            symbol: Symbol("s"), bigint: 1n, frozen: Object.freeze([]),
            speciesObject: Object.assign([() => {}], { constructor: { [Symbol.species]: function () { return {}; } } }),
          };
          const outcome = {};
          for (const [name, value] of Object.entries(values)) {
            const dc = channel("replaced-" + name);
            dc.subscribe(() => {});
            dc._subscribers = value;
            try {
              dc.subscribe(() => {});
              outcome[name] = name === "speciesObject" ? "length " + dc._subscribers.length : "returned";
            } catch (e) {
              outcome[name] = e.constructor.name;
            }
          }
          console.log(JSON.stringify(outcome));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ outcome: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      outcome: {
        number: "returned",
        string: "returned",
        boolean: "returned",
        object: "returned",
        null: "TypeError",
        undefined: "TypeError",
        symbol: "returned",
        bigint: "returned",
        frozen: "returned",
        speciesObject: "length 2",
      },
      stderr: "",
      exitCode: 0,
    });
  });

  test("references are not leaked", () => {
    function noop() {}

    const refs: WeakRef<Channel>[] = [];
    for (let i = 0; i < 1000; i++) {
      const name = `channel7-${i}`;
      const dc = channel(name);
      subscribe(name, noop);
      unsubscribe(name, noop);
      refs.push(new WeakRef(dc));
    }

    // Bun.gc() clears the WeakRef targets this job kept alive before it collects.
    gc(true);

    // Conservative stack scanning can keep the last few channels the loop
    // touched alive, so this checks that the channels are collectable rather
    // than that every one of them was collected. A retained reference keeps
    // all 1000 alive.
    const alive = refs.filter(ref => ref.deref() !== undefined).length;
    expect(alive).toBeLessThan(refs.length / 10);
  });
});

// Node's own tests of TracingChannel are test/js/node/test/parallel/test-diagnostics-channel-tracing-channel-*.js.
describe("TracingChannel", () => {
  const events = ["start", "end", "asyncStart", "asyncEnd", "error"] as const;
  const methods = ["traceSync", "tracePromise", "traceCallback"] as const;
  type Event = (typeof events)[number];
  type Tracing = ReturnType<typeof tracingChannel<any, any>>;
  type AnyChannel = Tracing[Event];

  // A channel lives as long as the process, so each test takes its subscribers and its stores off again.
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    for (const cleanup of cleanups.splice(0)) cleanup();
  });

  function on(channel: AnyChannel, subscriber: (message: any, name: string | symbol) => void) {
    channel.subscribe(subscriber);
    cleanups.push(() => channel.unsubscribe(subscriber));
  }

  function bind(channel: AnyChannel, store: AsyncLocalStorage<any>, transform?: (message: any) => any) {
    channel.bindStore(store, transform);
    cleanups.push(() => channel.unbindStore(store));
  }

  /** Subscribes to the given channels, to all five if none is given. Each event adds its name to the list. */
  function record(tc: Tracing, log: string[] = [], which: readonly Event[] = events) {
    for (const event of which) on(tc[event], () => log.push(event));
    return log;
  }

  test("hasSubscribers is true while one of the five channels has a subscriber or a store", () => {
    const tc = tracingChannel("tc-has-subscribers");
    const seen: Record<string, unknown[]> = {};
    for (const event of events) {
      const subscriber = () => {};
      const store = new AsyncLocalStorage<any>();
      const before = tc.hasSubscribers;
      tc[event].subscribe(subscriber);
      const subscribed = tc.hasSubscribers;
      tc[event].unsubscribe(subscriber);
      const unsubscribed = tc.hasSubscribers;
      tc[event].bindStore(store);
      const bound = tc.hasSubscribers;
      tc[event].unbindStore(store);
      seen[event] = [before, subscribed, unsubscribed, bound, tc.hasSubscribers];
    }
    const expected = [false, true, false, true, false];
    expect(seen).toEqual({
      start: expected,
      end: expected,
      asyncStart: expected,
      asyncEnd: expected,
      error: expected,
    });
  });

  test("with no subscriber the trace methods only call the function", () => {
    const tc = tracingChannel("tc-untraced");
    const calls: unknown[][] = [];
    function fn(this: unknown, ...args: any[]): any {
      calls.push([this, ...args]);
      return args[0];
    }
    const thisArg = { thisArg: true };
    const context = {};

    const value = { value: true };
    expect(tc.traceSync(fn, context, thisArg, value)).toBe(value);

    // tracePromise hands back what the function returned and does not call then() on it.
    class Subclass extends Promise<number> {}
    const then = mock();
    const results = { native: Promise.resolve(1), subclass: Subclass.resolve(1), thenable: { then } };
    for (const result of Object.values(results)) {
      expect(tc.tracePromise(fn, context, thisArg, result)).toBe(result);
    }
    expect(then).not.toHaveBeenCalled();

    // traceCallback does not wrap the callback, and does not require one.
    const callback = () => {};
    expect(tc.traceCallback(fn, 0, context, thisArg, callback)).toBe(callback);
    expect(tc.traceCallback(fn, -1, context, thisArg, "no function")).toBe("no function");

    // No context is written to, so null is as good as an object.
    expect(context).toEqual({});
    expect(tc.traceSync(fn, null as any, thisArg, value)).toBe(value);
    expect(tc.traceCallback(fn, 0, null as any, thisArg, callback)).toBe(callback);

    expect(calls).toEqual([
      [thisArg, value],
      [thisArg, results.native],
      [thisArg, results.subclass],
      [thisArg, results.thenable],
      [thisArg, callback],
      [thisArg, "no function"],
      [thisArg, value],
      [thisArg, callback],
    ]);
  });

  test("a subscriber added while the function runs gets no event of that call", async () => {
    const sync = tracingChannel("tc-late-sync");
    const syncLog: string[] = [];
    sync.traceSync(() => void record(sync, syncLog));

    const promise = tracingChannel("tc-late-promise");
    const promiseLog: string[] = [];
    await promise.tracePromise(() => {
      record(promise, promiseLog);
      return Promise.resolve(1);
    });

    const callback = tracingChannel("tc-late-callback");
    const callbackLog: string[] = [];
    const { promise: called, resolve } = Promise.withResolvers<unknown>();
    callback.traceCallback(
      (cb: (error: null, value: number) => void) => {
        record(callback, callbackLog);
        setImmediate(cb, null, 1);
      },
      0,
      undefined,
      undefined,
      resolve,
    );
    await called;

    expect({ syncLog, promiseLog, callbackLog }).toEqual({ syncLog: [], promiseLog: [], callbackLog: [] });
  });

  // Node.js publishes "end" only if start or end had a subscriber when the call began, and "asyncEnd" only if
  // asyncStart or asyncEnd had one when the continuation began. A subscriber of another channel makes the call traced.
  test.each(methods)("%s publishes end and asyncEnd to a window that had a subscriber when it opened", async method => {
    type Row = {
      before: Event[];
      inFunction?: Event[];
      inCallback?: Event[];
      published: string | Record<string, string>;
    };
    const rows: Row[] = [
      { before: ["end"], published: "end" },
      { before: ["start"], inFunction: ["end"], published: "start end" },
      { before: ["error"], inFunction: ["end"], published: "" },
      { before: ["asyncEnd"], published: { traceSync: "", tracePromise: "asyncEnd", traceCallback: "asyncEnd" } },
      {
        before: ["start", "asyncEnd", "error"],
        published: { traceSync: "start", tracePromise: "start asyncEnd", traceCallback: "start asyncEnd" },
      },
      {
        before: ["asyncStart"],
        inFunction: ["asyncEnd"],
        published: { traceSync: "", tracePromise: "asyncStart asyncEnd", traceCallback: "asyncStart asyncEnd" },
      },
      // Only traceCallback has a callback to subscribe in: the continuation has begun by then.
      { before: ["start"], inCallback: ["asyncEnd"], published: { traceCallback: "start" } },
      { before: ["asyncStart"], inCallback: ["asyncEnd"], published: { traceCallback: "asyncStart asyncEnd" } },
    ];

    const seen: unknown[] = [];
    const expected: unknown[] = [];
    for (const [index, row] of rows.entries()) {
      const published = typeof row.published === "string" ? row.published : row.published[method];
      if (published === undefined) continue;
      const tc = tracingChannel(`tc-window-${method}-${index}`);
      const log = record(tc, [], row.before);
      const inFunction = () => void record(tc, log, row.inFunction ?? []);
      const inCallback = () => void record(tc, log, row.inCallback ?? []);
      if (method === "traceSync") tc.traceSync(inFunction);
      else if (method === "tracePromise") await tc.tracePromise(async () => inFunction());
      else
        tc.traceCallback(
          (cb: () => void) => {
            inFunction();
            cb();
          },
          0,
          {},
          undefined,
          inCallback,
        );
      seen.push({ ...row, published: log.join(" ") });
      expected.push({ ...row, published });
    }
    expect(seen).toEqual(expected);
  });

  test("the trace methods make a context with no prototype when they get none", async () => {
    const trace: Record<string, (tc: Tracing, fn: () => void, ...context: [object?]) => unknown> = {
      traceSync: (tc, fn, ...context) => tc.traceSync(fn, ...context),
      tracePromise: (tc, fn, ...context) => tc.tracePromise(async () => fn(), ...context),
      traceCallback: (tc, fn, ...context) => {
        const { promise, resolve } = Promise.withResolvers<unknown>();
        tc.traceCallback(
          (cb: () => void) => {
            fn();
            setImmediate(cb);
          },
          0,
          context[0],
          undefined,
          resolve,
        );
        return promise;
      },
    };
    const seen: Record<string, unknown> = {};
    const given = { given: true };

    for (const [method, traceWith] of Object.entries(trace)) {
      const tc = tracingChannel(`tc-context-${method}`);
      const store = new AsyncLocalStorage<any>();
      bind(tc.start, store);
      let published: object[] = [];
      for (const event of events) on(tc[event], context => void published.push(context));

      // What one call publishes: the prototype of its context, and whether every event and the store got that object.
      const call = async (...context: [object?]) => {
        published = [];
        let inStore: unknown;
        await traceWith(tc, () => void (inStore = store.getStore()), ...context);
        const [first] = published;
        const prototype = Object.getPrototypeOf(first);
        return {
          context: first,
          prototype: prototype === null ? "none" : prototype === Object.prototype ? "Object.prototype" : prototype,
          events: published.length,
          everyEventGotIt: published.every(context => context === first),
          storeGotIt: inStore === first,
        };
      };
      const omitted = await call();
      const passedUndefined = await call(undefined);
      const passedObject = await call(given);
      const shape = ({ context, ...rest }: Awaited<ReturnType<typeof call>>) => rest;
      seen[method] = {
        omitted: shape(omitted),
        undefined: shape(passedUndefined),
        aNewOneForEachCall: omitted.context !== passedUndefined.context,
        object: { ...shape(passedObject), isTheOneGiven: passedObject.context === given },
        length: tc[method as "traceSync"].length,
      };
    }

    const made = (events: number) => ({ prototype: "none", events, everyEventGotIt: true, storeGotIt: true });
    const expected = (events: number) => ({
      omitted: made(events),
      undefined: made(events),
      aNewOneForEachCall: true,
      object: { ...made(events), prototype: "Object.prototype", isTheOneGiven: true },
      length: 1,
    });
    expect(seen).toEqual({ traceSync: expected(2), tracePromise: expected(4), traceCallback: expected(4) });
  });

  test("null is a context, and the write of a result to it throws", async () => {
    const published: Record<string, unknown[]> = {};
    const tcOf = (method: string) => {
      const tc = tracingChannel(`tc-context-null-${method}`);
      on(tc.start, context => (published[method] = [context]));
      return tc;
    };
    const callback = mock();

    expect(() => tcOf("traceSync").traceSync(() => 1, null as any)).toThrow(TypeError);
    await expect(tcOf("tracePromise").tracePromise(() => Promise.resolve(1), null as any)).rejects.toThrow(TypeError);
    expect(() =>
      tcOf("traceCallback").traceCallback((cb: Function) => cb(null, 1), 0, null as any, undefined, callback),
    ).toThrow(TypeError);

    expect(published).toEqual({ traceSync: [null], tracePromise: [null], traceCallback: [null] });
    expect(callback).not.toHaveBeenCalled();
    // An untraced call writes nothing, so it does not throw either.
    const promise = Promise.resolve(1);
    expect(tracingChannel("tc-context-null-untraced").tracePromise(() => promise, null as any)).toBe(promise);
  });

  test("with only an error subscriber a call is traced", async () => {
    const failure = new Error("failure");
    const calls: Record<string, (tc: Tracing) => unknown> = {
      "traceSync throws": tc =>
        tc.traceSync(() => {
          throw failure;
        }),
      "tracePromise throws": tc =>
        tc.tracePromise(() => {
          throw failure;
        }),
      "tracePromise rejects": tc => tc.tracePromise(() => Promise.reject(failure)),
      "traceCallback throws": tc =>
        tc.traceCallback(
          (cb: Function) => {
            throw failure;
          },
          0,
          undefined,
          undefined,
          () => {},
        ),
      "traceCallback gets an error": tc =>
        tc.traceCallback(
          (cb: Function) => cb(failure, "no result"),
          0,
          undefined,
          undefined,
          () => {},
        ),
      "traceCallback gets an error that is no Error": tc =>
        tc.traceCallback(
          (cb: Function) => cb("failure", "no result"),
          0,
          undefined,
          undefined,
          () => {},
        ),
    };

    const seen: Record<string, unknown> = {};
    for (const [name, call] of Object.entries(calls)) {
      const tc = tracingChannel(`tc-error-only-${name}`);
      const published: any[] = [];
      on(tc.error, context => void published.push(context));
      let outcome: unknown = "returned";
      try {
        await call(tc);
      } catch (error) {
        outcome = error === failure ? "threw the failure" : error;
      }
      const context = published[0] ?? { nothingWasPublished: true };
      seen[name] = {
        outcome,
        events: published.length,
        hasNoPrototype: Object.getPrototypeOf(context) === null,
        keys: Object.keys(context),
        error: context.error,
      };
    }

    const traced = (outcome: string, error: unknown = failure) => ({
      outcome,
      events: 1,
      hasNoPrototype: true,
      keys: ["error"],
      error,
    });
    expect(seen).toEqual({
      "traceSync throws": traced("threw the failure"),
      "tracePromise throws": traced("threw the failure"),
      "tracePromise rejects": traced("threw the failure"),
      "traceCallback throws": traced("threw the failure"),
      "traceCallback gets an error": traced("returned"),
      "traceCallback gets an error that is no Error": traced("returned", "failure"),
    });
  });

  test("tracePromise hands back every thenable but a direct instance of Promise as it is", async () => {
    class Subclass extends Promise<number> {}
    const spoofed = Subclass.resolve(1);
    spoofed.constructor = Promise;
    const ownThen = mock(Promise.prototype.then);
    // What the handler returns is the value again, so that a thenable can chain on it.
    const then = mock((onFulfilled: (value: number) => unknown) => onFulfilled(1));
    const results: Record<string, PromiseLike<number>> = {
      native: Promise.resolve(1),
      nativeWithOwnThen: Object.assign(Promise.resolve(1), { then: ownThen as any }),
      subclass: Subclass.resolve(1),
      subclassWithSpoofedConstructor: spoofed,
      promiseOfAnotherRealm: vm.runInNewContext("Promise.resolve(1)"),
      thenable: { then } as unknown as PromiseLike<number>,
      // No promise, although Promise.prototype is its prototype.
      thenableAbovePromisePrototype: Object.assign(Object.create(Promise.prototype), { then }),
    };

    const seen: Record<string, unknown> = {};
    for (const [kind, result] of Object.entries(results)) {
      const tc = tracingChannel(`tc-result-${kind}`);
      const log = record(tc);
      const context: { result?: unknown } = {};

      const thenCallsBefore = then.mock.calls.length;
      const traced = tc.tracePromise(() => result, context);
      const atReturn = log.join(" ");
      const thenCallsByTracePromise = then.mock.calls.length - thenCallsBefore;
      const value = await traced;
      seen[kind] = {
        isTheResult: traced === result,
        isDirectPromise: types.isPromise(traced) && Object.getPrototypeOf(traced) === Promise.prototype,
        value,
        atReturn,
        afterwards: log.join(" "),
        contextResult: context.result,
        thenCallsByTracePromise,
      };
    }

    const chained = { isTheResult: false, isDirectPromise: true };
    const asItIs = { isTheResult: true, isDirectPromise: false };
    const settlesLater = {
      value: 1,
      atReturn: "start end",
      afterwards: "start end asyncStart asyncEnd",
      contextResult: 1,
      thenCallsByTracePromise: 0,
    };
    // then() ran inside the call: the thenable settled before "end".
    const settlesInTheCall = {
      value: 1,
      atReturn: "start asyncStart asyncEnd end",
      afterwards: "start asyncStart asyncEnd end",
      contextResult: 1,
      thenCallsByTracePromise: 1,
    };
    expect(seen).toEqual({
      native: { ...chained, ...settlesLater },
      nativeWithOwnThen: { ...chained, ...settlesLater },
      subclass: { ...asItIs, ...settlesLater },
      subclassWithSpoofedConstructor: { ...asItIs, ...settlesLater },
      promiseOfAnotherRealm: { ...asItIs, ...settlesLater },
      thenable: { ...asItIs, ...settlesInTheCall },
      thenableAbovePromisePrototype: { ...asItIs, ...settlesInTheCall },
    });
    expect(then.mock.results[0]).toEqual({ type: "return", value: 1 });
    // For each of the two thenables tracePromise called then() once, and the await above once more.
    // A thenable that does its work at each then() does it twice.
    expect(then).toHaveBeenCalledTimes(4);
    // A direct Promise is chained with the then() that Promise.prototype had at first, not with one put on it later.
    expect(ownThen).not.toHaveBeenCalled();
  });

  // Warnings and unhandled rejections belong to the process, so these cases have a process of their own.
  test("tracePromise with a value that is no thenable, and with a rejection that nobody handles", async () => {
    const fixture = /* js */ `
      const { tracingChannel } = require("node:diagnostics_channel");
      const unhandled = [];
      const warnings = [];
      process.on("unhandledRejection", reason => unhandled.push(reason.message));
      process.on("warning", warning => warnings.push(warning.message));

      class Subclass extends Promise {}
      const rejections = {
        native: message => Promise.reject(new Error(message)),
        subclass: message => Subclass.reject(new Error(message)),
        thenable: message => ({ then: (onFulfilled, onRejected) => onRejected(new Error(message)) }),
      };
      const seen = {};

      for (const tracing of ["untraced", "subscribed"]) {
        const make = kind => {
          const tc = tracingChannel(tracing + "-" + kind);
          const log = [];
          if (tracing === "subscribed") {
            for (const event of ["start", "end", "asyncStart", "asyncEnd", "error"]) {
              tc[event].subscribe(() => log.push(event));
            }
          }
          return { tc, log };
        };
        seen[tracing] = {};

        {
          const { tc, log } = make("value");
          const value = { value: true };
          const context = {};
          const traced = tc.tracePromise(function named() { return value; }, context);
          seen[tracing].value = { isTheValue: traced === value, contextResult: context.result === value, log: log.join(" ") };
          tc.tracePromise(() => undefined);
        }

        for (const [kind, reject] of Object.entries(rejections)) {
          const { tc, log } = make(kind);
          const context = {};
          const message = tracing + " " + kind;
          let rejected;
          const traced = tc.tracePromise(() => (rejected = reject(message)), context);
          seen[tracing][kind] = { isTheResult: traced === rejected, context, log };
        }
      }

      // A handler on what tracePromise returned runs as early as one on the same chain made by hand.
      const order = [];
      const tc = tracingChannel("order");
      tc.start.subscribe(() => {});
      const failure = new Error("order");
      tc.tracePromise(() => Promise.reject(failure)).catch(() => order.push("traced"));
      Promise.reject(failure).then(undefined, error => { throw error; }).catch(() => order.push("by hand"));

      // What ioredis and others do: they trace unless the channel says that it has no subscriber, and they handle
      // the rejection of what they traced. With no subscriber the rejection is the caller's to handle.
      const library = tracingChannel("library");
      const command = () => Promise.reject(new Error("command of a library"));
      if (library.hasSubscribers !== false) library.tracePromise(command).catch(() => {});
      else command();

      setImmediate(() => setImmediate(() => {
        for (const tracing of Object.keys(seen)) {
          for (const kind of Object.keys(rejections)) {
            const { context, log } = seen[tracing][kind];
            seen[tracing][kind].contextError = context.error?.message;
            seen[tracing][kind].log = log.join(" ");
            delete seen[tracing][kind].context;
          }
        }
        console.log(JSON.stringify({ seen, order, unhandled: unhandled.sort(), warnings }));
      }));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", fixture],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const warning = (name: string) =>
      `tracePromise was called with the function '${name}', which returned a non-thenable.`;
    const warnings = [warning("named"), warning("<anonymous>")];
    expect({ ...JSON.parse(stdout.trim() || "{}"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      seen: {
        untraced: {
          value: { isTheValue: true, contextResult: false, log: "" },
          native: { isTheResult: true, log: "" },
          subclass: { isTheResult: true, log: "" },
          thenable: { isTheResult: true, log: "" },
        },
        subscribed: {
          // No asyncStart and no asyncEnd: nothing continues after a value.
          value: { isTheValue: true, contextResult: true, log: "start end" },
          native: {
            isTheResult: false,
            contextError: "subscribed native",
            log: "start end error asyncStart asyncEnd",
          },
          subclass: {
            isTheResult: true,
            contextError: "subscribed subclass",
            log: "start end error asyncStart asyncEnd",
          },
          thenable: {
            isTheResult: true,
            contextError: "subscribed thenable",
            log: "start error asyncStart asyncEnd end",
          },
        },
      },
      order: ["traced", "by hand"],
      // Untraced, a promise rejects as if tracePromise was not there. Subscribed, the chain that tracePromise
      // returns for a direct Promise rejects too. Its then() on any other thenable handles the rejection.
      unhandled: ["command of a library", "subscribed native", "untraced native", "untraced subclass"],
      warnings: [...warnings, ...warnings],
      stderr: "",
      exitCode: 0,
    });
  });

  test("traceCallback wraps the callback, and takes a first argument that is truthy for an error", () => {
    const tc = tracingChannel("tc-callback");
    const log = record(tc);
    const failure = new Error("failure");
    const receiver = { receiver: true };
    const thisArg = { thisArg: true };
    const calls: unknown[][] = [];
    function callback(this: unknown, ...args: unknown[]) {
      calls.push([this, ...args]);
      return "value of the callback";
    }

    const seen: unknown[] = [];
    const rows = [null, undefined, 0, "", false, "failure", failure].map(error => [error, { of: error }]);
    for (const [error, value] of rows) {
      const context = {};
      log.length = 0;
      // No position is given, so the callback to wrap is the last argument.
      const returned = tc.traceCallback(
        function (this: unknown, first: string, cb: Function) {
          return [this, first, cb.call(receiver, error, value)];
        },
        undefined,
        context,
        thisArg,
        "first",
        callback,
      );
      seen.push({ returned, log: log.join(" "), context });
    }

    const returned = [thisArg, "first", "value of the callback"];
    const result = (error: unknown) => ({
      returned,
      log: "start asyncStart asyncEnd end",
      context: { result: { of: error } },
    });
    const errored = (error: unknown) => ({
      returned,
      log: "start error asyncStart asyncEnd end",
      context: { error },
    });
    expect(seen).toEqual([
      result(null),
      result(undefined),
      result(0),
      result(""),
      result(false),
      errored("failure"),
      errored(failure),
    ]);
    expect(calls).toEqual(rows.map(([error, value]) => [receiver, error, value]));
  });

  test("stores are entered in the order in which they were bound", async () => {
    const three = () => ["A", "B", "C"].map(name => ({ name, store: new AsyncLocalStorage<any>() }));
    type Stores = ReturnType<typeof three>;
    const entered = (stores: Stores) => stores.map(({ store }) => store.getStore() ?? "-").join("");
    // Each store gets the name that its transform returns. A transform logs the stores that are entered by then.
    const bindAll = (channel: AnyChannel, stores: Stores, log: string[]) => {
      for (const { name, store } of stores) {
        bind(channel, store, () => {
          log.push(`transform ${name} in ${entered(stores)}`);
          return name;
        });
      }
    };
    const seen: Record<string, string[]> = {};

    // A program can replace Array.from at any time, so no store is entered through it.
    const arrayFrom = Array.from;
    const replacedArrayFrom = mock(() => {
      throw new Error("the Array.from of the program was called");
    });
    const withArrayFromReplaced = (fn: () => void) => {
      Array.from = replacedArrayFrom as unknown as typeof Array.from;
      try {
        fn();
      } finally {
        Array.from = arrayFrom;
      }
    };

    {
      const log: string[] = (seen.runStores = []);
      const stores = three();
      const dc = channel("tc-store-order-channel");
      bindAll(dc, stores, log);
      withArrayFromReplaced(() => dc.runStores({}, () => void log.push(`function in ${entered(stores)}`)));
    }
    {
      const log: string[] = (seen.traceSync = []);
      const stores = three();
      const tc = tracingChannel("tc-store-order-sync");
      bindAll(tc.start, stores, log);
      withArrayFromReplaced(() => tc.traceSync(() => void log.push(`function in ${entered(stores)}`)));
    }
    {
      const log: string[] = (seen.tracePromise = []);
      const stores = three();
      const tc = tracingChannel("tc-store-order-promise");
      bindAll(tc.asyncStart, stores, log);
      on(tc.asyncStart, () => void log.push(`asyncStart in ${entered(stores)}`));
      await tc.tracePromise(() => Promise.resolve(1));
    }
    {
      const log: string[] = (seen.traceCallback = []);
      const stores = three();
      const tc = tracingChannel("tc-store-order-callback");
      bindAll(tc.asyncStart, stores, log);
      withArrayFromReplaced(() =>
        tc.traceCallback(
          (cb: () => void) => cb(),
          0,
          {},
          undefined,
          () => void log.push(`callback in ${entered(stores)}`),
        ),
      );
    }

    const transforms = ["transform A in ---", "transform B in A--", "transform C in AB-"];
    expect(seen).toEqual({
      runStores: [...transforms, "function in ABC"],
      traceSync: [...transforms, "function in ABC"],
      tracePromise: [...transforms, "asyncStart in ABC"],
      traceCallback: [...transforms, "callback in ABC"],
    });
    expect(replacedArrayFrom).not.toHaveBeenCalled();
  });

  test.each(["resolves", "rejects"])(
    "tracePromise enters the stores of asyncStart when the promise %s",
    async settlement => {
      const tc = tracingChannel(`tc-continuation-store-${settlement}`);
      const store = new AsyncLocalStorage<object>();
      const context = {};
      const ofTheContinuation = { store: "of the continuation" };
      const transformed: unknown[] = [];
      const inStore: unknown[][] = [];
      bind(tc.asyncStart, store, message => {
        transformed.push(message);
        return ofTheContinuation;
      });
      on(tc.asyncStart, () => void inStore.push(["asyncStart", store.getStore()]));
      on(tc.asyncEnd, () => void inStore.push(["asyncEnd", store.getStore()]));

      const failure = new Error("rejected");
      const traced = tc.tracePromise(
        () => (settlement === "resolves" ? Promise.resolve(1) : Promise.reject(failure)),
        context,
      );
      const settled = await traced.then(
        value => ["resolved", value],
        error => ["rejected", error],
      );

      expect({ settled, inStore, afterwards: store.getStore() }).toEqual({
        settled: settlement === "resolves" ? ["resolved", 1] : ["rejected", failure],
        inStore: [
          ["asyncStart", ofTheContinuation],
          ["asyncEnd", ofTheContinuation],
        ],
        afterwards: undefined,
      });
      expect(transformed).toHaveLength(1);
      expect(transformed[0]).toBe(context);
    },
  );

  // Bun.$ and Bun.sql return a subclass of Promise that starts its work at the first then(), and that has methods
  // to call before that. With no subscriber nothing calls then(), so text() and values() still work.
  test("tracePromise hands back a Bun.$ promise and a Bun.sql query as they are", async () => {
    using dir = tempDir("diagnostics-channel-lazy", {});
    await using sql = new SQL("sqlite://:memory:");

    const untraced = tracingChannel("tc-lazy-untraced");
    const untracedFile = join(String(dir), "untraced.txt");
    const untracedShell = $`echo shell >> ${untracedFile}`;
    const untracedQuery = sql`select 1 as one`;
    const untracedSeen = {
      shellIsTheResult: untraced.tracePromise(() => untracedShell) === untracedShell,
      queryIsTheResult: untraced.tracePromise(() => untracedQuery) === untracedQuery,
      shellText: await untracedShell.text(),
      queryValues: await untracedQuery.values(),
      file: readFileSync(untracedFile, "utf8"),
    };

    const subscribed = tracingChannel("tc-lazy-subscribed");
    const results: unknown[] = [];
    on(subscribed.asyncStart, context => void results.push(context.result));
    const subscribedFile = join(String(dir), "subscribed.txt");
    const subscribedShell = $`echo shell >> ${subscribedFile}`.quiet();
    const subscribedQuery = sql`select 1 as one`.values();
    const tracedShell = subscribed.tracePromise(() => subscribedShell);
    const tracedQuery = subscribed.tracePromise(() => subscribedQuery);
    // With a subscriber tracePromise has called then(), so the command runs by now and text() comes too late.
    const textAfterTheStart = await Promise.resolve()
      .then(() => tracedShell.text())
      .then(
        () => "no error",
        error => error.message,
      );
    const output = await tracedShell;
    const rows = await tracedQuery;
    const subscribedSeen = {
      shellIsTheResult: tracedShell === subscribedShell,
      queryIsTheResult: tracedQuery === subscribedQuery,
      textAfterTheStart,
      exitCode: output.exitCode,
      queryValues: rows,
      resultsAreTheValues: results.length === 2 && results.includes(output) && results.includes(rows),
      file: readFileSync(subscribedFile, "utf8"),
    };

    expect({ untraced: untracedSeen, subscribed: subscribedSeen }).toEqual({
      untraced: {
        shellIsTheResult: true,
        queryIsTheResult: true,
        shellText: "",
        queryValues: [[1]],
        file: "shell\n",
      },
      subscribed: {
        shellIsTheResult: true,
        queryIsTheResult: true,
        textAfterTheStart: "Shell is already running",
        exitCode: 0,
        queryValues: [[1]],
        resultsAreTheValues: true,
        file: "shell\n",
      },
    });
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
