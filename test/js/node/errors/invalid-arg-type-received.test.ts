import { describe, expect, test } from "bun:test";
import EventEmitter from "node:events";
import { SocketAddress } from "node:net";

// The "Received ..." suffix of ERR_INVALID_ARG_TYPE is rendered by determineSpecificType() in
// src/jsc/bindings/ErrorCode.cpp, a port of node's lib/internal/errors.js determineSpecificType().
// Native classes also use it for the "but received ..." suffix of ERR_INVALID_THIS. The entry
// points below reach it from a C++ validator, from the JS builtins' $ERR_INVALID_ARG_TYPE, from
// Rust's determine_specific_type, and from createInvalidThisError. Every rendering and every
// thrown message asserted here is what node v26.3.0 prints for the same value through the three
// ERR_INVALID_ARG_TYPE entry points.
const entryPoints: [label: string, code: string, prefix: string, throwWith: (value: unknown) => unknown][] = [
  [
    "C++ validator (process.chdir)",
    "ERR_INVALID_ARG_TYPE",
    'The "directory" argument must be of type string. Received ',
    value => process.chdir(value as any),
  ],
  [
    "$ERR_INVALID_ARG_TYPE (EventEmitter#on)",
    "ERR_INVALID_ARG_TYPE",
    'The "listener" argument must be of type function. Received ',
    value => new EventEmitter().on("event", value as any),
  ],
  [
    "Rust determine_specific_type (SocketAddress.parse)",
    "ERR_INVALID_ARG_TYPE",
    'The "input" argument must be of type string. Received ',
    value => SocketAddress.parse(value as any),
  ],
  [
    "createInvalidThisError (CryptoHasher#update)",
    "ERR_INVALID_THIS",
    "Expected this to be instanceof CryptoHasher, but received ",
    value => Bun.CryptoHasher.prototype.update.call(value, "x"),
  ],
];

const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

const cases: [label: string, make: () => unknown, rendered: string][] = [
  // Number.prototype.toString drops the sign of -0; node special-cases it.
  ["negative zero", () => -0, "type number (-0)"],
  ["zero", () => 0, "type number (0)"],
  ["negative fraction", () => -1.5, "type number (-1.5)"],

  // `value.constructor && 'name' in value.constructor` -> `an instance of ${value.constructor.name}`
  ["plain object", () => ({}), "an instance of Object"],
  ["array", () => [], "an instance of Array"],
  ["instance of an anonymous class", () => new (class {})(), "an instance of "],
  ["non-function constructor with a name", () => ({ constructor: { name: "Custom" } }), "an instance of Custom"],
  ["constructor whose name is undefined", () => ({ constructor: { name: undefined } }), "an instance of undefined"],
  [
    "constructor that inherits its name",
    () => ({ constructor: Object.create({ name: "Inherited" }) }),
    "an instance of Inherited",
  ],

  // Otherwise node falls back to util.inspect(value, { depth: -1 }), which collapses the value to
  // its constructor name in brackets instead of printing its contents.
  ["constructor without a name", () => ({ constructor: {} }), "[Object]"],
  ["constructor is null", () => ({ constructor: null }), "[Object]"],
  ["constructor is a falsy primitive", () => ({ constructor: "" }), "[Object]"],
  [
    "constructor whose has trap hides name",
    () => ({ constructor: new Proxy({ name: "Hidden" }, { has: () => false }) }),
    "[Object]",
  ],
  [
    "class instance shadowing its constructor with a nameless one",
    () => Object.assign(new (class Foo {})(), { constructor: {} }),
    "[Foo]",
  ],
  ["Map with a null constructor", () => Object.assign(new Map([[1, 2]]), { constructor: null }), "[Map]"],
  ["empty null-prototype object", () => Object.create(null), "[Object: null prototype] {}"],
  [
    "null-prototype object with properties",
    () => Object.assign(Object.create(null), { a: 1 }),
    "[Object: null prototype]",
  ],
  [
    "custom inspect function receives depth -1",
    () => ({ constructor: null, [inspectCustom]: (depth: number) => `custom depth=${depth}` }),
    "custom depth=-1",
  ],
];

// `'name' in value.constructor` throws when the constructor is a truthy primitive, so node's
// message builder throws a plain TypeError instead of producing ERR_INVALID_ARG_TYPE.
const primitiveConstructors: [label: string, constructor: unknown, rendered: string][] = [
  ["number", 1, "1"],
  ["string", "abc", "abc"],
  ["boolean", true, "true"],
  ["symbol", Symbol("desc"), "Symbol(desc)"],
  ["bigint", 1n, "1"],
];

function thrownBy(fn: () => unknown): any {
  try {
    fn();
  } catch (e) {
    return e;
  }
  throw new Error("expected the call to throw");
}

describe.each(entryPoints)("determineSpecificType via %s", (_label, code, prefix, throwWith) => {
  test("renders -0 and objects like node", () => {
    const messages = cases.map(([label, make]) => {
      const error = thrownBy(() => throwWith(make()));
      return [label, error.code, error.message];
    });
    expect(messages).toEqual(cases.map(([label, , rendered]) => [label, code, prefix + rendered]));
  });

  test("a truthy primitive constructor throws the `in` operator's TypeError", () => {
    const errors = primitiveConstructors.map(([label, constructor]) => {
      const error = thrownBy(() => throwWith({ constructor }));
      return [label, error instanceof TypeError, error.code, error.message];
    });
    expect(errors).toEqual(
      primitiveConstructors.map(([label, , rendered]) => [
        label,
        true,
        undefined,
        `Cannot use 'in' operator to search for 'name' in ${rendered}`,
      ]),
    );
  });

  test("an exception thrown while rendering the value replaces the error being built", () => {
    const constructorBoom = new RangeError("constructor getter");
    const hasBoom = new RangeError("has trap");
    const nameBoom = new RangeError("name getter");
    const inspectBoom = new RangeError("custom inspect");

    expect(
      thrownBy(() =>
        throwWith({
          get constructor() {
            throw constructorBoom;
          },
        }),
      ),
    ).toBe(constructorBoom);
    expect(
      thrownBy(() =>
        throwWith({
          constructor: new Proxy(
            {},
            {
              has() {
                throw hasBoom;
              },
            },
          ),
        }),
      ),
    ).toBe(hasBoom);
    expect(
      thrownBy(() =>
        throwWith({
          constructor: {
            get name() {
              throw nameBoom;
            },
          },
        }),
      ),
    ).toBe(nameBoom);
    expect(
      thrownBy(() =>
        throwWith({
          constructor: null,
          [inspectCustom]() {
            throw inspectBoom;
          },
        }),
      ),
    ).toBe(inspectBoom);
  });
});
