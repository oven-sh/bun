import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, isLinux, isWindows, tempDir } from "harness";
import { AsyncLocalStorage } from "node:async_hooks";

// Coverage for the WebKit 0c44a1d1ab sync. The first case pins a rule of upstream that Bun turns off. The next four
// pin an observable difference between the old and the new JavaScriptCore. The others pin what had to stay the same in
// code that the sync rewrote and that Bun's fork changes: the shortcuts of await and of the promise combinators, the
// fast path of queueMicrotask(), unshift() of one element, for-in over objects whose names are not all enumerable
// strings, JSON.stringify() and JSON.parse(), Intl.ListFormat, array literals of constants, objects with several
// hundred properties, the searches of typed arrays, the helper threads of the collector and the compilers, and
// memory.fill and memory.copy of WebAssembly.

// What depends on the compiler runs in two children: one with the interpreter alone, one in which every tier of
// JavaScript and of WebAssembly compiles after a few calls, on the thread that asks.
const tiers = {
  interpreter: { BUN_JSC_useJIT: "0" },
  compilers: {
    BUN_JSC_useConcurrentJIT: "0",
    BUN_JSC_thresholdForJITAfterWarmUp: "10",
    BUN_JSC_thresholdForJITSoon: "10",
    BUN_JSC_thresholdForOptimizeAfterWarmUp: "50",
    BUN_JSC_thresholdForOptimizeSoon: "50",
    BUN_JSC_thresholdForFTLOptimizeAfterWarmUp: "300",
    BUN_JSC_thresholdForFTLOptimizeSoon: "300",
    BUN_JSC_thresholdForBBQOptimizeAfterWarmUp: "0",
    BUN_JSC_thresholdForBBQOptimizeSoon: "0",
    BUN_JSC_thresholdForOMGOptimizeAfterWarmUp: "50",
    BUN_JSC_thresholdForOMGOptimizeSoon: "50",
  },
};

async function runBody(body: string, env: Record<string, string>) {
  // new Function(): the body is sloppy code unless it says "use strict", as where the same body runs in this process.
  const source = `console.log(JSON.stringify(new Function(${JSON.stringify(body)})()));`;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", source],
    env: { ...bunEnv, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  return { result: stdout.trim() ? JSON.parse(stdout) : undefined, stderr, exitCode };
}

async function inEachTier(body: string) {
  const [interpreter, compilers] = await Promise.all([
    runBody(body, tiers.interpreter),
    runBody(body, tiers.compilers),
  ]);
  return { interpreter, compilers };
}

function inBothTiers(result: unknown) {
  const run = { result, stderr: "", exitCode: 0 };
  return { interpreter: run, compilers: run };
}

describe.concurrent("WebKit 0c44a1d1ab upgrade", () => {
  // The stage 3 proposal "nonextensible-applies-to-private" (b0be2f45a9): a private field, method or accessor is not
  // defined on an object that is not extensible. V8 has the rule behind --js-nonextensible-applies-to-private, which
  // is off in Node, so Bun has it off too: JSC::Options::useNonExtensibleAppliesToPrivate, which a variable turns on.
  test("an object that is not extensible takes a private name unless the rule is turned on", async () => {
    const body = `
      class Base { constructor(object) { return object; } }
      class Field extends Base { #x = 1; static has(object) { return #x in object; } }
      class Method extends Base { #m() {} static has(object) { return #m in object; } }
      class Accessor extends Base { get #a() { return 1; } static has(object) { return #a in object; } }
      const receivers = [
        ["frozen", () => Object.freeze({})],
        ["sealed", () => Object.seal({})],
        ["not extensible", () => Object.preventExtensions({})],
        ["frozen array", () => Object.freeze([1])],
        ["proxy of frozen", () => new Proxy(Object.freeze({}), {})],
        ["plain", () => ({})],
        ["proxy of plain", () => new Proxy({}, {})],
      ];
      const out = [];
      for (const [name, make] of receivers) {
        for (const Class of [Field, Method, Accessor]) {
          const object = make();
          let said = "defined";
          try { new Class(object); } catch (error) { said = error.constructor.name + ": " + error.message; }
          out.push([name, Class.name, said, Class.has(object)]);
        }
      }
      // With the rule the definition asks a proxy through its trap, once for each field and once for the brand of the methods.
      const log = [];
      const handler = { isExtensible(target) { log.push("isExtensible"); return Reflect.isExtensible(target); } };
      class Two extends Base { #a = 1; #b = 2; #m() {} }
      new Two(new Proxy({}, handler));
      // With the rule a field initializer that freezes the object stops the fields behind it.
      class Late { #early = "early"; #freeze = Object.freeze(this); #late = "late"; static has(object) { return #late in object; } }
      let late = "defined";
      try { late = String(Late.has(new Late())); } catch (error) { late = error.constructor.name; }
      // A frozen array keeps its elements read-only behind the definition.
      const array = Object.freeze([1, 2]);
      try { new Field(array); new Method(array); } catch {}
      const kept = [Object.isFrozen(array), Reflect.set(array, 0, 9), array.join()];
      return { out, traps: log.length, late, kept };
    `;
    const field = "TypeError: Attempting to define private field on object that is not extensible.";
    const method = "TypeError: Attempting to define private method on object that is not extensible.";
    const refused = (name: string) => [
      [name, "Field", field, false],
      [name, "Method", method, false],
      [name, "Accessor", method, false],
    ];
    const taken = (name: string) => [
      [name, "Field", "defined", true],
      [name, "Method", "defined", true],
      [name, "Accessor", "defined", true],
    ];
    const names = ["frozen", "sealed", "not extensible", "frozen array", "proxy of frozen", "plain", "proxy of plain"];
    // As in Node 26: every object takes the names, and no trap is asked.
    expect(new Function(body)()).toEqual({
      out: names.flatMap(taken),
      traps: 0,
      late: "true",
      kept: [true, false, "1,2"],
    });
    const withRule = await runBody(body, { BUN_JSC_useNonExtensibleAppliesToPrivate: "1" });
    expect(withRule).toEqual({
      result: {
        out: [...names.slice(0, 5).flatMap(refused), ...names.slice(5).flatMap(taken)],
        traps: 3,
        late: "TypeError",
        kept: [true, false, "1,2"],
      },
      stderr: "",
      exitCode: 0,
    });
  });

  // next() of an array iterator reads the index, then the length. A length getter that calls next() can finish the
  // iterator. The outer call then stored its index over the finished state (d94e8502e0), so the iterator went on.
  test("an array iterator that a nested next() finished stays finished", () => {
    let reads = 0;
    let iterator: IterableIterator<string>;
    const arrayLike = {
      0: "a",
      1: "b",
      get length() {
        reads++;
        if (reads === 1) {
          iterator.next();
          return 2;
        }
        return reads === 2 ? 0 : 2;
      },
    };
    iterator = Array.prototype.values.call(arrayLike);
    expect(iterator.next()).toEqual({ value: "a", done: false });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(iterator.next()).toEqual({ value: undefined, done: true });
    expect(reads).toBe(2);

    // A nested next() that does not finish the iterator moves it on, as before.
    let moves = 0;
    let moved: IterableIterator<string>;
    const longer = {
      0: "a",
      1: "b",
      2: "c",
      3: "d",
      get length() {
        if (++moves === 1) moved.next();
        return 4;
      },
    };
    moved = Array.prototype.values.call(longer);
    expect([moved.next().value, moved.next().value, moved.next().value, moved.next().done]).toEqual([
      "a",
      "b",
      "c",
      false,
    ]);
  });

  // indexOf(), lastIndexOf() and includes() of a Float16Array or Float32Array matched an int32 that the element type
  // cannot hold exactly (6de6cc3912), and those of an integer array could match a double outside the element type's
  // range (44751c8059).
  test("the searches of a typed array match no number that its elements cannot hold", () => {
    const run = new Function(`
      const out = [];
      const float32 = new Float32Array([16777216, 1, 16777216]);
      const float16 = new Float16Array([Infinity, 2048]);
      const clamped = new Uint8ClampedArray([1, 255]);
      const int8 = new Int8Array([1, -1]);
      for (let i = 0; i < 2000; i++) {
        out.length = 0;
        out.push(float32.indexOf(16777217), float32.lastIndexOf(16777217), float32.includes(16777217));
        out.push(float32.indexOf(16777216), float32.lastIndexOf(16777216), float32.includes(16777216));
        out.push(float16.indexOf(70000), float16.includes(70000), float16.indexOf(2049), float16.indexOf(2048));
        out.push(clamped.indexOf(257.0), clamped.indexOf(256), clamped.includes(1e10), clamped.indexOf(255));
        out.push(int8.indexOf(255), int8.indexOf(257), int8.lastIndexOf(-1), int8.includes(4294967295));
      }
      return out;
    `);
    expect(run()).toEqual([
      ...[-1, -1, false],
      ...[0, 2, true],
      ...[-1, false, -1, 1],
      ...[-1, -1, false, 1],
      ...[-1, -1, 1, false],
    ]);
  });

  // "delete o?.#x" was accepted and deleted the public property "#x" (2d7e066652).
  test("delete of a private name in an optional chain is a SyntaxError", () => {
    for (const body of ["delete o?.#x", "delete o?.y.#x", "delete o?.y?.#x", "delete (o?.#x)"]) {
      expect(() => new Function(`class A { #x; f(o) { return ${body}; } }`)).toThrow(SyntaxError);
    }
    // A public member of an optional chain is deleted as before.
    const run = new Function(
      `class A { #x; static f(o) { return [delete o?.y, delete o?.["#x"], "y" in o]; } } return A.f({ y: 1 });`,
    );
    expect(run()).toEqual([true, true, false]);
  });

  // new String(value) read newTarget.prototype before it converted the value (89467dc677).
  test("the String constructor converts its argument before it reads newTarget.prototype", () => {
    const log: string[] = [];
    const newTarget = new Proxy(function () {}, {
      get(target, key, receiver) {
        if (key === "prototype") log.push("prototype");
        return Reflect.get(target, key, receiver);
      },
    });
    const value = {
      toString() {
        log.push("toString");
        return "text";
      },
    };
    const made = Reflect.construct(String, [value], newTarget);
    expect(log).toEqual(["toString", "prototype"]);
    expect(String.prototype.valueOf.call(made)).toBe("text");
  });

  // await of a plain promise, the promise combinators and the promise jobs attach their reactions without a call of
  // then() (4d2fd0d353), and queueMicrotask() appends in place when the queue is already scheduled (abef915625).
  // Bun's async context travels with every one of these jobs.
  test("await, the promise combinators and queueMicrotask() keep the async context", async () => {
    const storage = new AsyncLocalStorage<string>();
    const seen: string[] = [];
    const note = (what: string) => seen.push(`${what}:${storage.getStore()}`);
    const thenable = (value: number) => ({
      then(resolve: (value: number) => void) {
        resolve(value);
      },
    });
    class Derived<T> extends Promise<T> {}

    async function work(tag: string) {
      await Promise.resolve(1);
      note(`${tag} plain`);
      await thenable(2);
      note(`${tag} thenable`);
      await 3;
      note(`${tag} value`);
      await Derived.resolve(4);
      note(`${tag} derived`);
      await Promise.all([Promise.resolve(1), thenable(2), 3]);
      note(`${tag} all`);
      await Promise.allSettled([Promise.reject(new Error("no")), Promise.resolve(1)]);
      note(`${tag} allSettled`);
      await Promise.any([Promise.reject(new Error("no")), Promise.resolve(1)]);
      note(`${tag} any`);
      await Promise.race([new Promise(() => {}), Promise.resolve(1)]);
      note(`${tag} race`);
      try {
        await Promise.reject(new Error("thrown"));
      } catch {
        note(`${tag} catch`);
      }
      await new Promise<void>(resolve => {
        // Several jobs in a row: the second and the later ones find the queue scheduled.
        queueMicrotask(() => note(`${tag} microtask 1`));
        queueMicrotask(() => note(`${tag} microtask 2`));
        queueMicrotask(() => {
          note(`${tag} microtask 3`);
          resolve();
        });
      });
      Promise.resolve(5).then(() => note(`${tag} then`));
      await Promise.resolve().finally(() => note(`${tag} finally`));
    }

    const tags = ["a", "b", "c"];
    await Promise.all(tags.map(tag => storage.run(tag, () => work(tag))));
    // A job queued outside of every run() has no store.
    await new Promise<void>(resolve =>
      queueMicrotask(() => {
        note("outside");
        resolve();
      }),
    );

    const steps = [
      ...["plain", "thenable", "value", "derived", "all", "allSettled", "any", "race", "catch"],
      ...["microtask 1", "microtask 2", "microtask 3", "then", "finally"],
    ];
    for (const tag of tags) {
      expect(seen.filter(line => line.startsWith(`${tag} `))).toEqual(steps.map(step => `${tag} ${step}:${tag}`));
    }
    expect(seen.at(-1)).toBe("outside:undefined");
  });

  // unshift() of one element moves the elements in place where the storage has room (293f970fc4). Bun's fork keeps
  // arrays that are frozen in place, and arrays that share the storage of their literal.
  test("unshift() of one element", async () => {
    const body = `
      "use strict";
      const out = [];
      function literal() { return [1, 2, 3]; }
      function prepend(array, value) { array.unshift(value); return array; }
      let hot;
      for (let i = 0; i < 1000; i++) {
        out.length = 0;
        const first = literal();
        first.unshift(0);
        out.push(first.join(), literal().join());
        const doubles = [1.5, 2.5];
        doubles.unshift(0.5);
        out.push(doubles.join());
        const holes = [1, , 3];
        holes.unshift(0);
        out.push(holes.length + " " + (2 in holes) + " " + holes.join());
        const cells = [{}, "s"];
        cells.unshift(null);
        out.push(cells.length + " " + String(cells[0]) + " " + typeof cells[1]);
        hot = prepend([1, 2, 3], i);
      }
      for (const lock of [Object.freeze, Object.seal, Object.preventExtensions]) {
        for (let i = 0; i < 400; i++) {
          const locked = lock([1, 2]);
          let said = "no error";
          try { prepend(locked, 0); } catch (error) { said = error.constructor.name; }
          if (i === 399) out.push(said + " " + locked.join());
        }
      }
      const grown = [];
      for (let i = 0; i < 5000; i++) grown.unshift(i);
      out.push(grown.length + " " + grown[0] + " " + grown[4999] + " " + grown.indexOf(2500));
      const typed = [];
      for (let i = 0; i < 100; i++) typed.unshift(i % 2 ? i + 0.5 : i);
      out.push(typed[0] + " " + typed[99] + " " + typed.length);
      out.push(hot.join());
      const empty = [];
      empty.unshift("only");
      out.push(empty.join() + " " + empty.length);
      return out;
    `;
    expect(await inEachTier(body)).toEqual(
      inBothTiers([
        "0,1,2,3",
        "1,2,3",
        "0.5,1.5,2.5",
        "4 false 0,1,,3",
        "3 null object",
        "TypeError 1,2",
        "TypeError 1,2",
        "TypeError 1,2",
        "5000 4999 0 2499",
        "99.5 0 100",
        "999,1,2,3",
        "only 1",
      ]),
    );
  });

  // for-in keeps its fast path over an object with a symbol key, a private field, an accessor, a property that is
  // not enumerable or a deleted property (7acbf94ea9). The names, "key in object", hasOwnProperty(key) and object[key]
  // stay what they were, also when the loop changes the object.
  test("for-in over objects whose properties are not all plain", async () => {
    const body = `
      const symbol = Symbol("s");
      class WithPrivate { #hidden = 1; a = 1; b = 2; }
      const own = Object.prototype.hasOwnProperty;
      function walk(object) {
        const seen = [];
        for (const key in object) seen.push(key + " " + (key in object) + " " + own.call(object, key) + " " + object[key]);
        return seen.join(", ");
      }
      function walkAndDelete(object, victim) {
        const seen = [];
        for (const key in object) { seen.push(key + " " + (key in object) + " " + object[key]); delete object[victim]; }
        return seen.join(", ");
      }
      const shapes = [
        () => ({ a: 1, [symbol]: 2, b: 3 }),
        () => new WithPrivate(),
        () => { const object = { a: 1, b: 2 }; Object.defineProperty(object, "hidden", { value: 4, enumerable: false }); object.c = 5; return object; },
        () => { const object = { a: 1, b: 2, c: 3 }; delete object.b; object.d = 6; return object; },
        () => ({ a: 1, get g() { return 7; }, z: 8 }),
        () => Object.create({ inherited: 9 }, { own: { value: 10, enumerable: true } }),
        () => { const object = { b: 1, a: 2 }; object[1] = "one"; object[0] = "zero"; return object; },
      ];
      const out = [];
      for (const make of shapes) {
        let last;
        for (let i = 0; i < 400; i++) last = walk(make());
        out.push(last);
      }
      let deleted;
      for (let i = 0; i < 400; i++) deleted = walkAndDelete({ a: 1, b: 2, c: 3, [symbol]: 4 }, "c");
      out.push(deleted);
      return out;
    `;
    expect(await inEachTier(body)).toEqual(
      inBothTiers([
        "a true true 1, b true true 3",
        "a true true 1, b true true 2",
        "a true true 1, b true true 2, c true true 5",
        "a true true 1, c true true 3, d true true 6",
        "a true true 1, g true true 7, z true true 8",
        "own true true 10, inherited true false 9",
        "0 true true zero, 1 true true one, b true true 1, a true true 2",
        "a true 1, b true 2",
      ]),
    );
  });

  // The fast path of JSON.stringify() writes the objects and arrays inside objects of one shape itself
  // (1c65e294a1), and copies the text of a string value that it wrote before (ee926d463f). A replacer that returns
  // every value as it is takes the general path.
  test("JSON.stringify writes nested values and repeated strings as the general path does", () => {
    const general = (value: unknown) => JSON.stringify(value, (_key, inner) => inner);
    const long = Buffer.alloc(300, "x").toString();
    const wide = "\u65e5\u672c" + long;
    const rows: unknown[] = [];
    for (let i = 0; i < 400; i++) {
      rows.push({
        id: i,
        name: long,
        wide: i % 7 ? wide : "\u3042",
        tag: i % 3 ? "plain" : 'quote " and \\ and \n',
        nested: { a: [], b: [i, { c: null }], d: {}, e: "\u00e9" + i, f: i % 5 ? undefined : 1 },
        list: [[], [1.5, -0, "s"], {}, [[[]]]],
        flag: i % 2 === 0,
        none: null,
      });
    }
    expect(JSON.stringify(rows)).toBe(general(rows));
    expect(JSON.stringify(rows, null, 2)).toBe(JSON.stringify(rows, (_key, inner) => inner, 2));

    // Values that the fast path cannot write: it gives up and the result is still the same.
    const odd: unknown[] = [];
    for (let i = 0; i < 50; i++) {
      odd.push({
        id: i,
        date: new Date(1e12 + i),
        big: { toJSON: () => `big ${i}` },
        fn: i % 2 ? () => 1 : undefined,
        sym: Symbol("s"),
        boxed: [new Number(i), new String("s"), new Boolean(false)],
        sparse: [, 1, , 2],
        proxy: new Proxy({ a: [i] }, {}),
      });
    }
    expect(JSON.stringify(odd)).toBe(general(odd));
    expect(JSON.stringify({ a: [], b: {}, c: [[]], d: [{}] })).toBe('{"a":[],"b":{},"c":[[]],"d":[{}]}');
  });

  // JSON.parse copies the plain stretches of a string with escapes in runs, and decodes one escape between two
  // runs (25d03d20cc). Bun.JSONL and Response.json() read strings through the same lexer.
  test("JSON.parse decodes strings with escapes at every place and width", async () => {
    const escapes: [string, string][] = [
      ["\\n", "\n"],
      ['\\"', '"'],
      ["\\\\", "\\"],
      ["\\/", "/"],
      ["\\t", "\t"],
      ["\\u0000", "\0"],
      ["\\u00e9", "\u00e9"],
      ["\\u3042", "\u3042"],
      ["\\ud83d\\ude00", "\u{1f600}"],
      ["\\ud83d", "\ud83d"],
    ];
    const wrong: string[] = [];
    const lengths = [0, 1, 2, 7, 8, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 300];
    for (const prefix of ["", "\u00e9", "\u3042"]) {
      for (const [text, decoded] of escapes) {
        for (const before of lengths) {
          for (const after of [0, 1, 16, 33]) {
            const head = Buffer.alloc(before, "a").toString();
            const tail = Buffer.alloc(after, "b").toString();
            const expected = prefix + head + decoded + tail + decoded;
            const source = `"${prefix}${head}${text}${tail}${text}"`;
            if (JSON.parse(source) !== expected) wrong.push(source);
            const inObject = JSON.parse(`{${source}:[${source}]}`);
            if (Object.keys(inObject)[0] !== expected || inObject[expected][0] !== expected) wrong.push(`{${source}}`);
          }
        }
      }
    }
    expect(wrong).toEqual([]);

    for (const bad of ['"a\\x"', '"a\\u12"', '"a\\u12g4"', '"a\\', '"a\\"', '"a\nb"', '"a\\u"']) {
      expect(() => JSON.parse(bad)).toThrow(SyntaxError);
    }

    const line = `{"k\\u00e9y":"v\\n${Buffer.alloc(100, "a").toString()}\\u3042"}`;
    const value = { "k\u00e9y": `v\n${Buffer.alloc(100, "a").toString()}\u3042` };
    expect(Bun.JSONL.parse(`${line}\n${line}\n`)).toEqual([value, value]);
    expect(await new Response(line).json()).toEqual(value);
  });

  // Intl.ListFormat formats through WTF::ListFormatter (e81b7ed3b0).
  test("Intl.ListFormat formats lists of every type and length", () => {
    const long = new Intl.ListFormat("en", { style: "long", type: "conjunction" });
    expect(long.format([])).toBe("");
    expect(long.format(["a"])).toBe("a");
    expect(long.format(["a", "b"])).toBe("a and b");
    expect(long.format(["a", "b", "c"])).toBe("a, b, and c");
    expect(new Intl.ListFormat("en", { type: "disjunction" }).format(["a", "b", "c"])).toBe("a, b, or c");
    expect(new Intl.ListFormat("en", { style: "narrow", type: "unit" }).format(["1", "2", "3"])).toBe("1 2 3");
    expect(new Intl.ListFormat("en", { style: "short", type: "unit" }).format(["1", "2", "3"])).toBe("1, 2, 3");
    expect(long.formatToParts(["a", "\u65e5\u672c", "c"])).toEqual([
      { type: "element", value: "a" },
      { type: "literal", value: ", " },
      { type: "element", value: "\u65e5\u672c" },
      { type: "literal", value: ", and " },
      { type: "element", value: "c" },
    ]);
    const many = Array.from({ length: 2000 }, (_, i) => `item${i}`);
    const formatted = long.format(many);
    expect(formatted.startsWith("item0, item1, ")).toBe(true);
    expect(formatted.endsWith(", item1998, and item1999")).toBe(true);
    expect(long.formatToParts(many).filter(part => part.type === "element").length).toBe(2000);
    expect(long.format(new Set(["x", "y"]))).toBe("x and y");
    expect(() => long.format(["a", 1 as unknown as string])).toThrow(TypeError);
  });

  // An array literal of numbers and null is kept as one vector of values (99a917a02f), and the strings of a
  // constant literal come from the table of atoms (a74d98710f). Each evaluation still makes an array of its own.
  test("array literals of constants make a new array each time", async () => {
    const body = `
      function numbers() { return [1, 2.5, null, -0, 4294967296, 1e21, 0x10, 1e-7, 0.1]; }
      function strings() { return ["a", "b", "a", "", "a string of more than one character"]; }
      function mixed() { return [1, "a", null, 2.5, true, undefined, [2, 3], { k: 4 }]; }
      function table() { return [${Array.from({ length: 3000 }, (_, i) => (i % 5 === 4 ? "null" : i % 2 ? `${i}.5` : `${i}`)).join(", ")}]; }
      const out = {};
      let last;
      let kept;
      let again;
      for (let i = 0; i < 400; i++) {
        const first = numbers();
        first[0] = "changed";
        first.push(9);
        last = numbers();
        const changed = strings();
        changed[0] = "changed";
        changed.length = 1;
        kept = strings();
        out.mixed = mixed().map(value => typeof value).join();
        out.inner = mixed()[6] !== mixed()[6];
        const big = table();
        big[0] = -1;
        again = table();
      }
      out.numbers = last.map(String).join("|");
      out.negativeZero = Object.is(last[3], -0);
      out.strings = kept.join("|");
      out.sameString = kept[0] === kept[2];
      out.table = [again.length, again[0], again[1], again[4], again[2999], again.reduce((sum, value) => sum + (value ?? 0), 0)];
      return out;
    `;
    const sum = Array.from({ length: 3000 }, (_, i) => (i % 5 === 4 ? 0 : i % 2 ? i + 0.5 : i)).reduce(
      (a, b) => a + b,
      0,
    );
    expect(await inEachTier(body)).toEqual(
      inBothTiers({
        mixed: "number,string,object,number,boolean,undefined,object,object",
        inner: true,
        numbers: "1|2.5|null|0|4294967296|1e+21|16|1e-7|0.1",
        negativeZero: true,
        strings: "a|b|a||a string of more than one character",
        sameString: true,
        table: [3000, 0, 1.5, null, null, sum],
      }),
    );
  });

  // An object that grew past 128 properties through stores by name keeps its shape on a store by key (fcbbc8e862),
  // and a prototype may be made a plain object again a few times (fbf0af895c, 28df7fa3c5). The counters for both
  // are new fields of Structure, beside the ones that Bun's fork added.
  test("objects with several hundred properties keep every one of them", async () => {
    const body = `
      const names = Array.from({ length: 300 }, (_, i) => "p" + i);
      const fill = new Function("object", names.map((name, i) => "object." + name + " = " + i + ";").join("\\n") + "\\nreturn object;");
      const out = [];
      for (let round = 0; round < 60; round++) {
        const object = fill({});
        for (let i = 0; i < 150; i++) object["k" + i] = i;
        let sum = 0;
        for (const key in object) sum += object[key];
        delete object.p7;
        delete object.k7;
        object.p7 = "again";
        out.length = 0;
        out.push(Object.keys(object).length, sum, object.p299, object.k149, object.p7, Object.keys(object).at(-1));
        const frozen = Object.freeze(fill({}));
        out.push(Object.isFrozen(frozen), frozen.p150, Reflect.set(frozen, "p150", 0), frozen.p150);
      }
      // A prototype that is read while it is filled, and filled again after it was used.
      function Shape() {}
      const reads = [];
      for (let round = 0; round < 6; round++) {
        for (let i = 0; i < 40; i++) Shape.prototype["m" + round + "_" + i] = i + round;
        const instance = new Shape();
        let total = 0;
        for (let i = 0; i < 2000; i++) total += instance["m" + round + "_" + (i % 40)];
        for (let i = 0; i < 40; i += 2) delete Shape.prototype["m" + round + "_" + i];
        reads.push(total, instance["m" + round + "_1"], instance["m" + round + "_0"]);
      }
      out.push(reads.join());
      return out;
    `;
    const sum = (300 * 299) / 2 + (150 * 149) / 2;
    const reads = Array.from({ length: 6 }, (_, round) => [50 * (780 + 40 * round), 1 + round, undefined]);
    expect(await inEachTier(body)).toEqual(
      inBothTiers([449, sum, 299, 149, "again", "p7", true, 150, false, 150, reads.flat().join()]),
    );
  });

  // indexOf(), lastIndexOf() and includes() of a byte array over a SharedArrayBuffer read one element at a time
  // (2b0d3c0d81). For an array that is not shared Bun reads a hit again (the next case says why).
  test("byte arrays find a value at every place and length", () => {
    const wrong: string[] = [];
    for (const shared of [false, true]) {
      for (const Type of [Uint8Array, Int8Array, Uint8ClampedArray]) {
        for (const length of [1, 2, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 200]) {
          const buffer = shared ? new SharedArrayBuffer(length + 3) : new ArrayBuffer(length + 3);
          const array = new Type(buffer, 3, length);
          array.fill(1);
          for (const place of new Set(
            [0, 1, length >> 1, length - 2, length - 1].filter(index => index >= 0 && index < length),
          )) {
            array[place] = 7;
            const found = [array.indexOf(7), array.lastIndexOf(7), array.includes(7), array.indexOf(7, place + 1)];
            if (found.join() !== `${place},${place},true,-1`)
              wrong.push(`${Type.name} ${shared} ${length} ${place}: ${found}`);
            array[place] = 1;
          }
          const missing = [
            array.indexOf(7),
            array.lastIndexOf(7),
            array.includes(7),
            array.indexOf(1),
            array.lastIndexOf(1),
          ];
          if (missing.join() !== `-1,-1,false,0,${length - 1}`)
            wrong.push(`${Type.name} ${shared} ${length}: ${missing}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  // The memchr() of some C libraries can answer a place that never held the value when another thread clears the
  // bytes meanwhile. Upstream searches a shared array without it (2b0d3c0d81). A pending fs.read() of Bun writes an
  // array that is not shared, so Bun reads a hit again. The searched bytes are the end of a buffer that one read
  // fills from its start: the search runs while they change. The variable makes glibc choose the memchr() that fails.
  test.skipIf(isWindows)(
    "indexOf() of a byte array answers no place that a pending fs.read() has cleared",
    async () => {
      const rounds = isDebug || isASAN ? 300 : 3000;
      const source = `
      const fs = require("fs");
      const fd = fs.openSync("/dev/zero", "r");
      const whole = new Uint8Array(1 << 20);
      const array = new Uint8Array(whole.buffer, whole.length - 4096, 4096);
      (async () => {
        let wrong = -1, round = 0;
        for (; round < ${rounds} && wrong < 0; round++) {
          array[570] = 1;
          const { promise, resolve } = Promise.withResolvers();
          fs.read(fd, whole, 0, whole.length, 0, resolve);
          for (let at; (at = array.indexOf(1)) !== -1;) if (at !== 570) wrong = at;
          await promise;
        }
        fs.closeSync(fd);
        console.log(JSON.stringify({ rounds: round, wrong }));
      })();
    `;
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", source],
        env: { ...bunEnv, GLIBC_TUNABLES: "glibc.cpu.hwcaps=-AVX2,-AVX2_Usable,-BMI2" },
        stdout: "pipe",
        stderr: "pipe",
      });
      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
      expect({ stdout: stdout.trim(), stderr }).toEqual({ stdout: JSON.stringify({ rounds, wrong: -1 }), stderr: "" });
      expect(exitCode).toBe(0);
    },
  );

  // Math.sign is an intrinsic of the DFG and the FTL (9ee75c0dc5); f.apply(this, undefined) of an inlined callee
  // fills the parameters in line (9cef4f44bb); a call of a function that the same code bound goes to the target
  // (a90c65c133); flat() copies arrays of numbers at once (3ddef4709a); and a number that is an integer is made a
  // string by the cache of integers (c27a5c2a2b).
  test("number and call shortcuts of the optimizing compilers give what the interpreter gives", async () => {
    const body = `
      const values = [3, -3, 0, -0, 2.5, -2.5, NaN, Infinity, -Infinity, "4", "-4", "x", null, undefined, true, { valueOf() { return -9; } }, [], [5]];
      function signs() { const out = []; for (const value of values) out.push(Math.sign(value)); return out; }
      function callee(a, b) { return [String(a), String(b), arguments.length, typeof this + " " + this]; }
      function applies(receiver) { return [callee.apply(receiver, undefined), callee.apply(receiver, null), callee.apply(receiver, [1]), callee.apply(receiver, [1, 2, 3])]; }
      function binds(receiver) { "use strict"; const bound = callee.bind(receiver); const twice = bound.bind("ignored"); return [bound(1, 2), twice(3)]; }
      function flats() { return [[[1, 2], [3, [4, [5]]]].flat(Infinity), [1, 2, 3].flat(), [1.5, NaN, -0].flat(2), [1, , 3].flat(), [[1.5], [2, , 3]].flat()]; }
      function strings() { return [String(1024.0), (2047.0).toString(), String(-0), String(2147483648), String(-2147483649), String(1e21), String(0.1 + 0.2), (255).toString(16), String(1.0)]; }
      let out;
      for (let i = 0; i < 400; i++) out = { signs: signs(), applies: applies("r"), binds: binds("r"), flats: flats(), strings: strings() };
      out.negativeZeros = [Object.is(out.signs[3], -0), Object.is(out.flats[2][2], -0)];
      out.signs = out.signs.map(String);
      out.flats = out.flats.map(array => array.length + ":" + array.join());
      return out;
    `;
    expect(await inEachTier(body)).toEqual(
      inBothTiers({
        signs: ["1", "-1", "0", "0", "1", "-1", "NaN", "1", "-1", "1", "-1", "NaN", "0", "NaN", "1", "-1", "0", "1"],
        applies: [
          ["undefined", "undefined", 0, "object r"],
          ["undefined", "undefined", 0, "object r"],
          ["1", "undefined", 1, "object r"],
          ["1", "2", 3, "object r"],
        ],
        binds: [
          ["1", "2", 2, "object r"],
          ["3", "undefined", 1, "object r"],
        ],
        flats: ["5:1,2,3,4,5", "3:1,2,3", "3:1.5,NaN,0", "2:1,3", "3:1.5,2,3"],
        strings: ["1024", "2047", "0", "2147483648", "-2147483649", "1e+21", "0.30000000000000004", "ff", "1"],
        negativeZeros: [true, true],
      }),
    );
  });

  // Upstream runs the marking helpers of the collector, the JIT compilers and the WebAssembly compilers on one pool
  // of threads (a3610f18d8, on by default since 5dec6bc395). Bun keeps threads of their own for each, and a variable
  // turns the pool on. The names of the threads say which arrangement runs. Both collect and compile in the main
  // thread and in workers, and end the process when the work is done.
  test.each([
    ["threads of their own", {}],
    ["the shared pool", { BUN_JSC_useSharedHelperThreadPool: "1" }],
  ])("collections and compiles beside workers on %s", async (arrangement, env) => {
    const source = `
      const { Worker, isMainThread, parentPort } = require("node:worker_threads");
      const { readdirSync, readFileSync } = require("node:fs");
      function work(rounds) {
        let kept = [];
        let sum = 0;
        for (let round = 0; round < rounds; round++) {
          const made = [];
          for (let i = 0; i < 2000; i++) made.push({ i, text: "t" + i, list: [i, i + 0.5] });
          kept = made.filter(item => item.i % 64 === 0);
          for (const item of made) sum += item.list[1] - item.i;
          Bun.gc(round % 2 === 0);
        }
        const bytes = new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 7, 1, 96, 2, 127, 127, 1, 127, 3, 2, 1, 0, 7, 7, 1, 3, 97, 100, 100, 0, 0, 10, 9, 1, 7, 0, 32, 0, 32, 1, 106, 11]);
        const add = new WebAssembly.Instance(new WebAssembly.Module(bytes)).exports.add;
        for (let i = 0; i < 20000; i++) sum += add(i, 1) - i - 1;
        return sum + kept.length;
      }
      function threadNames() {
        const names = new Set();
        for (const id of readdirSync("/proc/self/task")) {
          try { names.add(readFileSync("/proc/self/task/" + id + "/comm", "utf8").trim()); } catch {}
        }
        return names;
      }
      if (isMainThread) {
        const workers = [0, 1].map(() => new Worker(__filename));
        const answers = workers.map(worker => new Promise((resolve, reject) => { worker.once("message", resolve); worker.once("error", reject); }));
        const own = work(4);
        Promise.all(answers).then(async all => {
          const names = ${isLinux} ? threadNames() : new Set();
          await Promise.all(workers.map(worker => worker.terminate()));
          console.log(JSON.stringify({ answers: [own, ...all], sharedPool: names.has("HelperThread"), ownThreads: names.has("HeapHelper") || names.has("JITWorker") }));
        });
      } else {
        parentPort.postMessage(work(4));
      }
    `;
    using dir = tempDir("webkit-upgrade-helper-threads", { "main.cjs": source });
    await using proc = Bun.spawn({
      cmd: [bunExe(), "main.cjs"],
      env: { ...bunEnv, ...env },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    const answer = 4 * 2000 * 0.5 + 32;
    const usesPool = arrangement === "the shared pool";
    expect({ stdout: stdout.trim(), stderr: stderr.trim() }).toEqual({
      stdout: JSON.stringify({
        answers: [answer, answer, answer],
        sharedPool: isLinux && usesPool,
        ownThreads: isLinux && !usesPool,
      }),
      stderr: "",
    });
    expect(exitCode).toBe(0);
  });

  // B3 has a MemoryFill for each width of value, and lowers fills and moves by itself (8d8fd0bb8c, 3b07118688).
  // memory.fill and memory.copy of WebAssembly, and fill() of arrays in compiled JavaScript, use them.
  test("memory.fill, memory.copy and fill() of typed arrays write every byte and no other", async () => {
    // (module (memory (export "memory") 1)
    //   (func (export "fill") (param i32 i32 i32) local.get 0 local.get 1 local.get 2 memory.fill)
    //   (func (export "copy") (param i32 i32 i32) local.get 0 local.get 1 local.get 2 memory.copy))
    const bytes = [
      ...[0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00],
      ...[0x01, 0x07, 0x01, 0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x00],
      ...[0x03, 0x03, 0x02, 0x00, 0x00],
      ...[0x05, 0x03, 0x01, 0x00, 0x01],
      ...[0x07, 0x18, 0x03, 0x06, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x02, 0x00],
      ...[0x04, 0x66, 0x69, 0x6c, 0x6c, 0x00, 0x00, 0x04, 0x63, 0x6f, 0x70, 0x79, 0x00, 0x01],
      ...[0x0a, 0x1a, 0x02],
      ...[0x0b, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0xfc, 0x0b, 0x00, 0x0b],
      ...[0x0c, 0x00, 0x20, 0x00, 0x20, 0x01, 0x20, 0x02, 0xfc, 0x0a, 0x00, 0x00, 0x0b],
    ];
    const body = `
      const { memory, fill, copy } = new WebAssembly.Instance(new WebAssembly.Module(new Uint8Array(${JSON.stringify(bytes)}))).exports;
      const view = new Uint8Array(memory.buffer);
      const wrong = [];
      const sizes = [0, 1, 2, 3, 4, 7, 8, 9, 15, 16, 17, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000, 4097];
      for (let round = 0; round < 300; round++) {
        const size = sizes[round % sizes.length];
        const at = 64 + (round % 9);
        view.fill(0, 0, 8192);
        fill(at, 0x100 + round, size);
        const value = round & 0xff;
        if (view[at - 1] !== 0 || view[at + size] !== 0) wrong.push("fill " + size + " wrote outside");
        for (let i = 0; i < size; i++) {
          if (view[at + i] !== value) { wrong.push("fill " + size + " at " + i); break; }
        }
        for (let i = 0; i < size; i++) view[at + i] = (i * 7 + round) & 0xff;
        copy(at + 3, at, size);
        for (let i = 0; i < size; i++) {
          if (view[at + 3 + i] !== ((i * 7 + round) & 0xff)) { wrong.push("copy " + size + " at " + i); break; }
        }
      }
      const traps = [];
      for (const run of [() => fill(65536 - 4, 1, 8), () => copy(0, 65536 - 4, 8)]) {
        try { run(); traps.push("no trap"); } catch (error) { traps.push(error instanceof WebAssembly.RuntimeError); }
      }

      const arrays = [new Uint8Array(67), new Uint16Array(67), new Uint32Array(67), new Float64Array(67), new BigUint64Array(67)];
      function fillAll(value, start, end) { for (const array of arrays) array.fill(typeof array[0] === "bigint" ? BigInt(value) : value, start, end); }
      for (let round = 0; round < 400; round++) {
        const start = round % 5, end = 67 - (round % 7), value = (round % 250) + 1;
        fillAll(0, 0, 67);
        fillAll(value, start, end);
        for (const array of arrays) {
          for (let i = 0; i < 67; i++) {
            const expected = i >= start && i < end ? value : 0;
            if (Number(array[i]) !== expected) { wrong.push(array.constructor.name + " " + round + " " + i); break; }
          }
        }
      }
      return { wrong, traps };
    `;
    expect(await inEachTier(body)).toEqual(inBothTiers({ wrong: [], traps: [true, true] }));
  });
});
