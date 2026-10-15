import { bindgen as bindings } from "bun:internal-for-testing";
import { describe as describeAlways, expect, it as itAlways } from "bun:test";
import * as b from "../../src/codegen/bindgen-lib.ts";

// bindgen_test.bind.ts is only in a build with assertions: a debug build, CI's ASAN lane.
const bindgen = bindings ?? ({} as NonNullable<typeof bindings>);
const describe = describeAlways.skipIf(!bindings);
const it = itAlways.skipIf(!bindings);

it("bindgen add example", () => {
  // Simple cases
  expect(bindgen.add(5, 3)).toBe(8);
  expect(bindgen.add(-2, 7)).toBe(5);
  expect(bindgen.add(0, 0)).toBe(0);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 2. If argument is either a Symbol or a BigInt, throw a TypeError exception.
  expect(() => bindgen.add(1n, 0)).toThrow("Conversion from 'BigInt' to 'number' is not allowed");
  expect(() => bindgen.add(Symbol("1"), 0)).toThrow("Cannot convert a symbol to a number");
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is null or false, return +0.
  expect(bindgen.add(null, "32")).toBe(32);
  expect(bindgen.add(false, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 3. If argument is undefined, return NaN.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  // 8. If x is NaN, +0, +∞, or −∞, then return +0.
  expect(bindgen.add(undefined, "32")).toBe(32);
  expect(bindgen.add(NaN, "32")).toBe(32);
  expect(bindgen.add(Infinity, "32")).toBe(32);
  expect(bindgen.add(-Infinity, "32")).toBe(32);
  // https://tc39.es/ecma262/multipage/abstract-operations.html#sec-tonumber
  // 5. If argument is true, return 1.
  expect(bindgen.add(true, "32")).toBe(33);
  // https://tc39.es/ecma262/multipage/bigint-object.html#sec-tonumber
  // 6. If argument is a String, return StringToNumber(argument).
  expect(bindgen.add("1", "1")).toBe(2);
  // 8. Let primValue be ? ToPrimitive(argument, number).
  // 10. Return ? ToNumber(primValue).
  expect(bindgen.add({ [Symbol.toPrimitive]: () => "1" }, "1")).toBe(2);

  expect(bindgen.add(2147483647.9, 0)).toBe(2147483647);
  expect(bindgen.add(2147483647.1, 0)).toBe(2147483647);

  // Out of range wrapping behaviors. By adding `0`, this acts as an identity function.
  // https://webidl.spec.whatwg.org/#abstract-opdef-converttoint
  expect(bindgen.add(2147483648, 0)).toBe(-2147483648);
  expect(bindgen.add(5555555555, 0)).toBe(1260588259);
  expect(bindgen.add(-5555555555, 0)).toBe(-1260588259);
  expect(bindgen.add(55555555555, 0)).toBe(-279019293);
  expect(bindgen.add(-55555555555, 0)).toBe(279019293);
  expect(bindgen.add(555555555555, 0)).toBe(1504774371);
  expect(bindgen.add(-555555555555, 0)).toBe(-1504774371);
  expect(bindgen.add(5555555555555, 0)).toBe(-2132125469);
  expect(bindgen.add(-5555555555555, 0)).toBe(2132125469);

  // Test Zig error handling
  expect(() => bindgen.add(2147483647, 1)).toThrow("Integer overflow while adding");
});

it("optional arguments / default arguments", () => {
  expect(bindgen.requiredAndOptionalArg(false)).toBe(123498);
  expect(bindgen.requiredAndOptionalArg(false, 10)).toBe(52);
  expect(bindgen.requiredAndOptionalArg(true, 10)).toBe(-52);
  expect(bindgen.requiredAndOptionalArg(1, 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("coerce to true", 10, 5)).toBe(-15);
  expect(bindgen.requiredAndOptionalArg("", 10, 5)).toBe(15);
  expect(bindgen.requiredAndOptionalArg(true, 10, 5, 2)).toBe(-30);
  expect(bindgen.requiredAndOptionalArg(true, null, 5, 2)).toBe(123463);
});

it("custom enforceRange boundaries", () => {
  expect(bindgen.requiredAndOptionalArg(false, 0, 5)).toBe(5);
  expect(() => bindgen.requiredAndOptionalArg(false, 0, -1)).toThrow("Value -1 is outside the range [0, 100]");
  expect(() => bindgen.requiredAndOptionalArg(false, 0, 101)).toThrow("Value 101 is outside the range [0, 100]");
  expect(bindgen.requiredAndOptionalArg(false, 0, 100)).toBe(100);
  expect(bindgen.requiredAndOptionalArg(false, 0, 0)).toBe(0);
});

// Not through the test schema, so on every build.
itAlways("unsigned integer dictionary fields reject negative values", () => {
  const listen = (tls: Record<string, number>) =>
    Bun.listen({ hostname: "127.0.0.1", port: 0, tls, socket: { data() {} } });

  for (const field of ["secureOptions", "clientRenegotiationLimit", "clientRenegotiationWindow"] as const) {
    let caught: any = undefined;
    try {
      using listener = listen({ [field]: -1 });
      void listener;
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(RangeError);
    expect(caught.code).toBe("ERR_OUT_OF_RANGE");
    expect(caught.message).toBe(`TLSOptions.${field} must be in the range [0, 4294967295] (received -1)`);
  }
});

describe("strings", () => {
  const rope = (a: string, b: string) => a + b + a; // long enough that JSC keeps it a rope
  const texts = [
    "",
    "ascii",
    "latin1 éÿ",
    "utf16 你好 \u{1f600}",
    rope(Buffer.alloc(40, "a").toString(), Buffer.alloc(40, "b").toString()),
    rope(Buffer.alloc(80, "é").toString(), Buffer.alloc(120, "你").toString()),
    Buffer.alloc(1000, "x").toString(),
    Buffer.alloc(2000, "é").toString(),
    "nul \0 inside",
  ];

  it.each(texts)("round trips %j", text => {
    expect(bindgen.utf8Echo(text)).toBe(text);
    expect(bindgen.utf8EchoLoose(text)).toBe(text);
    expect(bindgen.utf8Optional(text)).toBe(text);
    expect(bindgen.utf8Owned(text)).toBe(text);
    expect(bindgen.stringEcho(text)).toBe(text);
  });

  it("replaces an unpaired surrogate", () => {
    expect(bindgen.utf8Echo("a\ud800b")).toBe("a�b");
    expect(bindgen.utf8Echo("\udc00")).toBe("�");
  });

  it("strict takes strings and String objects only", () => {
    expect(bindgen.utf8Echo(new String("boxed"))).toBe("boxed");
    class Path extends String {}
    expect(bindgen.utf8Echo(new Path("derived"))).toBe("derived");
    expect(bindgen.utf8Owned(new String("boxed"))).toBe("boxed");
    expect(bindgen.utf8Owned(new Path("derived"))).toBe("derived");
    for (const value of [1, true, null, undefined, {}, [], Symbol("s"), { toString: () => "no" }]) {
      for (const echo of [bindgen.utf8Echo, bindgen.utf8Owned]) {
        expect(() => echo(value)).toThrow(
          expect.objectContaining({ code: "ERR_INVALID_ARG_TYPE", message: "text must be a string" }),
        );
      }
    }
  });

  it("loose is ToString", () => {
    expect(bindgen.utf8EchoLoose(12)).toBe("12");
    expect(bindgen.utf8EchoLoose(null)).toBe("null");
    expect(bindgen.utf8EchoLoose({ toString: () => "custom" })).toBe("custom");
    expect(() => bindgen.utf8EchoLoose(Symbol("s"))).toThrow(TypeError);
    expect(() =>
      bindgen.utf8EchoLoose({
        toString() {
          throw new RangeError("from toString");
        },
      }),
    ).toThrow(new RangeError("from toString"));
  });

  it("tells an absent string from an empty one", () => {
    expect(bindgen.utf8Optional(null)).toBe(null);
    expect(bindgen.utf8Optional(undefined)).toBe(null);
    expect(bindgen.utf8Optional()).toBe(null);
    expect(bindgen.utf8Optional("")).toBe("");
  });

  it("checks the argument count", () => {
    expect(() => bindgen.utf8Echo()).toThrow(
      expect.objectContaining({ name: "TypeError", code: "ERR_MISSING_ARGS", message: "Not enough arguments" }),
    );
  });

  it("keeps the characters of a substring while its base is swapped for an atom", () => {
    const fill = (length: number, char: string) => Buffer.alloc(length, char).toString("latin1");
    const overwriteStack = (depth: number): number => (depth > 0 ? overwriteStack(depth - 1) + depth : 0);
    const keys: Record<string, number> = {};
    const strings = { base: fill(300, "q"), equal: fill(300, "q") };
    keys[strings.equal] = 1;
    const options = {
      name: strings.base.substring(10, 290),
      // Read after `name` is converted.
      get renamed() {
        // The base takes the atom's characters; two more lookups push its own out of the VM's last-atomized slot.
        keys[strings.base];
        keys[fill(33, "q")];
        keys[fill(34, "q")];
        overwriteStack(200);
        Bun.gc(true);
        const reuse = Array.from({ length: 5000 }, () => fill(300, "Z"));
        Bun.gc(true);
        return reuse.length ? 1 : 0;
      },
    };
    overwriteStack(300);
    expect(bindgen.optionsEcho(options).name).toBe(fill(280, "q"));
  });
});

describe("enumerations", () => {
  it("parses and returns the canonical spelling", () => {
    expect(bindgen.nextColor("red")).toBe("green");
    expect(bindgen.nextColor("green")).toBe("blue");
    expect(bindgen.nextColor("lime")).toBe("blue");
    expect(bindgen.nextColor("blue")).toBe("red");
  });

  it("rejects anything else", () => {
    for (const value of ["Red", "", "purple", 0, null, undefined, {}]) {
      expect(() => bindgen.nextColor(value)).toThrow(TypeError);
    }
  });
});

describe("dictionaries", () => {
  const defaults = { count: 1, flag: false, color: "red", ratio: null, payload: undefined };

  it("fills in defaults and leaves out what is absent", () => {
    expect(bindgen.optionsEcho({})).toStrictEqual(defaults);
    expect(Object.keys(bindgen.optionsEcho({}))).toEqual(["count", "flag", "color", "ratio", "payload"]);
  });

  it("reads every member", () => {
    const payload = { any: "value" };
    const seen = bindgen.optionsEcho({
      count: 7,
      flag: "truthy",
      name: "né",
      color: "lime",
      ratio: 0.5,
      payload,
      renamed: 9,
    });
    expect(seen).toStrictEqual({
      count: 7,
      flag: true,
      name: "né",
      color: "green",
      ratio: 0.5,
      payload,
      renamed: 9,
    });
    expect(seen.payload).toBe(payload);
    expect(Object.keys(seen)).toEqual(["count", "flag", "name", "color", "ratio", "payload", "renamed"]);
  });

  it("a default written in the schema reaches every member, the nested ones included", () => {
    const defaults = "inner: a=true b=7 name=inner; value: undefined; choice: none; counter: false";
    expect(bindgen.describeDefaults()).toBe(defaults);
    expect(bindgen.describeDefaults(undefined)).toBe(defaults);
    expect(bindgen.describeDefaults({ inner: {} })).toBe(defaults);
    expect(bindgen.describeDefaults({})).toBe("inner: none; value: undefined; choice: none; counter: false");
    expect(
      bindgen.describeDefaults({
        inner: { a: false, name: "n" },
        value: null,
        choice: true,
        counter: new (bindgen as any).TestCounter(),
      }),
    ).toBe("inner: a=false b=7 name=n; value: given; choice: true; counter: true");
  });

  it("a member that is absent is absent, whatever was on the stack before", () => {
    const counter = new (bindgen as any).TestCounter();
    for (let i = 0; i < 100; i++) {
      expect(bindgen.describeDefaults({ counter })).toEndWith("counter: true");
      expect(bindgen.describeDefaults({})).toEndWith("counter: false");
      expect(bindgen.describeDefaults({ counter: null })).toEndWith("counter: false");
    }
  });

  it("returns ordinary objects", () => {
    const seen = bindgen.optionsEcho({ name: "a", renamed: 1 });
    expect(Object.getPrototypeOf(seen)).toBe(Object.prototype);
    expect(Object.getOwnPropertyDescriptor(seen, "count")).toEqual({
      value: 1,
      writable: true,
      enumerable: true,
      configurable: true,
    });
    seen.count = 2;
    seen.extra = 3;
    delete seen.flag;
    expect(bindgen.optionsEcho({ name: "a", renamed: 1 })).toStrictEqual({ ...defaults, name: "a", renamed: 1 });
  });

  it("falls back to the other spelling of a member", () => {
    expect(bindgen.optionsEcho({ oldName: 4 }).renamed).toBe(4);
    expect(bindgen.optionsEcho({ renamed: 5, oldName: 4 }).renamed).toBe(5);
    expect(bindgen.optionsEcho({ renamed: undefined, oldName: 4 }).renamed).toBe(4);
  });

  it("names the member in an error", () => {
    expect(() => bindgen.optionsEcho({ count: "1" })).toThrow("TestOptions.count must be");
    expect(() => bindgen.optionsEcho({ name: 1 })).toThrow("TestOptions.name must be a string");
    expect(() => bindgen.optionsEcho({ color: "mauve" })).toThrow("TestOptions.color must be");
    for (const value of [1, "s", null, undefined, true, [], Symbol("s")]) {
      expect(() => bindgen.optionsEcho(value)).toThrow("TestOptions must be an object");
    }
  });

  // The direct read of a plain object and the generic lookup must be indistinguishable.
  describe("every kind of object gives the same answer", () => {
    const members = { count: 3, flag: true, name: "x", color: "blue", ratio: 2, payload: "p", renamed: 8 };
    const expected = { ...members };
    const shapes: Record<string, () => object> = {
      "literal": () => ({ ...members }),
      "other order": () => Object.fromEntries(Object.entries(members).reverse()),
      "null prototype": () => Object.assign(Object.create(null), members),
      "extra members": () => ({ a: 1, ...members, z: 2, [Symbol("s")]: 3, 0: 4 }),
      "frozen": () => Object.freeze({ ...members }),
      "sealed": () => Object.seal({ ...members }),
      "non-enumerable": () =>
        Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(members).map(([key, value]) => [key, { value, enumerable: false }])),
        ),
      "dictionary mode": () => {
        const object: Record<string, unknown> = {};
        for (let i = 0; i < 200; i++) object["k" + i] = i;
        Object.assign(object, members);
        for (let i = 0; i < 200; i++) delete object["k" + i];
        return object;
      },
      "getters": () =>
        Object.defineProperties(
          {},
          Object.fromEntries(Object.entries(members).map(([key, value]) => [key, { get: () => value }])),
        ),
      "one getter": () => Object.defineProperty({ ...members }, "ratio", { get: () => 2 }),
      "class instance": () => Object.assign(new (class Options {})(), members),
      "class getters": () =>
        new (class Options {
          get count() {
            return 3;
          }
          get flag() {
            return true;
          }
          get name() {
            return "x";
          }
          get color() {
            return "blue";
          }
          get ratio() {
            return 2;
          }
          get payload() {
            return "p";
          }
          get renamed() {
            return 8;
          }
        })(),
      "inherited": () => Object.create({ ...members }),
      "half inherited": () =>
        Object.assign(Object.create({ count: 3, flag: true, name: "x" }), {
          color: "blue",
          ratio: 2,
          payload: "p",
          renamed: 8,
        }),
      "proxy": () => new Proxy({ ...members }, {}),
      "proxy with a get trap": () => new Proxy({}, { get: (_, key) => (members as any)[key] }),
      "function": () => {
        const { name, ...rest } = members;
        return Object.assign({ x() {} }.x, rest);
      },
      "map with members": () => Object.assign(new Map(), members),
      "error with members": () => Object.assign(new Error("e"), members),
    };
    for (const [title, make] of Object.entries(shapes)) {
      it(title, () => {
        expect(bindgen.optionsEcho(make())).toStrictEqual(expected);
      });
    }
  });

  it("does not see Object.prototype", () => {
    const prototype = Object.prototype as any;
    try {
      prototype.count = 99;
      prototype.name = "polluted";
      Object.defineProperty(prototype, "ratio", { get: () => 99, configurable: true });
      expect(bindgen.optionsEcho({})).toStrictEqual(defaults);
      expect(bindgen.optionsEcho(new (class Options {})())).toStrictEqual(defaults);
      expect(bindgen.optionsEcho(Object.create({}))).toStrictEqual(defaults);
      // A proxy answers for itself: its target's lookup is not ours to cut short.
      expect(bindgen.optionsEcho(new Proxy({}, {}))).toMatchObject({ count: 99, name: "polluted", ratio: 99 });
    } finally {
      delete prototype.count;
      delete prototype.name;
      delete prototype.ratio;
    }
  });

  it("sees a change made after an earlier read", () => {
    const options: Record<string, unknown> = { count: 1, name: "a" };
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 1, name: "a" });
    options.count = 2;
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 2, name: "a" });
    delete options.name;
    expect(bindgen.optionsEcho(options)).toStrictEqual({ ...defaults, count: 2 });
    options.name = "b";
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 2, name: "b" });
    Object.defineProperty(options, "count", { get: () => 3 });
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 3, name: "b" });
    Object.setPrototypeOf(options, { renamed: 6 });
    expect(bindgen.optionsEcho(options)).toMatchObject({ count: 3, name: "b", renamed: 6 });
  });

  it("reads and converts members in declaration order, each once", () => {
    const log: string[] = [];
    const logged = (key: string, value: unknown) => ({
      get() {
        log.push(key);
        return value;
      },
      enumerable: true,
    });
    const flag = {
      valueOf() {
        log.push("never: ToBoolean calls nothing");
      },
    };
    bindgen.optionsEcho(
      Object.defineProperties(
        {},
        {
          renamed: logged("renamed", undefined),
          oldName: logged("oldName", 1),
          payload: logged("payload", 1),
          ratio: logged("ratio", 1),
          color: logged("color", "red"),
          name: logged("name", "n"),
          flag: logged("flag", flag),
          count: logged("count", 1),
        },
      ),
    );
    expect(log).toEqual(["count", "flag", "name", "color", "ratio", "payload", "renamed", "oldName"]);
  });

  it("stops at the first member that throws", () => {
    const log: string[] = [];
    expect(() =>
      bindgen.optionsEcho({
        get count() {
          log.push("count");
          return 1;
        },
        get flag() {
          log.push("flag");
          throw new RangeError("from a getter");
        },
        get name() {
          log.push("name");
          return "n";
        },
      }),
    ).toThrow(new RangeError("from a getter"));
    expect(log).toEqual(["count", "flag"]);
  });

  it("a getter that changes the object is seen by the members after it", () => {
    const options = {
      get count() {
        (this as any).name = "added";
        delete (this as any).ratio;
        return 1;
      },
      ratio: 5,
    };
    expect(bindgen.optionsEcho(options)).toStrictEqual({ ...defaults, name: "added" });
  });

  it("a conversion that changes the object is seen by the members after it", () => {
    const make = () => {
      const options: any = { payload: 0, color: "red", renamed: 1 };
      options.name = Object.assign(new String("x"), {
        toString() {
          options.color = "blue";
          options.renamed = 9;
          delete options.payload;
          options.payload = "late";
          return "n";
        },
      });
      return options;
    };
    const expected = { ...defaults, name: "n", color: "blue", payload: "late", renamed: 9 };
    expect(bindgen.optionsEcho(make())).toStrictEqual(expected);
    expect(bindgen.optionsEcho(Object.setPrototypeOf(make(), {}))).toStrictEqual(expected);
    expect(bindgen.optionsEcho(Object.defineProperty(make(), "count", { get: () => 1 }))).toStrictEqual(expected);
  });
});

describe("unions", () => {
  it("picks the first alternative that fits", () => {
    expect(bindgen.describeValue(1.5)).toBe("number 1.5");
    expect(bindgen.describeValue(true)).toBe("flag true");
    expect(bindgen.describeValue("téxt")).toBe("text téxt");
    expect(bindgen.describeValue([1, 2, 3])).toBe("list [1, 2, 3]");
    expect(bindgen.describeValue([])).toBe("list []");
  });

  it("rejects what fits none", () => {
    for (const value of [null, undefined, {}, Symbol("s"), 1n]) {
      expect(() => bindgen.describeValue(value)).toThrow(TypeError);
    }
    expect(() => bindgen.describeValue(["not a number"])).toThrow(TypeError);
  });

  it("sends each kind of value to the alternative that takes it", () => {
    const { TestCounter } = bindgen as any;
    class SubCounter extends TestCounter {}
    class SubArray extends Array {}
    const cases: [unknown, string][] = [
      [undefined, "nothing"],
      [null, "nothing"],
      [false, "flag false"],
      [5, "integer 5"],
      [-0, "integer 0"],
      [7n, "integer 7"],
      ["", "text "],
      ["téxt", "text téxt"],
      [new ArrayBuffer(3), "bytes 3"],
      [new Uint8Array(4), "bytes 4"],
      [new Float64Array(2), "bytes 16"],
      [new DataView(new ArrayBuffer(5)), "bytes 5"],
      [Buffer.alloc(6).buffer.slice(0, 6), "bytes 6"],
      [new Blob(["x"]), "blob"],
      [Bun.file("/nonexistent"), "blob"],
      [new TestCounter(3), "counter 3"],
      [new SubCounter(4), "counter 4"],
      [bindgen.makeToken(9), "token 9"],
      [[], "list []"],
      [[1, 2.5], "list [1.0, 2.5]"],
      [SubArray.of(1), "list [1.0]"],
      [{ count: 8 }, "options 8"],
    ];
    for (const [value, expected] of cases) expect(bindgen.describeAnything(value)).toBe(expected);
  });

  it("the last alternative gets what no other takes, and what another refuses", () => {
    const shared = new SharedArrayBuffer(2);
    for (const value of [
      shared,
      new Uint8Array(shared),
      new String("boxed"),
      new Number(1),
      function () {},
      new Date(0),
      new Map(),
      new Bun.Glob("x"),
      new URL("http://localhost/"),
      new Proxy({}, {}),
    ]) {
      expect(bindgen.describeAnything(value)).toBe("options 1");
    }
    for (const value of [Symbol("s"), new Proxy([], {})]) {
      expect(() => bindgen.describeAnything(value)).toThrow("TestOptions must be an object");
    }
  });

  it("the alternative that was chosen reports what is wrong with the value", () => {
    expect(() => bindgen.describeAnything(1.5)).toThrow("value must be an integer (received 1.5)");
    expect(() => bindgen.describeAnything(2n ** 40n)).toThrow(RangeError);
    expect(() => bindgen.describeAnything([1, "x"])).toThrow("element of value must be a number");
    expect(() => bindgen.describeAnything({ count: "x" })).toThrow("TestOptions.count must be a number");
  });

  it("choosing runs no JavaScript", () => {
    const calls: string[] = [];
    const trap =
      (name: string) =>
      (...args: unknown[]) => (calls.push(name), (Reflect as any)[name](...args));
    const handler = Object.fromEntries(Reflect.ownKeys(Reflect).map(name => [name, trap(name as string)]));
    expect(() => bindgen.describeValue(new Proxy({}, handler))).toThrow("value must be of type");
    expect(() =>
      bindgen.describeValue({ toString: () => calls.push("toString"), valueOf: () => calls.push("valueOf") }),
    ).toThrow("value must be of type");
    expect(calls).toEqual([]);
  });

  itAlways("an alternative that cannot be chosen is an error in the schema", () => {
    expect(() => b.union({ anything: b.any, text: b.string })).toThrow("text is never chosen");
    expect(() => b.union({ text: b.string.loose, flag: b.bool })).toThrow("flag is never chosen");
    expect(() => b.union({ text: b.string.utf8, other: b.string })).toThrow("other is never chosen");
    expect(() => b.union({ integer: b.i32, number: b.f64 })).toThrow("number is never chosen");
    expect(() => b.union({ none: b.null, inner: b.union({ text: b.string }) })).toThrow("list the alternatives");
    expect(() => b.union({ text: b.string.nullable, flag: b.bool })).toThrow("add b.null as an alternative");
    // What one refuses, the next can take.
    b.union({ bytes: b.bufferSource, reference: b.bufferSource.arrayBuffer });
    b.union({ text: b.string, boxed: b.string.utf8 });
  });
});

describe("overloads", () => {
  it("are told apart by the number of arguments and by their kinds", () => {
    const { TestCounter } = bindgen as any;
    const cases: [unknown[], string][] = [
      [["ab"], "text times ab"],
      [["ab", 2], "text times abab"],
      [["ab", 2n], "text times abab"],
      [["ab", undefined], "text times ab"],
      [["ab", true], "text upper AB"],
      [[new String("ab"), false], "text upper ab"],
      [[1], "number 1"],
      [[1, 2], "two numbers 1 2"],
      [[1, 2, 3], "two numbers 1 2"],
      [[[1]], "list [1.0]"],
      [[new TestCounter(6)], "counter 6"],
    ];
    for (const [args, expected] of cases) expect(bindgen.overloaded(...args)).toBe(expected);
    expect(bindgen.overloaded.length).toBe(1);
  });

  it("a signature ignores the arguments it does not have", () => {
    expect(bindgen.overloaded(1, "x")).toBe("number 1");
    expect(bindgen.overloaded([1], 5)).toBe("list [1.0]");
  });

  it("what fits none is reported by the one that requires the most arguments", () => {
    expect(() => bindgen.overloaded()).toThrow(expect.objectContaining({ code: "ERR_MISSING_ARGS" }));
    expect(() => bindgen.overloaded({})).toThrow("text must be a string");
    expect(() => bindgen.overloaded(null, 1)).toThrow("text must be a string");
    expect(() => bindgen.overloaded("ab", "x")).toThrow("upper must be a boolean");
  });

  itAlways("a signature that cannot be chosen is an error in the schema", () => {
    expect(() => b.overloads({ args: { a: b.string } }, { args: { b: b.string } })).toThrow(
      "overload 2 is never chosen",
    );
    expect(() => b.overloads({ args: { a: b.string.loose } }, { args: { b: b.bool } })).toThrow(
      "overload 2 is never chosen",
    );
    expect(() => b.overloads({ args: { a: b.i32, b: b.bool } }, { args: { a: b.f64, b: b.bool } })).toThrow(
      "overload 2 is never chosen",
    );
    b.overloads({ args: { a: b.string } }, { args: { a: b.string, b: b.bool } });
    b.overloads({ args: { a: b.string, b: b.f64 } }, { args: { a: b.string, b: b.bool } });
    b.overloads({ args: { a: b.bool } }, { args: { a: b.any } });
  });
});

describe("arrays", () => {
  it("in", () => {
    expect(bindgen.sumArray([])).toBe(0);
    expect(bindgen.sumArray([1, 2, 3])).toBe(6);
    expect(bindgen.sumArray(Array.from({ length: 1000 }, (_, i) => i))).toBe(499500);
    expect(() => bindgen.sumArray(new Set([4, 5]))).toThrow("numbers must be an array of integer");
    expect(() => bindgen.sumArray([1, "2"])).toThrow(TypeError);
    expect(() => bindgen.sumArray(5)).toThrow(TypeError);
  });

  it("out", () => {
    expect(bindgen.range(0)).toEqual([]);
    expect(bindgen.range(4)).toEqual([0, 1, 2, 3]);
    expect(bindgen.range(5000)).toEqual(Array.from({ length: 5000 }, (_, i) => i));
    for (const length of [7, 8, 9]) {
      expect(bindgen.range(length)).toEqual(Array.from({ length }, (_, i) => i));
      const words = Array.from({ length }, (_, i) => "word" + i);
      expect(bindgen.words(words.join(" "))).toEqual(words);
    }
    expect(bindgen.words("one twö 三")).toEqual(["one", "twö", "三"]);
    expect(Array.isArray(bindgen.range(1))).toBe(true);
  });
});

describe("buffers", () => {
  it("views every kind of buffer", () => {
    const bytes = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(bindgen.sumBytes(bytes)).toBe(36);
    expect(bindgen.sumBytes(bytes.buffer)).toBe(36);
    expect(bindgen.sumBytes(bytes.subarray(2, 4))).toBe(7);
    expect(bindgen.sumBytes(new DataView(bytes.buffer, 6))).toBe(15);
    expect(bindgen.sumBytes(new Uint16Array(bytes.buffer, 0, 1))).toBe(3);
    expect(bindgen.sumBytes(Buffer.from([9, 9]))).toBe(18);
    expect(bindgen.sumBytes(new Uint8Array(0))).toBe(0);
    expect(bindgen.sumBytes(new ArrayBuffer(0))).toBe(0);
  });

  it("a detached or shrunk view is empty", () => {
    const detached = new Uint8Array([1, 2, 3]);
    detached.buffer.transfer();
    expect(bindgen.sumBytes(detached)).toBe(0);

    const resizable = new ArrayBuffer(4, { maxByteLength: 8 });
    const tracking = new Uint8Array(resizable);
    const fixed = new Uint8Array(resizable, 2, 2);
    tracking.fill(1);
    expect(bindgen.sumBytes(tracking)).toBe(4);
    resizable.resize(3);
    expect(bindgen.sumBytes(tracking)).toBe(3);
    expect(bindgen.sumBytes(fixed)).toBe(0);
  });

  it("rejects shared memory and everything else", () => {
    for (const value of [new SharedArrayBuffer(4), new Uint8Array(new SharedArrayBuffer(4)), [1], "s", null, {}]) {
      expect(() => bindgen.sumBytes(value)).toThrow(
        "bytes must be an ArrayBuffer or ArrayBufferView that is not shared",
      );
      expect(() => bindgen.sumBeforeAndAfterCallback(value, () => {})).toThrow(TypeError);
    }
  });

  it("tells an absent buffer from an empty one", () => {
    expect(bindgen.sumBytesOptional(null)).toBe(null);
    expect(bindgen.sumBytesOptional(undefined)).toBe(null);
    expect(bindgen.sumBytesOptional()).toBe(null);
    expect(bindgen.sumBytesOptional(new Uint8Array(0))).toBe(0);
    expect(bindgen.sumBytesOptional(new Uint8Array([1, 2]))).toBe(3);
    const detached = new Uint8Array([1, 2]);
    detached.buffer.transfer();
    expect(bindgen.sumBytesOptional(detached)).toBe(0);
  });

  it("reads the bytes after every other argument is converted", () => {
    const transferred = new Uint8Array([1, 2, 3]);
    const transfers = { toString: () => (transferred.buffer.transfer(), "\x01") };
    expect(bindgen.sumBytesThenText(transferred, transfers)).toBe(1);

    const resizable = new ArrayBuffer(1 << 20, { maxByteLength: 1 << 20 });
    const view = new Uint8Array(resizable).fill(1);
    const shrinks = { toString: () => (resizable.resize(2), "") };
    expect(bindgen.sumBytesThenText(view, shrinks)).toBe(2);

    expect(() => bindgen.sumBytesThenText("no", { toString: () => expect.unreachable() })).toThrow(
      "bytes must be an ArrayBuffer or ArrayBufferView that is not shared",
    );
  });

  it("looks the bytes up again after JavaScript ran", () => {
    const same = new Uint8Array([1, 2, 3]);
    expect(bindgen.sumBeforeAndAfterCallback(same, () => {})).toEqual([6, 6]);
    expect(bindgen.sumBeforeAndAfterCallback(same, () => void same.fill(2))).toEqual([6, 6]);

    const transferred = new Uint8Array([1, 2, 3]);
    expect(bindgen.sumBeforeAndAfterCallback(transferred, () => void transferred.buffer.transfer())).toEqual([6, 0]);

    const resizable = new ArrayBuffer(4, { maxByteLength: 1 << 20 });
    const view = new Uint8Array(resizable).fill(1);
    expect(bindgen.sumBeforeAndAfterCallback(view, () => resizable.resize(1 << 20))).toEqual([4, 4]);
    expect(bindgen.sumBeforeAndAfterCallback(view, () => resizable.resize(1))).toEqual([4, 1]);

    expect(() =>
      bindgen.sumBeforeAndAfterCallback(same, () => {
        throw new RangeError("from the callback");
      }),
    ).toThrow(new RangeError("from the callback"));
  });
});

describe("withValue arguments", () => {
  it("hands back the very value that was converted", () => {
    const boxed = new String("boxed");
    const custom = { toString: () => "custom" };
    for (const value of ["plain", boxed, custom, 5]) expect(bindgen.withValueEcho(value)).toBe(value);
    expect(bindgen.withValueEcho("")).toBe(undefined);
  });
});

describe("errors", () => {
  it("throws what the function describes", () => {
    expect(() => bindgen.fail("type")).toThrow(new TypeError("a type error"));
    expect(() => bindgen.fail("range")).toThrow(new RangeError("a range error"));
    expect(() => bindgen.fail("plain")).toThrow(new Error("an error"));
    expect(() => bindgen.fail("syscall")).toThrow(expect.objectContaining({ code: "ENOENT", syscall: "open" }));
    const value = { thrown: true };
    let caught;
    try {
      bindgen.fail("value", value);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBe(value);
    for (const primitive of [1, "s", null, undefined]) {
      try {
        bindgen.fail("value", primitive);
        expect.unreachable();
      } catch (error) {
        expect(error).toBe(primitive);
      }
    }
  });
});

describe("classes", () => {
  const { TestCounter, TestHolder } = bindgen as any;

  it("looks like a class", () => {
    expect(typeof TestCounter).toBe("function");
    expect(TestCounter.name).toBe("TestCounter");
    expect(TestCounter.length).toBe(0);
    expect(TestCounter.prototype.constructor).toBe(TestCounter);
    expect(Object.prototype.toString.call(new TestCounter())).toBe("[object TestCounter]");
    expect(Object.getOwnPropertyNames(TestCounter.prototype).sort()).toEqual(
      ["constructor", "count", "increment", "label", "listen", "notify", "plus", "tag"].sort(),
    );
    expect(Object.getOwnPropertyNames(new TestCounter())).toEqual([]);
    expect(TestCounter.prototype.increment.length).toBe(0);
    expect(TestCounter.prototype.plus.length).toBe(1);
    expect(() => TestCounter()).toThrow("TestCounter constructor cannot be invoked without 'new'");
  });

  it("constructs, reads and mutates", () => {
    const counter = new TestCounter(5);
    expect(counter).toBeInstanceOf(TestCounter);
    expect(counter.count).toBe(5);
    expect(counter.increment()).toBe(6);
    expect(counter.increment(10)).toBe(16);
    expect(counter.count).toBe(16);
    expect(new TestCounter().count).toBe(0);
  });

  it("a constructor that throws makes nothing", () => {
    const before = TestCounter.alive();
    expect(() => new TestCounter(-1)).toThrow(new RangeError("start must not be negative"));
    expect(() => new TestCounter("1")).toThrow(TypeError);
    // A collection in between can only lower it.
    expect(TestCounter.alive()).toBeLessThanOrEqual(before);
  });

  it("setters convert like arguments", () => {
    const counter = new TestCounter();
    expect(counter.label).toBe("");
    counter.label = "näme";
    expect(counter.label).toBe("näme");
    expect(() => {
      counter.label = 5;
    }).toThrow("TestCounter.label must be a string");
    expect(counter.label).toBe("näme");
    expect(() => {
      "use strict";
      counter.count = 1;
    }).toThrow(TypeError);
  });

  it("a cached getter is computed once per object", () => {
    const counter = new TestCounter(3);
    const tag = counter.tag;
    expect(tag).toEqual([3]);
    counter.increment();
    expect(counter.tag).toBe(tag);
    Bun.gc(true);
    expect(counter.tag).toBe(tag);
    expect(new TestCounter(3).tag).not.toBe(tag);
  });

  it("checks the receiver", () => {
    const { increment } = TestCounter.prototype;
    const count = Object.getOwnPropertyDescriptor(TestCounter.prototype, "count")!.get!;
    const setLabel = Object.getOwnPropertyDescriptor(TestCounter.prototype, "label")!.set!;
    for (const receiver of [
      undefined,
      null,
      1,
      {},
      TestCounter.prototype,
      Object.create(new TestCounter()),
      new Bun.Glob("*"),
      bindgen.makeToken(1),
      new Blob([]),
      new URL("http://localhost/"),
      new Headers(),
      10n ** 30n,
    ]) {
      expect(() => increment.call(receiver)).toThrow(TypeError);
      expect(() => count.call(receiver)).toThrow(TypeError);
      expect(() => setLabel.call(receiver, "x")).toThrow(TypeError);
    }
    expect(() => new TestCounter().plus({})).toThrow("other must be an instance of TestCounter");
    expect(() => new TestCounter().plus(new Bun.Glob("*"))).toThrow(TypeError);
  });

  it("can be subclassed and made with Reflect.construct", () => {
    class Sub extends TestCounter {
      extra = 1;
      constructor(start: number) {
        super(start);
      }
      twice() {
        return this.increment() + this.increment();
      }
    }
    const sub = new Sub(1);
    expect(sub).toBeInstanceOf(Sub);
    expect(sub).toBeInstanceOf(TestCounter);
    expect(sub.extra).toBe(1);
    expect(sub.twice()).toBe(5);
    function Other() {}
    const other = Reflect.construct(TestCounter, [2], Other);
    expect(Object.getPrototypeOf(other)).toBe(Other.prototype);
    expect(TestCounter.prototype.increment.call(other)).toBe(3);
  });

  it("takes and returns instances", () => {
    const made = TestCounter.starting(40);
    expect(made).toBeInstanceOf(TestCounter);
    expect(made.plus(new TestCounter(2))).toBe(42);
    expect(made.plus(made)).toBe(80);
  });

  it("holds a value in an internal field and lets JavaScript re-enter", () => {
    const counter = new TestCounter(1);
    expect(counter.notify()).toBe(1);
    const receivers: unknown[] = [];
    counter.listen(function (this: unknown) {
      receivers.push(this);
      counter.increment(10);
      counter.label = "changed inside";
      if (receivers.length < 3) counter.notify();
    });
    Bun.gc(true);
    expect(counter.notify()).toBe(31);
    expect(receivers).toEqual([counter, counter, counter]);
    expect(counter.label).toBe("changed inside");
    counter.listen(() => {
      throw new RangeError("from the listener");
    });
    expect(() => counter.notify()).toThrow(new RangeError("from the listener"));
  });

  it("without `construct` there is no constructor", () => {
    const token = bindgen.makeToken(7);
    expect(token.id).toBe(7);
    expect(Object.prototype.toString.call(token)).toBe("[object TestToken]");
    const prototype = Object.getPrototypeOf(token);
    expect(Object.getOwnPropertyNames(prototype)).toEqual(["id"]);
    expect(token.constructor).toBe(Object);
    expect(Object.getPrototypeOf(bindgen.makeToken(8))).toBe(prototype);
  });

  it("a payload keeps another object alive with a Strong", () => {
    const holder = new TestHolder(new TestCounter(5));
    Bun.gc(true);
    expect(holder.counter).toBeInstanceOf(TestCounter);
    expect(holder.counter).toBe(holder.counter);
    expect(holder.incrementCounter()).toBe(6);
    expect(holder.counter.count).toBe(6);
    expect(() => new TestHolder({})).toThrow("counter must be an instance of TestCounter");
  });

  it("drops the Rust value when the object is collected", () => {
    const count = 1000;
    let counters: unknown[] | null = Array.from({ length: count }, (_, i) => {
      const counter = new TestCounter(i);
      counter.label = "label " + i;
      counter.listen(() => counter);
      counter.tag;
      return new TestHolder(counter);
    });
    Bun.gc(true);
    expect(TestCounter.alive()).toBeGreaterThanOrEqual(counters.length);
    counters = null;
    // The first collection drops the holders and their Strongs, the second the counters.
    Bun.gc(true);
    Bun.gc(true);
    expect(TestCounter.alive()).toBeLessThan(count);
  });
});
