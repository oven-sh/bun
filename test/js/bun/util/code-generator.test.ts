/**
 *
 * This is sort of like a fuzzer.
 *
 * We go through most of the methods & constructors in Bun
 * Try to call them with no arguments
 * Try to construct them with no arguments
 *
 * This is mostly to catch assertion failures in generated code
 *
 */

const logCalled = false;

import { test, expect, describe } from "bun:test";
import { CryptoHasher } from "bun";

// Don't allow these to be called
delete require("process").exit;
delete require("process")._reallyExit;
delete require("process").abort;
delete require("process").kill;

// ** Uncatchable errors in tests **
delete ReadableStreamDefaultReader.prototype["closed"];
delete ReadableStreamBYOBReader.prototype["closed"];
delete WritableStreamDefaultWriter.prototype["ready"];
delete WritableStreamDefaultWriter.prototype["closed"];
// ** Uncatchable errors in tests **

const banned = ["alert", "prompt", "confirm", "open", "close", "connect", "listen", "_start"];
const drainMicrotasks = require("bun:jsc").drainMicrotasks;

const TODOs = [
  "ByteLengthQueuingStrategy",
  "CountQueuingStrategy",
  "ReadableByteStreamController",
  "ReadableStream",
  "ReadableStreamBYOBReader",
  "ReadableStreamBYOBRequest",
  "ReadableStreamDefaultController",
  "ReadableStreamDefaultReader",
  "TransformStream",
  "TransformStreamDefaultController",
  "Worker",
  "WritableStream",
  "WritableStreamDefaultController",
  "WritableStreamDefaultWriter",
];

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

  // TODO: getFunctionRealm() on these.
  ReadableStream.prototype,
];

const constructBanned = banned;
const callBanned = [...TODOs, ...banned];

function allThePropertyNames(object, banned) {
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

if (logCalled) {
  {
    const original = Reflect.construct;
    Reflect.construct = function (...args) {
      try {
        console.log(args?.[1]?.name || args?.[0]?.name || args?.[0]?.[Symbol.toStringTag]);
      } catch (e) {}
      return original(...args);
    };
  }
  {
    const original = Reflect.apply;
    Reflect.apply = function (...args) {
      try {
        console.log(args?.[1]?.name || args?.[0]?.name || args?.[0]?.[Symbol.toStringTag]);
      } catch (e) {}
      return original(...args);
    };
  }
}

const seenValues = new WeakSet();
function callAllMethods(object) {
  const queue = [];
  const seen = new Set([object, object?.__proto__, object?.constructor, object?.subarray]);
  for (const methodName of allThePropertyNames(object, callBanned)) {
    try {
      const returnValue = Reflect.apply(object?.[methodName], object, []);
      queue.push(returnValue);
      drainMicrotasks();
    } catch (e) {}
  }

  while (queue.length) {
    const value = queue.shift();
    if (value && typeof value === "object") {
      for (const methodName of allThePropertyNames(value, callBanned)) {
        try {
          const method = value?.[methodName];
          if (method && seen.has(method)) {
            continue;
          }
          seen.add(method);

          const returnValue = Reflect.apply(method, value, []);
          if (seen.has(returnValue) || returnValue?.then) {
            continue;
          }
          seen.add(returnValue);
          queue.push(returnValue);
          drainMicrotasks();
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
      const returnValue = Reflect.construct(object, method, []);
      queue.push(returnValue);
    } catch (e) {
      try {
        const returnValue = Reflect.construct(object.constructor, [], method);
        queue.push(returnValue);
        drainMicrotasks();
      } catch (e) {}
    }
  }

  while (queue.length) {
    const value = queue.shift();
    if (value && typeof value === "object") {
      for (const methodName of allThePropertyNames(value, constructBanned)) {
        try {
          const method = value?.[methodName];
          if (method && seen.has(method)) {
            continue;
          }
          seen.add(method);
          const returnValue = Reflect.construct(object, method, [], value);
          if (seen.has(returnValue) || seen.has(returnValue?.__proto__ || returnValue?.then)) {
            continue;
          }
          seen.add(returnValue);
          queue.push(returnValue);
          drainMicrotasks();
        } catch (e) {}
      }
    }
  }
}

describe("Call all methods", () => {
  test("globalThis", () => {
    callAllMethods(globalThis);
  });

  test("Bun", () => {
    callAllMethods(Bun);
  });

  test("node:url", () => {
    callAllMethods(require("url"));
  });

  test("node:util", () => {
    callAllMethods(require("util"));
  });

  test("node:path", () => {
    callAllMethods(require("path"));
  });

  test("node:module", () => {
    callAllMethods(require("module"));
  });

  test("node:http2", () => {
    callAllMethods(require("http2"));
  });

  test("node:diagnostics_channel", () => {
    callAllMethods(require("diagnostics_channel"));
  });

  test("node:os", () => {
    callAllMethods(require("os"));
  });

  test("node:perf_hooks", () => {
    callAllMethods(require("perf_hooks"));
  });

  test("node:child_process", () => {
    callAllMethods(require("child_process"));
  });

  test("bun:ffi", () => {
    callAllMethods(require("bun:ffi"));
  });

  test("node:trace_events", () => {
    callAllMethods(require("node:trace_events"));
  });

  test("node:punycode", () => {
    callAllMethods(require("node:punycode"));
  });

  test("node:timers", () => {
    callAllMethods(require("node:timers"));
  });

  test("node:crypto", () => {
    callAllMethods(require("node:crypto"));
  });

  test("node:dgram", () => {
    callAllMethods(require("node:dgram"));
  });

  test("node:domain", () => {
    callAllMethods(require("node:domain"));
  });
});

describe("Construct all constructors", () => {
  test("globalThis", async () => {
    globalThis.reportError = console.error;

    constructAllConstructors(globalThis);
    await Bun.sleep(1);
  });

  test("Bun", async () => {
    globalThis.reportError = console.error;

    constructAllConstructors(Bun);
    await Bun.sleep(1);
  });

  test("node:url", () => {
    constructAllConstructors(require("url"));
  });

  test("node:util", () => {
    constructAllConstructors(require("util"));
  });

  test("node:path", () => {
    constructAllConstructors(require("path"));
  });

  test("node:module", () => {
    constructAllConstructors(require("module"));
  });
});

for (const HardCodedClass of [
  require("fs").ReadStream,
  require("fs").WriteStream,
  require("tty").ReadStream,
  require("tty").WriteStream,
  require("fs").Stats,
  require("fs").Dirent,

  // TODO: undefined is not an object
  // require("fs").FSWatcher,

  require("process"),
]) {
  test("call " + HardCodedClass.name || HardCodedClass?.toString?.(), () => constructAllConstructors(HardCodedClass));
  test("construct " + HardCodedClass.name || HardCodedClass?.toString?.(), () => callAllMethods(HardCodedClass));
}
