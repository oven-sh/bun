import { describe, expect, test } from "bun:test";
import _ from "lodash";
import { readFileSync } from "node:fs";

// Every native function prints the one-line shape V8 uses:
//   function name() { [native code] }
// oven-sh/WebKit#155 moved InternalFunction constructors (Map, Set, ...) to
// that shape. Host functions, builtins written in JavaScript, and bound
// functions kept JSC's three-line shape until oven-sh/WebKit#545. lodash's
// isNative() builds a RegExp from hasOwnProperty's source and tests Map against
// it, so with two shapes lodash thought Map was not native and cloneDeep,
// memoize, uniq and isEqual fell back to a linear-scan cache (quadratic).

const source = (fn: Function) => Function.prototype.toString.call(fn);

describe("Function.prototype.toString on native functions", () => {
  test("prints one line for every kind of native function", () => {
    expect({
      hostFunction: source(Object.prototype.hasOwnProperty),
      hostFunctionStatic: source(Object.create),
      internalFunctionConstructor: source(Map),
      jsFunctionConstructor: source(Promise),
      builtinWrittenInJS: source(Array.prototype.map),
      nativeGetter: source(Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!),
      boundFunction: source(function foo() {}.bind(null)),
      boundNativeFunction: source(Object.prototype.hasOwnProperty.bind({})),
      bunHostFunction: source(Bun.serve),
      bunBuiltinModule: source(readFileSync),
      bunClassConstructor: source(Bun.Transpiler),
    }).toEqual({
      hostFunction: "function hasOwnProperty() { [native code] }",
      hostFunctionStatic: "function create() { [native code] }",
      internalFunctionConstructor: "function Map() { [native code] }",
      jsFunctionConstructor: "function Promise() { [native code] }",
      builtinWrittenInJS: "function map() { [native code] }",
      nativeGetter: "function get size() { [native code] }",
      boundFunction: "function foo() { [native code] }",
      boundNativeFunction: "function hasOwnProperty() { [native code] }",
      bunHostFunction: "function serve() { [native code] }",
      bunBuiltinModule: "function readFileSync() { [native code] }",
      bunClassConstructor: "function Transpiler() { [native code] }",
    });
  });

  test("user functions still print their source", () => {
    function user(a: number, b: number) {
      return a + b;
    }
    expect(source(user)).toStartWith("function user(a, b) {");
    expect(source(user)).toContain("return a + b;");
    expect(source(() => 1)).toBe("() => 1");
    expect(source(class Foo {})).toStartWith("class Foo {");
  });

  test("lodash detects Map, Set, WeakMap, DataView and Promise as native", () => {
    const natives = [Map, Set, WeakMap, DataView, Promise, Symbol, Object.create, Object.prototype.hasOwnProperty];
    expect(natives.map(fn => [fn.name, _.isNative(fn)])).toEqual(natives.map(fn => [fn.name, true]));

    // lodash resolved `Map` through isNative() at load time. MapCache, which
    // backs memoize and the Stack that cloneDeep uses for cycle detection,
    // uses that Map. When the sniff failed it used ListCache: a linear scan.
    const memoized = _.memoize((key: object) => key);
    memoized({});
    expect((memoized.cache as any).__data__.map).toBeInstanceOf(Map);

    // cloneDeep keeps shared structure through the same Stack.
    const shared = { leaf: true };
    const definitions: Record<string, object> = {};
    for (let i = 0; i < 1000; i++) definitions["D" + i] = { shared, next: i };
    const copy = _.cloneDeep({ definitions });
    expect(copy).toEqual({ definitions });
    expect(copy.definitions.D0.shared).toBe(copy.definitions.D999.shared);
    expect(copy.definitions.D0.shared).not.toBe(shared);
  });
});
