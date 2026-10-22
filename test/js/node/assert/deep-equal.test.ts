// Deep-equality matrix for node:assert and node:util. The rows are in deep-equal-cases.ts.
// Expectations come from the documented semantics of assert.deepStrictEqual/deepEqual,
// cross-checked against Node.js. Cases Bun gets wrong today are marked `test.failing`.
import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isWindows, nodeExe } from "harness";
import assert from "node:assert";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import url from "node:url";
import util from "node:util";
import { argumentsObject, cases, expected, sym, verdictsInRow, type Question } from "./deep-equal-cases";
import { pairAt, verdicts } from "./deep-equal-random";

type Thunk = () => unknown;

const nanViews = new Float64Array([NaN]).buffer;

// The third argument is new in Node v26.
const isDeepStrictEqual = util.isDeepStrictEqual as (a: unknown, b: unknown, skipPrototype?: boolean) => boolean;

function caught(fn: () => void): (Error & { code?: string }) | null {
  try {
    fn();
    return null;
  } catch (error) {
    return error as Error & { code?: string };
  }
}

function describeMatrix(
  suite: string,
  question: Question,
  bugField: "strictBug" | "looseBug",
  equal: (actual: unknown, expected: unknown) => void,
  notEqual: (actual: unknown, expected: unknown) => void,
) {
  describe(suite, () => {
    for (const testCase of cases) {
      const verdict = expected(testCase, question);
      const bug = testCase[bugField];
      const label = `${verdict ? "accepts" : "rejects"} ${testCase.name}`;
      const run = bug ? test.failing : test;
      run(bug ? `${label} (Bun ${bug})` : label, () => {
        const error = caught(() => equal(testCase.a(), testCase.b()));
        if (verdict) {
          expect(error?.message ?? null).toBeNull();
        } else {
          expect(error?.code).toBe("ERR_ASSERTION");
        }
        expect(caught(() => notEqual(testCase.a(), testCase.b())) === null).toBe(!verdict);
        // For (b, a), the assertion that passes.
        const passes = expected(testCase, question, true) ? equal : notEqual;
        expect(caught(() => passes(testCase.b(), testCase.a()))?.message ?? null).toBeNull();
      });
    }
  });
}

describeMatrix("assert.deepStrictEqual", "strict", "strictBug", assert.deepStrictEqual, assert.notDeepStrictEqual);
describeMatrix("assert.deepEqual", "loose", "looseBug", assert.deepEqual, assert.notDeepEqual);

test("new assert.Assert({ skipPrototype: true }) gives the skipPrototype verdict of every row", () => {
  const skipping = new assert.Assert({ skipPrototype: true });
  const differences: string[] = [];
  for (const testCase of cases) {
    if (testCase.skipPrototypeBug) continue;
    for (const swapped of [false, true]) {
      const [actual, expectedValue] = swapped ? [testCase.b, testCase.a] : [testCase.a, testCase.b];
      // The assertion that passes. A method of an Assert reads the option from `this`.
      const error = expected(testCase, "skipPrototype", swapped)
        ? caught(() => skipping.deepStrictEqual(actual(), expectedValue()))
        : caught(() => skipping.notDeepStrictEqual(actual(), expectedValue()));
      if (error) differences.push(`${testCase.name}${swapped ? ", swapped" : ""}: ${error.code ?? error.name}`);
    }
  }
  expect(differences).toEqual([]);
});

describe("assert.deepEqual and symbol keys", () => {
  test.each([
    ["an array", () => [1]],
    ["an object with an index key", () => ({ 0: 1 })],
    ["an Error", () => new Error("m")],
  ])("never reads a symbol-keyed getter of %s", (_name, make) => {
    let calls = 0;
    const withGetter = () => Object.defineProperty(make(), sym, { enumerable: true, get: () => (calls++, 42) });
    assert.deepEqual(withGetter(), withGetter());
    expect(calls).toBe(0);
    assert.deepStrictEqual(withGetter(), withGetter());
    expect(calls).toBe(2);
  });

  test("a Proxy trap gets no symbol key but Symbol.toStringTag", () => {
    const seen = new Set<string>();
    const record = (trap: string, key: PropertyKey) => {
      if (typeof key === "symbol") seen.add(`${trap} ${String(key)}`);
    };
    const proxy = () =>
      new Proxy(
        { a: 1, [sym]: 1 },
        {
          get: (target, key, receiver) => (record("get", key), Reflect.get(target, key, receiver)),
          has: (target, key) => (record("has", key), Reflect.has(target, key)),
          getOwnPropertyDescriptor: (target, key) => (
            record("getOwnPropertyDescriptor", key),
            Reflect.getOwnPropertyDescriptor(target, key)
          ),
        },
      );
    assert.deepEqual(proxy(), { a: 1 });
    assert.deepEqual({ a: 1 }, proxy());
    assert.deepEqual(proxy(), proxy());
    expect([...seen]).toEqual(["get Symbol(Symbol.toStringTag)"]);
  });

  // node has no Symbol.toStringTag on these. Bun has a non-enumerable one on some of them (#42558 and #41389 remove it).
  test.each([
    ["a parsed query", () => url.parse("http://localhost/?a=b", true).query],
    ["a parsed query with an index key", () => url.parse("http://localhost/?0=a&b=c", true).query],
    ["a BlockList", () => new net.BlockList()],
    [
      "a SocketAddress with an index key",
      () => Object.assign(new net.SocketAddress({ address: "127.0.0.1" }), { 0: 1 }),
    ],
    ["a Stats", () => fs.statSync(import.meta.path)],
    ["a Dirent", () => fs.readdirSync(import.meta.dir, { withFileTypes: true })[0]],
  ])("%s is loosely equal to a plain copy", (_name, make) => {
    const value = make();
    const copy = Object.fromEntries(Object.entries(value));
    assert.deepEqual(value, copy);
    assert.deepEqual(copy, value);
  });

  // Deliberate difference from node, which compares the tags of every pair and reports these as not equal.
  test.each([
    ["with named keys", (value: object) => value],
    ["with an index key", (value: object) => Object.assign(value, { 0: 1 })],
    ["behind a Proxy", (value: object) => new Proxy(value, {})],
  ])("a non-enumerable Symbol.toStringTag against no tag starts no comparison, %s", (_name, shape) => {
    class Tagged {
      x = 1;
    }
    Object.defineProperty(Tagged.prototype, Symbol.toStringTag, { value: "Tagged" });
    const tagged = shape(new Tagged());
    const copy = Object.fromEntries(Object.entries(tagged));
    expect(Object.prototype.toString.call(tagged)).toBe("[object Tagged]");
    expect(Object.prototype.toString.call(copy)).toBe("[object Object]");
    assert.deepEqual(tagged, copy);
    assert.deepEqual(copy, tagged);
    assert.notDeepStrictEqual(tagged, copy);
  });

  test("reads the value of a Proxy through its get trap", () => {
    const proxy = () =>
      new Proxy({ a: 1 }, { get: (target, key, receiver) => (key === "a" ? 2 : Reflect.get(target, key, receiver)) });
    assert.deepEqual({ a: 2 }, proxy());
    assert.deepEqual(proxy(), { a: 2 });
    assert.deepEqual(proxy(), proxy());
    assert.notDeepEqual({ a: 1 }, proxy());
  });

  test.each([
    ["plain objects", () => ({ a: 1 })],
    ["objects with an index key", () => ({ 0: 1 })],
    ["arrays", () => [1]],
    ["Errors", () => new Error("m")],
  ])("Bun.deepEquals and expect().toEqual() still compare the symbol keys of %s", (_name, make) => {
    const withSymbol = (value: number) => Object.assign(make(), { [sym]: value });
    expect(Bun.deepEquals(withSymbol(1), withSymbol(2))).toBe(false);
    expect(Bun.deepEquals(withSymbol(1), withSymbol(2), true)).toBe(false);
    expect(Bun.deepEquals(withSymbol(1), withSymbol(1))).toBe(true);
    expect(withSymbol(1)).not.toEqual(withSymbol(2));
    expect(withSymbol(1)).toEqual(withSymbol(1));
  });
});

describe("util.isDeepStrictEqual", () => {
  for (const testCase of cases) {
    const label = `${testCase.name} is ${testCase.strict ? "" : "not "}deep-strict-equal`;
    const bug = testCase.strictBug ?? testCase.skipPrototypeBug;
    const run = bug ? test.failing : test;
    run(bug ? `${label} (Bun ${bug})` : label, () => {
      for (const swapped of [false, true]) {
        const [actual, expectedValue] = swapped ? [testCase.b, testCase.a] : [testCase.a, testCase.b];
        expect(isDeepStrictEqual(actual(), expectedValue())).toBe(expected(testCase, "strict", swapped));
        expect(isDeepStrictEqual(actual(), expectedValue(), true)).toBe(expected(testCase, "skipPrototype", swapped));
      }
    });
  }

  test("never throws on exotic input", () => {
    expect(util.isDeepStrictEqual(undefined, undefined)).toBe(true);
    expect(util.isDeepStrictEqual(null, undefined)).toBe(false);
    expect(util.isDeepStrictEqual(Object.create(null), Object.create(null))).toBe(true);
  });

  test("reads an array's own symbol-keyed getter once per side", () => {
    const s = Symbol("k");
    let calls = 0;
    const make = () => {
      const a = [1];
      Object.defineProperty(a, s, { enumerable: true, get: () => (calls++, 42) });
      return a;
    };
    expect(util.isDeepStrictEqual(make(), make())).toBe(true);
    expect(calls).toBe(2);
  });

  // The third argument was added in Node v26.
  describe("skipPrototype", () => {
    class Foo {
      declare value: unknown;
      constructor(value) {
        this.value = value;
      }
    }
    class Bar {
      declare value: unknown;
      constructor(value) {
        this.value = value;
      }
    }

    test("ignores differing constructors when set", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42))).toBe(false);
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(42), true as any)).toBe(true);
    });

    test("still compares values", () => {
      expect(util.isDeepStrictEqual(new Foo(42), new Bar(99), true as any)).toBe(false);
    });

    test.each([
      ["object property", () => ({ inner: new Foo(1) }), () => ({ inner: new Bar(1) })],
      ["array element", () => [new Foo(1)], () => [new Bar(1)]],
      ["Map value", () => new Map([["k", new Foo(1)]]), () => new Map([["k", new Bar(1)]])],
      ["Set element", () => new Set([new Foo(1)]), () => new Set([new Bar(1)])],
      ["Error cause", () => new Error("e", { cause: new Foo(1) }), () => new Error("e", { cause: new Bar(1) })],
    ])("propagates through %s", (_name, makeA, makeB) => {
      expect(util.isDeepStrictEqual(makeA(), makeB())).toBe(false);
      expect(util.isDeepStrictEqual(makeA(), makeB(), true as any)).toBe(true);
    });

    test("still compares Object.prototype.toString tags", () => {
      expect(util.isDeepStrictEqual(argumentsObject(1), { 0: 1 }, true as any)).toBe(false);
      expect(util.isDeepStrictEqual(argumentsObject(1), argumentsObject(1), true as any)).toBe(true);
      expect(util.isDeepStrictEqual(Object.create({ [Symbol.toStringTag]: "X" }), {}, true as any)).toBe(false);
    });

    test("ignores the boxed-primitive subclass distinction", () => {
      class S extends String {}
      expect(util.isDeepStrictEqual(new String("a"), new S("a"))).toBe(false);
      expect(util.isDeepStrictEqual(new String("a"), new S("a"), true as any)).toBe(true);
    });

    test("does not leak into assert.deepStrictEqual", () => {
      expect(() => assert.deepStrictEqual(new Foo(42), new Bar(42))).toThrow();
    });
  });
});

describe("detached ArrayBuffer", () => {
  function detached() {
    const buf = new ArrayBuffer(4);
    buf.transfer();
    return buf;
  }

  const table: Array<[string, Thunk, Thunk]> = [
    ["two distinct detached ArrayBuffers", detached, detached],
    ["a detached ArrayBuffer and a zero-length ArrayBuffer", detached, () => new ArrayBuffer(0)],
    ["a zero-length ArrayBuffer and a detached ArrayBuffer", () => new ArrayBuffer(0), detached],
    ["nested detached ArrayBuffers", () => ({ x: detached() }), () => ({ x: detached() })],
  ];

  for (const [label, a, b] of table) {
    test(`throws TypeError on ${label}`, () => {
      expect(() => assert.deepStrictEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.deepEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.notDeepStrictEqual(a(), b())).toThrow(TypeError);
      expect(() => assert.notDeepEqual(a(), b())).toThrow(TypeError);
      expect(() => util.isDeepStrictEqual(a(), b())).toThrow(TypeError);
    });
  }

  test("deepStrictEqual throws Node's DataView TypeError on a detached view", () => {
    const detachedView = () => {
      const ab = new ArrayBuffer(4);
      const dv = new DataView(ab);
      structuredClone(ab, { transfer: [ab] });
      return dv;
    };
    const error = caught(() => assert.deepStrictEqual(detachedView(), new DataView(new ArrayBuffer(0))));
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe(
      "Cannot perform get DataView.prototype.byteLength on a detached or out-of-bounds ArrayBuffer",
    );
    expect(() => util.isDeepStrictEqual(detachedView(), new DataView(new ArrayBuffer(0)))).toThrow(TypeError);
    // Bun.deepEquals keeps its own-properties DataView surface: no throw.
    expect(Bun.deepEquals(detachedView(), new DataView(new ArrayBuffer(0)), true)).toBe(true);
  });

  test("assert.partialDeepStrictEqual throws TypeError on a detached ArrayBuffer", () => {
    expect(() => assert.partialDeepStrictEqual(detached(), new ArrayBuffer(0))).toThrow(TypeError);
  });

  test("assert.partialDeepStrictEqual checks own properties on a KeyObject after equals()", () => {
    const crypto = require("node:crypto");
    const key = crypto.createSecretKey(Buffer.from("secret"));
    const key2 = crypto.createSecretKey(Buffer.from("secret"));
    Object.assign(key2, { x: 1 });
    // expected has {x:1} that actual lacks: node throws ERR_ASSERTION.
    expect(() => assert.partialDeepStrictEqual(key, key2)).toThrow(assert.AssertionError);
    // subset direction: extra own prop on actual is fine.
    expect(() =>
      assert.partialDeepStrictEqual(Object.assign(key, { x: 1 }), crypto.createSecretKey(Buffer.from("secret"))),
    ).not.toThrow();
  });

  test("error matches Node's message", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(0)));
    expect(error).toBeInstanceOf(TypeError);
    expect(error?.message).toBe("Cannot perform Construct on a detached ArrayBuffer");
  });

  test("reference-identical detached ArrayBuffer short-circuits as equal", () => {
    const buf = detached();
    expect(() => assert.deepStrictEqual(buf, buf)).not.toThrow();
    expect(util.isDeepStrictEqual(buf, buf)).toBe(true);
  });

  test("detached ArrayBuffer vs non-zero-length ArrayBuffer is an ordinary mismatch", () => {
    const error = caught(() => assert.deepStrictEqual(detached(), new ArrayBuffer(4)));
    expect(error?.code).toBe("ERR_ASSERTION");
  });

  // Node v26 passes typed-array views directly to Buffer.compare (no re-wrap over
  // .buffer), so a detached view compares as zero-length. Node v22 and earlier threw.
  test("a detached typed-array view is comparable as zero-length", () => {
    function detachedView() {
      const buf = new ArrayBuffer(4);
      const view = new Uint8Array(buf);
      buf.transfer();
      return view;
    }
    expect(() => assert.deepStrictEqual(detachedView(), detachedView())).not.toThrow();
    expect(() => assert.deepStrictEqual(detachedView(), new Uint8Array(0))).not.toThrow();
  });
});

describe("the relations of node:assert", () => {
  // Each function asserts the verdict with the assertion that passes, so no failure message reads the operands.
  const relations: [string, (a: unknown, b: unknown, verdict: boolean) => void][] = [
    ["assert.deepEqual", (a, b, verdict) => (verdict ? assert.deepEqual : assert.notDeepEqual)(a, b)],
    ["assert.deepStrictEqual", (a, b, verdict) => (verdict ? assert.deepStrictEqual : assert.notDeepStrictEqual)(a, b)],
    ["util.isDeepStrictEqual", (a, b, verdict) => expect(isDeepStrictEqual(a, b)).toBe(verdict)],
    [
      "util.isDeepStrictEqual with skipPrototype",
      (a, b, verdict) => expect(isDeepStrictEqual(a, b, true)).toBe(verdict),
    ],
  ];

  describe.each(relations)("%s", (_relation, expectVerdict) => {
    let reads = 0;
    const leaf = (value: unknown) => ({
      get leaf() {
        reads++;
        return value;
      },
    });
    const nested = (wrap: (value: unknown) => unknown, value: unknown = 1) => {
      let result: unknown = leaf(value);
      for (let i = 0; i < 10; i++) result = wrap(result);
      return result;
    };

    // A comparison in both orders at each level reads the leaf 2048 times.
    test.each<[string, (value: unknown) => unknown]>([
      ["a Set", value => new Set([value])],
      ["a Map value under a string key", value => new Map([["k", value]])],
      ["a Map value under an object key", value => new Map([[{ k: 1 }, value]])],
      ["a Set with an own property", value => Object.assign(new Set([value]), { p: 1 })],
      ["a Map with an own property", value => Object.assign(new Map([["k", value]]), { p: 1 })],
      ["the cause option of an Error", value => new Error("m", { cause: value })],
      ["an assigned cause of an Error", value => Object.assign(new Error("m"), { cause: value })],
      ["the errors of an AggregateError", value => new AggregateError([value], "m")],
    ])("reads a leaf under ten levels of %s once for each operand", (_name, wrap) => {
      const [a, b] = [nested(wrap), nested(wrap)];
      reads = 0;
      expectVerdict(a, b, true);
      expect(reads).toBe(2);
    });

    // node's loose mode compares the two values under one number key three times at each level: 118098 reads.
    test("reads an unequal leaf under ten Maps with a number key once for each operand", () => {
      const wrap = (value: unknown) => new Map([[1, value]]);
      const [a, b] = [nested(wrap, 1), nested(wrap, 2)];
      reads = 0;
      expectVerdict(a, b, false);
      expect(reads).toBe(2);
    });

    test("compares two Errors without a call of Error.prepareStackTrace", () => {
      const previous = Error.prepareStackTrace;
      let calls = 0;
      Error.prepareStackTrace = () => {
        calls++;
        return "";
      };
      try {
        const make = () => new Error("x", { cause: new Error("c") });
        expectVerdict(make(), make(), true);
        expectVerdict(new Set([make()]), new Set([make()]), true);
        expect(calls).toBe(0);
      } finally {
        Error.prepareStackTrace = previous;
      }
    });
  });

  // node v26.3.0 throws a TypeError for the two unequal pairs: it reads `constructor` of the null member. Later
  // releases answer false (nodejs/node#64441, nodejs/node#64449).
  test("a null Set member or Map key opposite an object is not equal", () => {
    const set = () => new Set([null, { a: 1 }, { a: 2 }]);
    const map = () =>
      new Map<unknown, unknown>([
        [null, 1],
        [{}, 2],
      ]);
    expect(isDeepStrictEqual(set(), new Set([{ a: 1 }, { a: 2 }, { a: 3 }]))).toBe(false);
    expect(
      isDeepStrictEqual(
        map(),
        new Map([
          [{}, 1],
          [{}, 2],
        ]),
      ),
    ).toBe(false);
    expect(isDeepStrictEqual(set(), set())).toBe(true);
    expect(isDeepStrictEqual(map(), map())).toBe(true);
  });

  // node switches to a second comparator for the rest of the process at the first cycle, and that one reports this
  // pair as not equal (nodejs/node#62422).
  test("a comparison of a cycle changes no later verdict", () => {
    const row = cases.find(testCase => testCase.name === "objects holding maps with two shared object keys")!;
    const cycle = () => {
      const object: Record<string, unknown> = {};
      object.self = object;
      return object;
    };
    expect(isDeepStrictEqual(row.a(), row.b())).toBe(true);
    expect(isDeepStrictEqual(cycle(), cycle())).toBe(true);
    expect(isDeepStrictEqual(row.a(), row.b())).toBe(true);
  });

  test("assert.strict and the validation object of assert.throws use the strict relation", () => {
    expect(assert.strict.deepEqual).toBe(assert.deepStrictEqual);
    expect(assert.strict.notDeepEqual).toBe(assert.notDeepStrictEqual);
    const thrown = () => ({ value: new Set([{ a: 1 }, { a: 1 }, { a: 2 }]) });
    const fails = () => {
      throw thrown();
    };
    assert.throws(fails, thrown());
    expect(caught(() => assert.throws(fails, { value: new Set([{ a: 1 }, { a: 2 }, { a: 2 }]) }))?.code).toBe(
      "ERR_ASSERTION",
    );
  });

  // These rules of the node relations share one function with Bun.deepEquals and expect(), which do not follow them.
  test.each<[string, Thunk, Thunk, boolean, boolean]>([
    [
      "two Float64Array views of one NaN buffer",
      () => new Float64Array(nanViews),
      () => new Float64Array(nanViews),
      true,
      true,
    ],
    [
      "a boxed string and one with another toString",
      () => new String("a"),
      () => Object.defineProperty(new String("a"), "toString", { value: () => "b" }),
      false,
      false,
    ],
    ["a URL and {}", () => new URL("http://a/"), () => ({}), true, false],
    ["{} and a URL", () => ({}), () => new URL("http://a/"), true, false],
  ])("Bun.deepEquals and expect() keep their verdict for %s", (_name, a, b, loose, strict) => {
    expect(Bun.deepEquals(a(), b())).toBe(loose);
    expect(Bun.deepEquals(a(), b(), true)).toBe(strict);
    expect(caught(() => expect(a()).toEqual(b())) === null).toBe(loose);
    expect(caught(() => expect(a()).toStrictEqual(b())) === null).toBe(strict);
  });
});

describe("AssertionError", () => {
  test("deepStrictEqual reports actual, expected and operator", () => {
    const error = caught(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })) as any;
    expect(error).not.toBeNull();
    expect(error.name).toBe("AssertionError");
    expect(error.code).toBe("ERR_ASSERTION");
    expect(error.operator).toBe("deepStrictEqual");
    expect(error.actual).toEqual({ a: 1 });
    expect(error.expected).toEqual({ a: 2 });
    expect(error.generatedMessage).toBe(true);
  });

  test("notDeepStrictEqual reports its own operator", () => {
    const error = caught(() => assert.notDeepStrictEqual({ a: 1 }, { a: 1 })) as any;
    expect(error.operator).toBe("notDeepStrictEqual");
    expect(error.code).toBe("ERR_ASSERTION");
  });

  test("a string message is used instead of generating one", () => {
    const error = caught(() => assert.deepStrictEqual(1, 2, "nope")) as any;
    expect(error.message.startsWith("nope")).toBe(true);
    expect(error.generatedMessage).toBe(false);
  });

  test("an Error message is thrown as-is", () => {
    const custom = new RangeError("custom");
    const error = caught(() => assert.deepStrictEqual(1, 2, custom));
    expect(error).toBe(custom);
  });
});

test("assert.deepEqual holds operands that user code changes during the comparison", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), path.join(import.meta.dir, "deep-equal-mutation-fixture.ts")],
    env: {
      ...bunEnv,
      // Malloc=1 routes JSC's allocations through the system allocator, so ASAN sees a freed table or buffer.
      ...(isWindows ? {} : { Malloc: "1" }),
      // symbolize=0: symbolizing a failure report outlasts the test timeout.
      // detect_leaks=0: Malloc=1 exposes JSC's never-freed startup allocations to LSAN.
      ASAN_OPTIONS: [bunEnv.ASAN_OPTIONS, "symbolize=0", "detect_leaks=0"].filter(Boolean).join(":"),
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect({ stderr, stdout: stdout.split("\n") }).toEqual({
    stderr: "",
    stdout: [
      "same structure: equal",
      "mixed structures: equal",
      "index keys: equal",
      "array: equal",
      "sparse array: equal",
      "typed array: equal",
      "set, expected side cleared: equal",
      "set, function member: equal",
      "map, function value: equal",
      "map, expected side cleared: not equal",
      "map, shared keys, both sides cleared: equal",
      "throwing coercion, array: RangeError",
      "throwing coercion, set: RangeError",
      "throwing coercion, map value: RangeError",
      "throwing coercion, notDeepEqual: RangeError",
      "",
    ],
  });
  expect(exitCode).toBe(0);
});

// The verdicts of Node.js v26.3.0 for the pairs of deep-equal-random.ts, one string for each of the seeds 1, 2 and 3.
const nodeVerdicts = [
  "10400044000041440404440040440040004404000414404044000044010000010440040004001000441100404404000440400444444400404000400104040001004041104401410000404444040440404044004004044000104414000001444044400004044410440400040400000004040041100110001041000400004440011444113400000001400104100404414040000004404004004110004411040441140411400000000044000044040000041004040440440004404044400044010144400000440004010404000000110044140040101040000044040440000401000414040004041401000444440400001400010040000004044040",
  "00004444041444400044004000040004040400400440000040040000041041004010000040140040440000140040044010400030040014000011004100000000040000040414444000401000040000400040040004010404404010300440044400041000400404100400140110100000404300400440040414040004400010440440043041004104004010400040004000404044404000040001001040000400400000004040441040444400000044140040014004144440400040104404400404040000110000044041444400000000401044040004404400044041400104014044404404010440044040440400400444104430000040000004",
  "40304140004000141440004040441440000004004444404044000404040404040040000404400010044040444440400044031044010004044040041000000014043444004404400444404000044004110004041044410044040440410010041400040000041000040444010044440000000004004044104000044040004404000400000004004001040044440044400000400444401004040400040040000400104040444414400044000044010400041440040430100040004444401004100441400044140400010004404440414440440040400443044404000140414100400004411000040000140044040400000004044040011400004003",
];

// Chunks of 100 pairs keep each test short on a debug build.
describe.each([1, 2, 3])("Bun gives the verdicts of Node.js for the random pairs of seed %d", seed => {
  test.each([0, 100, 200, 300, 400])("from pair %d", from => {
    const recorded = nodeVerdicts[seed - 1].slice(from, from + 100);
    const actual = verdicts(seed, from + 100, from);
    const differences: string[] = [];
    for (let i = 0; i < recorded.length && differences.length < 5; i++) {
      if (actual[i] !== recorded[i]) {
        const pair = util.inspect(pairAt(seed, from + i), { depth: 6 });
        differences.push(`pair ${from + i}: bun ${actual[i]}, node ${recorded[i]}: ${pair}`);
      }
    }
    expect(differences).toEqual([]);
    expect(actual).toBe(recorded);
  });
});

// The rows and the recorded verdicts are those of this version. A local `node` of another version is not asked.
const nodeVersion = "v26.3.0";
const node = nodeExe();
const hasThatNode =
  node !== null &&
  Bun.spawnSync({ cmd: [node, "--version"], env: bunEnv })
    .stdout.toString()
    .trim() === nodeVersion;

test.skipIf(!hasThatNode)(
  `Node.js ${nodeVersion} gives the verdicts of the rows and the recorded verdicts`,
  async () => {
    const script = `
    import { verdictsOfRows } from ${JSON.stringify(url.pathToFileURL(path.join(import.meta.dir, "deep-equal-cases.ts")).href)};
    import { verdicts } from ${JSON.stringify(url.pathToFileURL(path.join(import.meta.dir, "deep-equal-random.ts")).href)};
    console.log(JSON.stringify({ rows: verdictsOfRows(), random: [1, 2, 3].map(seed => verdicts(seed, 500)) }));
  `;
    await using proc = Bun.spawn({
      cmd: [node!, "--input-type=module", "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    // On stderr node warns about the module type of a .ts file.
    expect(stdout, stderr).toStartWith("{");
    const fromNode: { rows: string[]; random: string[] } = JSON.parse(stdout);

    const differences = cases.flatMap((testCase, index) => {
      const row = verdictsInRow(testCase);
      return fromNode.rows[index] === row ? [] : [{ name: testCase.name, node: fromNode.rows[index], row }];
    });
    expect(differences).toEqual([]);
    expect(fromNode.random).toEqual(nodeVerdicts);
    expect(exitCode).toBe(0);
  },
);
