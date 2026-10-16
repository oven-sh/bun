import { numberOfDFGCompiles } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// Coverage for the WebKit 23b0720b40 sync. Each case pins an observable difference between
// the old and the new JavaScriptCore, but for the last two, which pin what had to stay the same.
// The sources that depend on how JavaScriptCore parses
// are compiled with `new Function` or an indirect eval, so that Bun's transpiler leaves them alone.
// A source that has to be a SyntaxError goes through the indirect eval: see the TODO in
// webkit-upgrade-dbdca7545d.test.ts about the Function constructor.

describe.concurrent("WebKit 23b0720b40 upgrade", () => {
  test("a unary plus on an operand of `*` is not dropped (b985a89bbd)", () => {
    expect(() => new Function("return +1n * 2n;")()).toThrow(TypeError);
    expect(() => new Function("return 2n * +1n;")()).toThrow(TypeError);

    const log: string[] = [];
    const a = {
      valueOf() {
        log.push("a");
        return 3;
      },
    };
    const b = () => {
      log.push("b");
      return 2;
    };
    expect(new Function("a", "b", "return +a * b();")(a, b)).toBe(6);
    expect(log).toEqual(["a", "b"]);
  });

  test("`using` is allowed in a function nested in a switch clause (e694d1c0c3)", () => {
    expect((0, eval)("switch (0) { case 0: (() => { using x = null; })(); } 1")).toBe(1);
    // Directly in the clause it is still an error.
    expect(() => (0, eval)("switch (0) { case 0: using x = null; }")).toThrow(SyntaxError);
  });

  test("`await a ** b` is a SyntaxError (e33864764e)", () => {
    expect(() => (0, eval)("(async function () { await 2 ** 2; })")).toThrow(SyntaxError);
    expect(typeof (0, eval)("(async function () { (await 2) ** 2; })")).toBe("function");
  });

  test("a labelled function declaration is declared in the enclosing scope (29e6343215)", () => {
    expect(new Function("return typeof f; label: function f() {}")()).toBe("function");
    expect(() => (0, eval)("(function () { let f; label: function f() {} })")).toThrow(SyntaxError);
  });

  test("a 'use strict' directive rejects reserved words in the names before it (9f543645c4)", () => {
    expect(() => (0, eval)("(function foo(implements) { 'use strict'; })")).toThrow(SyntaxError);
    expect(() => (0, eval)("(function static() { 'use strict'; })")).toThrow(SyntaxError);
    expect(typeof (0, eval)("(function static(implements) {})")).toBe("function");
  });

  test("for-in visits the indexed properties of a function (21b684a378)", () => {
    const f: any = function () {};
    f[0] = "a";
    f[1] = "b";
    f.named = "c";
    const keys: string[] = [];
    for (const key in f) keys.push(key);
    expect(keys).toEqual(["0", "1", "named"]);
  });

  test("a built-in constructor reads newTarget.prototype before it looks for newTarget's realm (6fba1aeeb7)", () => {
    const log: string[] = [];
    const { proxy, revoke } = Proxy.revocable(function () {}, {
      get(_, key) {
        log.push(String(key));
        revoke();
        return undefined;
      },
    });
    // The prototype is not an object, so the realm's default is wanted, and a revoked proxy has no realm.
    expect(() => Reflect.construct(Map, [], proxy)).toThrow(TypeError);
    expect(log).toEqual(["prototype"]);
  });

  test("Array.fromAsync reads the iterator's `next` before it constructs `this` (d59de52c72)", async () => {
    const log: string[] = [];
    function Collection() {
      log.push("construct");
    }
    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          get next() {
            log.push("next");
            return async () => ({ done: true, value: undefined });
          },
        };
      },
    };
    await Array.fromAsync.call(Collection, iterable);
    expect(log).toEqual(["next", "construct"]);
  });

  test("optimized code does not take `x + y + 0.5` for an integer sum (13714a5887)", () => {
    const f = new Function("x", "y", "return (x + y + 0.5) | 0;");
    let result = f(2147483647, 2147483647);
    // Until the DFG's code is what runs. The bound is for a run with the JIT off.
    for (let i = 0; i < 200_000 && result === -2 && numberOfDFGCompiles(f) === 0; i++)
      result = f(2147483647, 2147483647);
    for (let i = 0; i < 100 && result === -2; i++) result = f(2147483647, 2147483647);
    expect(result).toBe(-2);
  });

  // JavaScriptCore no longer captures a stack in its Exception for a throw that a `catch` clause is certain to handle
  // (70896f26ff). node:vm takes the position for its header from that stack, between the throw and the `catch`.
  test("node:vm gives an error its header under a `catch` clause too", async () => {
    const cases: [() => unknown, string[]][] = [
      [() => vm.runInNewContext("\n  var 1a;"), ["evalmachine.<anonymous>:2", "  var 1a;", "      ^", ""]],
      [() => new vm.Script("\n  var 1a;", { filename: "f.js" }), ["f.js:2", "  var 1a;", "      ^", ""]],
      [
        () => vm.runInNewContext("\n  throw new Error('boom')"),
        ["evalmachine.<anonymous>:2", "  throw new Error('boom')", "                         ^", ""],
      ],
    ];
    const header = (error: Error) => error.stack!.split("\n").slice(0, 4);
    for (const [run, expected] of cases) {
      let caught: Error | undefined;
      try {
        run();
      } catch (error) {
        caught = error as Error;
      }
      expect(header(caught!)).toEqual(expected);
      // Here native code is what catches: the Promise constructor calls its executor.
      expect(header(await new Promise(run).catch(error => error))).toEqual(expected);
    }
  });

  // Upstream removed ShadowRealm in d5f13fa851 and Bun's fork keeps it.
  test("an error that leaves a ShadowRealm is caught as the outer realm's TypeError", () => {
    const realm = new ShadowRealm();
    const thrower = realm.evaluate("() => { throw new RangeError('inner'); }") as () => never;
    expect(String(thrower)).toBe("function () { [native code] }");
    let caught: unknown;
    try {
      thrower();
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(TypeError);
    expect((caught as TypeError).message).toBe("inner");
    expect((caught as TypeError).stack).toBeString();
  });
});
