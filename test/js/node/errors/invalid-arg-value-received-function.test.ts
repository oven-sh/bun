import { describe, expect, test } from "bun:test";
import fs from "node:fs";
import http from "node:http";

// ERR_INVALID_ARG_VALUE's "Received ..." is built by JSValueToStringSafe() in src/jsc/bindings/ErrorCode.cpp.
// Node renders the value with util.inspect, which for a callable means the function's kind plus an
// ordinary read of its `name`: "[Function: bound f]", "[AsyncFunction: f]", "[class Foo extends Base]".
// The entry points below reach the renderer from Rust (inspect_for_error_message), from two of the
// C++ INVALID_ARG_VALUE overloads (validateOneOf's and the plain one) and from the JS builtins'
// $ERR_INVALID_ARG_VALUE. Node prints these exact messages (prefix included) for the same calls.
const entryPoints: [label: string, prefix: string, throwWith: (value: unknown) => unknown][] = [
  [
    "Rust (fs.readFileSync flag)",
    "The argument 'flags' is invalid. Received ",
    value => fs.readFileSync(import.meta.path, { flag: value as any }),
  ],
  [
    "C++ validateOneOf (http.Agent scheduling)",
    "The argument 'scheduling' must be one of: 'fifo', 'lifo'. Received ",
    value => new http.Agent({ scheduling: value as any }),
  ],
  [
    "C++ INVALID_ARG_VALUE (require.resolve paths)",
    "The property 'options.paths' is invalid. Received ",
    value => require.resolve("./unused", { paths: value as any }),
  ],
  [
    "$ERR_INVALID_ARG_VALUE (fs.opendirSync encoding)",
    "The argument 'encoding' is invalid encoding. Received ",
    value => fs.opendirSync(".", { encoding: value as any }),
  ],
];

class Base {}
function Parent() {}
// The arrow takes its name from the property key. It lives here rather than inline in its case
// because the transpiler folds `({ aa: <arrow> }).aa` down to the bare arrow, which has no name.
const arrows = { aa: async () => {} };

// The cases build their values per call: JSC materializes a function's `name` property lazily, and
// the old renderer's output for e.g. a bound function depended on whether that had already happened.
const cases: [label: string, make: () => unknown, rendered: string][] = [
  ["bound function", () => function b() {}.bind(null), "[Function: bound b]"],
  ["bound anonymous function", () => [function () {}][0].bind(null), "[Function: bound ]"],
  ["bound class", () => class BC {}.bind(null), "[Function: bound BC]"],
  ["class", () => class Foo {}, "[class Foo]"],
  ["anonymous class", () => [class {}][0], "[class (anonymous)]"],
  ["class extending a class", () => class Derived extends Base {}, "[class Derived extends Base]"],
  ["class extending a function", () => class D extends Parent {}, "[class D extends Parent]"],
  [
    "class whose name was redefined",
    () => Object.defineProperty(class K {}, "name", { value: "Renamed" }),
    "[class Renamed]",
  ],
  [
    "class with a null prototype",
    () => Object.setPrototypeOf(class NP {}, null),
    "[class NP extends [null prototype]]",
  ],
  ["async function", () => async function af() {}, "[AsyncFunction: af]"],
  ["async arrow function", () => arrows.aa, "[AsyncFunction: aa]"],
  ["async method", () => ({ async m() {} }).m, "[AsyncFunction: m]"],
  ["generator function", () => function* gen() {}, "[GeneratorFunction: gen]"],
  ["async generator function", () => async function* agen() {}, "[AsyncGeneratorFunction: agen]"],
  ["getter", () => Object.getOwnPropertyDescriptor({ get x() {} }, "x")!.get, "[Function: get x]"],
  [
    "name redefined as a getter",
    () => Object.defineProperty(function f() {}, "name", { get: () => "fromGetter" }),
    "[Function: fromGetter]",
  ],
  ["name redefined as a number", () => Object.defineProperty(function f() {}, "name", { value: 42 }), "[Function: 42]"],
  [
    "name deleted (falls back to Function.prototype.name)",
    () => {
      function f() {}
      delete (f as any).name;
      return f;
    },
    "[Function (anonymous)]",
  ],
  [
    "function with a null prototype",
    () => Object.setPrototypeOf(function np() {}, null),
    "[Function (null prototype): np]",
  ],
  // Renderings the old code already got right, pinned so the rewrite keeps them.
  ["named function", () => function named() {}, "[Function: named]"],
  ["anonymous function", () => [function () {}][0], "[Function (anonymous)]"],
  [
    "name redefined as a string",
    () => Object.defineProperty(function f() {}, "name", { value: "renamed" }),
    "[Function: renamed]",
  ],
  ["symbol-keyed method", () => ({ [Symbol.iterator]() {} })[Symbol.iterator], "[Function: [Symbol.iterator]]"],
  ["native constructor", () => Array, "[Function: Array]"],
  ["native function", () => Math.max, "[Function: max]"],
];

function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
}

describe.each(entryPoints)("ERR_INVALID_ARG_VALUE renders a callable like node: %s", (_label, prefix, throwWith) => {
  test("kind and name", () => {
    const messages = cases.map(([label, make]) => {
      const error = thrownBy(() => throwWith(make()));
      return [label, error.code, error.message];
    });
    expect(messages).toEqual(cases.map(([label, , rendered]) => [label, "ERR_INVALID_ARG_VALUE", prefix + rendered]));
  });

  test("an exception thrown while reading a name replaces the error being built", () => {
    const getterBoom = new RangeError("getter boom");
    const throwingName = Object.defineProperty(function f() {}, "name", {
      get() {
        throw getterBoom;
      },
    });
    expect(thrownBy(() => throwWith(throwingName))).toBe(getterBoom);

    const parentBoom = new RangeError("parent boom");
    const throwingParent = Object.defineProperty(function P() {}, "name", {
      get() {
        throw parentBoom;
      },
    });
    expect(thrownBy(() => throwWith(class D extends throwingParent {}))).toBe(parentBoom);
  });
});
