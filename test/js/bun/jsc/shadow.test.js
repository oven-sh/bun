import { describe, expect, it } from "bun:test";

it("shadow realm works", () => {
  const red = new ShadowRealm();
  globalThis.someValue = 1;
  // Affects only the ShadowRealm's global
  const result = red.evaluate("globalThis.someValue = 2;");
  expect(globalThis.someValue).toBe(1);
  expect(result).toBe(2);
});

// https://tc39.es/proposal-shadowrealm/#sec-ordinary-wrapped-function-call
// OrdinaryWrappedFunctionCall passes |this| through GetWrappedValue, like an argument: a primitive crosses as is, a
// callable is wrapped for the target realm, and any other object throws a TypeError from the caller's realm before the
// target runs.
describe("wrapped function this value", () => {
  const realm = new ShadowRealm();
  realm.evaluate(`globalThis.calls = 0`);
  const callsInRealm = realm.evaluate(`() => globalThis.calls`);

  const describeThisSource = `(function describeThis() {
    "use strict";
    globalThis.calls++;
    if (this === undefined || this === null) return String(this);
    if (typeof this === "function") return "function:" + (Object.getPrototypeOf(this) === Function.prototype) + ":" + this();
    if (typeof this === "symbol") return "symbol:" + this.description;
    return typeof this + ":" + String(this);
  })`;

  // A plain function target takes remoteFunctionCallForJSFunction (or the JIT thunk once the target has JIT code). The
  // others take remoteFunctionCallGeneric.
  const targets = {
    "function": realm.evaluate(describeThisSource),
    "proxy": realm.evaluate(`new Proxy(${describeThisSource}, {})`),
    "proxy with an apply trap": realm.evaluate(
      `new Proxy(${describeThisSource}, { apply(target, thisValue, args) { return Reflect.apply(target, thisValue, args); } })`,
    ),
    "bound function": realm.evaluate(`${describeThisSource}.bind("bound")`),
  };

  function outer() {
    return "outer";
  }

  for (const [kind, wrapped] of Object.entries(targets)) {
    const isBound = kind === "bound function";
    describe(`${kind} target`, () => {
      it("passes a primitive through", () => {
        const seen = thisValue => [
          wrapped.call(thisValue),
          Reflect.apply(wrapped, thisValue, []),
          wrapped.bind(thisValue)(),
        ];
        const before = callsInRealm();
        const expected = isBound
          ? Object.fromEntries(
              [
                "undefined",
                "null",
                "number",
                "negative zero",
                "string",
                "boolean",
                "bigint",
                "symbol",
                "well-known symbol",
              ].map(k => [k, ["string:bound", "string:bound", "string:bound"]]),
            )
          : {
              "undefined": ["undefined", "undefined", "undefined"],
              "null": ["null", "null", "null"],
              "number": ["number:5", "number:5", "number:5"],
              "negative zero": ["number:0", "number:0", "number:0"],
              "string": ["string:s", "string:s", "string:s"],
              "boolean": ["boolean:true", "boolean:true", "boolean:true"],
              "bigint": ["bigint:10", "bigint:10", "bigint:10"],
              "symbol": ["symbol:d", "symbol:d", "symbol:d"],
              "well-known symbol": ["symbol:Symbol.iterator", "symbol:Symbol.iterator", "symbol:Symbol.iterator"],
            };
        expect({
          "undefined": seen(undefined),
          "null": seen(null),
          "number": seen(5),
          "negative zero": seen(-0),
          "string": seen("s"),
          "boolean": seen(true),
          "bigint": seen(10n),
          "symbol": seen(Symbol("d")),
          "well-known symbol": seen(Symbol.iterator),
        }).toEqual(expected);
        expect(callsInRealm()).toBe(before + 9 * 3);
      });

      it("wraps a callable for the target realm", () => {
        expect([wrapped.call(outer), wrapped.apply(() => "arrow", []), wrapped.bind(outer)()]).toEqual(
          isBound
            ? ["string:bound", "string:bound", "string:bound"]
            : ["function:true:outer", "function:true:arrow", "function:true:outer"],
        );
        if (!isBound) {
          // The wrapped function itself: JSRemoteFunction::tryCreate unwraps it and wraps its target again, this time
          // for the shadow realm, so the realm calls its own describeThis once more, with |this| undefined.
          const before = callsInRealm();
          expect(wrapped.call(wrapped)).toBe("function:true:undefined");
          expect(callsInRealm()).toBe(before + 2);
        }
      });

      it("throws a TypeError from the caller realm for any other object, before the target runs", () => {
        for (const thisValue of [
          {},
          [],
          new Proxy({}, {}),
          new String("boxed"),
          Object(Symbol("boxed")),
          globalThis,
          new Date(0),
          /re/,
        ]) {
          const before = callsInRealm();
          for (const call of [
            () => wrapped.call(thisValue),
            () => Reflect.apply(wrapped, thisValue, []),
            () => wrapped.bind(thisValue)(),
            () => ({ method: wrapped }).method(),
          ]) {
            let error;
            try {
              call();
            } catch (e) {
              error = e;
            }
            expect(error).toBeInstanceOf(TypeError);
            expect(error.message).toBe("value passing between realms must be callable or primitive");
          }
          expect(callsInRealm()).toBe(before);
        }
      });
    });
  }

  it("a sloppy-mode target sees its own global for undefined and null, and its own wrapper object for other primitives", () => {
    const sloppy = realm.evaluate(`(function () {
      if (this === globalThis) return "globalThis";
      if (typeof this === "function") return "function:" + this();
      return typeof this + ":" + (this instanceof Number || this instanceof String || this instanceof Symbol) + ":" + this.toString();
    })`);
    expect([
      sloppy(),
      sloppy.call(undefined),
      sloppy.call(null),
      sloppy.call(3),
      sloppy.call("s"),
      sloppy.call(Symbol("q")),
      sloppy.call(outer),
    ]).toEqual([
      "globalThis",
      "globalThis",
      "globalThis",
      "object:true:3",
      "object:true:s",
      "object:true:Symbol(q)",
      "function:outer",
    ]);
    expect(() => sloppy.call({})).toThrow(TypeError);
    // An arrow function target ignores |this|, but the wrapper cannot let an object through either.
    const arrow = realm.evaluate(`() => "arrow"`);
    expect([arrow.call(1), arrow.call(outer)]).toEqual(["arrow", "arrow"]);
    expect(() => arrow.call({})).toThrow(TypeError);
  });

  it("works the same when the shadow realm calls a function of the incubating realm", () => {
    let calls = 0;
    function describeThis() {
      "use strict";
      calls++;
      if (this === undefined || this === null) return String(this);
      if (typeof this === "function")
        return "function:" + (Object.getPrototypeOf(this) === Function.prototype) + ":" + this();
      return typeof this + ":" + String(this);
    }
    const callWith = realm.evaluate(`(function callWith(f, kind) {
      switch (kind) {
      case "none": return f();
      case "number": return f.call(42);
      case "string": return Reflect.apply(f, "s", []);
      case "callable": return f.call(() => "inner");
      case "bound callable": return f.bind(function () { return "inner bound"; })();
      default:
        try {
          if (kind === "object") f.call({});
          else if (kind === "array") f.apply([], []);
          else if (kind === "global") f.call(globalThis);
          else ({ f }).f();
        } catch (e) {
          return "threw " + e.constructor.name + " of the shadow realm: " + (e instanceof TypeError) + ": " + e.message;
        }
        return "did not throw";
      }
    })`);
    expect(
      ["none", "number", "string", "callable", "bound callable"].map(kind => callWith(describeThis, kind)),
    ).toEqual(["undefined", "number:42", "string:s", "function:true:inner", "function:true:inner bound"]);
    const before = calls;
    const threw =
      "threw TypeError of the shadow realm: true: value passing between realms must be callable or primitive";
    expect(["object", "array", "global", "method"].map(kind => callWith(describeThis, kind))).toEqual([
      threw,
      threw,
      threw,
      threw,
    ]);
    expect(calls).toBe(before);
  });

  // With the JIT on, only the first call of a plain function target goes through remoteFunctionCallForJSFunction. Once
  // the target has code, the remoteFunctionCallGenerator thunk copies and wraps the arguments and |this| itself.
  it("gets every argument count right on both call paths", () => {
    const collect = realm.evaluate(`"use strict"; (function (...args) { return String(this) + "|" + args.join(",") })`);
    const collectViaProxy = realm.evaluate(
      `"use strict"; new Proxy(function (...args) { return String(this) + "|" + args.join(",") }, {})`,
    );
    const hundred = new Array(100).fill(9);
    const expected = [
      "undefined|",
      "T|",
      "T|1",
      "T|1,2",
      "T|1,2,3",
      "T|1,2,3,4,5,6,7",
      "undefined|1,2,3,4,5,6,7,8",
      "T|" + hundred.join(","),
      "function|1",
      "TypeError",
    ];
    for (let i = 0; i < 200; i++) {
      for (const f of [collect, collectViaProxy]) {
        let objectThis;
        try {
          f.call({ i }, 1, 2);
        } catch (e) {
          objectThis = e.constructor.name;
        }
        const got = [
          f(),
          f.call("T"),
          f.call("T", 1),
          f.call("T", 1, 2),
          f.call("T", 1, 2, 3),
          f.call("T", 1, 2, 3, 4, 5, 6, 7),
          f(1, 2, 3, 4, 5, 6, 7, 8),
          f.apply("T", hundred),
          f.call(outer, 1).replace(/^function[^|]*/, "function"),
          objectThis,
        ];
        if (got.join("\n") !== expected.join("\n")) expect(got).toEqual(expected); // expect() in the loop is slow
      }
    }
  });

  // WrappedFunctionCreate reads the "length" and "name" of the callable it wraps, so the wrapping order is observable:
  // each argument in order, then |this|.
  it("wraps the arguments in order, then this", () => {
    const log = [];
    function observed(tag) {
      const f = function () {
        return tag;
      };
      Object.defineProperty(f, "name", {
        get() {
          log.push(tag + ".name");
          return tag;
        },
      });
      Object.defineProperty(f, "length", {
        get() {
          log.push(tag + ".length");
          return 0;
        },
      });
      return f;
    }
    const takesTwo = realm.evaluate(`(function (a, b) { "use strict"; return [this(), a(), b()].join() })`);
    const takesTwoViaProxy = realm.evaluate(
      `new Proxy(function (a, b) { "use strict"; return [this(), a(), b()].join() }, {})`,
    );
    // Past the first call, the plain function target takes the thunk.
    for (let i = 0; i < 100; i++) {
      for (const f of [takesTwo, takesTwoViaProxy]) {
        log.length = 0;
        const result = f.call(observed("this"), observed("a"), observed("b"));
        if (result !== "this,a,b") expect(result).toBe("this,a,b");
        if (log.join() !== "a.length,a.name,b.length,b.name,this.length,this.name")
          expect(log).toEqual(["a.length", "a.name", "b.length", "b.name", "this.length", "this.name"]);

        // When an argument cannot be wrapped, |this| is not looked at and the target does not run.
        log.length = 0;
        expect(() => f.call(observed("this"), observed("a"), {})).toThrow(TypeError);
        if (log.join() !== "a.length,a.name") expect(log).toEqual(["a.length", "a.name"]);
      }
    }
  });
});
