import { describe, expect, test } from "bun:test";

// Coverage for the WebKit 982277c9dd sync. Each case pins an observable difference between
// the old and the new JavaScriptCore. The sources go through `new Function`, so that Bun's
// transpiler leaves them alone.

describe.concurrent("WebKit 982277c9dd upgrade", () => {
  test("Object.assign() calls an indexed setter on the target's prototype chain", () => {
    const stored: unknown[] = [];
    const prototype = {};
    Object.defineProperty(prototype, "0", {
      set(value) {
        stored.push(value);
      },
      get() {
        return "inherited";
      },
    });
    const target = Object.assign(Object.create(prototype), { 0: 1, a: 2 });
    expect(stored).toEqual([1]);
    expect(Object.keys(target)).toEqual(["a"]);
    expect(target[0]).toBe("inherited");
  });

  test("a `case` expression that stores into the variable of its `switch` does not change what is compared", () => {
    const run = new Function(`
      function parameter(value, other) {
        switch (value) {
          case (value = 5, 1.1): return "first";
          case other: return "matched";
        }
        return "none";
      }
      function local(start) {
        let value = start;
        switch (value) {
          case value++ + 10: return "first " + value;
          case start: return "matched " + value;
          case start + 1: return "the stored value " + value;
        }
        return "none " + value;
      }
      function storedByCall(start) {
        let value = start;
        const change = () => { value = "changed"; return "never"; };
        switch (value) {
          case change(): return "first";
          case "changed": return "the stored value";
          case start: return "matched " + value;
        }
        return "none";
      }
      function behindDefault(value) {
        switch (value) {
          case (value += 1, "no"): return "first";
          default: return "default " + value;
          case 7: return "seven " + value;
        }
      }
      return [
        parameter(undefined, undefined), parameter(1.1, 0), parameter(5, 5), parameter(5, 6),
        local(1), local(-10),
        storedByCall("kept"),
        behindDefault(7), behindDefault(6), behindDefault(0),
      ];
    `);
    expect(run()).toEqual([
      "matched",
      "first",
      "matched",
      "none",
      "matched 2",
      "matched -9",
      "matched changed",
      "seven 8",
      "default 7",
      "default 1",
    ]);
  });

  test("what a ShadowRealm function throws reaches a native caller as a TypeError of the caller's realm", () => {
    const realm = new ShadowRealm();
    const throwers: Record<string, any> = {
      error: realm.evaluate("() => { throw new RangeError('inner'); }"),
      literal: realm.evaluate("() => { throw { secret: 1 }; }"),
      function: realm.evaluate("() => { throw function leaked() { }; }"),
    };
    const callers: Record<string, (thrower: any) => unknown> = {
      direct: thrower => thrower(),
      sort: thrower => [2, 1].sort(thrower),
      replace: thrower => "x".replace(/x/, thrower),
      reviver: thrower => JSON.parse("1", thrower),
      getter: thrower => Object.defineProperty({}, "x", { get: thrower }).x,
      valueOf: thrower => +{ valueOf: thrower },
      next: thrower => [...{ [Symbol.iterator]: () => ({ next: thrower }) }],
    };
    const prototypesOfCaught: Record<string, boolean> = {};
    for (const how in callers) {
      for (const what in throwers) {
        try {
          callers[how](throwers[what]);
        } catch (error) {
          prototypesOfCaught[`${how} of ${what}`] = Object.getPrototypeOf(error) === TypeError.prototype;
        }
      }
    }
    const expected = Object.keys(callers).flatMap(how =>
      Object.keys(throwers).map(what => [`${how} of ${what}`, true]),
    );
    expect(prototypesOfCaught).toEqual(Object.fromEntries(expected));
  });
});
