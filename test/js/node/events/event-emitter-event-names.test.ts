/**
 * All tests in this file run in both Bun and Node.js: `bun test` runs them
 * here, and the last test runs this same file under Node.js.
 *
 * A name whose slot in `_events` holds `undefined` has no listener, and
 * eventNames() does not list it:
 * https://github.com/nodejs/node/blob/v26.12.1/lib/events.js#L872-L883
 */
import assert from "node:assert";
import EventEmitter from "node:events";
import { Duplex, Readable, Writable } from "node:stream";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const fn = () => {};
const eventsOf = (emitter: EventEmitter) => (emitter as any)._events as Record<string | symbol, unknown>;

// When `_events` exists before the constructor runs, removeListener() stores `undefined` and keeps the key.
class ConstructedTwice extends EventEmitter {
  constructor() {
    super();
    (EventEmitter as any).call(this);
  }
}

describe("eventNames() skips a name whose slot in _events holds undefined", () => {
  test("after off() on an emitter whose constructor ran twice", () => {
    function CalledTwice(this: EventEmitter) {
      (EventEmitter as any).call(this);
      (EventEmitter as any).call(this);
    }
    Object.setPrototypeOf(CalledTwice.prototype, EventEmitter.prototype);
    for (const emitter of [new ConstructedTwice(), new (CalledTwice as any)() as EventEmitter]) {
      emitter.on("a", fn).on("b", fn).off("a", fn);
      assert.deepStrictEqual(
        { names: emitter.eventNames(), keys: Reflect.ownKeys(eventsOf(emitter)) },
        { names: ["b"], keys: ["a", "b"] },
      );
    }
  });

  test("when _events is set before the constructor runs", () => {
    function Preset(this: any) {
      this._events = { a: undefined, b: undefined };
      (EventEmitter as any).call(this);
    }
    Object.setPrototypeOf(Preset.prototype, EventEmitter.prototype);
    const emitter: EventEmitter = new (Preset as any)();
    const seen = [emitter.eventNames()];
    emitter.on("a", fn).on("c", fn);
    seen.push(emitter.eventNames());
    emitter.off("a", fn);
    seen.push(emitter.eventNames());
    assert.deepStrictEqual(
      { seen, keys: Reflect.ownKeys(eventsOf(emitter)) },
      { seen: [[], ["a", "c"], ["c"]], keys: ["a", "b", "c"] },
    );
  });

  test("EventEmitter.prototype.eventNames.call() on a stream", () => {
    const streams = [new Readable({ read() {} }), new Writable({ write() {} }), new Duplex({ read() {}, write() {} })];
    for (const stream of streams) {
      stream.on("x", fn);
      assert.deepStrictEqual(EventEmitter.prototype.eventNames.call(stream), ["x"]);
    }
  });

  test("a once() listener that has run, and a name inside its 'removeListener' listener", () => {
    const emitter = new ConstructedTwice();
    const seen: (string | symbol)[][] = [];
    emitter.on("removeListener", () => seen.push(emitter.eventNames()));
    emitter.on("keep", fn);
    emitter.once("ready", () => seen.push(emitter.eventNames()));
    emitter.emit("ready");
    seen.push(emitter.eventNames());
    assert.deepStrictEqual(seen, [
      ["removeListener", "keep"],
      ["removeListener", "keep"],
      ["removeListener", "keep"],
    ]);
  });

  test("removeAllListeners(name) deletes its key and leaves the other emptied slots", () => {
    const emitter = new ConstructedTwice();
    emitter.on("a", fn).on("b", fn).on("c", fn).off("a", fn).removeAllListeners("b");
    assert.deepStrictEqual(
      { names: emitter.eventNames(), keys: Reflect.ownKeys(eventsOf(emitter)) },
      { names: ["c"], keys: ["a", "c"] },
    );
  });

  // `_eventsCount` still counts these slots. emitter-listener (under cls-hooked) leaves an emitter in this state.
  test("undefined stored from outside, at every place among a, b, c, d", () => {
    const listedWithout = (...emptied: string[]) => {
      const emitter = new EventEmitter();
      for (const name of ["a", "b", "c", "d"]) emitter.on(name, fn);
      for (const name of emptied) eventsOf(emitter)[name] = undefined;
      return emitter.eventNames().join(" ");
    };
    assert.deepStrictEqual(
      {
        first: listedWithout("a"),
        middle: listedWithout("b"),
        last: listedWithout("d"),
        neighbours: listedWithout("b", "c"),
        everySecond: listedWithout("a", "c"),
        all: listedWithout("a", "b", "c", "d"),
      },
      { first: "b c d", middle: "a c d", last: "a b c", neighbours: "a d", everySecond: "b d", all: "" },
    );
  });

  test("only undefined is skipped, and the order of the keys is kept", () => {
    const kept = Symbol("kept");
    const emptied = Symbol("emptied");
    const emitter = new EventEmitter();
    const names = ["null", emptied, "b", "1", "zero", kept, "false", "empty", "list", "lateNull", "0"];
    for (const name of names) emitter.on(name, fn);
    const events = eventsOf(emitter);
    events.null = events.lateNull = null;
    events.b = events[emptied] = undefined;
    events.zero = 0;
    events.false = false;
    events.empty = "";
    events.list = [];
    assert.deepStrictEqual(emitter.eventNames(), [
      "0",
      "1",
      "null",
      "zero",
      "false",
      "empty",
      "list",
      "lateNull",
      kept,
    ]);
  });

  test("reads the count, then _events, then the keys, then every slot once in the order of the keys", () => {
    const log: string[] = [];
    const logged = <T extends object>(name: string, target: T) =>
      new Proxy(target, {
        get(target, key, receiver) {
          log.push(`${name} get ${String(key)}`);
          return Reflect.get(target, key, receiver);
        },
        has(target, key) {
          log.push(`${name} has ${String(key)}`);
          return Reflect.has(target, key);
        },
        ownKeys(target) {
          log.push(`${name} ownKeys`);
          return Reflect.ownKeys(target);
        },
        getOwnPropertyDescriptor(target, key) {
          log.push(`${name} getOwnPropertyDescriptor ${String(key)}`);
          return Reflect.getOwnPropertyDescriptor(target, key);
        },
      });
    const receiver = logged("this", { _events: logged("_events", { a() {}, b: undefined, c() {} }), _eventsCount: 2 });
    assert.deepStrictEqual(EventEmitter.prototype.eventNames.call(receiver), ["a", "c"]);
    assert.deepStrictEqual(log, [
      "this get _eventsCount",
      "this get _events",
      "_events ownKeys",
      "_events get a",
      "_events get b",
      "_events get c",
    ]);
  });

  test("a count of zero answers without a read of _events", () => {
    const receiver = {
      _eventsCount: 0,
      get _events(): never {
        throw new Error("_events was read");
      },
    };
    assert.deepStrictEqual(EventEmitter.prototype.eventNames.call(receiver), []);
  });

  test("every call gives a new array", () => {
    const emitters = [new EventEmitter(), new ConstructedTwice().on("removed", fn).off("removed", fn)];
    for (const emitter of emitters) {
      emitter.on("a", fn).on("b", fn).on("c", fn);
      const names = emitter.eventNames();
      names[0] = "changed";
      names.push("added");
      assert.deepStrictEqual(emitter.eventNames(), ["a", "b", "c"]);
      assert.notStrictEqual(emitter.eventNames(), emitter.eventNames());
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const { bunEnv, nodeExeAtLeast } = await import("harness");
  // Node.js v26.6.0 is the first v26 release whose eventNames() reads the slots.
  const node = nodeExeAtLeast("26.6.0");

  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node
      // process per file. node:test still exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", fileURLToPath(import.meta.url)],
        env: { ...bunEnv, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
