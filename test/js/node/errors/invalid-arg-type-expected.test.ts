import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { EventEmitter, addAbortListener, on, once } from "node:events";
import { Session } from "node:inspector";
import { timerify } from "node:perf_hooks";
import { Duplex, Readable, Writable, addAbortSignal } from "node:stream";
import { SyntheticModule } from "node:vm";

// The "must be ..." half of an ERR_INVALID_ARG_TYPE message is rendered by
// Message::ERR_INVALID_ARG_TYPE in src/jsc/bindings/ErrorCode.cpp. Node's
// lib/internal/errors.js treats a string `expected` as a one-entry list and
// classifies the entry: a kTypes name renders "of type x" (lower-cased), a name
// matching /^[A-Z][a-zA-Z0-9]*$/ renders "an instance of X", anything else is
// printed as written. The same formatter is reached from C++ callers that pass a
// C++ argument name, from C++ validators that receive the name from JS, and from
// the builtins' $ERR_INVALID_ARG_TYPE(name, "X", value). Every message below is
// what node v26.3.0 prints for the same call.

function caught(fn: () => unknown) {
  try {
    fn();
  } catch (error: any) {
    return { name: error.name, code: error.code, message: error.message };
  }
  throw new Error("expected the call to throw");
}

type Case = [label: string, call: () => unknown, message: string];

describe("ERR_INVALID_ARG_TYPE with a single class name renders 'an instance of'", () => {
  const cases: Case[] = [
    // C++ caller with a C++ argument name (JSBuffer.cpp copyBytesFrom).
    [
      "Buffer.copyBytesFrom(1)",
      () => Buffer.copyBytesFrom(1 as any),
      'The "view" argument must be an instance of TypedArray. Received type number (1)',
    ],
    [
      "Buffer.copyBytesFrom({})",
      () => Buffer.copyBytesFrom({} as any),
      'The "view" argument must be an instance of TypedArray. Received an instance of Object',
    ],

    // C++ validator whose argument name comes from JS (NodeValidator.cpp
    // validateAbortSignal); a dotted name is a "property".
    [
      "events.on() with a primitive signal",
      () => on(new EventEmitter(), "x", { signal: 1 as any }),
      'The "options.signal" property must be an instance of AbortSignal. Received type number (1)',
    ],
    [
      "events.on() with an object that is not a signal",
      () => on(new EventEmitter(), "x", { signal: {} as any }),
      'The "options.signal" property must be an instance of AbortSignal. Received an instance of Object',
    ],
    [
      "events.on() with a null signal",
      () => on(new EventEmitter(), "x", { signal: null as any }),
      'The "options.signal" property must be an instance of AbortSignal. Received null',
    ],

    // Builtins calling $ERR_INVALID_ARG_TYPE(name, "ClassName", value).
    [
      "events.addAbortListener(1)",
      () => addAbortListener(1 as any, () => {}),
      'The "signal" argument must be an instance of AbortSignal. Received type number (1)',
    ],
    [
      "stream.addAbortSignal(1)",
      () => addAbortSignal(1 as any, new Readable()),
      'The "signal" argument must be an instance of AbortSignal. Received type number (1)',
    ],
    [
      "new Readable({ signal: 'abc' })",
      () => new Readable({ signal: "abc" as any }),
      `The "signal" argument must be an instance of AbortSignal. Received type string ('abc')`,
    ],
    [
      "Readable.fromWeb(1)",
      () => Readable.fromWeb(1 as any),
      'The "readableStream" argument must be an instance of ReadableStream. Received type number (1)',
    ],
    [
      "Writable.fromWeb(1)",
      () => Writable.fromWeb(1 as any),
      'The "writableStream" argument must be an instance of WritableStream. Received type number (1)',
    ],
    [
      "Duplex.fromWeb({ readable: 1 })",
      () => Duplex.fromWeb({ readable: 1, writable: 1 } as any),
      'The "pair.readable" property must be an instance of ReadableStream. Received type number (1)',
    ],
    [
      "perf_hooks.timerify(fn, { histogram: 1 })",
      () => timerify(() => {}, { histogram: 1 as any }),
      'The "options.histogram" property must be an instance of RecordableHistogram. Received type number (1)',
    ],
  ];

  test.each(cases)("%s", (_label, call, message) => {
    expect(caught(call)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  });

  test("events.once(1) rejects with the same rendering", async () => {
    const error: any = await once(1 as any, "x").then(
      () => {
        throw new Error("expected once() to reject");
      },
      error => error,
    );
    expect({ name: error.name, code: error.code, message: error.message }).toEqual({
      name: "TypeError",
      code: "ERR_INVALID_ARG_TYPE",
      message: 'The "emitter" argument must be an instance of EventEmitter. Received type number (1)',
    });
  });
});

test("a kTypes name spelled with a capital renders lower-cased like node", () => {
  // inspector.ts passes "Object"; node's validateObject prints "object".
  expect(caught(() => new Session().post("Runtime.evaluate", 1 as any))).toEqual({
    name: "TypeError",
    code: "ERR_INVALID_ARG_TYPE",
    message: 'The "params" argument must be of type object. Received type number (1)',
  });
});

describe("renderings that do not involve a class name are unchanged", () => {
  const cases: Case[] = [
    [
      "primitive type name (process.chdir)",
      () => process.chdir(1 as any),
      'The "directory" argument must be of type string. Received type number (1)',
    ],
    [
      "pre-rendered list (Hash#update)",
      () => createHash("sha256").update(1 as any),
      'The "data" argument must be of type string or an instance of Buffer, TypedArray, or DataView. Received type number (1)',
    ],
    [
      "free-form phrase (vm.SyntheticModule)",
      () => new SyntheticModule(1 as any, () => {}),
      'The "exportNames" argument must be an Array of unique strings. Received type number (1)',
    ],
  ];

  test.each(cases)("%s", (_label, call, message) => {
    expect(caught(call)).toEqual({ name: "TypeError", code: "ERR_INVALID_ARG_TYPE", message });
  });
});
