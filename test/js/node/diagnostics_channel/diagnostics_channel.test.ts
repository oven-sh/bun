import { gc } from "bun";
import { fullGC } from "bun:jsc";
import { beforeEach, describe, expect, mock, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";
import { channel, Channel, hasSubscribers, subscribe, tracingChannel, unsubscribe } from "node:diagnostics_channel";

describe("Channel", () => {
  // test-diagnostics-channel-has-subscribers.js
  test("can have subscribers", () => {
    const name = "channel1";
    const dc = channel(name);
    expect(hasSubscribers(name)).toBeFalse();

    const subscriber = () => {};
    dc.subscribe(subscriber);
    expect(hasSubscribers(name)).toBeTrue();

    // A subscriber holds its channel. Leave none behind for a rerun in this process.
    dc.unsubscribe(subscriber);

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
    dc.unsubscribe(subscriber);

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

  // test-diagnostics-channel-gc-maintains-subcriptions.js
  //
  // Node holds a channel for as long as it has a subscriber or a bound store.
  // These tests keep no reference to a channel. Bun.gc() ends the keep-alive
  // that a WeakRef gives its target for the current job before it collects, so
  // a channel that only the registry refers to is gone when it returns.
  describe("that nothing else refers to", () => {
    const count = 100;
    const named = (prefix: string) => Array.from({ length: count }, (_, i) => `${prefix}-${i}`);

    test("is held while it has a subscriber or a bound store, whichever way that was added", () => {
      const names = named("held");
      const store = new AsyncLocalStorage();
      const received = { subscribe: 0, channel: 0, symbol: 0, again: 0, store: 0, tracing: 0 };
      const on = {
        subscribe: () => void received.subscribe++,
        channel: () => void received.channel++,
        symbol: () => void received.symbol++,
        again: () => void received.again++,
        tracing: { start: () => void received.tracing++ },
      };
      for (const name of names) {
        subscribe(`${name}-subscribe`, on.subscribe);
        channel(`${name}-channel`).subscribe(on.channel);
        subscribe(Symbol.for(name), on.symbol);
        // The number of subscribers goes from 0 to 1 a second time.
        subscribe(`${name}-again`, on.again);
        unsubscribe(`${name}-again`, on.again);
        subscribe(`${name}-again`, on.again);
        channel(`${name}-store`).bindStore(store);
        tracingChannel(name).subscribe(on.tracing);
      }

      gc(true);

      for (const name of names) {
        channel(`${name}-subscribe`).publish(name);
        channel(`${name}-channel`).publish(name);
        channel(Symbol.for(name)).publish(name);
        channel(`${name}-again`).publish(name);
        if (channel(`${name}-store`).runStores(name, () => store.getStore()) === name) received.store++;
        tracingChannel(name).traceSync(() => {});
      }
      expect(received).toEqual({
        subscribe: count,
        channel: count,
        symbol: count,
        again: count,
        store: count,
        tracing: count,
      });

      for (const name of names) {
        unsubscribe(`${name}-subscribe`, on.subscribe);
        unsubscribe(`${name}-channel`, on.channel);
        unsubscribe(Symbol.for(name), on.symbol);
        unsubscribe(`${name}-again`, on.again);
        channel(`${name}-store`).unbindStore(store);
        tracingChannel(name).unsubscribe(on.tracing);
      }
    });

    test("is held until its last subscriber and its last store are removed", () => {
      const names = named("released");
      const first = () => {};
      const second = () => {};
      const store = new AsyncLocalStorage();
      const refs = names.map(name => {
        const dc = channel(name);
        dc.subscribe(first);
        dc.subscribe(second);
        dc.bindStore(store);
        // Binding a store again replaces its transform. It is still one store.
        dc.bindStore(store, data => data);
        return new WeakRef(dc);
      });
      const alive = () => {
        gc(true);
        return refs.filter(ref => ref.deref() !== undefined).length;
      };

      const held: Record<string, number> = {};
      held["two subscribers and a store"] = alive();
      for (const name of names) unsubscribe(name, first);
      held["one subscriber and a store"] = alive();
      for (const name of names) unsubscribe(name, second);
      held["a store"] = alive();
      expect(held).toEqual({
        "two subscribers and a store": count,
        "one subscriber and a store": count,
        "a store": count,
      });

      for (const name of names) channel(name).unbindStore(store);
      // A reference that the module keeps holds every one of them, so this
      // checks the population, as "references are not leaked" does.
      expect(alive()).toBeLessThan(count / 10);
    });

    // A lookup by name is a WeakRef#deref(), and a deref() holds its target
    // until the job ends. So unsubscribe(name) and subscribe(name) in one job
    // act on one channel even when a collection runs between them, as in Node.
    // fullGC() collects without ending the job.
    test("is one channel across unsubscribe(name), a collection and subscribe(name) in one job", () => {
      const names = named("one-job");
      const first = () => {};
      for (const name of names) {
        subscribe(name, first);
        (channel(name) as Channel & { tag?: string }).tag = name;
      }
      gc(true);

      const unsubscribed = names.filter(name => unsubscribe(name, first)).length;
      fullGC();
      let received = 0;
      const second = () => void received++;
      for (const name of names) subscribe(name, second);
      const sameChannel = names.filter(name => (channel(name) as Channel & { tag?: string }).tag === name).length;
      for (const name of names) channel(name).publish(name);
      expect({ unsubscribed, sameChannel, received }).toEqual({
        unsubscribed: count,
        sameChannel: count,
        received: count,
      });

      for (const name of names) unsubscribe(name, second);
    });
  });

  // https://github.com/oven-sh/bun/issues/43086
  test("a subscriber by name receives what is published in a later turn, after a collection", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const dc = require("node:diagnostics_channel");
          const received = [];
          dc.subscribe("app.event", message => received.push(message));
          dc.channel("app.event").publish(1);
          for (let turn = 0; turn < 3; turn++) {
            await new Promise(resolve => setImmediate(resolve));
            Bun.gc(true);
          }
          const hasSubscribers = dc.hasSubscribers("app.event");
          dc.channel("app.event").publish(2);
          console.log(JSON.stringify({ hasSubscribers, received }));
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ result: JSON.parse(stdout.trim() || "null"), stderr: exitCode === 0 ? "" : stderr, exitCode }).toEqual({
      result: { hasSubscribers: true, received: [1, 2] },
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

describe("TracingChannel", () => {
  // Port tests from:
  // https://github.com/search?q=repo%3Anodejs%2Fnode+test-diagnostics-channel+AND+%2Ftracing%2F&type=code
  test.todo("TODO");
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
