import { describe, expect, test } from "bun:test";
import { Readable, Writable } from "node:stream";

// What a program can see of ReadableState and WritableState, as Node.js has it.
const classes = [
  ["ReadableState", (Readable as any).ReadableState, () => (new Readable({ read() {} }) as any)._readableState],
  ["WritableState", (Writable as any).WritableState, () => (new Writable({ write() {} }) as any)._writableState],
] as const;

describe.each(classes)("%s", (_name, State, makeState) => {
  const prototype = Object.getPrototypeOf(makeState());
  const accessors = Object.getOwnPropertyNames(prototype).filter(
    name => typeof Object.getOwnPropertyDescriptor(prototype, name)!.get === "function",
  );

  test("is the class of a stream's state", () => {
    expect(State).toBeFunction();
    expect(State.length).toBe(3);
    expect(State.prototype).toBe(prototype);
    expect(makeState()).toBeInstanceOf(State);
  });

  test("can be called without new on an object of the caller", () => {
    const target: Record<string, unknown> = {};
    expect(State.call(target, {}, undefined, false)).toBeUndefined();
    expect(target.highWaterMark).toBeNumber();
    expect(Object.keys(target)).toEqual(Object.keys(new State({}, undefined, false)));
  });

  test("has accessors that can be neither listed nor defined anew", () => {
    expect(accessors.length).toBeGreaterThan(20);
    for (const name of accessors) {
      const { configurable, enumerable } = Object.getOwnPropertyDescriptor(prototype, name)!;
      expect({ name, configurable, enumerable }).toEqual({ name, configurable: false, enumerable: false });
    }
    expect(() => Object.defineProperty(prototype, accessors[0], { value: 1 })).toThrow(TypeError);
    expect(Reflect.deleteProperty(prototype, accessors[0])).toBe(false);
  });

  test("has the method that runs when construction ends", () => {
    const symbols = Object.getOwnPropertySymbols(prototype).map(symbol => symbol.description);
    expect(symbols).toEqual(["kOnConstructed"]);
  });
});

test("ReadableState.prototype has Node.js' accessors and no other", () => {
  const prototype = (Readable as any).ReadableState.prototype;
  expect(Object.getOwnPropertyNames(prototype).filter(name => name !== "constructor")).toEqual([
    "objectMode",
    "ended",
    "endEmitted",
    "reading",
    "constructed",
    "sync",
    "needReadable",
    "emittedReadable",
    "readableListening",
    "resumeScheduled",
    "errorEmitted",
    "emitClose",
    "autoDestroy",
    "destroyed",
    "closed",
    "closeEmitted",
    "multiAwaitDrain",
    "readingMore",
    "dataEmitted",
    "errored",
    "defaultEncoding",
    "decoder",
    "encoding",
    "flowing",
    "pipesCount",
    "paused",
  ]);
});

test("WritableState.prototype has Node.js' members in Node.js' order", () => {
  const prototype = (Writable as any).WritableState.prototype;
  expect(Object.getOwnPropertyNames(prototype).filter(name => name !== "constructor")).toEqual([
    "objectMode",
    "finalCalled",
    "needDrain",
    "ending",
    "ended",
    "finished",
    "destroyed",
    "decodeStrings",
    "writing",
    "sync",
    "bufferProcessing",
    "constructed",
    "prefinished",
    "errorEmitted",
    "emitClose",
    "autoDestroy",
    "closed",
    "closeEmitted",
    "allBuffers",
    "allNoop",
    "errored",
    "writable",
    "defaultEncoding",
    "writecb",
    "afterWriteTickInfo",
    "buffered",
    "getBuffer",
    "bufferedRequestCount",
  ]);
});

test("WritableState's onwrite is a bound function", () => {
  const { onwrite } = (new Writable({ write() {} }) as any)._writableState;
  expect(onwrite.name).toBe("bound onwrite");
  expect("prototype" in onwrite).toBe(false);
  expect(Function.prototype.toString.call(onwrite)).toContain("[native code]");
});
