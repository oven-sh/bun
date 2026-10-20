import { describe, expect, mock, test } from "bun:test";

// The diff matchers (toEqual, toStrictEqual, toMatchObject, toHaveBeenCalledWith, ...)
// print both sides through the Jest-style pretty formatter. That formatter must honour
// `util.inspect.custom` / `Bun.inspect.custom` the same way `toBe` and `console.log`
// do, so a value with a large reachable graph (a DOM node) prints its short form
// instead of megabytes of properties. Snapshots keep ignoring the hook so `.snap`
// files do not change.

const inspectCustom = Symbol.for("nodejs.util.inspect.custom");

// The message carries ANSI colors when stderr is a TTY (CI lanes). Strip them.
const failureMessage = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return Bun.stripANSI((e as Error).message);
  }
  throw new Error("expected the matcher to fail");
};

class Node {
  big = Array.from({ length: 2_000 }, (_, i) => ({ i, label: `item-${i}` }));
  [inspectCustom]() {
    return "<Node>";
  }
}

describe("expect diff matchers honour inspect.custom", () => {
  test.each([
    ["toEqual", () => expect(new Node()).toEqual(null)],
    ["toStrictEqual", () => expect({ node: new Node() }).toStrictEqual({ node: null })],
    ["toMatchObject", () => expect({ node: new Node() }).toMatchObject({ node: null })],
    ["toHaveProperty", () => expect({ node: new Node() }).toHaveProperty("node", null)],
    [
      "toHaveBeenCalledWith",
      () => {
        const spy = mock((..._args: unknown[]) => {});
        spy(new Node());
        expect(spy).toHaveBeenCalledWith(null);
      },
    ],
    [
      "toHaveBeenLastCalledWith",
      () => {
        const spy = mock((..._args: unknown[]) => {});
        spy(new Node());
        expect(spy).toHaveBeenLastCalledWith(null);
      },
    ],
    [
      "toHaveBeenNthCalledWith",
      () => {
        const spy = mock((..._args: unknown[]) => {});
        spy(new Node());
        expect(spy).toHaveBeenNthCalledWith(1, null);
      },
    ],
    [
      "matcherHint",
      () => {
        expect.extend({
          _hint(received, expected) {
            return { pass: false, message: () => this.utils.matcherHint("_hint", received, expected) };
          },
        });
        (expect(new Node()) as any)._hint(null);
      },
    ],
  ])("%s prints the hook result instead of the object graph", (_name, fn) => {
    const message = failureMessage(fn);
    expect(message).toContain("<Node>");
    expect(message).not.toContain("item-1");
    expect(message.length).toBeLessThan(300);
  });

  test("the hook is honoured at every nesting level", () => {
    const message = failureMessage(() =>
      expect({ list: [new Node()], map: new Map([["k", new Node()]]), set: new Set([new Node()]) }).toEqual({
        list: [null],
        map: new Map([["k", null]]),
        set: new Set([null]),
      }),
    );
    expect(message.split("<Node>").length - 1).toBe(3);
    expect(message).not.toContain("item-1");
  });

  test("the hook is honoured on Array, Error, Map, Set and class constructors", () => {
    class A extends Array {
      [inspectCustom]() {
        return "<A>";
      }
    }
    class E extends Error {
      [inspectCustom]() {
        return "<E>";
      }
    }
    class M extends Map {
      [inspectCustom]() {
        return "<M>";
      }
    }
    class S extends Set {
      [inspectCustom]() {
        return "<S>";
      }
    }
    class C {
      static [inspectCustom]() {
        return "<C>";
      }
    }
    const a = new A();
    a.push(1, 2, 3);
    const received = { a, e: new E("boom"), m: new M([["k", 1]]), s: new S([1]), c: C };
    const message = failureMessage(() => expect(received).toEqual({}));
    expect(message).toContain("<A>");
    expect(message).toContain("<E>");
    expect(message).toContain("<M>");
    expect(message).toContain("<S>");
    expect(message).toContain("<C>");
    expect(message).not.toContain("boom");
  });

  test("a hook that returns this falls back to the default printer once", () => {
    const value = {
      a: 1,
      [inspectCustom]() {
        return this;
      },
    };
    const message = failureMessage(() => expect(value).toEqual(null));
    expect(message).toContain('"a": 1');
    expect(message.split('"a": 1').length - 1).toBe(1);
  });

  test("a hook that returns an object prints that object", () => {
    const value = {
      big: new Node(),
      [inspectCustom]() {
        return { summary: "short" };
      },
    };
    const message = failureMessage(() => expect(value).toEqual(null));
    expect(message).toContain('"summary": "short"');
    expect(message).not.toContain("item-1");
  });

  test("a hook that returns a hooked object prints the inner hook result", () => {
    const value = {
      [inspectCustom]() {
        return new Node();
      },
    };
    const message = failureMessage(() => expect(value).toEqual(null));
    expect(message).toContain("<Node>");
    expect(message).not.toContain("item-1");
  });

  test("a throwing hook surfaces as a catchable error with its message", () => {
    const value = {
      [inspectCustom]() {
        throw new Error("inspect failed");
      },
    };
    expect(() => expect(value).toEqual(null)).toThrow("inspect failed");
  });

  test("the hook runs once per object and receives the depth and options", () => {
    let calls = 0;
    const args: unknown[][] = [];
    const value = {
      get [inspectCustom]() {
        calls++;
        return (...a: unknown[]) => {
          args.push(a);
          return "<V>";
        };
      },
    };
    const message = failureMessage(() => expect(value).toEqual(null));
    expect(message).toContain("<V>");
    expect(calls).toBe(1);
    expect(args).toHaveLength(1);
    const [depth, options, inspect] = args[0] as [number, { depth: number }, Function];
    expect(typeof depth).toBe("number");
    expect(typeof options.depth).toBe("number");
    expect(typeof inspect).toBe("function");
  });

  test("a nested hook sees a smaller depth than the root", () => {
    const depths: Record<string, number> = {};
    const hooked = (name: string) => ({
      [inspectCustom](depth: number) {
        depths[name] = depth;
        return name;
      },
    });
    failureMessage(() => expect({ outer: hooked("outer"), deep: { deeper: { x: hooked("inner") } } }).toEqual(null));
    expect(Object.keys(depths).sort()).toEqual(["inner", "outer"]);
    expect(depths.outer).toBeGreaterThan(depths.inner);
  });

  test("two values that print alike report 'serializes to the same string'", () => {
    const message = failureMessage(() => expect(new Node()).toEqual({ other: true, [inspectCustom]: () => "<Node>" }));
    expect(message).toContain("Expected: <Node>");
    expect(message).toContain("Received: serializes to the same string");
  });

  test("a passing matcher never calls the hook", () => {
    let calls = 0;
    const value = {
      a: 1,
      [inspectCustom]() {
        calls++;
        return "<V>";
      },
    };
    expect(value).toEqual({ a: 1, [inspectCustom]: value[inspectCustom] });
    expect(value).toStrictEqual(value);
    expect(value).toMatchObject({ a: 1 });
    expect(calls).toBe(0);
  });

  test("Buffer diffs keep the per-byte output", () => {
    const message = failureMessage(() => expect(Buffer.from("ab")).toEqual(Buffer.from("ac")));
    expect(message).toContain('"data"');
    expect(message).toContain("97");
  });

  test("snapshots ignore the hook", () => {
    class Small {
      a = 1;
      [inspectCustom]() {
        return "<Small>";
      }
    }
    expect(new Small()).toMatchInlineSnapshot(`
      Small {
        "a": 1,
      }
    `);
    expect({ n: new Small() }).toMatchInlineSnapshot(`
      {
        "n": Small {
          "a": 1,
        },
      }
    `);
  });
});
