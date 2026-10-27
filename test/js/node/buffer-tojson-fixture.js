// Calls Buffer.prototype.toJSON on each shape below and compares the result with what Node.js v26.3.0 returns.
// Node.js copies by index up to the %TypedArray%.prototype.length of the receiver, so it runs no user code:
// https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L1241-L1250
// buffer.test.js runs this fixture under Bun, and under Node.js when that has https://github.com/nodejs/node/pull/61871.
"use strict";

const toJSON = Buffer.prototype.toJSON;
const TypedArrayPrototype = Object.getPrototypeOf(Uint8Array.prototype);
const ArrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
const typedArrayIterator = TypedArrayPrototype[Symbol.iterator];

// Calls of a `length` getter or of an iteration hook that a row installed.
let userCalls = 0;

const live = () => Buffer.from([1, 2, 3]);

function detachable() {
  const ab = new ArrayBuffer(3);
  return { ab, buf: Buffer.from(ab).fill(7) };
}

function detached() {
  const { ab, buf } = detachable();
  ab.transfer();
  return buf;
}

function outOfBounds() {
  const rab = new ArrayBuffer(4, { maxByteLength: 8 });
  const buf = Buffer.from(rab, 0, 4);
  rab.resize(2);
  return buf;
}

const lengthGetter = value => ({
  get() {
    userCalls++;
    return value;
  },
  configurable: true,
});

const throwingGetter = {
  get() {
    userCalls++;
    throw new RangeError("my length");
  },
  configurable: true,
};

function* yieldNine() {
  userCalls++;
  yield 9;
}

// Calls toJSON on `receiver` while `key` of `target` is `descriptor`.
function patched(target, key, descriptor, receiver) {
  const original = Object.getOwnPropertyDescriptor(target, key);
  Object.defineProperty(target, key, { configurable: true, ...descriptor });
  try {
    return toJSON.call(receiver);
  } finally {
    if (original) Object.defineProperty(target, key, original);
    else delete target[key];
  }
}

const rows = [
  // A `length` on the Buffer or on its prototype chain. Node.js never reads it.
  ["live", "[1,2,3]", () => toJSON.call(live())],
  ["live, own length 0", "[1,2,3]", () => toJSON.call(Object.defineProperty(live(), "length", { value: 0 }))],
  ["live, own length 2", "[1,2,3]", () => toJSON.call(Object.defineProperty(live(), "length", { value: 2 }))],
  ["live, own length 5", "[1,2,3]", () => toJSON.call(Object.defineProperty(live(), "length", { value: 5 }))],
  ["live, own length getter", "[1,2,3]", () => toJSON.call(Object.defineProperty(live(), "length", lengthGetter(0)))],
  [
    "live, own length getter that throws",
    "[1,2,3]",
    () => toJSON.call(Object.defineProperty(live(), "length", throwingGetter)),
  ],
  [
    "live, own length getter that detaches",
    "[7,7,7]",
    () => {
      const { ab, buf } = detachable();
      Object.defineProperty(buf, "length", {
        get() {
          userCalls++;
          ab.transfer();
          return 3;
        },
      });
      return toJSON.call(buf);
    },
  ],
  [
    "live, subclass length getter",
    "[1,2,3]",
    () => {
      class Sub extends Buffer {
        get length() {
          userCalls++;
          return 0;
        }
      }
      return toJSON.call(Object.setPrototypeOf(live(), Sub.prototype));
    },
  ],
  [
    "live, Buffer.prototype length getter",
    "[1,2,3]",
    () => patched(Buffer.prototype, "length", lengthGetter(0), live()),
  ],
  [
    "live, Uint8Array.prototype length getter",
    "[1,2,3]",
    () => patched(Uint8Array.prototype, "length", lengthGetter(0), live()),
  ],
  [
    "live, %TypedArray%.prototype length getter replaced",
    "[1,2,3]",
    () => patched(TypedArrayPrototype, "length", lengthGetter(0), live()),
  ],

  // A detached or out-of-bounds view has no bytes.
  ["detached", "[]", () => toJSON.call(detached())],
  ["out of bounds", "[]", () => toJSON.call(outOfBounds())],
  [
    "length-tracking, byteOffset past the end",
    "[]",
    () => {
      const rab = new ArrayBuffer(8, { maxByteLength: 8 });
      const buf = Buffer.from(rab, 4);
      rab.resize(2);
      return toJSON.call(buf);
    },
  ],
  ["detached, own length 3", "[]", () => toJSON.call(Object.defineProperty(detached(), "length", { value: 3 }))],
  [
    "detached, own length getter that throws",
    "[]",
    () => toJSON.call(Object.defineProperty(detached(), "length", throwingGetter)),
  ],
  [
    "out of bounds, own length 4",
    "[]",
    () => toJSON.call(Object.defineProperty(outOfBounds(), "length", { value: 4 })),
  ],
  [
    "detached, %TypedArray%.prototype length getter replaced",
    "[]",
    () => patched(TypedArrayPrototype, "length", lengthGetter(3), detached()),
  ],
  [
    "out of bounds, then in bounds again",
    "[0,0,0,0]",
    () => {
      const rab = new ArrayBuffer(4, { maxByteLength: 8 });
      const buf = Buffer.from(rab, 0, 4);
      rab.resize(2);
      rab.resize(4);
      return toJSON.call(buf);
    },
  ],

  // Live views of length 0.
  ["Buffer.alloc(0)", "[]", () => toJSON.call(Buffer.alloc(0))],
  [
    "length-tracking, resized to 0",
    "[]",
    () => {
      const rab = new ArrayBuffer(4, { maxByteLength: 8 });
      const buf = Buffer.from(rab);
      rab.resize(0);
      return toJSON.call(buf);
    },
  ],

  // The iteration protocol. Node.js does not use it.
  [
    "live, own Symbol.iterator",
    "[1,2,3]",
    () => toJSON.call(Object.defineProperty(live(), Symbol.iterator, { value: yieldNine })),
  ],
  [
    "detached, own Symbol.iterator",
    "[]",
    () => toJSON.call(Object.defineProperty(detached(), Symbol.iterator, { value: yieldNine })),
  ],
  [
    "live, own Symbol.iterator getter that detaches",
    "[7,7,7]",
    () => {
      const { ab, buf } = detachable();
      Object.defineProperty(buf, Symbol.iterator, {
        get() {
          userCalls++;
          ab.transfer();
          return typedArrayIterator;
        },
      });
      return toJSON.call(buf);
    },
  ],
  [
    "live, own Symbol.iterator undefined, own length 2",
    "[1,2,3]",
    () => {
      const buf = Object.defineProperty(live(), Symbol.iterator, { value: undefined });
      return toJSON.call(Object.defineProperty(buf, "length", { value: 2 }));
    },
  ],
  [
    "live, Array.from replaced",
    "[1,2,3]",
    () =>
      patched(
        Array,
        "from",
        {
          value() {
            userCalls++;
            return ["patched"];
          },
        },
        live(),
      ),
  ],
  [
    "live, %TypedArray%.prototype[Symbol.iterator] replaced",
    "[1,2,3]",
    () => patched(TypedArrayPrototype, Symbol.iterator, { value: yieldNine }, live()),
  ],
  [
    "live, %ArrayIteratorPrototype%.next replaced",
    "[1,2,3]",
    () =>
      patched(
        ArrayIteratorPrototype,
        "next",
        {
          value() {
            userCalls++;
            return { done: true };
          },
        },
        live(),
      ),
  ],

  // Receivers. Any TypedArray is accepted. Everything else fails the check of the length getter.
  ["subarray(1, 3) of [1,2,3,4]", "[2,3]", () => toJSON.call(Buffer.from([1, 2, 3, 4]).subarray(1, 3))],
  [
    "Buffer over a SharedArrayBuffer",
    "[5,0]",
    () => {
      const buf = Buffer.from(new SharedArrayBuffer(2));
      buf[0] = 5;
      return toJSON.call(buf);
    },
  ],
  ["Uint8Array", "[4,5]", () => toJSON.call(new Uint8Array([4, 5]))],
  ["Uint8ClampedArray", "[0,255]", () => toJSON.call(new Uint8ClampedArray([-1, 300]))],
  ["Int8Array", "[-128,127]", () => toJSON.call(new Int8Array([-128, 127]))],
  ["Uint16Array", "[0,65535]", () => toJSON.call(new Uint16Array([0, 65535]))],
  ["Int16Array", "[-32768,32767]", () => toJSON.call(new Int16Array([-32768, 32767]))],
  ["Uint32Array", "[0,4294967295]", () => toJSON.call(new Uint32Array([0, 4294967295]))],
  ["Int32Array", "[-2147483648,2147483647]", () => toJSON.call(new Int32Array([-2147483648, 2147483647]))],
  ["Float16Array", '[1.5,"NaN","-0"]', () => toJSON.call(new Float16Array([1.5, NaN, -0]))],
  ["Float32Array", '[1.5,"NaN","-0"]', () => toJSON.call(new Float32Array([1.5, NaN, -0]))],
  ["Float64Array", '[1.5,"NaN","-0",9007199254740992]', () => toJSON.call(new Float64Array([1.5, NaN, -0, 2 ** 53]))],
  ["BigInt64Array", '["-1n","9223372036854775807n"]', () => toJSON.call(new BigInt64Array([-1n, 2n ** 63n - 1n]))],
  ["BigUint64Array", '["0n","18446744073709551615n"]', () => toJSON.call(new BigUint64Array([0n, 2n ** 64n - 1n]))],
  ["Float64Array of length 0", "[]", () => toJSON.call(new Float64Array(0))],
  [
    "detached Float64Array",
    "[]",
    () => {
      const ab = new ArrayBuffer(16);
      const view = new Float64Array(ab);
      ab.transfer();
      return toJSON.call(view);
    },
  ],
  ["receiver {}", "TypeError", () => toJSON.call({})],
  ["receiver { length: 1, 0: 1 }", "TypeError", () => toJSON.call({ length: 1, 0: 1 })],
  ["receiver [1, 2]", "TypeError", () => toJSON.call([1, 2])],
  ["receiver 'ab'", "TypeError", () => toJSON.call("ab")],
  ["receiver 1", "TypeError", () => toJSON.call(1)],
  ["receiver undefined", "TypeError", () => toJSON.call(undefined)],
  ["receiver null", "TypeError", () => toJSON.call(null)],
  ["receiver DataView", "TypeError", () => toJSON.call(new DataView(new ArrayBuffer(2)))],
  ["receiver ArrayBuffer", "TypeError", () => toJSON.call(new ArrayBuffer(2))],
  ["receiver Proxy of a Buffer", "TypeError", () => toJSON.call(new Proxy(live(), {}))],
  ["receiver Object.create(Buffer)", "TypeError", () => toJSON.call(Object.create(live()))],
];

// -0, NaN and BigInt do not survive JSON.stringify, so they are printed as strings.
function replacer(key, value) {
  if (typeof value === "bigint") return `${value}n`;
  if (Object.is(value, -0)) return "-0";
  if (Number.isNaN(value)) return "NaN";
  return value;
}

function show(result) {
  const keys = Object.keys(result).join();
  if (keys !== "type,data" || result.type !== "Buffer" || !Array.isArray(result.data)) {
    return `unexpected result with keys ${keys}`;
  }
  return JSON.stringify(result.data, replacer);
}

let failed = 0;
for (const [name, expected, run] of rows) {
  userCalls = 0;
  let actual;
  try {
    actual = show(run());
  } catch (error) {
    actual = error instanceof TypeError ? "TypeError" : `${error?.constructor?.name}: ${error?.message}`;
  }
  if (userCalls) actual += ` after ${userCalls} calls of user code`;
  if (actual !== expected) {
    failed++;
    console.log(`${name}: expected ${expected}, got ${actual}`);
  }
}
console.log(`${rows.length - failed} of ${rows.length} rows match`);
process.exitCode = failed ? 1 : 0;
