import { describe, expect, test } from "bun:test";
import vm from "node:vm";

// Coverage for the WebKit 4611b64906 sync. The first group pins observable differences between
// the old and the new JavaScriptCore. The second group runs code the range rewrote (for-of
// without an iterator object, the JSON.parse caches, the in-place splice, the Collector split,
// lazy Error.captureStackTrace stacks, Wasm memories) and checks that results hold.

describe("WebKit 4611b64906 upgrade", () => {
  // Through the Function constructor: the parentheses are the point, and a printer may drop them.
  test("a call through a parenthesized optional chain is outside the chain (63b7d629dd)", () => {
    const run = new Function(`
      let a;
      let evaluated = false;
      let error;
      try {
        (a?.b)((evaluated = true));
      } catch (e) {
        error = e;
      }
      const o = { b() { return this; } };
      return { evaluated, isTypeError: error instanceof TypeError, receiver: (o?.b)() === o };
    `);
    expect(run()).toEqual({ evaluated: true, isTypeError: true, receiver: true });
  });

  test("a template tagged with a parenthesized optional chain keeps its receiver (7fbe85cfbf)", () => {
    const run = new Function(`
      const o = { b() { return this; } };
      return (o?.b)\`x\` === o;
    `);
    expect(run()).toBe(true);
  });

  test("a template tagged with a super property is called with the current this (24e354459d)", () => {
    class A {
      tag(_strings: TemplateStringsArray) {
        return this;
      }
    }
    class B extends A {
      test() {
        return super.tag`x`;
      }
    }
    const b = new B();
    expect(b.test()).toBe(b);
  });

  test("Intl.DurationFormat formats a fraction that has no integer part (ee8e5dbbcc)", () => {
    const format = new Intl.DurationFormat("en", { milliseconds: "numeric" });
    expect(format.format({ milliseconds: 500 })).toBe("0.5 sec");
    expect(format.format({ hours: 1, milliseconds: 500 })).toBe("1 hr, 0.5 sec");
  });

  test("Intl.DurationFormat keeps the sign of a negative sub-second value (501d1f661f)", () => {
    const format = new Intl.DurationFormat("en", { seconds: "numeric" });
    expect(format.format({ milliseconds: -500 })).toBe("-0.5");
    expect(format.formatToParts({ milliseconds: -500 }).map(part => part.type)).toEqual([
      "minusSign",
      "integer",
      "decimal",
      "fraction",
    ]);
  });

  test("Intl.Segmenter containing() at a lead surrogate returns the segment that starts there (3e27303e85)", () => {
    const segments = new Intl.Segmenter("en", { granularity: "grapheme" }).segment(" \u{1F600}");
    expect(segments.containing(1)).toMatchObject({ segment: "\u{1F600}", index: 1 });
    expect(segments.containing(0)).toMatchObject({ segment: " ", index: 0 });
    expect(segments.containing(2)).toMatchObject({ segment: "\u{1F600}", index: 1 });
  });

  test("Temporal names an invalid calendar identifier in one form (3141e1c662)", () => {
    expect(() => new Temporal.PlainDate(2020, 1, 1).withCalendar("foo")).toThrow(
      new RangeError("'foo' is not a valid calendar identifier"),
    );
  });

  test("a typed array constructor reads the length of an array-like Proxy (71d329770b, 240fe1fc63)", () => {
    const gets: PropertyKey[] = [];
    const proxy = new Proxy(
      { length: 2, 0: 1, 1: 2 },
      {
        get(target, key, receiver) {
          gets.push(key);
          return Reflect.get(target, key, receiver);
        },
      },
    );
    expect(Array.from(new Float64Array(proxy as any))).toEqual([1, 2]);
    expect(gets).toContain("length");
    // A Proxy of an array still goes through its iterator.
    expect(Array.from(new Uint8Array(new Proxy([3, 4, 5], {})))).toEqual([3, 4, 5]);
  });

  test("the ArrayBuffer and Array constructors convert the length in spec order (1b1238d3e3, e4e335cf8d)", () => {
    const makeNewTarget = () => {
      const state = { read: false };
      const newTarget = function () {}.bind(null);
      Object.defineProperty(newTarget, "prototype", {
        get() {
          state.read = true;
          throw new Error("prototype getter");
        },
      });
      return { state, newTarget };
    };
    // ArrayBuffer: ToIndex(length) comes before the read of newTarget.prototype.
    const forBuffer = makeNewTarget();
    expect(() => Reflect.construct(ArrayBuffer, [-1], forBuffer.newTarget)).toThrow(RangeError);
    expect(forBuffer.state.read).toBe(false);
    // Array: the read of newTarget.prototype comes before the RangeError for the length.
    const forArray = makeNewTarget();
    expect(() => Reflect.construct(Array, [-1], forArray.newTarget)).toThrow("prototype getter");
    expect(forArray.state.read).toBe(true);
    expect(() => Array(-1)).toThrow(RangeError);
  });

  test("Promise, String and RegExp fast paths are not taken across realms (1f47117433, bffe36ec16)", async () => {
    const other = vm.runInNewContext("({ promise: Promise.resolve(1), regExp: /b/, Promise, Array })");
    // The species lookup runs in the realm of the promise.
    const derived = Promise.prototype.then.call(other.promise, (value: number) => value + 1);
    expect(derived instanceof other.Promise).toBe(true);
    expect(derived instanceof Promise).toBe(false);
    expect(await derived).toBe(2);
    // The match array belongs to the realm of the RegExp.
    const match = "abc".match(other.regExp)!;
    expect(Object.getPrototypeOf(match)).toBe(other.Array.prototype);
    expect([...match]).toEqual(["b"]);
    expect(match.index).toBe(1);
    // Same realm: nothing changes.
    expect(Object.getPrototypeOf("abc".match(/b/)!)).toBe(Array.prototype);
    expect("abcb".replace(vm.runInNewContext("/b/g"), "x")).toBe("axcx");
  });

  // (module (func (export "add") (param i64 i64 i64 i64) (result i64 i64)
  //   local.get 0 local.get 1 local.get 2 local.get 3 i64.add128))
  // prettier-ignore
  const wideArithmeticModule = new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
    0x01, 0x0a, 0x01, 0x60, 0x04, 0x7e, 0x7e, 0x7e, 0x7e, 0x02, 0x7e, 0x7e,
    0x03, 0x02, 0x01, 0x00,
    0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
    0x0a, 0x0e, 0x01, 0x0c, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0x20, 0x03, 0xfc, 0x13, 0x0b,
  ]);

  test("Wasm wide arithmetic is on by default (ba4ffde846)", () => {
    expect(WebAssembly.validate(wideArithmeticModule)).toBe(true);
    const { add } = new WebAssembly.Instance(new WebAssembly.Module(wideArithmeticModule)).exports as {
      add: (aLow: bigint, aHigh: bigint, bLow: bigint, bHigh: bigint) => [bigint, bigint];
    };
    // (2**64 - 1) + 1 carries into the high half.
    expect(add(-1n, 0n, 1n, 0n)).toEqual([0n, 1n]);
    expect(add(5n, 7n, 6n, 8n)).toEqual([11n, 15n]);
  });

  describe("code the range rewrote", () => {
    test("for-of and array patterns over an Array keep the iteration protocol (35637c6433, bb73af4a4b, 39f7f217cd)", () => {
      const sum = (array: number[]) => {
        let total = 0;
        for (const value of array) total += value;
        return total;
      };
      const firstTwo = (pair: unknown[]) => {
        const [a, b] = pair;
        return [a, b];
      };
      const ints = Array.from({ length: 64 }, (_, i) => i);
      const doubles = ints.map(i => i + 0.5);
      // Enough calls for the LLInt, the Baseline JIT and the DFG to take their own paths.
      for (let i = 0; i < 3000; i++) {
        expect(sum(ints)).toBe(2016);
        expect(sum(doubles)).toBe(2048);
        expect(firstTwo(i & 1 ? ints : ["x", "y", "z"])).toEqual(i & 1 ? [0, 1] : ["x", "y"]);
      }

      // The length is read again on every step, and a hole reads through the prototype chain.
      const grown = [1, 2, 3];
      const seen: number[] = [];
      for (const value of grown) {
        seen.push(value);
        if (grown.length < 6) grown.push(value * 10);
      }
      expect(seen).toEqual([1, 2, 3, 10, 20, 30]);
      const shrunk = [1, 2, 3, 4];
      const seenWhileShrinking: number[] = [];
      for (const value of shrunk) {
        seenWhileShrinking.push(value);
        shrunk.length = 2;
      }
      expect(seenWhileShrinking).toEqual([1, 2]);
      // prettier-ignore
      const holey = [1, , 3];
      expect([...(function* () { for (const value of holey) yield value; })()]).toEqual([1, undefined, 3]);

      // A loop that is suspended in a generator resumes at the right element.
      function* pairs(array: number[]) {
        for (const value of array) {
          const [a, b] = [value, yield value];
          yield [a, b];
        }
      }
      const generator = pairs([7, 8]);
      expect(generator.next().value).toBe(7);
      expect(generator.next("first").value).toEqual([7, "first"]);
      expect(generator.next().value).toBe(8);
      expect(generator.next("second").value).toEqual([8, "second"]);
      expect(generator.next().done).toBe(true);
    });

    test("leaving an Array loop calls a return method that appeared after the loop was opened (35637c6433)", () => {
      const arrayIteratorPrototype = Object.getPrototypeOf([][Symbol.iterator]());
      const calls: unknown[] = [];
      const breakOut = (array: number[]) => {
        for (const value of array) {
          if (value === 2) {
            arrayIteratorPrototype.return = function (this: Iterator<number>) {
              // The iterator that is made for the call stands where the loop was.
              calls.push(this.next().value);
              return {};
            };
            break;
          }
        }
      };
      const destructure = (array: number[]) => {
        const [first] = array;
        return first;
      };
      try {
        // Warm up while the protocol is intact: nothing to close.
        for (let i = 0; i < 2000; i++) {
          breakOut([1, 3, 5]);
          expect(destructure([9, 8, 7])).toBe(9);
        }
        expect(calls).toEqual([]);
        breakOut([1, 2, 3, 4]);
        expect(calls).toEqual([3]);
        // With return present, a pattern that leaves elements behind closes its iterator too.
        expect(destructure([9, 8, 7])).toBe(9);
        expect(calls).toEqual([3, 8]);
      } finally {
        delete arrayIteratorPrototype.return;
      }
      expect(destructure([4, 5])).toBe(4);
      expect(calls).toEqual([3, 8]);
    });

    test("for-of and array patterns over a String iterate code points (5330149c55)", () => {
      const text = "a\u{1F600}b\uD800c";
      const expected = ["a", "\u{1F600}", "b", "\uD800", "c"];
      const collect = (string: string) => {
        const out: string[] = [];
        for (const character of string) out.push(character);
        return out;
      };
      const head = (string: string) => {
        const [first, second, ...rest] = string;
        return [first, second, rest.length];
      };
      for (let i = 0; i < 3000; i++) {
        expect(collect(text)).toEqual(expected);
        expect(head(text)).toEqual(["a", "\u{1F600}", 3]);
      }
      expect(collect("")).toEqual([]);
      // A rope, and a String object.
      expect(collect("x" + "xx" + "\u{1F600}")).toEqual(["x", "x", "x", "\u{1F600}"]);
      expect(collect(Object("hi") as string)).toEqual(["h", "i"]);

      const stringIteratorPrototype = Object.getPrototypeOf(""[Symbol.iterator]());
      const calls: unknown[] = [];
      try {
        for (const character of "abc") {
          if (character === "a") {
            stringIteratorPrototype.return = function (this: Iterator<string>) {
              calls.push(this.next().value);
              return {};
            };
            break;
          }
        }
      } finally {
        delete stringIteratorPrototype.return;
      }
      expect(calls).toEqual(["b"]);
    });

    test("JSON.parse gives the same values through its key, transition and string caches (b718c65267, 1e80c1e3ef, 0506f92aff, 7fb452f1a4, e5517023f3)", () => {
      const longValue = "https://example.com/" + Buffer.alloc(96, "segment/").toString();
      const veryLongValue = Buffer.alloc(300, "v").toString();
      const records = Array.from({ length: 200 }, (_, i) => ({
        name: "record" + (i % 7),
        value: i,
        ratio: i / 8,
        aKeyThatIsLongerThanSixteenCharacters: i % 3 === 0,
        "escaped\n\"key\"": null,
        url: longValue,
        blob: i % 50 === 0 ? veryLongValue : longValue + i,
        nested: { ints: [i, i + 1, i + 2], doubles: [i + 0.5, -2.25, 1e300], mixed: [i, "s", null, [true], {}] },
        // Same keys in another order every third record: a different Structure transition.
        ...(i % 3 === 1 ? { z: 1, y: 2 } : { y: 2, z: 1 }),
      }));
      const text = JSON.stringify(records);
      expect(JSON.parse(text)).toEqual(records);
      // Twice: the second parse starts with the caches the first one filled.
      expect(JSON.parse(text)).toEqual(records);
      // A 16-bit source.
      const wide = JSON.stringify({ snowman: "\u2603", records });
      expect(JSON.parse(wide)).toEqual({ snowman: "\u2603", records });
      // With a reviver the lexer takes the general path.
      const revived = JSON.parse(text, (key, value) => (key === "value" ? value + 1 : value));
      expect(revived.map((record: { value: number }) => record.value)).toEqual(records.map(record => record.value + 1));
      // Order of keys is the order of the text, and a duplicate key keeps the last value.
      expect(Object.keys(JSON.parse('{"b":1,"a":2,"b":3}'))).toEqual(["b", "a"]);
      expect(JSON.parse('{"b":1,"a":2,"b":3}')).toEqual({ b: 3, a: 2 });
      expect(Object.getOwnPropertyNames(JSON.parse('{"__proto__":1,"length":2}'))).toEqual(["__proto__", "length"]);
      expect(JSON.parse("[1,2.5,-0,1e21,[],[[]],\"\\u0041\"]")).toEqual([1, 2.5, -0, 1e21, [], [[]], "A"]);
      for (const bad of ['{"a":1,}', "[1,]", '{"a" 1}', '["\u0001"]', "[01]", '{"a":1', "nul"]) {
        expect(() => JSON.parse(bad)).toThrow(SyntaxError);
      }
    });

    test("Bun.JSONL reports how far it read after each kind of value", () => {
      const lines = ['{"a":1}', "[1,2]", '"text"', "-12.5", "true", "null", '{"b":{"c":[{}]}}'];
      const whole = lines.join("\n") + "\n";
      expect(Bun.JSONL.parse(whole)).toEqual(lines.map(line => JSON.parse(line)));
      // Cut the input after the first character of a value: everything before it is returned,
      // and `read` is the end of the last whole value.
      for (let i = 1; i < lines.length; i++) {
        const complete = lines.slice(0, i).join("\n") + "\n";
        const chunk = complete + lines[i].slice(0, 1);
        const result = Bun.JSONL.parseChunk(chunk);
        expect(result.values).toEqual(lines.slice(0, i).map(line => JSON.parse(line)));
        expect(result.read).toBe(complete.length - 1);
        expect(result.done).toBe(false);
      }
    });

    test("Array.prototype.splice in place agrees with the generic algorithm (d29218b6de)", () => {
      const reference = (array: unknown[], start: number, deleteCount: number, items: unknown[]) => {
        const copy = Array.prototype.slice.call(array);
        const removed = copy.slice(start, start + deleteCount);
        return { removed, result: [...copy.slice(0, start), ...items, ...copy.slice(start + deleteCount)] };
      };
      const shapes: Record<string, () => unknown[]> = {
        int32: () => [1, 2, 3, 4, 5, 6, 7, 8],
        double: () => [1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5, 8.5],
        contiguous: () => ["a", {}, 3, null, "e", 6.5, [], "h"],
      };
      for (const [shape, make] of Object.entries(shapes)) {
        for (const [start, deleteCount, items] of [
          [0, 0, []],
          [0, 3, []],
          [2, 2, ["x", "y"]],
          [2, 1, [10, 20, 30, 40]],
          [8, 0, [9]],
          [3, 5, [0.25]],
          [0, 8, []],
          [1, 6, ["only"]],
        ] as [number, number, unknown[]][]) {
          const array = make();
          const expected = reference(array, start, deleteCount, items);
          const removed = array.splice(start, deleteCount, ...items);
          expect({ shape, removed, result: array }).toEqual({ shape, ...expected });
          expect(array.length).toBe(expected.result.length);
        }
      }
      // A hole that an indexed property on the prototype fills takes the generic path.
      // prettier-ignore
      const holey = [1, , 3, 4];
      Object.defineProperty(Array.prototype, 1, { value: "inherited", writable: true, configurable: true });
      try {
        expect(holey.splice(0, 2)).toEqual([1, "inherited"]);
        expect(Object.getOwnPropertyNames(holey)).toEqual(["0", "1", "length"]);
        expect([holey[0], holey[1], holey.length]).toEqual([3, 4, 2]);
      } finally {
        delete (Array.prototype as any)[1];
      }
    });

    test("Reflect.construct with an array literal passes its arguments in order (8ae122a848)", () => {
      class Point {
        args: unknown[];
        target: unknown;
        constructor(...args: unknown[]) {
          this.args = args;
          this.target = new.target;
        }
      }
      class Derived extends Point {}
      const order: string[] = [];
      const note = <T>(label: string, value: T) => (order.push(label), value);
      const build = (newTarget?: Function) =>
        newTarget
          ? Reflect.construct(note("callee", Point), [note("a", 1), note("b", "two")], note("target", newTarget))
          : Reflect.construct(note("callee", Point), [note("a", 1), note("b", "two")]);
      for (let i = 0; i < 2000; i++) {
        const plain = build();
        expect(plain.args).toEqual([1, "two"]);
        expect(plain.target).toBe(Point);
        const derived = build(Derived);
        expect(derived.args).toEqual([1, "two"]);
        expect(derived.target).toBe(Derived);
        expect(Object.getPrototypeOf(derived)).toBe(Derived.prototype);
      }
      expect(order.slice(0, 7)).toEqual(["callee", "a", "b", "callee", "a", "b", "target"]);
      // The ordinary call still runs when the arguments are not valid for the fast path.
      expect(() => Reflect.construct((() => {}) as any, [1, 2])).toThrow(TypeError);
      expect(Reflect.construct(Array, [3]).length).toBe(3);
    });

    test("parseInt reads a short rope without changing the result (1df0dac22d)", () => {
      const rope = (...parts: string[]) => parts.reduce((left, right) => left + right);
      for (let i = 0; i < 2000; i++) {
        expect(parseInt(rope("12", "34", String(i % 10)))).toBe(12340 + (i % 10));
        expect(parseInt(rope("  0x", "f", "F"))).toBe(255);
        expect(parseInt(rope("7", "7"), 8)).toBe(63);
        expect(parseInt(rope("-", "1", "0", "px"))).toBe(-10);
        expect(parseInt(rope("", "x", "1"))).toBeNaN();
      }
      const ones = Buffer.alloc(40, "1").toString();
      const twos = Buffer.alloc(40, "2").toString();
      expect(parseInt(rope(ones, twos))).toBe(Number(ones + twos));
    });

    test("a stack that Error.captureStackTrace saves in another realm reads the same later (696c406fe5)", () => {
      // A node:vm context keeps JavaScriptCore's own Error.captureStackTrace, which now formats
      // the string when it is first read or when a collection finds a frame's code dead.
      const context = vm.createContext({});
      const capture = vm.runInContext(
        `(function capture(target) {
          Error.captureStackTrace(target);
          return target;
        })`,
        context,
        { filename: "capture-in-realm.js" },
      );
      const OtherError = vm.runInContext("Error", context);
      const error = capture(new OtherError("lazy"));
      const plain = capture({});
      Bun.gc(true);
      const stack = error.stack;
      expect(stack).toStartWith("capture@capture-in-realm.js:2:");
      expect(stack.split("\n").length).toBeGreaterThan(1);
      expect(error.stack).toBe(stack);
      expect(plain.stack).toStartWith("capture@capture-in-realm.js:2:");
      expect(Object.getOwnPropertyDescriptor(error, "stack")).toEqual({
        value: stack,
        writable: true,
        enumerable: false,
        configurable: true,
      });
      error.stack = "replaced";
      expect(error.stack).toBe("replaced");
      // A second capture replaces the first one.
      const twice = capture(capture(new OtherError("twice")));
      expect(twice.stack.match(/capture-in-realm\.js/g)!.length).toBe(1);
      // A capture by this realm's Error.captureStackTrace after one that the other realm saved:
      // the later one is what "stack" reads as, also for an error whose stack was read before.
      const recapture = (target: object) => (Error.captureStackTrace(target), target);
      const reused = new Error("reused");
      void reused.stack;
      delete (reused as any).stack;
      capture(reused);
      recapture(reused);
      expect(reused.stack!.split("\n").slice(0, 2)).toEqual([
        "Error: reused",
        expect.stringMatching(/^    at recapture \(.*webkit-upgrade-4611b64906\.test\.ts:\d+:\d+\)$/),
      ]);
      // A stack that is never read, on an error that dies, costs nothing and breaks nothing.
      for (let i = 0; i < 200; i++) capture(new OtherError("dropped " + i));
      Bun.gc(true);
      expect(capture(new OtherError("after")).stack).toStartWith("capture@capture-in-realm.js:2:");
    });

    test("positions of the same call sites are the same on every read (c59d70e267, 93ebfacfd7)", () => {
      const where = () => new Error("here").stack!.split("\n").slice(1, 3).join("|");
      const seen = new Set<string>();
      for (let i = 0; i < 500; i++) {
        seen.add(where());
        if (i === 250) Bun.gc(true);
      }
      expect(seen.size).toBe(1);
      const [frames] = seen;
      const [inner, outer] = frames.split("|");
      expect(inner).toMatch(/ at where \(.*webkit-upgrade-4611b64906\.test\.ts:\d+:31\)$/);
      expect(outer).toMatch(/webkit-upgrade-4611b64906\.test\.ts:\d+:18\)$/);
    });

    test("full and eden collections still finalize and keep what they must (c2fa192760 and the Collector series)", async () => {
      const registry = new FinalizationRegistry<string>(held => finalized.push(held));
      const finalized: string[] = [];
      const kept = { alive: true };
      const keptRef = new WeakRef(kept);
      let droppedRef: WeakRef<object>;
      (() => {
        const dropped = { payload: new Array(1000).fill(0) };
        droppedRef = new WeakRef(dropped);
        registry.register(dropped, "dropped");
        registry.register(kept, "kept");
      })();
      // WeakRef targets stay alive until the end of the current job.
      await new Promise(resolve => setImmediate(resolve));
      for (let i = 0; i < 20 && droppedRef!.deref() !== undefined; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(droppedRef!.deref()).toBeUndefined();
      for (let i = 0; i < 20 && finalized.length === 0; i++) {
        Bun.gc(true);
        await new Promise(resolve => setImmediate(resolve));
      }
      expect(finalized).toEqual(["dropped"]);
      expect(keptRef.deref()).toBe(kept);
    });

    // (module (memory 1) (func (export "load") (param i32) (result i32) local.get 0 i32.load))
    // prettier-ignore
    const loadModule = new Uint8Array([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
      0x01, 0x06, 0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f,
      0x03, 0x02, 0x01, 0x00,
      0x05, 0x03, 0x01, 0x00, 0x01,
      0x07, 0x08, 0x01, 0x04, 0x6c, 0x6f, 0x61, 0x64, 0x00, 0x00,
      0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x28, 0x02, 0x00, 0x0b,
    ]);

    test("an out-of-bounds Wasm load traps in every tier (653b77d5bd, 987be10500)", () => {
      const { load } = new WebAssembly.Instance(new WebAssembly.Module(loadModule)).exports as {
        load: (address: number) => number;
      };
      const trap = () => {
        try {
          load(65536);
        } catch (error) {
          return error;
        }
      };
      // The first call runs in the interpreter.
      expect(load(0)).toBe(0);
      expect(trap()).toBeInstanceOf(WebAssembly.RuntimeError);
      // Enough calls for the function to tier up, then the same access again.
      for (let i = 0; i < 20000; i++) load((i * 4) % 65532);
      expect(load(65532)).toBe(0);
      expect(trap()).toBeInstanceOf(WebAssembly.RuntimeError);
      expect(() => load(-1)).toThrow(WebAssembly.RuntimeError);
    });
  });
});
