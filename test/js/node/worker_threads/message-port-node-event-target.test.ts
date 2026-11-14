/**
 * MessagePort is node's NodeEventTarget: on()/once()/addListener() store the listener itself in
 * the EventTarget listener list, marked to receive the value its dispatcher supplies and not the
 * Event (kIsNodeStyleListener and kHybridDispatch in lib/internal/event_target.js). Bun used to
 * register a wrapper closure, so removeEventListener(f) did not remove what on(f) added.
 *
 * This file uses node:test/node:assert so the identical file also runs under `node --test`, which
 * is where every expected value comes from (v26.3.0 and v26.11.1). That is why these cases are
 * not in worker_threads.test.ts, and why the file cannot import from "harness". A test marked
 * todo for Bun names a result that Bun does not give yet.
 */
import assert from "node:assert";
import { spawn } from "node:child_process";
import EventEmitter, { getEventListeners, once, setMaxListeners } from "node:events";
import { describe, test } from "node:test";
import { MessageChannel, MessagePort, Worker } from "node:worker_threads";

const isBun = typeof Bun !== "undefined";
const todoOnBun = (reason: string) => (isBun ? { todo: reason } : {});

// The typings keep on() listeners and addEventListener() listeners apart. These tests give one
// function to both, and arguments that only the runtime accepts.
type Port = MessagePort &
  Record<
    | "on"
    | "once"
    | "addListener"
    | "off"
    | "removeListener"
    | "emit"
    | "listenerCount"
    | "eventNames"
    | "removeAllListeners"
    | "addEventListener"
    | "removeEventListener"
    | "setMaxListeners"
    | "getMaxListeners"
    | "close",
    (...args: any[]) => any
  >;
type Ports = { port1: Port; port2: Port };

// Runs `body` with a fresh channel and closes both ports afterwards.
async function withChannel<T>(body: (ports: Ports) => T | Promise<T>): Promise<T> {
  const { port1, port2 } = new MessageChannel() as unknown as Ports;
  try {
    return await body({ port1, port2 });
  } finally {
    port1.close();
    port2.close();
  }
}

// Resolves when `port` delivers the next message (or the one equal to `want`) to a listener added
// now. Listeners run in registration order, so every listener added before this call has seen that
// message by then.
function delivered(port: Port, want?: unknown) {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  const listener = (event: MessageEvent) => {
    if (want !== undefined && event.data !== want) return;
    port.removeEventListener("message", listener);
    resolve(event.data);
  };
  port.addEventListener("message", listener);
  return promise;
}

function closed(port: Port) {
  const { promise, resolve } = Promise.withResolvers<void>();
  port.addEventListener("close", () => resolve(), { once: true });
  return promise;
}

const kind = (value: unknown) => (value instanceof Event ? "event" : `data:${value}`);

// node registers 'newListener' and 'removeListener' listeners of its own on every port.
const eventNames = (port: Port): string[] =>
  port.eventNames().filter((name: string) => name !== "newListener" && name !== "removeListener");

// Posts a message that serializes, but does not deserialize: the DataView is in bounds only after
// the getter resized the buffer, and the buffer was serialized before that.
function postUndeserializable(port: Port) {
  const buffer = new ArrayBuffer(8, { maxByteLength: 65536 });
  port.postMessage({
    buffer,
    get grow() {
      buffer.resize(65536);
      return 1;
    },
    get view() {
      return new DataView(buffer, 4096, 16);
    },
  });
}

// The shape that a listener-wrapping patch installs (zone.js, for example): addEventListener()
// registers a wrapper of the listener, and removeEventListener() removes the wrapper it made.
function wrapListeners(port: Port) {
  const wrappers = new WeakMap<object, (...args: unknown[]) => unknown>();
  const { addEventListener, removeEventListener } = port;
  port.addEventListener = function (this: Port, type: string, listener: (...args: unknown[]) => unknown, options) {
    let wrapper = wrappers.get(listener);
    if (!wrapper) {
      wrapper = function (this: unknown, ...args) {
        return listener.apply(this, args);
      };
      wrappers.set(listener, wrapper);
    }
    return addEventListener.call(this, type, wrapper, options);
  };
  port.removeEventListener = function (this: Port, type: string, listener: object, options) {
    return removeEventListener.call(this, type, wrappers.get(listener) ?? listener, options);
  };
}

// Runs `script` in its own process, with `port1` and `port2` of a fresh channel in scope. port2
// stays reachable: Bun closes a port whose peer was collected. The unref'd timer never fires when
// nothing keeps the loop alive. It bounds the failure (a process that stays alive), so the test
// does not run into its timeout.
async function inOwnProcess(script: string) {
  const child = spawn(
    process.execPath,
    [
      "-e",
      `const { MessageChannel, Worker } = require("node:worker_threads");
       const { port1, port2 } = new MessageChannel();
       globalThis.keep = port2;
       ${script}
       setTimeout(() => { console.log("still alive"); process.exit(1); }, 2_000).unref();`,
    ],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  let stdout = "";
  child.stdout.setEncoding("utf8").on("data", chunk => (stdout += chunk));
  const [status, signal] = await once(child, "close");
  return { stdout: stdout.trim().split("\n"), status, signal };
}

describe("MessagePort: on()/once() listeners are entries of the EventTarget listener list", () => {
  for (const add of ["on", "once", "addListener"]) {
    for (const [name, remove] of [
      ["port.removeEventListener(f)", (port, type, f) => port.removeEventListener(type, f)],
      [
        "EventTarget.prototype.removeEventListener.call(port, f)",
        (port, type, f) => EventTarget.prototype.removeEventListener.call(port, type, f),
      ],
    ] as [string, (port: Port, type: string, f: () => void) => void][]) {
      test(`${add}(f) is removed by ${name}`, async () => {
        const result = await withChannel(async ({ port1, port2 }) => {
          const calls: string[] = [];
          const addThenRemove = (type: string) => {
            const f = () => void calls.push(type);
            port1[add](type, f);
            remove(port1, type, f);
          };

          addThenRemove("message");
          const afterRemoval = { count: port1.listenerCount("message"), hasRef: port1.hasRef() };
          const seen = delivered(port1);
          port2.postMessage(1);
          await seen;

          addThenRemove("custom");
          port1.emit("custom", 1);

          addThenRemove("close");
          const closing = closed(port1);
          port1.close();
          await closing;
          return { ...afterRemoval, calls };
        });
        assert.deepStrictEqual(result, { count: 0, hasRef: false, calls: [] });
      });
    }
  }

  test("close(cb) is removed by removeEventListener('close', cb)", async () => {
    let called = 0;
    const { port1, port2 } = new MessageChannel() as unknown as Ports;
    const cb = () => void called++;
    const closing = closed(port1);
    port1.close(cb);
    port1.removeEventListener("close", cb);
    await closing;
    port2.close();
    assert.strictEqual(called, 0);
  });

  test("a message for a removed on() listener stays queued for the next listener", async () => {
    const log = await withChannel(async ({ port1, port2 }) => {
      const log: string[] = [];
      const f = (data: string) => void log.push(`f:${data}`);
      port2.postMessage("m");
      port1.on("message", f);
      port1.removeEventListener("message", f);
      const { promise, resolve } = Promise.withResolvers<void>();
      port1.on("message", (data: string) => {
        log.push(`g:${data}`);
        if (data === "n") resolve();
      });
      port2.postMessage("n");
      await promise;
      return log;
    });
    assert.deepStrictEqual(log, ["g:m", "g:n"]);
  });

  // Each row is a list of calls with one function f. `counts` is listenerCount("message") after
  // each call, `got` is what f received for the messages "a" and "b".
  for (const [name, calls, want] of [
    [
      "on(f), addEventListener(f)",
      [(p, f) => p.on("message", f), (p, f) => p.addEventListener("message", f)],
      { counts: [1, 1], got: ["data:a", "data:b"], after: 1 },
    ],
    [
      "addEventListener(f), on(f)",
      [(p, f) => p.addEventListener("message", f), (p, f) => p.on("message", f)],
      { counts: [1, 1], got: ["event", "event"], after: 1 },
    ],
    [
      "once(f), addEventListener(f)",
      [(p, f) => p.once("message", f), (p, f) => p.addEventListener("message", f)],
      { counts: [1, 1], got: ["data:a"], after: 0 },
    ],
    [
      "addEventListener(f, { once: true }), on(f)",
      [(p, f) => p.addEventListener("message", f, { once: true }), (p, f) => p.on("message", f)],
      { counts: [1, 1], got: ["event"], after: 0 },
    ],
    [
      "on(f), removeEventListener(f), addEventListener(f)",
      [
        (p, f) => p.on("message", f),
        (p, f) => p.removeEventListener("message", f),
        (p, f) => p.addEventListener("message", f),
      ],
      { counts: [1, 0, 1], got: ["event", "event"], after: 1 },
    ],
    [
      "on(f), removeEventListener(f), once(f)",
      [(p, f) => p.on("message", f), (p, f) => p.removeEventListener("message", f), (p, f) => p.once("message", f)],
      { counts: [1, 0, 1], got: ["data:a"], after: 0 },
    ],
    [
      "once(f), removeEventListener(f), on(f)",
      [(p, f) => p.once("message", f), (p, f) => p.removeEventListener("message", f), (p, f) => p.on("message", f)],
      { counts: [1, 0, 1], got: ["data:a", "data:b"], after: 1 },
    ],
  ] as [string, ((port: Port, f: (value: unknown) => void) => void)[], object][]) {
    test(`${name}: one listener, and the first registration decides how it is called`, async () => {
      const result = await withChannel(async ({ port1, port2 }) => {
        const got: string[] = [];
        const f = (value: unknown) => void got.push(kind(value));
        const counts = calls.map(call => (call(port1, f), port1.listenerCount("message")));
        const seen = delivered(port1, "b");
        port2.postMessage("a");
        port2.postMessage("b");
        await seen;
        return { counts, got, after: port1.listenerCount("message") };
      });
      assert.deepStrictEqual(result, want);
    });
  }

  test("capture is part of a listener's identity", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      const got: string[] = [];
      const f = (value: unknown) => void got.push(value instanceof Event ? "event" : "data");
      port1.addEventListener("message", f, { capture: true });
      port1.on("message", f);
      const counts = [port1.listenerCount("message")];
      let seen = delivered(port1);
      port2.postMessage("a");
      await seen;
      // Removes the on() registration. The capture one is a different listener.
      port1.removeEventListener("message", f);
      counts.push(port1.listenerCount("message"));
      seen = delivered(port1);
      port2.postMessage("b");
      await seen;
      port1.off("message", f, { capture: true });
      counts.push(port1.listenerCount("message"));
      return { counts, got };
    });
    assert.deepStrictEqual(result, { counts: [2, 1, 0], got: ["event", "data", "event"] });
  });

  test("off() is removeEventListener(): options select the capture listener, a missing listener is ignored", async () => {
    const result = await withChannel(({ port1 }) => {
      const f = () => {};
      const counts: number[] = [];
      port1.on("message", f);
      port1.off("message", f, { capture: true });
      counts.push(port1.listenerCount("message"));
      port1.addEventListener("message", f, { capture: true });
      port1.off("message", f);
      counts.push(port1.listenerCount("message"));
      port1.off("message", f, { capture: true });
      counts.push(port1.listenerCount("message"));
      return { counts, returned: port1.off("message") === port1 };
    });
    assert.deepStrictEqual(result, { counts: [1, 1, 0], returned: true });
  });

  // A boolean third argument is the capture flag, as for EventTarget. Older node (v26.3.0) read
  // only `options?.capture === true`, in removeEventListener() too, and has no result to compare.
  const booleanIsCapture = (() => {
    const target = new EventTarget();
    let called = 0;
    const f = () => void called++;
    target.addEventListener("x", f, true);
    target.removeEventListener("x", f, true);
    target.dispatchEvent(new Event("x"));
    return called === 0;
  })();
  test(
    "off(type, f, true) removes the capture listener and keeps the on() listener",
    { skip: !booleanIsCapture && "this node does not read a boolean as the capture flag" },
    async () => {
      const counts = await withChannel(({ port1 }) => {
        const f = () => {};
        const counts: number[] = [];
        port1.on("message", f);
        port1.off("message", f, true);
        counts.push(port1.listenerCount("message"));
        port1.addEventListener("message", f, true);
        port1.off("message", f, true);
        counts.push(port1.listenerCount("message"));
        return counts;
      });
      assert.deepStrictEqual(counts, [1, 1]);
    },
  );

  test("off() and removeListener() call the port's removeEventListener()", async () => {
    const result = await withChannel(({ port1 }) => {
      const seen: unknown[] = [];
      const { removeEventListener } = port1;
      const f = () => {};
      port1.removeEventListener = function (this: Port, type: string, listener: unknown, options) {
        seen.push([type, listener === f, options]);
        return removeEventListener.call(this, type, listener, options);
      };
      port1.on("message", f);
      port1.off("message", f);
      port1.on("message", f);
      port1.removeListener("message", f, { capture: false });
      return { seen, count: port1.listenerCount("message") };
    });
    assert.deepStrictEqual(result, {
      seen: [
        ["message", true, undefined],
        ["message", true, { capture: false }],
      ],
      count: 0,
    });
  });

  for (const add of ["on", "addEventListener"]) {
    for (const remove of ["off", "removeEventListener"]) {
      test(`${add}(f) then ${remove}(f) leaves no listener on a port whose methods wrap listeners`, async () => {
        const result = await withChannel(({ port1 }) => {
          wrapListeners(port1);
          const f = () => {};
          port1[add]("message", f);
          const added = port1.listenerCount("message");
          port1[remove]("message", f);
          return { added, count: port1.listenerCount("message"), hasRef: port1.hasRef() };
        });
        assert.deepStrictEqual(result, { added: 1, count: 0, hasRef: false });
      });
    }
  }

  test("off() rejects a listener that is not an object, before it converts the type", async () => {
    await withChannel(({ port1 }) => {
      const type = {
        toString() {
          throw new RangeError("the type was converted first");
        },
      };
      assert.throws(() => port1.off(type, 5), {
        name: "TypeError",
        code: "ERR_INVALID_ARG_TYPE",
        message: 'The "listener" argument must be an instance of EventListener. Received type number (5)',
      });
    });
  });

  test("removeEventListener() during dispatch stops an on() listener that has not run yet", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      const log: string[] = [];
      const b = () => void log.push("b");
      const a = () => {
        log.push("a");
        port1.removeEventListener("message", b);
      };
      port1.on("message", a);
      port1.on("message", b);
      const seen = delivered(port1);
      port2.postMessage(1);
      await seen;
      return { log, count: port1.listenerCount("message") };
    });
    assert.deepStrictEqual(result, { log: ["a"], count: 1 });
  });

  test("an on() listener that removes itself with removeEventListener() does not run again", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      const log: string[] = [];
      const a = (data: number) => {
        log.push(`a:${data}`);
        port1.removeEventListener("message", a);
      };
      port1.on("message", a);
      const seen = delivered(port1, 2);
      port2.postMessage(1);
      port2.postMessage(2);
      await seen;
      return { log, count: port1.listenerCount("message") };
    });
    assert.deepStrictEqual(result, { log: ["a:1"], count: 0 });
  });

  test("aborting the signal of addEventListener(f, { signal }) removes f after on(f) as well", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      let calls = 0;
      const f = () => void calls++;
      const controller = new AbortController();
      port1.addEventListener("message", f, { signal: controller.signal });
      port1.on("message", f);
      controller.abort();
      const afterAbort = { count: port1.listenerCount("message"), hasRef: port1.hasRef() };
      const seen = delivered(port1);
      port2.postMessage(1);
      await seen;
      return { ...afterAbort, calls };
    });
    assert.deepStrictEqual(result, { count: 0, hasRef: false, calls: 0 });
  });

  test("listenerCount(), eventNames() and removeAllListeners() cover addEventListener() and onmessage listeners", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      let calls = 0;
      const f = () => void calls++;
      const controller = new AbortController();
      port1.addEventListener("message", f);
      port1.addEventListener("message", f, { capture: true });
      port1.addEventListener("message", () => void calls++, { signal: controller.signal });
      port1.onmessage = f;
      port1.on("close", f);
      const added = { count: port1.listenerCount("message"), names: eventNames(port1) };
      port1.removeAllListeners("message");
      const removedByType = { count: port1.listenerCount("message"), names: eventNames(port1) };
      controller.abort();
      const seen = delivered(port1);
      port2.postMessage(1);
      await seen;
      port1.removeAllListeners();
      return { added, removedByType, names: eventNames(port1), calls };
    });
    assert.deepStrictEqual(result, {
      added: { count: 4, names: ["message", "close"] },
      removedByType: { count: 0, names: ["close"] },
      names: [],
      calls: 0,
    });
  });

  test("removeAllListeners(undefined) removes every type, any other value names one type", async () => {
    const result = await withChannel(({ port1 }) => {
      const f = () => {};
      port1.on("a", f);
      port1.on("null", f);
      port1.on("Symbol(s)", f);
      port1.removeAllListeners(null);
      const afterNull = eventNames(port1);
      port1.removeAllListeners(Symbol("s"));
      const afterSymbol = eventNames(port1);
      port1.removeAllListeners(undefined);
      return { afterNull, afterSymbol, afterUndefined: eventNames(port1) };
    });
    assert.deepStrictEqual(result, { afterNull: ["a", "Symbol(s)"], afterSymbol: ["a"], afterUndefined: [] });
  });

  test("eventNames() lists the types in the order of their first listener", async () => {
    const result = await withChannel(({ port1 }) => {
      const f = () => {};
      port1.on("a", f);
      port1.on("b", f);
      port1.on("c", f);
      const added = eventNames(port1);
      port1.off("a", f);
      const removed = eventNames(port1);
      port1.on("a", f);
      return { added, removed, addedAgain: eventNames(port1) };
    });
    assert.deepStrictEqual(result, { added: ["a", "b", "c"], removed: ["b", "c"], addedAgain: ["b", "c", "a"] });
  });

  test("listenerCount() and removeAllListeners() convert the type like String(), on() like a DOMString", async () => {
    const result = await withChannel(({ port1 }) => {
      const f = () => {};
      const thrower = {
        toString() {
          throw new RangeError("no type");
        },
      };
      const thrown = (call: () => unknown) => {
        try {
          call();
          return "did not throw";
        } catch (error) {
          return (error as Error).constructor.name;
        }
      };
      port1.on(5, f);
      port1.on("Symbol(s)", f);
      return {
        number: port1.listenerCount(5),
        symbol: port1.listenerCount(Symbol("s")),
        onSymbol: thrown(() => port1.on(Symbol("s"), f)),
        onThrowing: thrown(() => port1.on(thrower, f)),
        offThrowing: thrown(() => port1.off(thrower, f)),
        countThrowing: thrown(() => port1.listenerCount(thrower)),
        removeAllThrowing: thrown(() => port1.removeAllListeners(thrower)),
        names: eventNames(port1),
      };
    });
    assert.deepStrictEqual(result, {
      number: 1,
      symbol: 1,
      onSymbol: "TypeError",
      onThrowing: "RangeError",
      offThrowing: "RangeError",
      countThrowing: "RangeError",
      removeAllThrowing: "RangeError",
      names: ["5", "Symbol(s)"],
    });
  });

  test("events.getEventListeners() returns the function given to on()", async () => {
    const result = await withChannel(({ port1 }) => {
      const f = () => {};
      port1.on("message", f);
      const listeners = getEventListeners(port1, "message");
      port1.removeEventListener("message", f);
      return {
        length: listeners.length,
        isF: listeners[0] === f,
        afterRemoval: getEventListeners(port1, "message").length,
      };
    });
    assert.deepStrictEqual(result, { length: 1, isF: true, afterRemoval: 0 });
  });

  test("on() calls a { handleEvent } object and a function with the message, `this` is the object or the port", async () => {
    const result = await withChannel(async ({ port1, port2 }) => {
      const calls: [boolean, unknown][] = [];
      const listener = {
        handleEvent(value: unknown) {
          calls.push([this === listener, value]);
        },
      };
      port1.on("message", listener);
      port1.on("message", function (this: unknown, value: unknown) {
        calls.push([this === port1, value]);
      });
      const seen = delivered(port1);
      port2.postMessage("d");
      await seen;
      port1.removeEventListener("message", listener);
      return { calls, count: port1.listenerCount("message") };
    });
    assert.deepStrictEqual(result, {
      calls: [
        [true, "d"],
        [true, "d"],
      ],
      count: 1,
    });
  });

  // node invokes node-style listeners with `this` bound to the port: for a posted message, for the
  // 'close' event (on, once and close(cb), which is once("close", cb)) and for emit().
  test("on()/once() listeners are called with `this` bound to the port", async () => {
    const { port1, port2 } = new MessageChannel() as unknown as Ports;
    const calls: unknown[] = [];
    const { promise: messaged, resolve: onMessaged } = Promise.withResolvers<void>();
    const { promise: closedWithCallback, resolve: onClosed } = Promise.withResolvers<void>();

    port1.on("message", function (this: unknown, data: unknown) {
      calls.push(["on message", this === port1, data]);
    });
    port1.once("message", function (this: unknown, data: unknown) {
      calls.push(["once message", this === port1, data]);
      onMessaged();
    });
    port1.on("close", function (this: unknown) {
      calls.push(["on close", this === port1]);
    });
    port1.once("close", function (this: unknown) {
      calls.push(["once close", this === port1]);
    });
    port1.on("custom", function (this: unknown, arg: unknown) {
      calls.push(["on custom", this === port1, arg]);
    });
    port1.once("custom", function (this: unknown, arg: unknown) {
      calls.push(["once custom", this === port1, arg]);
    });

    port1.emit("custom", 42);
    port2.postMessage("hi");
    await messaged;
    port1.close(function (this: unknown) {
      calls.push(["close(cb)", this === port1]);
      onClosed();
    });
    await closedWithCallback;
    port2.close();

    assert.deepStrictEqual(calls, [
      ["on custom", true, 42],
      ["once custom", true, 42],
      ["on message", true, "hi"],
      ["once message", true, "hi"],
      ["on close", true],
      ["once close", true],
      ["close(cb)", true],
    ]);
  });

  test("parentPort.on() listeners are called with `this` bound to parentPort", async () => {
    const worker = new Worker(
      `const { parentPort } = require("node:worker_threads");
       parentPort.once("message", function (data) {
         this.postMessage({ data, thisIsParentPort: this === parentPort });
       });`,
      { eval: true },
    );
    worker.postMessage("ping");
    const [reply] = await once(worker, "message");
    await worker.terminate();
    assert.deepStrictEqual(reply, { data: "ping", thisIsParentPort: true });
  });
});

describe("MessagePort: an on() listener receives what the dispatcher supplies, or the Event", () => {
  test("a posted message: on() gets the message, addEventListener() the MessageEvent", async () => {
    const got = await withChannel(async ({ port1, port2 }) => {
      const got: unknown[] = [];
      port1.on("message", (value: unknown) => void got.push(["on", value]));
      port1.addEventListener("message", (event: MessageEvent) => void got.push(["addEventListener", kind(event)]));
      const seen = delivered(port1);
      port2.postMessage({ id: 1 });
      await seen;
      return got;
    });
    assert.deepStrictEqual(got, [
      ["on", { id: 1 }],
      ["addEventListener", "event"],
    ]);
  });

  test("a posted message does not pass through MessageEvent.prototype.data", async () => {
    const descriptor = Object.getOwnPropertyDescriptor(MessageEvent.prototype, "data")!;
    const got = await withChannel(async ({ port1, port2 }) => {
      const got: unknown[] = [];
      port1.on("message", (value: unknown) => void got.push(value));
      const seen = delivered(port1);
      Object.defineProperty(MessageEvent.prototype, "data", { configurable: true, get: () => "patched" });
      try {
        port2.postMessage(1);
        await seen;
      } finally {
        Object.defineProperty(MessageEvent.prototype, "data", descriptor);
      }
      return got;
    });
    assert.deepStrictEqual(got, [1]);
  });

  test("a message that fails to deserialize gives addEventListener('messageerror') a MessageEvent", async () => {
    const got = await withChannel(async ({ port1, port2 }) => {
      const { promise: seen, resolve } = Promise.withResolvers<string>();
      port1.addEventListener("messageerror", (event: Event) => resolve(event.constructor.name));
      // Delivery starts with the first 'message' listener.
      port1.on("message", () => {});
      postUndeserializable(port2);
      return await seen;
    });
    assert.strictEqual(got, "MessageEvent");
  });

  test("dispatchEvent(): on() listeners get the Event itself", async () => {
    const result = await withChannel(({ port1 }) => {
      const got: unknown[] = [];
      for (const type of ["message", "messageerror", "error", "custom"]) {
        port1.on(type, (value: unknown) => void got.push(value));
      }
      const events = [
        new MessageEvent("message", { data: "d" }),
        new MessageEvent("messageerror", { data: "d" }),
        new Event("error"),
        new CustomEvent("custom", { detail: 7 }),
        new Event("custom"),
      ];
      for (const event of events) port1.dispatchEvent(event);
      return { length: got.length, sameObjects: got.map((value, i) => value === events[i]) };
    });
    assert.deepStrictEqual(result, { length: 5, sameObjects: [true, true, true, true, true] });
  });

  // node's 'close' is dispatchEvent(new MessagePortCloseEvent()). close(cb) is once("close", cb).
  type Recorder = (via: string) => (...args: unknown[]) => void;
  for (const [name, close, vias] of [
    ["the port is closed", ({ port1 }, record) => port1.close(record("close(cb)")), ["on", "once", "close(cb)"]],
    ["the peer is closed", ({ port2 }) => port2.close(), ["on", "once"]],
  ] as [string, (ports: Ports, record: Recorder) => void, string[]][]) {
    test(`'close' listeners receive the close Event when ${name}`, async () => {
      const seen = await withChannel(async ports => {
        const { port1 } = ports;
        const seen: unknown[] = [];
        const record: Recorder =
          via =>
          (...args) => {
            const event = args[0] as Event | undefined;
            seen.push({
              via,
              argc: args.length,
              isEvent: event instanceof Event,
              type: event?.type,
              target: event?.target === port1,
            });
          };
        port1.on("close", record("on"));
        port1.once("close", record("once"));
        const closing = closed(port1);
        close(ports, record);
        await closing;
        return seen;
      });
      assert.deepStrictEqual(
        seen,
        vias.map(via => ({ via, argc: 1, isEvent: true, type: "close", target: true })),
      );
    });
  }

  test("emit(): on() gets the argument, addEventListener() a MessageEvent or a CustomEvent, the result is a boolean", async () => {
    const result = await withChannel(({ port1 }) => {
      const payload = { id: 42 };
      const got: unknown[] = [];
      for (const type of ["message", "messageerror", "error", "custom"]) {
        port1.on(type, (value: unknown) => void got.push([type, "on", value === payload]));
        port1.addEventListener(type, (event: any) => {
          got.push([type, event.constructor.name, event.data === payload, event.detail === payload]);
        });
      }
      const returned = ["message", "messageerror", "error", "custom", "unheard"].map(type => port1.emit(type, payload));
      // With no argument, on() gets undefined and the event carries null.
      const omitted: unknown[] = [];
      port1.on("omitted", (...args: unknown[]) => void omitted.push(args));
      port1.addEventListener("omitted", (event: CustomEvent) => void omitted.push(event.detail));
      port1.emit("omitted");
      return { got, returned, omitted };
    });
    assert.deepStrictEqual(result, {
      got: [
        ["message", "on", true],
        ["message", "MessageEvent", true, false],
        ["messageerror", "on", true],
        ["messageerror", "MessageEvent", true, false],
        ["error", "on", true],
        ["error", "CustomEvent", false, true],
        ["custom", "on", true],
        ["custom", "CustomEvent", false, true],
      ],
      returned: [true, true, true, true, false],
      omitted: [[undefined], null],
    });
  });

  // A DOM polyfill, for example, replaces these globals.
  test("emit() does not build its event with the global MessageEvent or CustomEvent", async () => {
    const result = await withChannel(({ port1 }) => {
      const globals = { MessageEvent: globalThis.MessageEvent, CustomEvent: globalThis.CustomEvent };
      class Replaced {
        constructor() {
          throw new Error("emit() used the replaced global");
        }
      }
      const got: unknown[] = [];
      port1.on("message", (value: unknown) => void got.push(value));
      port1.addEventListener("message", (event: Event) => void got.push(event instanceof globals.MessageEvent));
      port1.on("custom", (value: unknown) => void got.push(value));
      port1.addEventListener("custom", (event: Event) => void got.push(event instanceof globals.CustomEvent));
      Object.assign(globalThis, { MessageEvent: Replaced, CustomEvent: Replaced });
      try {
        return { returned: [port1.emit("message", 1), port1.emit("custom", 2)], got };
      } finally {
        Object.assign(globalThis, globals);
      }
    });
    assert.deepStrictEqual(result, { returned: [true, true], got: [1, true, 2, true] });
  });

  test("emit() counts addEventListener() listeners and accepts a primitive", async () => {
    const result = await withChannel(({ port1 }) => {
      const got: unknown[] = [];
      port1.addEventListener("message", (event: MessageEvent) => void got.push(event.data));
      return { returned: port1.emit("message", 5), count: port1.listenerCount("message"), got };
    });
    assert.deepStrictEqual(result, { returned: true, count: 1, got: [5] });
  });

  test("emit() requires a string type", async () => {
    await withChannel(({ port1 }) => {
      for (const [type, received] of [
        [undefined, "undefined"],
        [5, "type number (5)"],
        [Symbol("s"), "type symbol (Symbol(s))"],
      ] as [unknown, string][]) {
        assert.throws(() => port1.emit(type, 1), {
          name: "TypeError",
          code: "ERR_INVALID_ARG_TYPE",
          message: `The "type" argument must be of type string. Received ${received}`,
        });
      }
    });
  });

  test("emit() and dispatchEvent() in a listener of a posted message leave the later listeners their message", async () => {
    const got = await withChannel(async ({ port1, port2 }) => {
      const got: unknown[] = [];
      port1.on("message", (value: unknown) => {
        got.push(["a", kind(value)]);
        if (value !== "posted") return;
        // Each of these dispatches runs to its end inside this listener.
        got.push(["emit message", port1.emit("message", "emitted")]);
        got.push(["emit custom", port1.emit("custom", "custom")]);
        port1.dispatchEvent(new MessageEvent("message", { data: "dispatched" }));
      });
      port1.on("message", (value: unknown) => void got.push(["b", kind(value)]));
      port1.on("custom", (value: unknown) => void got.push(["custom", kind(value)]));
      const seen = delivered(port1, "posted");
      port2.postMessage("posted");
      await seen;
      return got;
    });
    assert.deepStrictEqual(got, [
      ["a", "data:posted"],
      ["a", "data:emitted"],
      ["b", "data:emitted"],
      ["emit message", true],
      ["custom", "data:custom"],
      ["emit custom", true],
      ["a", "event"],
      ["b", "event"],
      ["b", "data:posted"],
    ]);
  });

  test("emit() in a listener of emit() leaves the later listeners the outer argument", async () => {
    const got = await withChannel(({ port1 }) => {
      const got: unknown[] = [];
      port1.on("outer", (value: unknown) => {
        got.push(["a", value]);
        port1.emit("inner", 2);
      });
      port1.on("inner", (value: unknown) => void got.push(["inner", value]));
      port1.on("outer", (value: unknown) => void got.push(["b", value]));
      port1.emit("outer", 1);
      return got;
    });
    assert.deepStrictEqual(got, [
      ["a", 1],
      ["inner", 2],
      ["b", 1],
    ]);
  });

  // Bun delivers the queued message inside close(), node after the listeners of the first one,
  // so the order within `b` is not compared.
  test("close() in a 'message' listener: the later listeners get each queued message, never the Event", async () => {
    const { port1, port2 } = new MessageChannel() as unknown as Ports;
    const a: string[] = [];
    const b: string[] = [];
    port1.on("message", (value: unknown) => {
      a.push(kind(value));
      port1.close();
    });
    port1.on("message", (value: unknown) => void b.push(kind(value)));
    const closing = closed(port1);
    port2.postMessage(1);
    port2.postMessage(2);
    await closing;
    port2.close();
    assert.deepStrictEqual({ a, b: b.sort() }, { a: ["data:1", "data:2"], b: ["data:1", "data:2"] });
  });

  // Spawned because the test runner would otherwise see the exceptions itself.
  test("a rejecting async on()/once() listener is reported as an uncaughtException", async () => {
    const result = await inOwnProcess(
      `const seen = [];
       process.on("uncaughtException", error => {
         seen.push(error.message);
         if (seen.length === 2) {
           console.log(JSON.stringify(seen));
           port1.close();
         }
       });
       port1.on("message", async () => { throw new Error("from on"); });
       port1.once("message", async () => { throw new Error("from once"); });
       port2.postMessage(1);`,
    );
    assert.deepStrictEqual(result, { stdout: [JSON.stringify(["from on", "from once"])], status: 0, signal: null });
  });
});

describe("MessagePort: what on(), once() and addListener() accept", () => {
  for (const add of ["on", "once", "addListener"]) {
    test(`${add}() rejects a listener that is not an object, before it converts the type`, async () => {
      const result = await withChannel(({ port1 }) => {
        for (const type of ["message", Symbol("s")]) {
          assert.throws(() => port1[add](type, 5), {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: 'The "listener" argument must be an instance of EventListener. Received type number (5)',
          });
        }
        return { count: port1.listenerCount("message"), hasRef: port1.hasRef() };
      });
      assert.deepStrictEqual(result, { count: 0, hasRef: false });
    });
  }

  // Spawned: the process warning would land in this runner's own stderr.
  test("on() with a null listener warns like addEventListener() and registers nothing", async () => {
    const result = await inOwnProcess(
      `process.on("warning", warning => {
         console.log(JSON.stringify({
           name: warning.name,
           type: warning.type,
           target: warning.target === port1,
           count: port1.listenerCount("message"),
           hasRef: port1.hasRef(),
         }));
       });
       console.log(port1.on("message", null) === port1);`,
    );
    assert.deepStrictEqual(result, {
      stdout: [
        "true",
        JSON.stringify({
          name: "AddEventListenerArgumentTypeWarning",
          type: "message",
          target: true,
          count: 0,
          hasRef: false,
        }),
      ],
      status: 0,
      signal: null,
    });
  });

  test("the methods throw ERR_INVALID_THIS for a receiver that is not a MessagePort", () => {
    const methods = [
      "on",
      "once",
      "addListener",
      "off",
      "removeListener",
      "emit",
      "listenerCount",
      "eventNames",
      "removeAllListeners",
      "setMaxListeners",
      "getMaxListeners",
    ];
    let calls = 0;
    const f = () => void calls++;
    const target = new EventTarget();
    target.addEventListener("custom", f);
    const controller = new AbortController();
    controller.signal.addEventListener("custom", f);
    const receivers: [string, unknown][] = [
      ["undefined", undefined],
      ["{}", {}],
      ["EventTarget", target],
      ["AbortSignal", controller.signal],
    ];

    const codes: Record<string, unknown> = {};
    for (const method of methods) {
      for (const [name, receiver] of receivers) {
        try {
          MessagePort.prototype[method].call(receiver, "custom", f);
          codes[`${method} on ${name}`] = "did not throw";
        } catch (error) {
          codes[`${method} on ${name}`] = (error as NodeJS.ErrnoException).code;
        }
      }
    }
    // The listeners of the borrowed receivers are still there.
    target.dispatchEvent(new Event("custom"));
    controller.signal.dispatchEvent(new Event("custom"));

    assert.deepStrictEqual(
      { codes, calls },
      {
        codes: Object.fromEntries(
          methods.flatMap(method => receivers.map(([name]) => [`${method} on ${name}`, "ERR_INVALID_THIS"])),
        ),
        calls: 2,
      },
    );
    // The receiver is checked before the arguments.
    const prototype = MessagePort.prototype as unknown as Port;
    assert.throws(() => prototype.emit.call({}, 5), { code: "ERR_INVALID_THIS" });
    assert.throws(() => prototype.on.call({}, "custom", 5), { code: "ERR_INVALID_THIS" });
  });
});

describe("MessagePort: setMaxListeners() and getMaxListeners()", () => {
  test("the limit is the one that events.setMaxListeners() sets", async () => {
    const result = await withChannel(({ port1, port2 }) => {
      const initial = port1.getMaxListeners();
      const returned = port1.setMaxListeners(5);
      const own = port1.getMaxListeners();
      port1.setMaxListeners();
      setMaxListeners(7, port2);
      return { initial, returned, own, reset: port1.getMaxListeners(), viaEvents: port2.getMaxListeners() };
    });
    const byDefault = EventEmitter.defaultMaxListeners;
    assert.deepStrictEqual(result, { initial: byDefault, returned: undefined, own: 5, reset: byDefault, viaEvents: 7 });
  });

  test("setMaxListeners() rejects a limit that is not a number of 0 or more", async () => {
    await withChannel(({ port1 }) => {
      assert.throws(() => port1.setMaxListeners(-1), { name: "RangeError", code: "ERR_OUT_OF_RANGE" });
      assert.throws(() => port1.setMaxListeners("5"), { name: "TypeError", code: "ERR_INVALID_ARG_TYPE" });
    });
  });
});

describe("MessagePort: a removed on() listener does not keep the thread alive", () => {
  for (const [name, calls] of [
    ["on(f), removeEventListener(f)", `port1.on("message", f); port1.removeEventListener("message", f);`],
    ["once(f), removeEventListener(f)", `port1.once("message", f); port1.removeEventListener("message", f);`],
    [
      "onmessage = g, on(f), removeEventListener(f), onmessage = null",
      `port1.onmessage = () => {}; port1.on("message", f); port1.removeEventListener("message", f); port1.onmessage = null;`,
    ],
  ]) {
    test(`${name} lets the process exit`, async () => {
      const result = await inOwnProcess(
        `const f = () => {};
         ${calls}
         console.log("count=" + port1.listenerCount("message") + " hasRef=" + port1.hasRef());`,
      );
      assert.deepStrictEqual(result, { stdout: ["count=0 hasRef=false"], status: 0, signal: null });
    });
  }

  test("parentPort.on(f) then parentPort.removeEventListener(f) lets a worker exit", async () => {
    const worker = new Worker(
      `const { parentPort } = require("node:worker_threads");
       const f = () => {};
       parentPort.on("message", f);
       parentPort.removeEventListener("message", f);
       parentPort.postMessage({ count: parentPort.listenerCount("message"), hasRef: parentPort.hasRef() });
       // Never fires when parentPort released the loop. It bounds the failure with its own exit code.
       setTimeout(() => process.exit(7), 2_000).unref();`,
      { eval: true },
    );
    const message = once(worker, "message");
    const exited = once(worker, "exit");
    assert.deepStrictEqual(
      { state: (await message)[0], exitCode: (await exited)[0] },
      { state: { count: 0, hasRef: false }, exitCode: 0 },
    );
  });
});

describe("MessagePort: results that Bun does not give yet", () => {
  test(
    "a closed port and a transferred port keep their listeners",
    todoOnBun("Bun drops the listeners of a closed or a transferred port: listenerCount() is 0, eventNames() is []"),
    async () => {
      const toClose = new MessageChannel() as unknown as Ports;
      const toTransfer = new MessageChannel() as unknown as Ports;
      const carrier = new MessageChannel() as unknown as Ports;
      const f = () => {};
      try {
        toClose.port1.on("message", f);
        // Not closed(): node keeps the type of a { once: true } listener that fired in eventNames().
        const { promise: closing, resolve: onClose } = Promise.withResolvers<void>();
        toClose.port1.addEventListener("close", onClose);
        toClose.port1.close();
        await closing;
        toClose.port1.removeEventListener("close", onClose);
        toTransfer.port1.on("message", f);
        carrier.port1.postMessage(null, [toTransfer.port1]);
        assert.deepStrictEqual(
          {
            closed: [toClose.port1.listenerCount("message"), eventNames(toClose.port1)],
            transferred: [toTransfer.port1.listenerCount("message"), eventNames(toTransfer.port1)],
          },
          { closed: [1, ["message"]], transferred: [1, ["message"]] },
        );
      } finally {
        for (const { port1, port2 } of [toClose, toTransfer, carrier]) {
          port1.close();
          port2.close();
        }
      }
    },
  );

  test(
    "on('messageerror') receives the error that deserialization threw",
    todoOnBun("Bun gives on('messageerror') listeners undefined. #39408 changes the value."),
    async () => {
      const got = await withChannel(async ({ port1, port2 }) => {
        const { promise, resolve } = Promise.withResolvers<unknown>();
        port1.on("messageerror", resolve);
        // Delivery starts with the first 'message' listener.
        port1.on("message", () => {});
        postUndeserializable(port2);
        return await promise;
      });
      assert.ok(got instanceof Error, `received ${String(got)}`);
    },
  );

  test(
    "on() and once() call the port's addEventListener()",
    todoOnBun("Bun adds the listener natively: its node-style mark does not travel through a replaced method"),
    async () => {
      const seen = await withChannel(({ port1 }) => {
        const seen: unknown[] = [];
        const { addEventListener } = port1;
        const f = () => {};
        port1.addEventListener = function (this: Port, type: string, listener: unknown, options) {
          seen.push([type, listener === f]);
          return addEventListener.call(this, type, listener, options);
        };
        port1.on("message", f);
        port1.once("custom", f);
        return seen;
      });
      assert.deepStrictEqual(seen, [
        ["message", true],
        ["custom", true],
      ]);
    },
  );

  test(
    "removeAllListeners() in a listener does not stop the listeners after it for that event",
    todoOnBun("Bun removes them from the dispatch in progress too, as removeEventListener() does"),
    async () => {
      const log = await withChannel(async ({ port1, port2 }) => {
        const log: string[] = [];
        const { promise: dispatched, resolve } = Promise.withResolvers<void>();
        port1.on("message", () => {
          log.push("a");
          port1.removeAllListeners("message");
          // Runs after every listener of this dispatch.
          queueMicrotask(resolve);
        });
        port1.on("message", () => void log.push("b"));
        port1.addEventListener("message", () => void log.push("c"));
        port2.postMessage(1);
        await dispatched;
        return log;
      });
      assert.deepStrictEqual(log, ["a", "b", "c"]);
    },
  );
});
