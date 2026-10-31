/**
 * The deprecated Buffer constructor and Buffer.from() are one conversion in
 * Node: a number goes to Buffer.alloc(), everything else to Buffer.from().
 * https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L302-L312
 * https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L333-L365
 *
 * Bun had two implementations. `new Buffer(x)` and `Buffer(x)` returned an
 * empty Buffer, with no error, for a Buffer that went through JSON
 * (`{ type: "Buffer", data: [...] }`), for an object with `valueOf()` and for
 * an object with `Symbol.toPrimitive`.
 *
 * This file uses node:test and node:assert, so the identical file runs under
 * Node.js. The expected values come from there: the last test runs this file
 * with the `node` on PATH.
 */
import assert from "node:assert";
import { kMaxLength } from "node:buffer";
import { execFile, type ChildProcess } from "node:child_process";
import { Readable, Stream } from "node:stream";
import { after, describe, test } from "node:test";
import vm from "node:vm";

// `new Buffer(x)` and `Buffer(x)` do not type-check.
const B: any = Buffer;

type Call = (...args: unknown[]) => Buffer;

const forms: [string, Call][] = [
  ["Buffer.from(x)", (...args) => B.from(...args)],
  ["new Buffer(x)", (...args) => new B(...args)],
  ["Buffer(x)", (...args) => B(...args)],
];

const context = vm.createContext({ Buffer, args: [] as unknown[] });

// The other ways to reach the constructor. They enter the same function as the two forms above.
const otherConstructorForms: [string, Call][] = [
  ["Reflect.construct(Buffer, [x])", (...args) => Reflect.construct(B, args)],
  ["Reflect.construct(Buffer, [x], Uint8Array)", (...args) => Reflect.construct(B, args, Uint8Array)],
  ["Reflect.apply(Buffer, undefined, [x])", (...args) => Reflect.apply(B, undefined, args)],
  ["Buffer.bind(null)(x)", (...args) => B.bind(null)(...args)],
  ["new (class extends Buffer {})(x)", (...args) => new (class extends B {} as any)(...args)],
  ["buffer.constructor(x)", (...args) => B.alloc(0).constructor(...args)],
  [
    "vm.runInContext('new Buffer(x)')",
    (...args) => vm.runInContext("new Buffer(...args)", Object.assign(context, { args })),
  ],
];

const constructorForms = [...forms.slice(1), ...otherConstructorForms];
const allForms: [string, Call][] = [
  ...forms,
  ["new Buffer.from(x)", (...args) => new B.from(...args)],
  ...otherConstructorForms,
];

function hex(buffer: Buffer) {
  assert.strictEqual(Object.getPrototypeOf(buffer), Buffer.prototype);
  return buffer.toString("hex");
}

const invalidArgType = {
  name: "TypeError",
  code: "ERR_INVALID_ARG_TYPE",
  message:
    /^The first argument must be of type string or an instance of Buffer, ArrayBuffer, or Array or an Array-like Object\. Received /,
};

const arrayBuffer = () => new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]).buffer;

function detachedArrayBuffer() {
  const buffer = arrayBuffer();
  buffer.transfer();
  return buffer;
}

// A whole number that JavaScriptCore stores as a double and not as an int32.
const double = (value: number) => new Float64Array([value])[0];

// The bytes as hex, or the name and the code of what the call throws.
function outcome(call: () => Buffer) {
  try {
    return hex(call());
  } catch (error: any) {
    return `${error.name} ${error.code}`;
  }
}

// Each case is [name, () => the arguments, the outcome]. Every form must give that outcome.
function checkEach(forms: [string, Call][], cases: [string, () => unknown[], string][]) {
  const actual: Record<string, string> = {};
  const expected: Record<string, string> = {};
  for (const [name, args, result] of cases) {
    for (const [form, call] of forms) {
      actual[`${form} with ${name}`] = outcome(() => call(...args()));
      expected[`${form} with ${name}`] = result;
    }
  }
  assert.deepStrictEqual(actual, expected);
}

const children: ChildProcess[] = [];
after(() => {
  for (const child of children) child.kill();
});

// Runs `script` in a child process. The script prints one line of JSON. The child starts at once, so it runs while
// the tests do.
function runChild(script: string, env: NodeJS.ProcessEnv = {}) {
  const { promise, resolve } = Promise.withResolvers<{ results: unknown; stderr: string; code: unknown }>();
  const prelude = `
    process.noDeprecation = true;
    const hex = buffer => buffer.toString("hex");
    const forms = [x => Buffer.from(x), x => new Buffer(x), x => Buffer(x)];
  `;
  children.push(
    execFile(
      process.execPath,
      ["-e", prelude + script],
      { env: { ...process.env, NODE_NO_WARNINGS: "1", BUN_DEBUG_QUIET_LOGS: "1", ...env } },
      (error, stdout, stderr) => {
        let results: unknown = stdout;
        try {
          results = JSON.parse(stdout);
        } catch {}
        resolve({ results, stderr: error ? stderr : "", code: error ? (error.code ?? error.signal) : 0 });
      },
    ),
  );
  return promise;
}

describe("the Buffer constructor converts what Buffer.from() converts", () => {
  const dateString = Buffer.from(String(new Date(0))).toString("hex");

  const cases: [string, () => unknown[], string][] = [
    ["a Buffer that went through JSON", () => [JSON.parse(JSON.stringify(Buffer.from("hello")))], "68656c6c6f"],
    ["{ type: 'Buffer', data: [] }", () => [{ type: "Buffer", data: [] }], ""],
    ["{ data, type: 'Buffer' }", () => [{ data: [1, 2], type: "Buffer" }], "0102"],
    ["{ type: 'Buffer', data } and another property", () => [{ type: "Buffer", data: [1, 2], other: 1 }], "0102"],
    // prettier-ignore
    ["{ type: 'Buffer', data } after a delete", () => { const object: any = { other: 1, type: "Buffer", data: [1, 2] }; delete object.other; return [object]; }, "0102"],
    [
      "{ type: 'Buffer', data } from another realm",
      () => [vm.runInContext("({ type: 'Buffer', data: [1, 2] })", context)],
      "0102",
    ],
    ["{ type: a string made of two parts, data }", () => [{ type: "Buf".concat("fer"), data: [1, 2] }], "0102"],
    // prettier-ignore
    ["{ type: 'Buffer', data: an instance of a subclass of Array }", () => [{ type: "Buffer", data: class extends Array {}.from([1, 2]) }], "0102"],
    [
      "{ type: 'Buffer', data } with a null prototype",
      () => [{ __proto__: null, type: "Buffer", data: [1, 2] }],
      "0102",
    ],
    ["{ type: 'Buffer', data: a Proxy of an array }", () => [{ type: "Buffer", data: new Proxy([1, 2], {}) }], "0102"],
    ["{ type: 'Buffer', data: ['1', '2'] }", () => [{ type: "Buffer", data: ["1", "2"] }], "0102"],
    // prettier-ignore
    ["{ type: 'Buffer', data } from getters", () => [{ get type() { return "Buffer"; }, get data() { return [1, 2]; } }], "0102"],
    ["a Proxy of { type: 'Buffer', data }", () => [new Proxy({ type: "Buffer", data: [1, 2] }, {})], "0102"],
    // prettier-ignore
    ["valueOf() that returns a string", () => [{ valueOf() { return "hello"; } }], "68656c6c6f"],
    // prettier-ignore
    ["valueOf() that returns a string, with an encoding", () => [{ valueOf() { return "6869"; } }, "hex"], "6869"],
    // prettier-ignore
    ["valueOf() that returns an array", () => [{ valueOf() { return [104, 105]; } }], "6869"],
    // prettier-ignore
    ["valueOf() that returns a Uint8Array", () => [{ valueOf() { return new Uint8Array([1, 2]); } }], "0102"],
    // prettier-ignore
    ["valueOf() that returns an ArrayBuffer, with offset and length", () => [{ valueOf() { return arrayBuffer(); } }, 1, 2], "0203"],
    // prettier-ignore
    ["valueOf() that returns a String object", () => [{ valueOf() { return new String("hi"); } }], "6869"],
    // prettier-ignore
    ["valueOf() that returns an object with valueOf()", () => [{ valueOf() { return { valueOf() { return "deep"; } }; } }], "64656570"],
    // prettier-ignore
    ["valueOf() from a getter", () => [{ get valueOf() { return () => "hi"; } }], "6869"],
    // prettier-ignore
    ["valueOf() on the prototype", () => [new (class { valueOf() { return "hi"; } })()], "6869"],
    // prettier-ignore
    ["a Proxy of an object with valueOf()", () => [new Proxy({ valueOf() { return "hi"; } }, {})], "6869"],
    // prettier-ignore
    ["valueOf() before length", () => [{ length: 1, 0: 5, valueOf() { return "v"; } }], "76"],
    // prettier-ignore
    ["valueOf() before { type: 'Buffer', data }", () => [{ type: "Buffer", data: [1, 2, 3], valueOf() { return "v"; } }], "76"],
    ["valueOf: ''", () => [{ valueOf: "" }], ""],
    // prettier-ignore
    ["Symbol.toPrimitive that returns a string", () => [{ [Symbol.toPrimitive]() { return "hello"; } }], "68656c6c6f"],
    // prettier-ignore
    ["Symbol.toPrimitive that returns a string, with an encoding", () => [{ [Symbol.toPrimitive]() { return "6869"; } }, "hex"], "6869"],
    // prettier-ignore
    ["Symbol.toPrimitive gets the 'string' hint", () => [{ [Symbol.toPrimitive](hint: string) { return hint; } }], "737472696e67"],
    // prettier-ignore
    ["Symbol.toPrimitive from a getter", () => [{ get [Symbol.toPrimitive]() { return () => "hi"; } }], "6869"],
    // prettier-ignore
    ["a Proxy of an object with Symbol.toPrimitive", () => [new Proxy({ [Symbol.toPrimitive]() { return "hi"; } }, {})], "6869"],
    // prettier-ignore
    ["{ type: 'Buffer', data } before Symbol.toPrimitive", () => [{ type: "Buffer", data: [1, 2, 3], [Symbol.toPrimitive]() { return "p"; } }], "010203"],
    ["a Date", () => [new Date(0)], dateString],
    ["a String object", () => [new String("hi")], "6869"],
    ["a String object, with an encoding", () => [new String("6869"), "hex"], "6869"],
    [
      "a String object with its own valueOf()",
      () => [Object.assign(new String("hi"), { valueOf: () => "yo" })],
      "796f",
    ],
    [
      "a String object with its own toString()",
      () => [Object.assign(new String("hi"), { toString: () => "yo" })],
      "6869",
    ],
    ["a String object with another property", () => [Object.assign(new String("hi"), { x: 1 })], "6869"],
    ["a String object from another realm", () => [vm.runInContext("new String('hi')", context)], "6869"],
    ["an instance of a subclass of String", () => [new (class extends String {})("hi")], "6869"],
    // prettier-ignore
    ["an instance of a subclass of String with valueOf()", () => [new (class extends String { valueOf() { return "yo"; } })("hi")], "796f"],
    // A String object that valueOf() does not unwrap is an array-like object: each character is converted to a byte.
    [
      "a String object whose valueOf() returns a number",
      () => [Object.assign(new String("123"), { valueOf: () => 5 })],
      "010203",
    ],
    // prettier-ignore
    ["a String object whose valueOf() returns undefined", () => [Object.assign(new String("abc"), { valueOf() {} })], "000000"],
    ["a String object with valueOf: null", () => [Object.assign(new String("12"), { valueOf: null })], "0102"],
    ["a String object with a null prototype", () => [Object.setPrototypeOf(new String("12"), null)], "0102"],
    ["a String object with the prototype {}", () => [Object.setPrototypeOf(new String("12"), {})], "0102"],
    // prettier-ignore
    ["an instance of a subclass of String whose valueOf() returns a number", () => [new (class extends String { valueOf() { return 5; } })("12")], "0102"],
    // prettier-ignore
    ["a String object whose valueOf() returns a number, with an encoding", () => [Object.assign(new String("6162"), { valueOf: () => 5 }), "hex"], "06010602"],
    // prettier-ignore
    ["a String object with Symbol.toPrimitive", () => [Object.assign(new String("hi"), { [Symbol.toPrimitive]: () => "yo" })], "6869"],
    // prettier-ignore
    ["valueOf() that returns a function, before length", () => [{ valueOf() { return () => {}; }, length: 1, 0: 65 }], "41"],
    // prettier-ignore
    ["valueOf() that returns a function, before { type: 'Buffer', data }", () => [{ valueOf() { return () => {}; }, type: "Buffer", data: [1, 2] }], "0102"],
    // prettier-ignore
    ["valueOf() that returns a function, before Symbol.toPrimitive", () => [{ valueOf() { return () => {}; }, [Symbol.toPrimitive]() { return "hi"; } }], "6869"],
    ["an array-like object", () => [{ length: 2, 0: 104, 1: 105 }], "6869"],
    ["an array-like object with a fractional length", () => [{ length: 1.5, 0: 104, 1: 105 }], "68"],
    ["an array-like object with a null prototype", () => [{ __proto__: null, length: 1, 0: 5 }], "05"],
    ["an array-like object with holes", () => [{ length: 3, 1: 7 }], "000700"],
    // prettier-ignore
    ["an array-like object from getters", () => [{ get length() { return 2; }, get 0() { return 7; }, get 1() { return 8; } }], "0708"],
    ["length before { type: 'Buffer', data }", () => [{ length: 1, 0: 5, type: "Buffer", data: [1, 2] }], "05"],
    ["{ buffer: ArrayBuffer, length: 2 }", () => [{ buffer: arrayBuffer(), length: 2, 0: 9, 1: 8 }], "0908"],
    ["a Proxy of an array", () => [new Proxy([1, 2], {})], "0102"],
    ["a Proxy of an array-like object", () => [new Proxy({ length: 2, 0: 1, 1: 2 }, {})], "0102"],
    // prettier-ignore
    ["arguments", () => [(function (..._: number[]) { return arguments; })(1, 2)], "0102"],
    ["an array", () => [[1, 2, 3]], "010203"],
    ["an array with holes", () => [[1, , 3]], "010003"],
    // prettier-ignore
    ["an array of strings and objects", () => [["1", { valueOf() { return 7; } }, 300, -1, 1.9, "x"]], "01072cff0100"],
    ["an empty array", () => [[]], ""],
    ["an array with another property", () => [Object.assign([1, 2, 3], { x: 1 })], "010203"],
    ["a frozen array", () => [Object.freeze([1, 2, 3])], "010203"],
    ["an instance of a subclass of Array", () => [class extends Array {}.from([1, 2, 3])], "010203"],
    ["an array from another realm", () => [vm.runInContext("[1, 2, 3]", context)], "010203"],
    ["an array with its own valueOf()", () => [Object.assign([1, 2], { valueOf: () => "hi" })], "6869"],
    // prettier-ignore
    ["an array with its own valueOf() that returns a number", () => [Object.assign([1, 2], { valueOf: () => 5 })], "0102"],
    // prettier-ignore
    ["an array with its own valueOf() that returns a function", () => [Object.assign([1, 2], { valueOf: () => () => {} })], "0102"],
    // prettier-ignore
    ["an instance of a subclass of Array with valueOf()", () => [new (class extends Array { valueOf() { return "hi"; } })()], "6869"],
    ["a string", () => ["hello"], "68656c6c6f"],
    ["a string and an encoding", () => ["6869", "hex"], "6869"],
    ["a Uint8Array", () => [new Uint8Array([104, 105])], "6869"],
    ["a Uint8ClampedArray", () => [new Uint8ClampedArray([104, 105])], "6869"],
    ["a Uint16Array", () => [new Uint16Array([0x1234, 5])], "3405"],
    ["a Float64Array", () => [new Float64Array([1.5, 300])], "012c"],
    ["an ArrayBuffer", () => [arrayBuffer()], "0102030405060708"],
    ["an ArrayBuffer, with offset and length", () => [arrayBuffer(), 2, 3], "030405"],
    ["a SharedArrayBuffer", () => [new SharedArrayBuffer(3)], "000000"],
    // prettier-ignore
    ["a DataView with a length", () => [Object.assign(new DataView(new Uint8Array([1, 2, 3]).buffer), { length: 2, 0: 9 })], "0900"],
  ];

  test("Buffer.from(x), new Buffer(x) and Buffer(x) give the same bytes", () => {
    checkEach(forms, cases);
  });

  test("every way to call the constructor gives the same Buffer", () => {
    const shapes: [() => unknown[], string][] = [
      [() => [JSON.parse(JSON.stringify(Buffer.from("hello")))], "68656c6c6f"],
      // prettier-ignore
      [() => [{ valueOf() { return "6869"; } }, "hex"], "6869"],
      // prettier-ignore
      [() => [{ [Symbol.toPrimitive]() { return "hi"; } }], "6869"],
      [() => [{ length: 2, 0: 104, 1: 105 }], "6869"],
      [() => [[1, 2, 3]], "010203"],
      [() => ["6869", "hex"], "6869"],
      [() => [arrayBuffer(), 2, 3], "030405"],
      [() => [new Uint8Array([1, 2])], "0102"],
    ];
    for (const [form, call] of allForms) {
      assert.deepStrictEqual(
        shapes.map(([args]) => hex(call(...args()))),
        shapes.map(([, bytes]) => bytes),
        form,
      );
      assert.throws(() => call({}), invalidArgType, form);
    }
  });

  test("a JSON reviver gets every byte back", () => {
    const documents = Array.from({ length: 16 }, (_, i) => ({ id: i, payload: Buffer.alloc(i, i) }));
    const revived = JSON.parse(JSON.stringify(documents), (_, value) =>
      value !== null && typeof value === "object" && value.type === "Buffer" ? new B(value) : value,
    );
    assert.deepStrictEqual(revived, documents);
  });
});

describe("the Buffer constructor rejects what Buffer.from() rejects", () => {
  // prettier-ignore
  const rejected: [string, () => unknown[]][] = [
    ["undefined", () => [undefined]],
    ["null", () => [null]],
    ["true", () => [true]],
    ["a symbol", () => [Symbol("x")]],
    ["a bigint", () => [5n]],
    ["{}", () => [{}]],
    ["a Proxy of {}", () => [new Proxy({}, {})]],
    ["an object with a null prototype", () => [{ __proto__: null }]],
    ["a Number object", () => [new Number(5)]],
    ["a Boolean object", () => [new Boolean(true)]],
    ["a RegExp", () => [/x/]],
    ["an Error", () => [new Error("x")]],
    ["a Promise", () => [Promise.resolve(1)]],
    ["a Set", () => [new Set([1, 2, 3])]],
    ["a Map", () => [new Map([[1, 2]])]],
    ["a generator", () => [(function* () { yield 1; yield 2; })()]],
    ["an iterable object", () => [{ *[Symbol.iterator]() { yield 1; yield 2; } }]],
    ["a function", () => [function (_a: unknown, _b: unknown) {}]],
    ["a class", () => [class {}]],
    ["a Proxy of a function", () => [new Proxy(function () {}, {})]],
    ["valueOf() that returns a number", () => [{ valueOf() { return 5; } }]],
    ["valueOf() that returns null", () => [{ valueOf() { return null; } }]],
    ["valueOf() that returns a function", () => [{ valueOf() { return () => {}; } }]],
    ["valueOf() that returns {}", () => [{ valueOf() { return {}; } }]],
    ["valueOf: 0", () => [{ valueOf: 0 }]],
    ["Symbol.toPrimitive that returns a number", () => [{ [Symbol.toPrimitive]() { return 5; } }]],
    ["Symbol.toPrimitive that returns a String object", () => [{ [Symbol.toPrimitive]() { return new String("x"); } }]],
    ["Symbol.toPrimitive that is not a function", () => [{ [Symbol.toPrimitive]: 5 }]],
    ["{ type: 'Buffer', data: 'x' }", () => [{ type: "Buffer", data: "x" }]],
    ["{ type: 'Buffer', data: an array-like object }", () => [{ type: "Buffer", data: { length: 1, 0: 1 } }]],
    ["{ type: 'Buffer', data: a Uint8Array }", () => [{ type: "Buffer", data: new Uint8Array([1]) }]],
    ["{ type: a String object, data }", () => [{ type: new String("Buffer"), data: [1] }]],
    ["{ type: 'buffer', data }", () => [{ type: "buffer", data: [1] }]],
    ["{ buffer: a Uint8Array }", () => [{ buffer: new Uint8Array(3) }]],
  ];

  test("ERR_INVALID_ARG_TYPE from Buffer.from(x), new Buffer(x) and Buffer(x)", () => {
    checkEach(
      forms,
      rejected.map(([name, args]) => [name, args, "TypeError ERR_INVALID_ARG_TYPE"]),
    );
  });

  // prettier-ignore
  const empty: [string, () => unknown[]][] = [
    ["a DataView", () => [new DataView(new Uint8Array([1, 2, 3]).buffer)]],
    ["{ length: '2' }", () => [{ length: "2", 0: 104, 1: 105 }]],
    ["{ length: true }", () => [{ length: true, 0: 7 }]],
    ["{ length: null }", () => [{ length: null }]],
    ["{ length: 1n }", () => [{ length: 1n, 0: 7 }]],
    ["{ length: NaN }", () => [{ length: NaN, 0: 7 }]],
    ["{ length: -1 }", () => [{ length: -1 }]],
    ["{ length: 0.5 }", () => [{ length: 0.5, 0: 7 }]],
    ["{ buffer: ArrayBuffer }", () => [{ buffer: new ArrayBuffer(3) }]],
    ["{ buffer: SharedArrayBuffer }", () => [{ buffer: new SharedArrayBuffer(3) }]],
    ["{ buffer: ArrayBuffer } before { type: 'Buffer', data }", () => [{ buffer: new ArrayBuffer(3), type: "Buffer", data: [1, 2] }]],
    ["valueOf() that returns a DataView", () => [{ valueOf() { return new DataView(new ArrayBuffer(2)); } }]],
  ];

  test("an empty Buffer from Buffer.from(x), new Buffer(x) and Buffer(x)", () => {
    checkEach(
      forms,
      empty.map(([name, args]) => [name, args, ""]),
    );
  });

  test("what valueOf() and Symbol.toPrimitive throw comes out", () => {
    const boom = new Error("boom");
    // prettier-ignore
    const throwers: object[] = [
      { valueOf() { throw boom; } },
      { [Symbol.toPrimitive]() { throw boom; } },
      { get valueOf() { throw boom; } },
      { get length() { throw boom; } },
      { get buffer() { throw boom; } },
      { get type() { throw boom; } },
      { type: "Buffer", get data() { throw boom; } },
      { get [Symbol.toPrimitive]() { throw boom; } },
      { length: 1, get 0() { throw boom; } },
      Object.assign([1], { valueOf() { throw boom; } }),
    ];
    for (const thrower of throwers) {
      for (const [form, call] of forms) {
        assert.throws(
          () => call(thrower),
          error => error === boom,
          form,
        );
      }
    }
  });

  test("valueOf that is not a function is a TypeError", () => {
    for (const [form, call] of forms) {
      for (const valueOf of [5, "str", {}, true]) {
        assert.throws(() => call({ valueOf }), { name: "TypeError", message: "value.valueOf is not a function" }, form);
      }
    }
  });

  test("a revoked Proxy is a TypeError", () => {
    for (const [form, call] of forms) {
      const { proxy, revoke } = Proxy.revocable({}, {});
      revoke();
      assert.throws(() => call(proxy), TypeError, form);
    }
  });
});

describe("an array-like object that has an iterator", () => {
  // Node copies it by index below `Buffer.poolSize >>> 1` and with `new Uint8Array(object)` from there up.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/buffer.js#L557-L571
  const half = Buffer.poolSize >>> 1;
  // prettier-ignore
  const iterable = (length: number) => ({ length, 0: 1, *[Symbol.iterator]() { yield 9; yield 8; } });

  test("is copied by index below half of Buffer.poolSize", () => {
    for (const [form, call] of forms) {
      const buffer = call(iterable(half - 1));
      assert.deepStrictEqual(
        [buffer.length, buffer[0], buffer.subarray(1).every(byte => byte === 0)],
        [half - 1, 1, true],
        form,
      );
    }
  });

  test("is iterated from half of Buffer.poolSize up", () => {
    for (const [form, call] of forms) {
      assert.deepStrictEqual([hex(call(iterable(half))), hex(call(iterable(half * 4)))], ["0908", "0908"], form);
    }
  });

  test("is iterated when its length is NaN", () => {
    for (const [form, call] of forms) {
      assert.strictEqual(hex(call(iterable(NaN))), "0908", form);
    }
  });

  test("without an iterator it is copied by index at every length", () => {
    for (const [form, call] of forms) {
      const buffer = call({ length: half, 0: 1, [half - 1]: 2 });
      assert.deepStrictEqual([buffer.length, buffer[0], buffer[half - 1]], [half, 1, 2], form);
    }
  });

  test("Buffer.poolSize is read when the Buffer is made", () => {
    const poolSize = Buffer.poolSize;
    try {
      Buffer.poolSize = 8;
      for (const [form, call] of forms) {
        assert.deepStrictEqual([hex(call(iterable(3))), hex(call(iterable(4)))], ["010000", "0908"], form);
      }
    } finally {
      Buffer.poolSize = poolSize;
    }
  });
});

describe("a detached view gives an empty Buffer", () => {
  const views = [
    Uint8Array,
    Uint8ClampedArray,
    Int8Array,
    Uint16Array,
    Int16Array,
    Uint32Array,
    Int32Array,
    Float32Array,
    Float64Array,
    BigInt64Array,
    BigUint64Array,
    Buffer,
  ];

  function detached(View: (typeof views)[number], buffer = new ArrayBuffer(8)) {
    const view = View === Buffer ? Buffer.from(buffer) : new (View as Uint8ArrayConstructor)(buffer);
    buffer.transfer();
    return view;
  }

  test("of every kind", () => {
    checkEach(
      forms,
      views.map(View => [View.name, () => [detached(View)], ""]),
    );
  });

  test("that tracks a resizable ArrayBuffer", () => {
    checkEach(forms, [
      ["Uint8Array", () => [detached(Uint8Array, new ArrayBuffer(8, { maxByteLength: 16 }))], ""],
      ["Uint16Array", () => [detached(Uint16Array, new ArrayBuffer(8, { maxByteLength: 16 }))], ""],
    ]);
  });
});

describe("the Buffer constructor with a number", () => {
  const forms = constructorForms;

  test("allocates zero-filled bytes", () => {
    for (const [form, call] of forms) {
      assert.deepStrictEqual(
        [hex(call(3)), hex(call(0)), hex(call(-0)), hex(call(3.5)), hex(call(0.5))],
        ["000000", "", "", "000000", ""],
        form,
      );
    }
  });

  test("rejects a string as the second argument, for every number", () => {
    for (const [form, call] of forms) {
      for (const [size, received] of [
        [1, "1"],
        [-1, "-1"],
        [3.5, "3.5"],
        [NaN, "NaN"],
        [Infinity, "Infinity"],
      ] as const) {
        assert.throws(
          () => call(size, "utf8"),
          {
            name: "TypeError",
            code: "ERR_INVALID_ARG_TYPE",
            message: `The "string" argument must be of type string. Received type number (${received})`,
          },
          form,
        );
      }
    }
  });

  test("validates the size like Buffer.alloc()", () => {
    for (const [form, call] of forms) {
      for (const [size, received] of [
        [-1, "-1"],
        [-1.5, "-1.5"],
        [NaN, "NaN"],
        [Infinity, "Infinity"],
        [-Infinity, "-Infinity"],
      ] as const) {
        const expected = {
          name: "RangeError",
          code: "ERR_OUT_OF_RANGE",
          message: `The value of "size" is out of range. It must be >= 0 && <= ${kMaxLength}. Received ${received}`,
        };
        assert.throws(() => call(size), expected, form);
        assert.throws(() => Buffer.alloc(size), expected);
      }
    }
  });
});

describe("Buffer.from", () => {
  test("is a data property named 'from' that takes 3 parameters", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Buffer, "from")!;
    assert.deepStrictEqual(
      {
        name: Buffer.from.name,
        length: Buffer.from.length,
        writable: descriptor.writable,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
      },
      { name: "from", length: 3, writable: true, enumerable: true, configurable: true },
    );
  });

  test("does not use `this`", () => {
    const { from } = B;
    assert.strictEqual(hex(from("hi")), "6869");
    assert.strictEqual(hex(from.call(null, [1, 2])), "0102");
  });

  test("rejects a number and a call with no argument", () => {
    assert.throws(() => B.from(5), invalidArgType);
    assert.throws(() => new B.from(5), invalidArgType);
    assert.throws(() => B.from(), invalidArgType);
    assert.throws(() => new B.from(), invalidArgType);
  });
});

describe("Buffer[Symbol.species]", () => {
  // Node's FastBuffer: a subclass of Uint8Array whose prototype is Buffer.prototype.
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/buffer.js#L960
  const FastBuffer = B[Symbol.species];

  test("is FastBuffer and not Buffer", () => {
    const descriptor = Object.getOwnPropertyDescriptor(Buffer, Symbol.species)!;
    assert.deepStrictEqual(
      {
        name: FastBuffer.name,
        length: FastBuffer.length,
        isBuffer: FastBuffer === Buffer,
        hasBufferPrototype: FastBuffer.prototype === Buffer.prototype,
        extendsUint8Array: Object.getPrototypeOf(FastBuffer) === Uint8Array,
        enumerable: descriptor.enumerable,
        configurable: descriptor.configurable,
        onBufferPrototype: Object.hasOwn(Buffer.prototype, Symbol.species),
      },
      {
        name: "FastBuffer",
        length: 0,
        isBuffer: false,
        hasBufferPrototype: true,
        extendsUint8Array: true,
        enumerable: false,
        configurable: true,
        onBufferPrototype: false,
      },
    );
  });

  // prettier-ignore
  const cases: [string, () => unknown[], string][] = [
    ["no arguments", () => [], ""],
    ["3", () => [3], "000000"],
    ["'3'", () => ["3"], "000000"],
    ["'abc'", () => ["abc"], ""],
    ["null", () => [null], ""],
    ["{}", () => [{}], ""],
    ["an array", () => [[1, 2]], "0102"],
    ["a Set", () => [new Set([1, 2])], "0102"],
    ["an array-like object", () => [{ length: 2, 0: 5 }], "0500"],
    ["a Uint8Array", () => [new Uint8Array([7, 8])], "0708"],
    ["an ArrayBuffer", () => [arrayBuffer()], "0102030405060708"],
    ["an ArrayBuffer, byteOffset and length", () => [arrayBuffer(), 1, 2], "0203"],
    ["{ type: 'Buffer', data }", () => [{ type: "Buffer", data: [1, 2] }], ""],
    ["2 stored as a double", () => [double(2)], "0000"],
    ["1.5", () => [1.5], "00"],
    ["-0", () => [-0], ""],
    ["NaN", () => [NaN], ""],
    ["-1", () => [-1], "RangeError undefined"],
    ["2 ** 53", () => [2 ** 53], "RangeError undefined"],
    ["an ArrayBuffer, byteOffset and length stored as doubles", () => [arrayBuffer(), double(1), double(2)], "0203"],
    ["an ArrayBuffer and a byteOffset stored as a double", () => [arrayBuffer(), double(6)], "0708"],
    ["an ArrayBuffer, -0 and -0", () => [arrayBuffer(), -0, -0], ""],
    ["an ArrayBuffer, 1.5 and 2.5", () => [arrayBuffer(), 1.5, 2.5], "0203"],
    ["an ArrayBuffer and the byteOffset 8", () => [arrayBuffer(), 8], ""],
    ["an ArrayBuffer and the byteOffset 9", () => [arrayBuffer(), 9], "RangeError undefined"],
    ["an ArrayBuffer and the byteOffset 2 ** 31", () => [arrayBuffer(), 2 ** 31], "RangeError undefined"],
    ["an ArrayBuffer and the byteOffset 2 ** 32", () => [arrayBuffer(), 2 ** 32], "RangeError undefined"],
    ["an ArrayBuffer and the byteOffset 2 ** 53", () => [arrayBuffer(), 2 ** 53], "RangeError undefined"],
    ["an ArrayBuffer and the length 9", () => [arrayBuffer(), 0, 9], "RangeError undefined"],
    ["an ArrayBuffer and the length 2 ** 32", () => [arrayBuffer(), 0, 2 ** 32], "RangeError undefined"],
    ["an ArrayBuffer and the length 2 ** 53", () => [arrayBuffer(), 0, 2 ** 53], "RangeError undefined"],
    ["an ArrayBuffer, the byteOffset 6 and the length 3", () => [arrayBuffer(), 6, 3], "RangeError undefined"],
    ["a resizable ArrayBuffer and a byteOffset past its end", () => [new ArrayBuffer(4, { maxByteLength: 8 }), 5], "RangeError undefined"],
    ["a resizable ArrayBuffer and a length past its end", () => [new ArrayBuffer(4, { maxByteLength: 8 }), 0, 5], "RangeError undefined"],
    ["a detached ArrayBuffer", () => [detachedArrayBuffer()], "TypeError undefined"],
  ];

  test("is the Uint8Array constructor, not Buffer.from()", () => {
    checkEach([["new FastBuffer(x)", (...args) => new FastBuffer(...args)]], cases);
  });

  test("with no length it tracks a resizable ArrayBuffer and a growable SharedArrayBuffer", () => {
    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    const growable = new SharedArrayBuffer(4, { maxByteLength: 8 });
    const views = [resizable, growable].flatMap(buffer => [
      new FastBuffer(buffer),
      new FastBuffer(buffer, 1),
      new FastBuffer(buffer, double(1)),
      new FastBuffer(buffer, 1, 2),
      new FastBuffer(buffer, double(1), double(2)),
    ]);
    resizable.resize(8);
    growable.grow(8);
    const eachBuffer = [
      [true, 0, 8],
      [true, 1, 7],
      [true, 1, 7],
      [true, 1, 2],
      [true, 1, 2],
    ];
    assert.deepStrictEqual(
      views.map(view => [Object.getPrototypeOf(view) === Buffer.prototype, view.byteOffset, view.length]),
      [...eachBuffer, ...eachBuffer],
    );
  });

  test("gives and throws what the Uint8Array constructor gives and throws", () => {
    // The bytes and the byteOffset, or the name and the message of the error.
    const outcome = (construct: () => Uint8Array) => {
      try {
        const view = construct();
        return `${Array.from(view).join(",")} at ${view.byteOffset}`;
      } catch (error: any) {
        return `${error.name}: ${error.message}`;
      }
    };
    // prettier-ignore
    const accepted: (() => unknown[])[] = [
      () => [],
      () => [undefined],
      () => [null],
      () => [true],
      () => ["3"],
      () => [1.5],
      () => [[1, 2, 300]],
      () => [[1, , 3]],
      () => [["1", "x", { valueOf() { return 7; } }]],
      () => [Object.assign([1, 2], { *[Symbol.iterator]() { yield 9; } })],
      () => [new Proxy([1, 2], {})],
      () => [new Set([4, 5])],
      () => [{ *[Symbol.iterator]() { yield 1; yield 2; } }],
      () => [{ length: 2, 0: 5 }],
      () => [{ length: "2", 0: 5 }],
      () => [(function (..._: number[]) { return arguments; })(1, 2)],
      () => [new Uint16Array([258, 3])],
      () => [new Float64Array([1.5, 300])],
      () => [Buffer.from("hi")],
      () => [new DataView(arrayBuffer())],
      () => [new String("12")],
      () => [function (_a: unknown, _b: unknown) {}],
      () => [[1, 2, 3], 1, 2],
      () => [new Uint8Array([7, 8, 9]), 1, 1],
      () => [arrayBuffer(), "2", "3"],
      () => [arrayBuffer(), 1.5],
      () => [arrayBuffer(), null, null],
      () => [arrayBuffer(), undefined, 2],
      () => [new SharedArrayBuffer(3)],
    ];
    const rejected: (() => unknown[])[] = [
      () => [detachedArrayBuffer()],
      () => [detachedArrayBuffer(), 0],
      () => [detachedArrayBuffer(), 0, 0],
      () => [detachedArrayBuffer(), double(0), double(0)],
      () => [new Uint8Array(detachedArrayBuffer())],
      () => [new BigInt64Array([1n])],
      () => [1n],
      () => [Symbol("x")],
      () => [-1],
      () => [double(-1)],
      () => [-(2 ** 31) - 1],
      () => [2 ** 53],
      () => [Infinity],
      () => [arrayBuffer(), 9],
      () => [arrayBuffer(), 0, 9],
      () => [arrayBuffer(), -1],
      () => [arrayBuffer(), 2 ** 32, 2 ** 32],
      () => [new ArrayBuffer(4, { maxByteLength: 8 }), 5],
      () => [new ArrayBuffer(4, { maxByteLength: 8 }), 0, 5],
    ];
    const shapes = [...accepted, ...rejected];
    const actual = shapes.map(args => outcome(() => new FastBuffer(...args())));
    const expected = shapes.map(args => outcome(() => new (Uint8Array as any)(...args())));
    assert.deepStrictEqual(actual, expected);
    assert.deepStrictEqual(
      actual.map(result => result.includes("Error: ")),
      shapes.map((_, index) => index >= accepted.length),
    );
  });

  test("is a class: it needs `new` and a subclass gets its own prototype", () => {
    assert.throws(() => FastBuffer(3), TypeError);
    class Sub extends FastBuffer {}
    const viaNew: any = new (Sub as any)(2);
    const viaReflect: any = Reflect.construct(FastBuffer, [arrayBuffer(), 1, 2], Sub);
    assert.deepStrictEqual(
      [
        viaNew instanceof Sub,
        viaNew.length,
        viaReflect instanceof Sub,
        Buffer.prototype.toString.call(viaReflect, "hex"),
      ],
      [true, 2, true, "0203"],
    );
  });

  test("the TypedArray methods make their result with it", () => {
    const buffer = Buffer.from([1, 2, 3]);
    assert.deepStrictEqual(
      [
        hex(buffer.map(byte => byte + 1) as Buffer),
        hex(buffer.filter(byte => byte > 1) as Buffer),
        hex(Uint8Array.prototype.slice.call(buffer, 1) as Buffer),
        hex(Uint8Array.prototype.subarray.call(buffer, 1) as Buffer),
      ],
      ["020304", "0203", "0203", "0203"],
    );
  });
});

describe("a valueOf() that every value of a kind reaches", () => {
  // The script replaces `valueOf` on shared prototypes and recurses until the stack ends, so it runs in a child
  // process. Each result has an entry for each of `forms`.
  const script = `
    const all = make => forms.map(call => hex(call(make()))).join(",");
    const results = {};

    {
      // An object literal, then the same shape with a property that comes from somewhere else.
      const json = () => ({ type: "Buffer", data: [1, 2] });
      const rows = [all(json)];
      Object.prototype.length = 1;
      Object.prototype[0] = 9;
      rows.push(all(json));
      delete Object.prototype.length;
      delete Object.prototype[0];
      Object.prototype.buffer = new ArrayBuffer(1);
      rows.push(all(json));
      delete Object.prototype.buffer;
      Object.prototype.type = "Buffer";
      Object.prototype.data = [5, 6];
      rows.push(all(() => ({})));
      delete Object.prototype.type;
      delete Object.prototype.data;
      Object.prototype[Symbol.toPrimitive] = () => "hi";
      rows.push(all(() => ({})));
      delete Object.prototype[Symbol.toPrimitive];
      rows.push(all(() => Object.setPrototypeOf(json(), { length: 1, 0: 7 })));
      rows.push(all(() => Object.defineProperty(json(), "type", { get: () => "Buffer" })));
      rows.push(all(() => Object.defineProperty(json(), "data", { get: () => [3, 4] })));
      rows.push(all(json));
      results["an object literal reads each property where it is"] = rows;
    }

    {
      // With this many named properties the array gains and loses a valueOf() and keeps one shape.
      const array = Object.assign([1, 2], Object.fromEntries(Array.from({ length: 200 }, (_, i) => ["p" + i, i])));
      const before = all(() => array);
      array.valueOf = () => "hi";
      const during = all(() => array);
      delete array.valueOf;
      results["an array with 200 named properties calls a valueOf() that it gains"] = [before, during, all(() => array)];
    }

    {
      // Node calls valueOf() before it reads type and data.
      const json = () => ({ type: "Buffer", data: [1, 2] });
      const original = Object.prototype.valueOf;
      const rows = [all(json)];
      for (const answer of ["hi", [7, 8], 5]) {
        Object.prototype.valueOf = function () { return this.type === "Buffer" ? answer : this; };
        rows.push(all(json));
      }
      Object.defineProperty(Object.prototype, "valueOf", { get: () => original, set() {}, configurable: true });
      rows.push(all(json));
      Object.defineProperty(Object.prototype, "valueOf", { value: original, writable: true, configurable: true });
      rows.push(all(json));
      results["a Buffer that went through JSON calls a replaced Object.prototype.valueOf first"] = rows;
    }

    for (const prototype of [Array.prototype, Object.prototype]) {
      const name = prototype === Array.prototype ? "Array.prototype" : "Object.prototype";
      const original = Object.getOwnPropertyDescriptor(prototype, "valueOf");
      const before = all(() => [1, 2]);
      prototype.valueOf = function () { return Array.isArray(this) ? "hi" : this; };
      const during = all(() => [1, 2]);
      if (original) Object.defineProperty(prototype, "valueOf", original);
      else delete prototype.valueOf;
      results["an array calls a valueOf() that is put on " + name] = [before, during, all(() => [1, 2])];
    }

    {
      const before = all(() => new String("hi"));
      const original = String.prototype.valueOf;
      String.prototype.valueOf = function () { return "yo"; };
      const during = all(() => new String("hi"));
      String.prototype.valueOf = original;
      results["a String object calls a replaced String.prototype.valueOf"] = [before, during, all(() => new String("hi"))];
    }

    {
      const object = { length: 1, 0: 5 };
      const before = all(() => object);
      const original = Object.prototype.valueOf;
      Object.prototype.valueOf = function () { return this === object ? "hi" : this; };
      const during = all(() => object);
      Object.prototype.valueOf = original;
      results["an object calls a replaced Object.prototype.valueOf"] = [before, during, all(() => object)];
    }

    {
      // An accessor is what the lockdown() of SES makes of Object.prototype.valueOf.
      const original = Object.prototype.valueOf;
      let answer = original;
      Object.defineProperty(Object.prototype, "valueOf", { get: () => answer, set() {}, configurable: true });
      const before = all(() => [1, 2]);
      answer = function () { return Array.isArray(this) ? "hi" : this; };
      const during = all(() => [1, 2]);
      answer = original;
      results["an array calls the valueOf() that an accessor on Object.prototype gives"] = [before, during, all(() => [1, 2])];
      Object.defineProperty(Object.prototype, "valueOf", { value: original, writable: true, configurable: true });
    }

    {
      // Each valueOf() returns the next object of the chain. Node recurses for each one and runs out of stack.
      const chain = depth => ({ valueOf: () => (depth === 0 ? "end" : chain(depth - 1)) });
      results["a chain of 100000 valueOf() is a RangeError"] = forms.map(call => {
        try { call(chain(100000)); return "no error"; } catch (error) { return error.name; }
      });
    }

    {
      Object.freeze(Object.prototype);
      const own = () => Object.defineProperty([1, 2], "valueOf", { value: () => "hi" });
      results["an array after Object.freeze(Object.prototype)"] = [all(() => [1, 2]), all(own)];
    }

    console.log(JSON.stringify(results));
  `;

  const unchanged = ["0102,0102,0102", "6869,6869,6869", "0102,0102,0102"];
  const expected: Record<string, unknown> = {
    "an object literal reads each property where it is": [
      "0102,0102,0102",
      "09,09,09",
      ",,",
      "0506,0506,0506",
      "6869,6869,6869",
      "07,07,07",
      "0102,0102,0102",
      "0304,0304,0304",
      "0102,0102,0102",
    ],
    "an array with 200 named properties calls a valueOf() that it gains": unchanged,
    "a Buffer that went through JSON calls a replaced Object.prototype.valueOf first": [
      "0102,0102,0102",
      "6869,6869,6869",
      "0708,0708,0708",
      "0102,0102,0102",
      "0102,0102,0102",
      "0102,0102,0102",
    ],
    "an array calls a valueOf() that is put on Array.prototype": unchanged,
    "an array calls a valueOf() that is put on Object.prototype": unchanged,
    "a String object calls a replaced String.prototype.valueOf": ["6869,6869,6869", "796f,796f,796f", "6869,6869,6869"],
    "an object calls a replaced Object.prototype.valueOf": ["05,05,05", "6869,6869,6869", "05,05,05"],
    "an array calls the valueOf() that an accessor on Object.prototype gives": unchanged,
    "a chain of 100000 valueOf() is a RangeError": ["RangeError", "RangeError", "RangeError"],
    "an array after Object.freeze(Object.prototype)": ["0102,0102,0102", "6869,6869,6869"],
  };

  const result = runChild(script);

  test("every result is the one Node gives", async () => {
    assert.deepStrictEqual(await result, { results: expected, stderr: "", code: 0 });
  });
});

describe("a view that only valueOf() returned", () => {
  // Nothing but the conversion holds the view. A collection inside the conversion ends the view, and its memory
  // with it, unless the conversion still needs the view at that time.
  const script = `
    const expected = Buffer.alloc(4096, 7);
    const views = [Uint8Array, Uint8ClampedArray, Uint16Array];
    // One canary for each conversion. valueOf() drops it as it returns. A canary that is gone when the conversion
    // returns was collected inside the conversion.
    const canaries = [];
    const refs = [];
    for (let i = 0; i < 4 * views.length * forms.length; i++) {
      canaries.push({});
      refs.push(new WeakRef(canaries[i]));
    }
    // A WeakRef keeps its target until the job that made it ends.
    setImmediate(() => {
      let wrong = 0;
      let next = 0;
      const collectedInside = { Uint8Array: 0, Uint8ClampedArray: 0, Uint16Array: 0 };
      for (let i = 0; i < 4; i++) {
        for (const View of views) {
          const fresh = { valueOf() { const view = new View(4096).fill(7); canaries[next] = 0; return view; } };
          for (const call of forms) {
            const buffer = call(fresh);
            if (refs[next++].deref() === undefined) collectedInside[View.name]++;
            if (!buffer.equals(expected)) wrong++;
          }
        }
      }
      console.log(JSON.stringify({ wrong, collectedInside }));
    });
  `;

  const env: NodeJS.ProcessEnv = {};
  // Malloc=1 makes JavaScriptCore use the system allocator, so an ASAN build reports a read of freed memory.
  // WebKit has no such allocator on Windows: the child would trap when JavaScriptCore starts.
  if (process.platform !== "win32") {
    env.Malloc = "1";
    // detect_leaks=0: with Malloc=1 the leak check reports what JavaScriptCore allocates once and never frees.
    // symbolize=0: a report with symbols takes longer than the test has.
    env.ASAN_OPTIONS = [process.env.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":");
  }
  // The option makes JavaScriptCore collect at every Nth allocation that leaves its fast path. That puts a collection
  // inside some of the conversions. With no option, no collection starts inside a conversion of this script. Which
  // conversions get one depends on N and on the build, so the script runs with two values of N.
  const runs = [4, 7].map(period => runChild(script, { ...env, BUN_JSC_slowPathAllocsBetweenGCs: String(period) }));

  test("is copied before a collection ends it", async () => {
    let collectedInside = 0;
    for (const run of runs) {
      const { results, stderr, code } = (await run) as { results: any; stderr: string; code: unknown };
      assert.deepStrictEqual({ wrong: results.wrong, stderr, code }, { wrong: 0, stderr: "", code: 0 });
      // The conversions of these two kinds of view copy the bytes with memcpy.
      collectedInside += results.collectedInside.Uint8Array + results.collectedInside.Uint8ClampedArray;
    }
    // Node.js has no such option. In Bun the checks above say nothing unless a collection ran inside a conversion.
    if (typeof Bun !== "undefined") assert.ok(collectedInside > 0);
  });
});

describe("Stream._uint8ArrayToBuffer", () => {
  const toBuffer = (Stream as any)._uint8ArrayToBuffer as (chunk: unknown) => Buffer;

  test("is a Buffer over the memory of the chunk", () => {
    const chunk = new Uint8Array(arrayBuffer(), 2, 4);
    const buffer = toBuffer(chunk);
    assert.deepStrictEqual(
      { bytes: hex(buffer), sameMemory: buffer.buffer === chunk.buffer, byteOffset: buffer.byteOffset },
      { bytes: "03040506", sameMemory: true, byteOffset: 2 },
    );
    chunk[0] = 0xff;
    assert.strictEqual(buffer[0], 0xff);
  });

  // Node makes the Buffer with `new FastBuffer(chunk.buffer, chunk.byteOffset, chunk.byteLength)`,
  // the Uint8Array constructor. It is not Buffer.from().
  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/legacy.js#L118-L120
  // prettier-ignore
  const cases: [string, () => object, string][] = [
    ["{}", () => ({}), ""],
    ["{ buffer: 3 }", () => ({ buffer: 3 }), "000000"],
    ["{ buffer: '3' }", () => ({ buffer: "3" }), "000000"],
    ["{ buffer: 'abc' }", () => ({ buffer: "abc" }), ""],
    ["{ buffer: null }", () => ({ buffer: null }), ""],
    ["{ buffer: true }", () => ({ buffer: true }), "00"],
    ["{ buffer: [1, 2] }", () => ({ buffer: [1, 2] }), "0102"],
    ["{ buffer: a Set }", () => ({ buffer: new Set([4, 5]) }), "0405"],
    ["{ buffer: an array-like object }", () => ({ buffer: { length: 2, 0: 7, 1: 8 } }), "0708"],
    ["{ buffer: a Uint8Array }", () => ({ buffer: new Uint8Array([9, 8]) }), "0908"],
    ["{ buffer: an object with valueOf() }", () => ({ buffer: { valueOf() { return "hi"; } } }), ""],
    ["{ buffer: { type: 'Buffer', data } }", () => ({ buffer: { type: "Buffer", data: [1, 2] } }), ""],
    ["{ buffer: ArrayBuffer }", () => ({ buffer: arrayBuffer() }), "0102030405060708"],
    ["{ buffer: ArrayBuffer, byteOffset: 2 }", () => ({ buffer: arrayBuffer(), byteOffset: 2 }), "030405060708"],
    ["{ buffer: ArrayBuffer, byteOffset: 2, byteLength: 3 }", () => ({ buffer: arrayBuffer(), byteOffset: 2, byteLength: 3 }), "030405"],
    ["{ buffer: ArrayBuffer, byteOffset: 8, byteLength: 0 }", () => ({ buffer: arrayBuffer(), byteOffset: 8, byteLength: 0 }), ""],
    ["{ buffer: ArrayBuffer, byteOffset: 1.5 }", () => ({ buffer: arrayBuffer(), byteOffset: 1.5 }), "02030405060708"],
    ["{ buffer: ArrayBuffer, byteOffset: '2' }", () => ({ buffer: arrayBuffer(), byteOffset: "2" }), "030405060708"],
    ["{ buffer: ArrayBuffer, byteOffset: NaN }", () => ({ buffer: arrayBuffer(), byteOffset: NaN }), "0102030405060708"],
    ["{ buffer: ArrayBuffer, byteLength: NaN }", () => ({ buffer: arrayBuffer(), byteLength: NaN }), ""],
    ["{ buffer: SharedArrayBuffer, byteOffset: 1 }", () => ({ buffer: new SharedArrayBuffer(4), byteOffset: 1 }), "000000"],
    ["a DataView", () => new DataView(arrayBuffer(), 1, 2), "0203"],
    ["a Uint16Array", () => new Uint16Array(arrayBuffer(), 2, 2), "03040506"],
    ["{ buffer: -1 }", () => ({ buffer: -1 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteOffset: 9 }", () => ({ buffer: arrayBuffer(), byteOffset: 9 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteOffset: -1 }", () => ({ buffer: arrayBuffer(), byteOffset: -1 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteLength: 9 }", () => ({ buffer: arrayBuffer(), byteLength: 9 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteLength: -1 }", () => ({ buffer: arrayBuffer(), byteLength: -1 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteOffset: 6, byteLength: 3 }", () => ({ buffer: arrayBuffer(), byteOffset: 6, byteLength: 3 }), "RangeError undefined"],
    ["{ buffer: 2 stored as a double }", () => ({ buffer: double(2) }), "0000"],
    ["{ buffer: ArrayBuffer, byteOffset and byteLength stored as doubles }", () => ({ buffer: arrayBuffer(), byteOffset: double(2), byteLength: double(3) }), "030405"],
    ["{ buffer: ArrayBuffer, byteOffset: -0, byteLength: -0 }", () => ({ buffer: arrayBuffer(), byteOffset: -0, byteLength: -0 }), ""],
    ["{ buffer: ArrayBuffer, byteOffset: 2 ** 31 }", () => ({ buffer: arrayBuffer(), byteOffset: 2 ** 31 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteLength: 2 ** 32 }", () => ({ buffer: arrayBuffer(), byteLength: 2 ** 32 }), "RangeError undefined"],
    ["{ buffer: ArrayBuffer, byteLength: 2 ** 53 }", () => ({ buffer: arrayBuffer(), byteLength: 2 ** 53 }), "RangeError undefined"],
    ["{ buffer: a detached ArrayBuffer }", () => ({ buffer: detachedArrayBuffer() }), "TypeError undefined"],
    ["a Uint8Array of a resizable ArrayBuffer", () => new Uint8Array(new ArrayBuffer(3, { maxByteLength: 8 }), 1), "0000"],
    ["a Uint8Array of a growable SharedArrayBuffer", () => new Uint8Array(new SharedArrayBuffer(3, { maxByteLength: 8 }), 1, 1), "00"],
  ];

  test("is the Uint8Array constructor for every chunk", () => {
    checkEach(
      [["_uint8ArrayToBuffer(chunk)", toBuffer]],
      cases.map(([name, chunk, result]) => [name, () => [chunk()], result]),
    );
  });

  test("a resizable ArrayBuffer with no length gives a Buffer that tracks it", () => {
    const resizable = new ArrayBuffer(2, { maxByteLength: 8 });
    const tracking = toBuffer({ buffer: resizable });
    const fixed = toBuffer({ buffer: resizable, byteOffset: 1, byteLength: 1 });
    resizable.resize(4);
    assert.deepStrictEqual([tracking.length, fixed.length], [4, 1]);
  });

  // https://github.com/nodejs/node/blob/v26.3.0/lib/internal/streams/readable.js#L1707-L1708
  test("readable.read(n) splits a chunk with it, for an n stored as an int32 and as a double", () => {
    for (const n of [6, double(6)]) {
      const readable = new Readable({ read() {} });
      readable.push(Buffer.from([1, 2, 3, 4]));
      readable.push(Buffer.from([5, 6, 7, 8]));
      assert.deepStrictEqual([hex(readable.read(n)), hex(readable.read())], ["010203040506", "0708"]);
    }
  });
});

// Only in Bun: when Node.js runs this file it must not spawn itself again.
if (typeof Bun !== "undefined") {
  const node = Bun.which("node");
  describe("Node.js compatibility", () => {
    (node ? test : test.skip)("all tests pass in Node.js", async () => {
      // A direct run, not `node --test`: the runner mode forks a second node process per file. node:test still
      // exits non-zero on any failure.
      await using proc = Bun.spawn({
        cmd: [node!, "--v8-pool-size=1", import.meta.filename],
        env: { ...process.env, UV_THREADPOOL_SIZE: "2" },
        stdout: "pipe",
        stderr: "pipe",
        stdin: "ignore",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      assert.deepStrictEqual({ exitCode, output: exitCode === 0 ? "" : stdout + stderr }, { exitCode: 0, output: "" });
    });
  });
}
