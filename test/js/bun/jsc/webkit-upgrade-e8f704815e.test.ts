import { describe, expect, test } from "bun:test";

// Coverage for the WebKit e8f704815e sync. The first four cases pin an observable difference between the old and the
// new JavaScriptCore. The others pin what had to stay the same in code that the sync rewrote.
// The sources that depend on how JavaScriptCore compiles go through `new Function`, so that Bun's transpiler leaves
// them alone.

describe.concurrent("WebKit e8f704815e upgrade", () => {
  test("Math.sumPrecise does not round a negative sum away from zero (8ee560d748)", () => {
    const sumPrecise: (values: Iterable<number>) => number = (Math as any).sumPrecise;
    // These were -1.0000000000000002, -0.10000000000000002, -1.0000000000000002 and -Infinity.
    expect(sumPrecise([-1])).toBe(-1);
    expect(sumPrecise([-0.1])).toBe(-0.1);
    expect(sumPrecise([1, -1, -1])).toBe(-1);
    expect(sumPrecise([-Number.MAX_VALUE])).toBe(-Number.MAX_VALUE);
    // Positive sums are as they were.
    expect(sumPrecise([1])).toBe(1);
    expect(sumPrecise([0.1, 0.2])).toBe(0.30000000000000004);
    expect(sumPrecise([1e308, 1e308, -1e308])).toBe(1e308);
    expect(sumPrecise([Number.MAX_VALUE])).toBe(Number.MAX_VALUE);
    expect(sumPrecise([])).toBe(-0);
  });

  test("the revoke function of Proxy.revocable is an ordinary function (fad04e2527)", () => {
    const result = Proxy.revocable({ a: 1 }, {});
    const { proxy, revoke } = result;
    expect(Object.getOwnPropertyDescriptors(result)).toEqual({
      proxy: { value: proxy, writable: true, enumerable: true, configurable: true },
      revoke: { value: revoke, writable: true, enumerable: true, configurable: true },
    });
    expect(Reflect.ownKeys(result)).toEqual(["proxy", "revoke"]);
    expect(Object.getPrototypeOf(result)).toBe(Object.prototype);

    expect(typeof revoke).toBe("function");
    expect(Object.getPrototypeOf(revoke)).toBe(Function.prototype);
    expect(Object.getOwnPropertyDescriptors(revoke)).toEqual({
      length: { value: 0, writable: false, enumerable: false, configurable: true },
      name: { value: "", writable: false, enumerable: false, configurable: true },
    });
    expect(() => new (revoke as any)()).toThrow(TypeError);
    expect(Proxy.revocable({}, {}).revoke).not.toBe(revoke);

    // After `length` is deleted and defined again, the revoke function lists its keys as any other function does.
    // It used to list them in another order than an arrow function. The order itself is the engine's, so no list is written here.
    const arrow = () => {};
    for (const fn of [revoke, arrow]) {
      delete (fn as any).length;
      Object.defineProperty(fn, "length", { value: 0, configurable: true });
    }
    expect(Reflect.ownKeys(revoke)).toEqual(Reflect.ownKeys(arrow));

    expect(proxy.a).toBe(1);
    expect(revoke()).toBeUndefined();
    expect(() => proxy.a).toThrow(TypeError);
    // The second call does nothing.
    expect(revoke()).toBeUndefined();
  });

  // The walk over the awaiters of a promise stops when it comes back to a promise combinator (071ce01fcb). The
  // frame was repeated until the trace was full.
  test("an async function that awaits itself through Promise.all has one frame in a stack trace", async () => {
    const { promise: captured, resolve } = Promise.withResolvers<string>();
    async function leaf() {
      await 0;
      await 0;
      resolve(new Error("here").stack!);
    }
    let self: Promise<void>;
    async function selfAwaiting() {
      await 0;
      // Never settles: it waits for itself.
      await Promise.all([leaf(), self]);
    }
    self = selfAwaiting();
    const stack = await captured;
    expect(stack).toContain("leaf");
    expect(stack.split("selfAwaiting").length - 1).toBe(1);
  });

  // A bound function that is inlined keeps the kind of the call it is inlined into (f274ef4c03). When a bound
  // comparator left optimized code, it returned behind the call of sort: the caller got the comparator's result,
  // or Array.prototype.sort itself. The program is the one of oven-sh/WebKit#885.
  test("Array.prototype.sort with a bound comparator returns its array when the comparator leaves optimized code", () => {
    const run = new Function(`
      "use strict";
      const compare = ((a, b) => a - b).bind(null);
      function sortTwo(x, y) { return [x, y].sort(compare); }
      function outer(x, y) { let sum = 0; for (let i = 0; i < 1000; i++) sum += i; return [sortTwo(x, y), sum]; }
      function spin() { let sum = 0; for (let i = 0; i < 100000; i++) sum += i; return sum; }
      for (let i = 0; i < 300; i++) { outer(2, 1); spin(); }
      // The difference of these two is not an int32, and the compiled comparator has only subtracted small ones.
      const sorted = outer(2147483647, -5)[0];

      // A tail call through a bound function is a tail call of its target.
      function sum(n, total) { return n ? boundSum(n - 1, total + n) : total; }
      const boundSum = sum.bind(null);
      let total;
      for (let i = 0; i < 2000; i++) total = sum(100, 0);
      return { sorted: Array.isArray(sorted) ? sorted.join() : typeof sorted, isSort: sorted === Array.prototype.sort, total };
    `);
    expect(run()).toEqual({ sorted: "-5,2147483647", isSort: false, total: 5050 });
  });

  // `{ ...fn }` and `let { a, ...rest } = fn` read the properties off the function's Structure now (e04a6f9fae).
  test("spread and rest of a function copy its enumerable own properties", () => {
    const run = new Function(`
      function plain() {}
      plain.a = 1;
      plain.b = 2;
      class Klass { static x = 1; static method() {} static z = 3; static get accessor() { return 4; } }
      Object.defineProperty(Klass, "shown", { get() { return 5; }, enumerable: true });
      const renamed = function () {};
      Object.defineProperty(renamed, "name", { value: "n", enumerable: true, configurable: true });
      renamed.q = 1;
      const resized = function (a, b) {};
      resized.q = 1;
      Object.defineProperty(resized, "length", { value: 5, enumerable: true, configurable: true });
      const withGetter = function () {};
      let getterCalls = 0;
      Object.defineProperty(withGetter, "g", { get() { getterCalls++; return 7; }, enumerable: true });
      const withHidden = function () {};
      Object.defineProperty(withHidden, "hidden", { value: 1, enumerable: false });
      withHidden.shown = 2;
      const symbol = Symbol("s");
      const withSymbol = function () {};
      withSymbol[symbol] = 1;
      const withIndex = function () {};
      withIndex[0] = "zero";
      withIndex.named = 1;
      const withProto = function () {};
      Object.defineProperty(withProto, "__proto__", { value: 1, enumerable: true, writable: true, configurable: true });
      const bound = plain.bind(null);
      bound.own = 1;
      const arrow = () => {};
      arrow.k = 1;
      async function asyncFunction() {}
      asyncFunction.k = 2;
      function* generator() {}
      generator.k = 3;
      const native = Math.max.bind;
      const spread = source => ({ ...source });
      const rest = source => { const { a, ...others } = source; return others; };
      let last;
      for (let i = 0; i < 1500; i++) {
        last = {
          plain: spread(plain),
          rest: rest(plain),
          klass: spread(Klass),
          renamed: Object.keys(spread(renamed)),
          resized: Object.entries(spread(resized)),
          withGetter: spread(withGetter),
          withHidden: spread(withHidden),
          symbolValue: spread(withSymbol)[symbol],
          symbolKeys: Reflect.ownKeys(spread(withSymbol)).length,
          withIndex: Object.entries(spread(withIndex)),
          withProto: Object.getOwnPropertyDescriptor(spread(withProto), "__proto__"),
          bound: spread(bound),
          arrow: spread(arrow),
          asyncFunction: spread(asyncFunction),
          generator: spread(generator),
          natives: [spread(Math.max), spread(native), spread(Object), spread(Proxy)],
          prototype: Object.getPrototypeOf(spread(plain)) === Object.prototype,
        };
      }
      last.getterCalls = getterCalls;
      return last;
    `);
    expect(run()).toEqual({
      plain: { a: 1, b: 2 },
      rest: { b: 2 },
      klass: { x: 1, z: 3, shown: 5 },
      renamed: ["name", "q"],
      resized: [
        ["length", 5],
        ["q", 1],
      ],
      withGetter: { g: 7 },
      withHidden: { shown: 2 },
      symbolValue: 1,
      symbolKeys: 1,
      withIndex: [
        ["0", "zero"],
        ["named", 1],
      ],
      withProto: { value: 1, writable: true, enumerable: true, configurable: true },
      bound: { own: 1 },
      arrow: { k: 1 },
      asyncFunction: { k: 2 },
      generator: { k: 3 },
      natives: [{}, {}, {}, {}],
      prototype: true,
      getterCalls: 1500,
    });
  });

  // Array.from, %TypedArray%.from, Object.groupBy, Map.groupBy and Iterator.prototype.flatMap/some/every/find call
  // `next` themselves now, where they ran a for-of loop over a wrapper object (37aa2b5bd9).
  test("the builtins that take an iterable read @@iterator and next once and close the iterator", () => {
    const iteratorOver = (log: string[], values: unknown[]) => {
      let index = 0;
      return {
        __proto__: Iterator.prototype,
        get next() {
          log.push("get next");
          return () => {
            log.push("next");
            return index < values.length ? { value: values[index++], done: false } : { value: undefined, done: true };
          };
        },
        get return() {
          log.push("get return");
          return () => {
            log.push("return");
            return {};
          };
        },
      } as unknown as Iterator<any> & { [name: string]: any };
    };
    const iterableOver = (log: string[], values: unknown[]) =>
      ({
        get [Symbol.iterator]() {
          log.push("get @@iterator");
          return () => {
            log.push("call @@iterator");
            return iteratorOver(log, values);
          };
        },
      }) as Iterable<any>;
    const fail = () => {
      throw new Error("callback");
    };
    const run = <Source>(make: (log: string[], values: unknown[]) => Source, call: (source: Source) => unknown) => {
      const log: string[] = [];
      let result: unknown;
      try {
        result = call(make(log, [1, 2]));
      } catch (error) {
        result = (error as Error).message;
      }
      return { result, log };
    };
    const opened = ["get @@iterator", "call @@iterator", "get next"];
    const closed = ["get return", "return"];

    expect(run(iterableOver, iterable => Array.from(iterable))).toEqual({
      result: [1, 2],
      log: [...opened, "next", "next", "next"],
    });
    expect(run(iterableOver, iterable => Array.from(iterable, fail))).toEqual({
      result: "callback",
      log: [...opened, "next", ...closed],
    });
    expect(run(iterableOver, iterable => Array.from(iterable, value => value * 2))).toEqual({
      result: [2, 4],
      log: [...opened, "next", "next", "next"],
    });
    expect(run(iterableOver, iterable => Object.groupBy(iterable, value => (value === 1 ? "one" : "other")))).toEqual({
      result: { one: [1], other: [2] },
      log: [...opened, "next", "next", "next"],
    });
    expect(run(iterableOver, iterable => Object.groupBy(iterable, fail))).toEqual({
      result: "callback",
      log: [...opened, "next", ...closed],
    });
    expect(run(iterableOver, iterable => [...Map.groupBy(iterable, value => value === 1)])).toEqual({
      result: [
        [true, [1]],
        [false, [2]],
      ],
      log: [...opened, "next", "next", "next"],
    });
    expect(run(iterableOver, iterable => Map.groupBy(iterable, fail))).toEqual({
      result: "callback",
      log: [...opened, "next", ...closed],
    });

    // The iterator helpers read `next` of the iterator they are called on, and close it when they stop early.
    expect(run(iteratorOver, iterator => iterator.some((value: number) => value === 1))).toEqual({
      result: true,
      log: ["get next", "next", ...closed],
    });
    expect(run(iteratorOver, iterator => iterator.some((value: number) => value === 3))).toEqual({
      result: false,
      log: ["get next", "next", "next", "next"],
    });
    expect(run(iteratorOver, iterator => iterator.every((value: number) => value === 1))).toEqual({
      result: false,
      log: ["get next", "next", "next", ...closed],
    });
    expect(run(iteratorOver, iterator => iterator.find((value: number) => value === 2))).toEqual({
      result: 2,
      log: ["get next", "next", "next", ...closed],
    });
    expect(run(iteratorOver, iterator => iterator.find(fail))).toEqual({
      result: "callback",
      log: ["get next", "next", ...closed],
    });
    expect(run(iteratorOver, iterator => [...iterator.flatMap((value: number) => [value, value * 10])])).toEqual({
      result: [1, 10, 2, 20],
      log: ["get next", "next", "next", "next"],
    });
    expect(run(iteratorOver, iterator => iterator.flatMap(fail).next())).toEqual({
      result: "callback",
      log: ["get next", "next", ...closed],
    });
    expect(
      run(iteratorOver, iterator => {
        const flat = iterator.flatMap((value: number) => [value, value * 10]);
        return [flat.next(), flat.return()];
      }),
    ).toEqual({
      result: [
        { value: 1, done: false },
        { value: undefined, done: true },
      ],
      log: ["get next", "next", ...closed],
    });

    // An iterator that is not an object is a TypeError.
    for (const notAnObject of [undefined, null, 1, "s", true]) {
      const iterable = { [Symbol.iterator]: () => notAnObject } as unknown as Iterable<any>;
      expect(() => Array.from(iterable)).toThrow(TypeError);
      expect(() => Uint8Array.from(iterable)).toThrow(TypeError);
      expect(() => Object.groupBy(iterable, value => value)).toThrow(TypeError);
      expect(() => Map.groupBy(iterable, value => value)).toThrow(TypeError);
    }
    expect(Uint8Array.from(iterableOver([], [1, 2]))).toEqual(new Uint8Array([1, 2]));
    expect(Float64Array.from(new Set([1.5, 2]), value => value * 2)).toEqual(new Float64Array([3, 4]));
  });

  test("Array.fromAsync reads a sync iterable, an async iterable and an array-like", async () => {
    async function* asyncValues() {
      yield 1;
      yield 2;
    }
    expect(await Array.fromAsync([1, Promise.resolve(2), 3])).toEqual([1, 2, 3]);
    expect(await Array.fromAsync(new Set([1, 2]), value => value * 2)).toEqual([2, 4]);
    expect(await Array.fromAsync(asyncValues())).toEqual([1, 2]);
    expect(await Array.fromAsync(asyncValues(), async value => value + 1)).toEqual([2, 3]);
    expect(await Array.fromAsync({ length: 2, 0: "a", 1: Promise.resolve("b") })).toEqual(["a", "b"]);

    const log: string[] = [];
    const iterable = {
      [Symbol.asyncIterator]() {
        return {
          next() {
            log.push("next");
            return Promise.resolve({ value: 1, done: false });
          },
          return() {
            log.push("return");
            return Promise.resolve({});
          },
        };
      },
    };
    expect(
      await Array.fromAsync(iterable, () => {
        throw new Error("callback");
      }).catch(error => error.message),
    ).toBe("callback");
    expect(log).toEqual(["next", "return"]);

    for (const notAnObject of [undefined, null, 1, "s"]) {
      const result = await Array.fromAsync({ [Symbol.asyncIterator]: () => notAnObject } as any).catch(error => error);
      expect(result).toBeInstanceOf(TypeError);
    }
  });

  // Array.prototype.join keeps its exact-length path for booleans, undefined and null (e81441a5ec).
  test("Array.prototype.join writes booleans, undefined and null as before", () => {
    const run = new Function(`
      const join = (array, separator) => array.join(separator);
      const holey = [1, , true];
      const results = [];
      for (let i = 0; i < 2000; i++) {
        results.length = 0;
        results.push(
          join([true, null, undefined, false, 1, "a"]),
          join([true, false], ""),
          join([null, undefined], "-"),
          join([undefined], ""),
          join([null]),
          join([true]),
          join([false], ""),
          join([1, 2, 3], ""),
          join([1, -2, 2147483647, -2147483648], ""),
          join(["a", true, "b", null, "c", undefined, 7], ""),
          join(["\\u4e2d", true, null], ""),
          join([true, "\\u4e2d"], "\\u00e9"),
          join(holey, ""),
          join([1.5, true], ""),
          join([true, {}], ""),
          join([[true, null], [undefined, false]], ";"),
        );
      }
      return results;
    `);
    expect(run()).toEqual([
      "true,,,false,1,a",
      "truefalse",
      "-",
      "",
      "",
      "true",
      "false",
      "123",
      "1-22147483647-2147483648",
      "atruebc7",
      "\u4e2dtrue",
      "true\u00e9\u4e2d",
      "1true",
      "1.5true",
      "true[object Object]",
      "true,;,false",
    ]);
  });

  // JSON.parse reads a key it has seen for the same shape, and a short integer or a cached string after it, in
  // a loop of its own (6f5f583b55).
  describe("JSON.parse of objects with the same keys", () => {
    const values: unknown[] = [
      0,
      7,
      42,
      123456789,
      999999999,
      1000000000,
      2147483647,
      2147483648,
      4294967296,
      9007199254740993,
      -1,
      -999999999,
      1.5,
      0.1,
      1e3,
      12e-1,
      Infinity,
      "",
      "s",
      "repeated",
      "repeated",
      'with "quotes" and \\ and \n',
      "\u00e9",
      "\u4e2d\u6587",
      true,
      false,
      null,
      [],
      [1, "s", null],
      {},
      { k: 1, l: [2] },
    ];
    // How a value is written in the text. JSON.stringify would write Infinity as null.
    const write = (value: unknown) => (value === Infinity ? "1e400" : JSON.stringify(value));
    type Field = [key: string, value: string];
    const layouts: [name: string, layout: (fields: Field[]) => string][] = [
      ["compact", fields => `{${fields.map(([key, value]) => `"${key}":${value}`).join(",")}}`],
      ["spaced", fields => `{ ${fields.map(([key, value]) => `"${key}" : ${value}`).join(" , ")} }`],
      ["indented", fields => `{\n${fields.map(([key, value]) => `\t"${key}":\r\n  ${value}`).join(",\n")}\n}`],
    ];

    test.each(layouts)("%s: every kind of value after a known key", (_, layout) => {
      const expected: Record<string, unknown>[] = [];
      const texts: string[] = [];
      // Each object has the same three keys, and each value takes each position.
      for (let i = 0; i < values.length; i++) {
        const row = [values[i], values[(i + 7) % values.length], values[(i + 13) % values.length]];
        expected.push({ first: row[0], second: row[1], third: row[2] });
        texts.push(
          layout([
            ["first", write(row[0])],
            ["second", write(row[1])],
            ["third", write(row[2])],
          ]),
        );
      }
      for (const text of [`[${texts.join(",")}]`, `[\n${texts.join(",\n")}\n]`]) {
        // Twice: the second parse finds every key and every short string in the cache.
        for (let round = 0; round < 2; round++) {
          const parsed = JSON.parse(text);
          expect(parsed).toEqual(expected);
          for (const object of parsed) expect(Object.keys(object)).toEqual(["first", "second", "third"]);
        }
        // The same text in a string of 16-bit characters.
        expect(JSON.parse(`["\u4e2d",${text}]`)).toEqual(["\u4e2d", expected]);
      }
    });

    test("-0, keys out of order, repeated keys and keys that are not plain names", () => {
      const known = '{"a":1,"b":2}';
      const parse = (last: string) => JSON.parse(`[${known},${known},${last}]`)[2];
      expect(parse('{"a":-0,"b":2}').a).toBe(-0);
      expect(parse('{"a":0,"b":2}').a).toBe(0);
      expect(Object.entries(parse('{"b":1,"a":2}'))).toEqual([
        ["b", 1],
        ["a", 2],
      ]);
      expect(parse('{"a":1,"a":3,"b":2}')).toEqual({ a: 3, b: 2 });
      expect(parse('{"a":1,"b":2,"a":"x"}')).toEqual({ a: "x", b: 2 });
      expect(parse('{"a":1}')).toEqual({ a: 1 });
      expect(parse('{"a":1,"b":2,"c":3}')).toEqual({ a: 1, b: 2, c: 3 });
      expect(parse("{}")).toEqual({});
      // An escape in the key is the same key.
      expect(parse('{"\\u0061":5,"b":6}')).toEqual({ a: 5, b: 6 });
      expect(Object.entries(parse('{"a":1,"1":2,"0":3}'))).toEqual([
        ["0", 3],
        ["1", 2],
        ["a", 1],
      ]);
      const withProto = parse('{"a":1,"__proto__":{"x":1},"b":2}');
      expect(Object.getPrototypeOf(withProto)).toBe(Object.prototype);
      expect(Object.keys(withProto)).toEqual(["a", "__proto__", "b"]);
    });

    test("what is not JSON after a known key is a SyntaxError", () => {
      const known = '{"a":1,"b":2}';
      const invalid = [
        '{"a":01,"b":2}',
        '{"a":00,"b":2}',
        '{"a":1x,"b":2}',
        '{"a":1_000,"b":2}',
        '{"a":0x10,"b":2}',
        '{"a":+1,"b":2}',
        '{"a":-,"b":2}',
        '{"a":1.,"b":2}',
        '{"a":.5,"b":2}',
        '{"a":1e,"b":2}',
        '{"a":1e+,"b":2}',
        '{"a":,"b":2}',
        '{"a":1,"b":}',
        '{"a":1,"b"}',
        '{"a":1,"b":2,}',
        '{"a":1,,"b":2}',
        '{"a":1 "b":2}',
        '{"a":1;"b":2}',
        '{"a":1,"b":2',
        '{"a":1,"b":',
        '{"a":1,"b"',
        '{"a":1,"',
        '{"a":1,',
        '{"a":1',
        '{"a":',
        '{"a"',
        '{"a":1,"b":2]',
        '{"a":1,"b":"unterminated}',
        '{"a":1,"b":\'single\'}',
        '{"a":1,b:2}',
        '{"a":1,"b":undefined}',
        '{"a":1,"b":NaN}',
        '{"a":1,"b":tru}',
        '{"a":123456789012345678901234567890x,"b":2}',
      ];
      for (const last of invalid) {
        // Alone, after two objects that make the keys known, and the same in a string of 16-bit characters.
        for (const text of [last, `[${known},${known},${last}]`, `["\u4e2d",${known},${known},${last}]`])
          expect(() => JSON.parse(text), text).toThrow(SyntaxError);
      }
      // The valid neighbours of the above.
      const parse = (last: string) => JSON.parse(`[${known},${known},${last}]`)[2];
      expect(parse('{"a":0,"b":2}')).toEqual({ a: 0, b: 2 });
      expect(parse('{"a":10,"b":2}')).toEqual({ a: 10, b: 2 });
      expect(parse('{"a":1e0,"b":2}')).toEqual({ a: 1, b: 2 });
      expect(parse('{"a":1.0,"b":2}')).toEqual({ a: 1, b: 2 });
      expect(parse('{"a":-1,"b":2}')).toEqual({ a: -1, b: 2 });
      expect(parse('{"a":1 ,"b":2 }')).toEqual({ a: 1, b: 2 });
    });

    test("a reviver sees the same values", () => {
      const text = '[{"a":1,"b":"x"},{"a":2,"b":"x"},{"a":123456789,"b":"y"}]';
      const seen: [string, unknown][] = [];
      const parsed = JSON.parse(text, function (key, value) {
        if (typeof value !== "object") seen.push([key, value]);
        return typeof value === "number" ? value + 1 : value;
      });
      expect(parsed).toEqual([
        { a: 2, b: "x" },
        { a: 3, b: "x" },
        { a: 123456790, b: "y" },
      ]);
      expect(seen).toEqual([
        ["a", 1],
        ["b", "x"],
        ["a", 2],
        ["b", "x"],
        ["a", 123456789],
        ["b", "y"],
      ]);
    });

    // Bun.JSONL reads its lines with the same parser, and tells a value that is cut off from one that is wrong
    // by where the parser stopped.
    test("Bun.JSONL.parseChunk takes the whole lines of a text that is cut at any place", () => {
      const line =
        '{"id":1,"name":"ab","n":123456789,"big":1234567890,"neg":-5,"f":1.5,"t":true,"z":null,"s":"ab","arr":[1,2],"o":{"k":1}}';
      const lines = [line, line.replace('"id":1', '"id":2'), line.replace('"id":1', '"id":3')];
      const text = lines.join("\n") + "\n";
      const bytes = new TextEncoder().encode(text);
      const failures: unknown[] = [];
      for (let cut = 0; cut <= text.length; cut++) {
        // The lines whose last character is before the cut, and where the last of them ends.
        let whole = 0;
        let end = 0;
        let offset = 0;
        for (const each of lines) {
          if (offset + each.length <= cut) {
            whole++;
            end = offset + each.length;
          }
          offset += each.length + 1;
        }
        for (const input of [text.slice(0, cut), bytes.subarray(0, cut)]) {
          const result = Bun.JSONL.parseChunk(input);
          const ids = (result.values as { id: number }[]).map(value => value.id);
          if (result.error !== null || result.read !== end || ids.length !== whole || ids.some((id, i) => id !== i + 1))
            failures.push({ cut, input: typeof input, read: result.read, end, ids, error: String(result.error) });
        }
      }
      expect(failures).toEqual([]);
      expect(Bun.JSONL.parse(text)).toEqual(lines.map(each => JSON.parse(each)));

      const wrong = Bun.JSONL.parseChunk(`${line}\n${line.replace('"n":123456789', '"n":0123456789')}\n`);
      expect(wrong.values).toEqual([JSON.parse(line)]);
      expect(wrong.error).toBeInstanceOf(SyntaxError);
    });
  });

  // A null test or a negated comparison that ends a loop is one fused jump now (bd50166362).
  test("loops that end in a null test or a negated comparison", () => {
    const run = new Function(`
      function countUntilNull(node) { let count = 0; while (node != null) { count++; node = node.next; } return count; }
      function countWhileNull(array) { let i = 0; while (array[i] == null) i++; return i; }
      function countUntilNullish(node) { let count = 0; do { count++; node = node.next; } while (node !== undefined && node !== null); return count; }
      function countNegatedNull(node) { let count = 0; do { count++; node = node.next; } while (!(node == null)); return count; }
      function untilLess(value, bound) { let steps = 0; do { value--; steps++; } while (!(value < bound) && steps < 8); return steps; }
      function untilLessEq(value, bound) { let steps = 0; do { value--; steps++; } while (!(value <= bound) && steps < 8); return steps; }
      function untilGreater(value, bound) { let steps = 0; do { value++; steps++; } while (!(value > bound) && steps < 8); return steps; }
      function untilGreaterEq(value, bound) { let steps = 0; do { value++; steps++; } while (!(value >= bound) && steps < 8); return steps; }
      function untilEq(value, bound) { let steps = 0; do { value++; steps++; } while (!(value == bound) && steps < 8); return steps; }
      function untilStrictEq(value, bound) { let steps = 0; do { value++; steps++; } while (!(value === bound) && steps < 8); return steps; }
      function untilNotEq(value, other) { let steps = 0; do { steps++; } while (!(value != other) && steps < 8); return steps; }
      function untilNotStrictEq(value, other) { let steps = 0; do { steps++; } while (!(value !== other) && steps < 8); return steps; }
      const list = { next: { next: { next: null } } };
      const open = { next: { next: {} } };
      const all = () => [
        countUntilNull(list), countUntilNull(null), countUntilNull(undefined), countUntilNull(open),
        countWhileNull([null, undefined, , 0]), countWhileNull([false]),
        countUntilNullish(list), countUntilNullish(open), countNegatedNull(list), countNegatedNull(open),
        untilLess(10, 5), untilLess(5, 5), untilLessEq(10, 5), untilLessEq(5, 5),
        untilGreater(0, 5), untilGreaterEq(0, 5), untilEq(0, 5), untilStrictEq(0, 5),
        untilNotEq(1, 1), untilNotEq(1, 2), untilNotStrictEq(1, 1), untilNotStrictEq(1, 2),
      ];
      let integers;
      for (let i = 0; i < 3000; i++) integers = all();
      // After the loops are compiled for integers: a comparison with NaN is false whichever way it is written,
      // so its negation goes around until the limit, and other types compare as they do everywhere.
      const others = [
        untilLess(NaN, 5), untilLessEq(NaN, 5), untilGreater(NaN, 5), untilGreaterEq(NaN, 5),
        untilLess(5, undefined), untilGreaterEq(undefined, 0), untilEq(NaN, NaN), untilStrictEq(NaN, NaN),
        untilLess(7.5, 5), untilLessEq("7", "5"), untilGreater("a", "b"), untilEq("4", 5), untilStrictEq("4", 5),
        untilEq(null, undefined), untilNotEq(1, "1"), untilNotStrictEq(1, "1"), untilNotEq(null, undefined),
        untilNotStrictEq(null, undefined), untilNotEq(NaN, NaN),
      ];
      return { integers, others, again: all() };
    `);
    const integers = [3, 0, 0, 3, 3, 0, 3, 3, 3, 3, 6, 1, 5, 1, 6, 5, 5, 5, 8, 1, 8, 1];
    expect(run()).toEqual({
      integers,
      others: [8, 8, 8, 8, 8, 8, 8, 8, 3, 2, 8, 1, 1, 8, 8, 1, 8, 1, 1],
      again: integers,
    });
  });

  // The first-character filter of an anchored RegExp, and `switch` on a string, read a substring in place (b92d6a6bea).
  test("an anchored RegExp and a switch see the characters of a substring", () => {
    const run = new Function(`
      const tail = "abc=1;def=2;\\u00e9=3;";
      const narrow = "xxxxxxxxxxxxxxxxxxxxxxxx" + tail;
      const wide = "\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d\\u4e2d" + tail;
      const kind = piece => {
        switch (piece) {
        case "abc=1;": return "abc";
        case "def=2;": return "def";
        case "\\u00e9=3;": return "e-acute";
        case "": return "empty";
        default: return "other";
        }
      };
      const startsWithA = piece => /^a/.test(piece);
      const startsWithDigitOrD = piece => /^[0-9d]/.test(piece);
      const matchA = piece => piece.match(/^(a)bc/);
      let last;
      for (let i = 0; i < 5000; i++) {
        last = [];
        for (const base of [narrow, wide]) {
          const pieces = [base.slice(24, 30), base.slice(30, 36), base.substring(36, 40), base.slice(24, 24), base.slice(25, 31), base.slice(0, 6)];
          for (const piece of pieces) {
            const match = matchA(piece);
            last.push([kind(piece), startsWithA(piece), startsWithDigitOrD(piece), match && [match[0], match[1], match.index]]);
          }
        }
      }
      return last;
    `);
    const half = [
      ["abc", true, false, ["abc", "a", 0]],
      ["def", false, true, null],
      ["e-acute", false, false, null],
      ["empty", false, false, null],
      ["other", false, false, null],
      ["other", false, false, null],
    ];
    expect(run()).toEqual([...half, ...half]);
  });
});
