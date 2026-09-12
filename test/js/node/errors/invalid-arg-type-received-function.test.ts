import { describe, expect, test } from "bun:test";
import url from "node:url";
import zlib from "node:zlib";

// The "Received ..." suffix of ERR_INVALID_ARG_TYPE comes from determineSpecificType() in
// src/jsc/bindings/ErrorCode.cpp. For a callable, Node renders `function ${value.name}`, i.e. a
// plain property read, so a callable Proxy reports its target's name (or whatever its get trap
// returns), a bound function reports "bound f", and `name` overrides and getters are honored.
// The entry points below reach the renderer from a C++ validator, from the JS builtins'
// $ERR_INVALID_ARG_TYPE, from Rust's determine_specific_type, and from the ERR_INVALID_THIS message
// that native classes build with it. The ERR_INVALID_ARG_TYPE renderings are what node v26.3.0 prints
// for the same values.
const entryPoints: [label: string, code: string, prefix: string, throwWith: (value: unknown) => unknown][] = [
  [
    "C++ validator (process.umask)",
    "ERR_INVALID_ARG_TYPE",
    'The "mask" argument must be of type number. Received ',
    value => process.umask(value as any),
  ],
  [
    "$ERR_INVALID_ARG_TYPE (url.format)",
    "ERR_INVALID_ARG_TYPE",
    'The "urlObject" argument must be one of type object or string. Received ',
    value => url.format(value as any),
  ],
  [
    "Rust determine_specific_type (zlib.crc32)",
    "ERR_INVALID_ARG_TYPE",
    'The "value" argument must be of type number. Received ',
    value => zlib.crc32("x", value as any),
  ],
  [
    "createInvalidThisError (CryptoHasher#update)",
    "ERR_INVALID_THIS",
    "Expected this to be instanceof CryptoHasher, but received ",
    value => Bun.CryptoHasher.prototype.update.call(value, "x"),
  ],
];

// Each case builds a fresh value so that nothing has read `.name` before the error is rendered
// (JSC materializes a function's `name` property lazily).
const cases: [label: string, make: () => unknown, rendered: string][] = [
  ["proxy of a named function", () => new Proxy(function codegen() {}, {}), "function codegen"],
  ["proxy of a class", () => new Proxy(class Bar {}, {}), "function Bar"],
  ["proxy of a builtin", () => new Proxy(Array.prototype.push, {}), "function push"],
  ["proxy of a proxy", () => new Proxy(new Proxy(function inner() {}, {}), {}), "function inner"],
  ["proxy of an anonymous function", () => new Proxy((0, function () {}), {}), "function "],
  [
    "proxy whose get trap renames it",
    () =>
      new Proxy(function target() {}, { get: (t, key, r) => (key === "name" ? "trapped" : Reflect.get(t, key, r)) }),
    "function trapped",
  ],
  [
    "proxy whose get trap returns a non-string name",
    () => new Proxy(function target() {}, { get: (t, key, r) => (key === "name" ? 7 : Reflect.get(t, key, r)) }),
    "function 7",
  ],
  ["bound function", () => function f() {}.bind(null), "function bound f"],
  ["name redefined as a number", () => Object.defineProperty(function f() {}, "name", { value: 42 }), "function 42"],
  ["name redefined as empty", () => Object.defineProperty(function f() {}, "name", { value: "" }), "function "],
  [
    "name redefined as a getter",
    () => Object.defineProperty(function f() {}, "name", { get: () => "fromGetter" }),
    "function fromGetter",
  ],
  [
    "name deleted (falls back to Function.prototype.name)",
    () => {
      function f() {}
      delete (f as any).name;
      return f;
    },
    "function ",
  ],
  // Unchanged renderings, pinned so the rewrite of the callable branch cannot regress them.
  ["named function", () => function named() {}, "function named"],
  ["class", () => class Foo {}, "function Foo"],
  ["builtin", () => Array.prototype.push, "function push"],
  ["anonymous arrow", () => (0, () => {}), "function "],
];

function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
}

describe.each(entryPoints)(
  "determineSpecificType renders a callable like node: %s",
  (_label, code, prefix, throwWith) => {
    test("reads the callable's name through [[Get]]", () => {
      const messages = cases.map(([label, make]) => {
        const error = thrownBy(() => throwWith(make()));
        return [label, error.code, error.message];
      });
      expect(messages).toEqual(cases.map(([label, , rendered]) => [label, code, prefix + rendered]));
    });

    test("an exception thrown while reading the name replaces the error being built", () => {
      const trapBoom = new RangeError("trap boom");
      const getterBoom = new RangeError("getter boom");
      const revocable = Proxy.revocable(function f() {}, {});
      revocable.revoke();

      const trapProxy = new Proxy(function f() {}, {
        get() {
          throw trapBoom;
        },
      });
      const getterFunction = Object.defineProperty(function f() {}, "name", {
        get() {
          throw getterBoom;
        },
      });

      expect(thrownBy(() => throwWith(trapProxy))).toBe(trapBoom);
      expect(thrownBy(() => throwWith(getterFunction))).toBe(getterBoom);
      const revokedError = thrownBy(() => throwWith(revocable.proxy));
      expect(revokedError).toBeInstanceOf(TypeError);
      expect(revokedError.code).toBeUndefined();
    });
  },
);

test("a non-callable Proxy still renders through the object branch", () => {
  const messages = [new Proxy([], {}), new Proxy({}, {})].map(
    value => thrownBy(() => process.umask(value as any)).message,
  );
  expect(messages).toEqual([
    'The "mask" argument must be of type number. Received an instance of Array',
    'The "mask" argument must be of type number. Received an instance of Object',
  ]);
});
