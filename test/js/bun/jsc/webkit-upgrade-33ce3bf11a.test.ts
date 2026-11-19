import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// Coverage for the WebKit 33ce3bf11a sync. Each case pins an observable difference between
// the old and the new JavaScriptCore, but for the last two, which pin what had to stay the same.
// The sources that depend on how JavaScriptCore parses or compiles go through `new Function` or
// node:vm, so that Bun's transpiler leaves them alone.

describe.concurrent("WebKit 33ce3bf11a upgrade", () => {
  test("an import or export declaration cannot redeclare a `var` of its module (f88678d334)", () => {
    const sources = [
      "var x; export let x;",
      "var x; export const x = 1;",
      "var x; export function x() {}",
      "var x; export class x {}",
      "{ var x; } export let x;",
      'var x; import { y as x } from "./m.js";',
      'var x; import * as x from "./m.js";',
      'var x; import x from "./m.js";',
    ];
    for (const source of sources) expect(() => new vm.SourceTextModule(source), source).toThrow(SyntaxError);
    // Exporting the `var` itself is not a second declaration.
    expect(new vm.SourceTextModule("var x; export { x };").status).toBe("unlinked");
  });

  test("a static private name can be used in the computed keys of its class (5d5248a69a)", () => {
    const run = new Function(`
      const log = [];
      let read;
      const C = class {
        static #method() { return 1; }
        static [(
          read = object => object.#method,
          log.push(#method in {}),
          (() => { try { read({}); } catch (error) { log.push(error.constructor.name); } })(),
          "key"
        )]() {}
      };
      log.push(read(C)());
      return log;
    `);
    // The brand check used to throw a ReferenceError until the class body had been evaluated.
    expect(run()).toEqual([false, "TypeError", 1]);
  });

  test("searching a BigInt typed array does not wrap a BigInt that is out of range (de4efbb4d3)", () => {
    const unsigned = new BigUint64Array([1n, 2n ** 64n - 1n, 0n]);
    expect(unsigned.includes(-1n)).toBe(false);
    expect(unsigned.indexOf(-1n)).toBe(-1);
    expect(unsigned.lastIndexOf(-1n)).toBe(-1);
    expect(unsigned.indexOf(2n ** 64n)).toBe(-1);
    expect(unsigned.indexOf(2n ** 64n - 1n)).toBe(1);

    const signed = new BigInt64Array([-1n, 5n, -(2n ** 63n)]);
    expect(signed.includes(2n ** 64n - 1n)).toBe(false);
    expect(signed.indexOf(5n + 2n ** 64n)).toBe(-1);
    expect(signed.indexOf(2n ** 63n)).toBe(-1);
    expect(signed.lastIndexOf(-1n)).toBe(0);
    expect(signed.indexOf(-(2n ** 63n))).toBe(2);
  });

  // A callable Proxy with no `apply` trap is called straight through its call link now (b40ec02b7c). The trap is
  // looked up on every call, so one that appears, goes away or belongs to a revoked proxy must still be seen.
  test("a Proxy called through a linked call still looks up its `apply` trap", () => {
    const handler: ProxyHandler<(this: unknown, value: number) => unknown[]> = {};
    const target = function (this: unknown, value: number) {
      return [this, value];
    };
    const { proxy, revoke } = Proxy.revocable(target, handler);
    // The proxy is the callee of this call site, which is what gets linked.
    const call = new Function("receiver", "value", "return receiver.method(value);");
    const receiver = { method: proxy };
    for (let i = 0; i < 10_000; i++) {
      const result = call(receiver, i);
      if (result[0] !== receiver || result[1] !== i) throw new Error(`call ${i} returned ${String(result)}`);
    }
    handler.apply = () => ["trapped"];
    expect(call(receiver, 1)).toEqual(["trapped"]);
    delete handler.apply;
    expect(call(receiver, 2)).toEqual([receiver, 2]);
    revoke();
    expect(() => call(receiver, 3)).toThrow(TypeError);
  });

  // The shortest form of a double comes from zmij instead of dragonbox (33ce3bf11a).
  test("numbers are written as they were", () => {
    const cases: [number, string][] = [
      [0.1 + 0.2, "0.30000000000000004"],
      [1 / 3, "0.3333333333333333"],
      [2 / 3, "0.6666666666666666"],
      [4.35, "4.35"],
      [123456.789, "123456.789"],
      [5e-324, "5e-324"],
      [2.2250738585072014e-308, "2.2250738585072014e-308"],
      [1.7976931348623157e308, "1.7976931348623157e+308"],
      [9007199254740993, "9007199254740992"],
      [123456789012345680000, "123456789012345680000"],
      [1e21, "1e+21"],
      [1e100, "1e+100"],
      [0.000001, "0.000001"],
      [1e-7, "1e-7"],
      [-1.5e-10, "-1.5e-10"],
    ];
    for (const [value, expected] of cases) {
      expect(String(value)).toBe(expected);
      expect(Number(expected)).toBe(value);
    }
    expect(String(-0)).toBe("0");
    expect(JSON.stringify([1.5, -0, 1e21, 0.1, 5e-324])).toBe("[1.5,0,1e+21,0.1,5e-324]");
    expect((123456).toExponential()).toBe("1.23456e+5");
    expect((0).toExponential()).toBe("0e+0");
    expect((1e-7).toExponential()).toBe("1e-7");
    expect((-1.5e300).toExponential()).toBe("-1.5e+300");
    expect((0.1 + 0.2).toExponential()).toBe("3.0000000000000004e-1");
  });
});
