/**
 *
 * This file attempts to run practically every function in Bun with no
 * arguments. This is sort of like a fuzzer.
 *
 * If you have a test failure pointing to this file, or if this file suddenly
 * started becoming flaky, that usually means a JS bindings issue or a memory bug.
 *
 * What this does:
 *
 * Go through most of the methods & constructors in Bun:
 * - Try to call them with no arguments - Foo()
 * - Try to construct them with no arguments - new Foo()
 *
 * If your code panics or crashes with an uncatchable exception when no
 * arguments are passed, that's a bug you should fix.
 *
 */

const ENABLE_LOGGING = false;

import { afterAll, describe, test } from "bun:test";
import { EventEmitter } from "events";
import { isWindows } from "harness";
var calls = 0,
  constructs = 0,
  subclasses = 0;
afterAll(() => {
  process.stdout.write(`\nStats: ${calls} calls, ${constructs} constructs, ${subclasses} subclasses\n`);
});
const Promise = globalThis.Promise;
globalThis.Promise = function (...args) {
  if (args.length === 0) {
    return Promise.resolve();
  }

  const { resolve, reject, promise } = Promise.withResolvers();
  args[0](resolve, reject);

  return promise?.catch?.(e => {
    if (ENABLE_LOGGING) {
      console.log(e);
    }
  });
};
globalThis.Promise.prototype = Promise.prototype;
Object.assign(globalThis.Promise, Promise);

function wrap(input) {
  if (typeof input?.catch === "function") {
    return input?.catch?.(e => {
      if (ENABLE_LOGGING) {
        console.error(e);
      }
    });
  }

  return input;
}

// Don't allow these to be called
delete process.exit;
delete process._reallyExit;
delete process.reallyExit;
delete process.abort;
delete process.kill;
delete process._kill;
delete process._destroy;
delete process._events;
delete process.openStdin;
delete process.emitWarning;
delete require("stream").Readable.prototype.destroy;
delete globalThis.Loader;
// ** Uncatchable errors in tests **
delete ReadableStreamDefaultReader.prototype["closed"];
delete ReadableStreamBYOBReader.prototype["closed"];
delete WritableStreamDefaultWriter.prototype["ready"];
delete WritableStreamDefaultWriter.prototype["closed"];
WebAssembly.compile = () => {};
WebAssembly.instantiate = () => {};
// ** Uncatchable errors in tests **

const banned = [
  "alert",
  "prompt",
  "confirm",
  "open",
  "close",
  "connect",
  "listen",
  "_start",
  "wait",
  "wait",
  "sleep",
  "exit",
  "kill",
  // "_read",
  // "read",
  // "_write",
  // "resume",
];
const drainMicrotasks = require("bun:jsc").drainMicrotasks;

import.meta.require.cache["bun:jsc"] = {};
delete console.takeHeapSnapshot;
delete console.clear;
delete console.warn;
delete console.time;
delete console.timeEnd;
delete console.trace;
delete console.timeLog;
delete console.assert;
Bun.generateHeapSnapshot = () => {};

const ignoreList = [
  Object.prototype,
  Function.prototype,
  Array.prototype,
  async function () {}.prototype,
  function* () {}.prototype,
  async function* () {}.prototype,
  function* () {}.prototype,
  Uint8Array.prototype,
  Uint16Array.prototype,
  Uint32Array.prototype,
  Int8Array.prototype,
  Int16Array.prototype,
  Int32Array.prototype,
  Float16Array.prototype,
  Float32Array.prototype,
  Float64Array.prototype,
  BigInt64Array.prototype,
  BigUint64Array.prototype,
  ArrayBuffer.prototype,
  DataView.prototype,
  Promise.prototype,
  SharedArrayBuffer.prototype,
  Error.prototype,
  EvalError.prototype,
  RangeError.prototype,
  ReferenceError.prototype,
  SyntaxError.prototype,
  TypeError.prototype,
  URIError.prototype,
  RegExp.prototype,
  Date.prototype,
  String.prototype,
];

const constructBanned = banned;
const callBanned = [...banned];

function allThePropertyNames(object, banned) {
  if (!object) {
    return [];
  }
  const names = Object.getOwnPropertyNames(object);
  var pro = Object.getPrototypeOf(object);

  while (pro) {
    if (ignoreList.includes(pro)) {
      break;
    }

    names.push(...Object.getOwnPropertyNames(pro));
    pro = Object.getPrototypeOf(pro);
  }

  for (const ban of banned) {
    const index = names.indexOf(ban);
    if (index !== -1) {
      names.splice(index, 1);
    }
  }

  return names;
}

if (ENABLE_LOGGING) {
  {
    const original = Reflect.construct;
    Reflect.construct = function (...args) {
      try {
        console.log(args?.[0]?.name || args?.[1]?.name || args?.[0]?.name || args?.[0]?.[Symbol.toStringTag]);
      } catch (e) {}
      return original(...args);
    };
  }
  {
    const original = Reflect.apply;
    Reflect.apply = function (...args) {
      try {
        console.log(args?.[0]?.name || args?.[1]?.name || args?.[0]?.name || args?.[0]?.[Symbol.toStringTag]);
      } catch (e) {}
      return original(...args);
    };
  }
}

const seenValues = new WeakSet();
var callAllMethodsCount = 0;
function callAllMethods(object) {
  callAllMethodsCount++;
  const queue = [];
  const seen = new Set([object, object?.subarray]);
  for (const methodName of allThePropertyNames(object, callBanned)) {
    try {
      try {
        if (object instanceof EventEmitter) {
          object?.on?.("error", () => {});
        }
        const returnValue = wrap(Reflect.apply(object?.[methodName], object, []));
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        calls++;
      } catch (e) {
        const returnValue = wrap(Reflect.apply(object.constructor?.[methodName], object?.constructor, []));
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        calls++;
      }
    } catch (e) {
      const val = object?.[methodName];
      if (val && (typeof val === "object" || typeof val === "function") && !seenValues.has(val)) {
        seenValues.add(val);
        queue.push(val);
      }
    } finally {
    }
  }

  while (queue.length) {
    const value = queue.shift();
    if (value) {
      for (const methodName of allThePropertyNames(value, callBanned)) {
        try {
          const method = value?.[methodName];
          if (method && seen.has(method)) {
            continue;
          }
          seen.add(method);
          if (value instanceof EventEmitter) {
            value?.on?.("error", () => {});
          }
          const returnValue = wrap(Reflect?.apply?.(method, value, []));
          if (returnValue?.then) {
            continue;
          }
          (Bun.inspect?.(returnValue), queue.push(returnValue));
          calls++;
        } catch (e) {}
      }
    }
  }
}

function constructAllConstructors(object) {
  const queue = [];
  const seen = new Set([object?.subarray]);
  for (const methodName of allThePropertyNames(object, constructBanned)) {
    const method = object?.[methodName];

    try {
      try {
        const returnValue = Reflect.construct(object, [], method);
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        constructs++;
      } catch (e) {
        const returnValue = Reflect.construct(object?.constructor, [], method);
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        constructs++;
      }
    } catch (e) {
      try {
        const returnValue = Reflect.construct(object?.prototype?.constructor, [], method);
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        constructs++;
      } catch (e) {
        Error.captureStackTrace(e);
      }
    }
  }

  while (queue.length) {
    const value = queue.shift();
    for (const methodName of allThePropertyNames(value, constructBanned)) {
      try {
        const method = value?.[methodName];
        if (method && seen.has(method)) {
          continue;
        }

        const returnValue = Reflect.construct(value, [], method);
        if (seen.has(returnValue)) {
          continue;
        }

        (Bun.inspect?.(returnValue), queue.push(returnValue));
        seen.add(returnValue);
        constructs++;
      } catch (e) {}
    }
  }
}

function constructAllConstructorsWithSubclassing(object) {
  const queue = [];
  const seen = new Set([object?.subarray]);
  for (const methodName of allThePropertyNames(object, constructBanned)) {
    const method = object?.[methodName];

    try {
      try {
        // Create a subclass of the constructor
        class Subclass extends object {}
        const returnValue = Reflect.construct(object, [], Subclass);
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        subclasses++;
      } catch (e) {
        try {
          // Try with the constructor property
          class Subclass extends object?.constructor {}
          const returnValue = Reflect.construct(object?.constructor, [], Subclass);
          (Bun.inspect?.(returnValue), queue.push(returnValue));
          subclasses++;
        } catch (e) {
          // Fallback to a more generic approach
          const Subclass = function () {};
          Object.setPrototypeOf(Subclass.prototype, object);
          const returnValue = Reflect.construct(object, [], Subclass);
          (Bun.inspect?.(returnValue), queue.push(returnValue));
          subclasses++;
        }
      }
    } catch (e) {
      try {
        // Try with prototype constructor
        class Subclass extends object?.prototype?.constructor {}
        const returnValue = Reflect.construct(object?.prototype?.constructor, [], Subclass);
        (Bun.inspect?.(returnValue), queue.push(returnValue));
        subclasses++;
      } catch (e) {
        Error.captureStackTrace(e);
      }
    }
  }

  while (queue.length) {
    const value = queue.shift();
    for (const methodName of allThePropertyNames(value, constructBanned)) {
      try {
        const method = value?.[methodName];
        if (method && seen.has(method)) {
          continue;
        }

        // Create a subclass of the value
        try {
          class Subclass extends value {}
          const returnValue = Reflect.construct(value, [], Subclass);
          if (seen.has(returnValue)) {
            continue;
          }

          (Bun.inspect?.(returnValue), queue.push(returnValue));
          seen.add(returnValue);
          subclasses++;
        } catch (e) {
          // Fallback to a more generic approach
          const Subclass = function () {};
          Object.setPrototypeOf(Subclass.prototype, value);
          const returnValue = Reflect.construct(value, [], Subclass);
          if (seen.has(returnValue)) {
            continue;
          }

          (Bun.inspect?.(returnValue), queue.push(returnValue));
          seen.add(returnValue);
          subclasses++;
        }
      } catch (e) {}
    }
  }
}

const modules = [
  "module",
  "util",
  "url",
  "path",
  "path/posix",
  "path/win32",
  "perf_hooks",
  "os",
  "dgram",
  "domain",
  "crypto",
  "util/types",
  "http",
  "_http_agent",
  "_http_client",
  "_http_common",
  "_http_incoming",
  "_http_outgoing",
  "_http_server",
  "http2",
  "process",
  "undici",
  "timers",
  "punycode",
  "trace_events",
  "child_process",
  "diagnostics_channel",
  "http2",
  "bun:ffi",
  "string_decoder",
  "bun:sqlite",
  "fs/promises",
];

for (const mod of modules) {
  describe(mod, () => {
    test("call", () => callAllMethods(require(mod)));
    test("construct", () => constructAllConstructors(require(mod)));
    test("construct-subclass", () => constructAllConstructorsWithSubclassing(require(mod)));
  });
}

for (const HardCodedClass of [
  require("fs").ReadStream,
  require("fs").WriteStream,
  require("tty").ReadStream,
  require("tty").WriteStream,
  require("fs").Stats,
  require("fs").Dirent,
  Intl,
  Intl.Collator,
  Intl.DateTimeFormat,
  Intl.ListFormat,
  Intl.NumberFormat,
  Intl.PluralRules,
  Intl.RelativeTimeFormat,
  Intl.Locale,
  Intl.DisplayNames,
  Intl.Segmenter,

  // TODO: undefined is not an object
  // require("fs").FSWatcher,

  process,
]) {
  test("call " + (HardCodedClass.name || HardCodedClass.toString()), () => constructAllConstructors(HardCodedClass));
  test("construct " + (HardCodedClass.name || HardCodedClass.toString()), () => callAllMethods(HardCodedClass));
  test("construct-subclass " + (HardCodedClass.name || HardCodedClass.toString()), () =>
    constructAllConstructorsWithSubclassing(HardCodedClass),
  );
}

const globals = [
  [globalThis, "globalThis"],
  [Bun, "Bun"],
] as const;

for (const [Global, name] of globals) {
  describe(name, () => {
    // TODO: hangs in CI on Windows.
    test.skipIf(isWindows && Global === Bun)("call", async () => {
      await Bun.sleep(1);
      callAllMethods(Global);
      await Bun.sleep(1);
    });
    // TODO: hangs in CI on Windows.
    test.skipIf(isWindows && Global === Bun)("construct", async () => {
      await Bun.sleep(1);
      constructAllConstructors(Global);
      await Bun.sleep(1);
    });
    test.skipIf(isWindows && Global === Bun)("construct-subclass", async () => {
      await Bun.sleep(1);
      constructAllConstructorsWithSubclassing(Global);
      await Bun.sleep(1);
    });
  });
}
