import { edenGC, fullGC } from "bun:jsc";
import { describe, expect, test } from "bun:test";
import { isASAN, isDebug } from "harness";
import vm from "node:vm";

// Coverage for the WebKit 7b485a76e9 sync. The first group pins observable differences
// between the old and the new JavaScriptCore. The second group runs code the range rewrote
// (source positions from offsets, the Reflect.construct call site, WeakBlock, WeakGCMap, the
// B3 lowering of a negated multiply, the BigInt multiply and divide loops) and checks that
// results hold.

describe("WebKit 7b485a76e9 upgrade", () => {
  test("BigInt() needs a digit after a sign or a radix prefix (a89c41295f)", () => {
    for (const text of ["-", "+", " - ", "0x", "0x ", "0b", "0o"]) {
      expect(() => BigInt(text)).toThrow(SyntaxError);
    }
    expect(0n == ("-" as any)).toBe(false);
    expect(BigInt("")).toBe(0n);
    expect(BigInt(" -12 ")).toBe(-12n);
    expect(BigInt("0x1f")).toBe(31n);
  });

  test("Error.stackTraceLimit is read from the Error constructor when a stack is captured (a5bfdb3aaf)", () => {
    const depth = () => {
      const recurse = (n: number): number => (n ? recurse(n - 1) + 0 : new Error("x").stack!.split("\n").length - 1);
      return recurse(30);
    };
    const descriptor = Object.getOwnPropertyDescriptor(Error, "stackTraceLimit")!;
    try {
      // Node's default.
      expect(descriptor.value).toBe(10);
      expect(depth()).toBe(10);
      // A write that does not go through a put on the constructor.
      Object.defineProperty(Error, "stackTraceLimit", { ...descriptor, value: 3 });
      expect(depth()).toBe(3);
      // Only the Error constructor's own property counts, as in V8.
      (TypeError as any).stackTraceLimit = 1;
      expect(depth()).toBe(3);
      Error.stackTraceLimit = NaN;
      expect(new Error("x").stack).toBeUndefined();
    } finally {
      delete (TypeError as any).stackTraceLimit;
      Object.defineProperty(Error, "stackTraceLimit", descriptor);
    }
    // Every realm starts from the same default.
    expect(vm.runInNewContext("Error.stackTraceLimit")).toBe(10);
    expect(new ShadowRealm().evaluate("Error.stackTraceLimit")).toBe(10);
  });

  test("a parenthesized assignment target does not name an anonymous function (a848db6782)", () => {
    // Through the Function constructor, because Bun's printer drops the parentheses.
    const names = new Function(`
      let a, b, c, d;
      (a) = function () {};
      (b) = () => {};
      (c) = class {};
      d = function () {};
      return [a.name, b.name, c.name, d.name];
    `)();
    expect(names).toEqual(["", "", "", "d"]);
  });

  test("Intl.DurationFormat shows minutes and seconds after a numeric unit (9aea44e083)", () => {
    const format = new Intl.DurationFormat("en", { hours: "numeric" });
    expect(format.format({ hours: 1 })).toBe("1:00:00");
    expect(format.resolvedOptions()).toMatchObject({ minutesDisplay: "always", secondsDisplay: "always" });
  });

  test("Intl.DateTimeFormat does not report dayPeriod for the AM/PM marker (c5c46669ba)", () => {
    const format = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" });
    expect(format.resolvedOptions().dayPeriod).toBeUndefined();
    expect(format.formatToParts(new Date(Date.UTC(2026, 0, 1, 10, 5))).map(part => part.type)).toContain("dayPeriod");
    expect(
      new Intl.DateTimeFormat("en-US", { hour: "numeric", dayPeriod: "long", timeZone: "UTC" }).resolvedOptions()
        .dayPeriod,
    ).toBe("long");
  });

  test("a named back reference in a lookbehind sees the group that was opened last (ae0a88e6c1)", () => {
    expect(/(?<n>.)..(?<=\k<n>.)/.exec("abc")).toBeNull();
    expect(/(?<n>.)..(?<=\k<n>.)/.exec("aac")?.[0]).toBe("aac");
    expect(/(?<n>.)(?<=\k<n>\k<n>)x/.exec("abx")).toBeNull();
    expect(/(?<n>.)(?<=\k<n>\k<n>)x/.exec("bbx")?.index).toBe(1);
  });

  test("ArrayBuffer.prototype.slice reads the species of a buffer from another realm (da75c48c45)", () => {
    const other = vm.runInNewContext("({ buffer: new ArrayBuffer(16), ArrayBuffer })");
    const slice = ArrayBuffer.prototype.slice.call(other.buffer, 0, 8);
    expect(slice.constructor).toBe(other.ArrayBuffer);
    expect(slice.byteLength).toBe(8);
    expect(new ArrayBuffer(16).slice(4).constructor).toBe(ArrayBuffer);
  });

  test("a strict arguments object with a length over 2**32 does not wrap in apply (a0e2a50e76)", () => {
    function count() {
      return arguments.length;
    }
    // Module code is strict, so this `arguments` object is the strict kind. A sloppy one still wraps.
    function makeArguments(..._: unknown[]) {
      arguments.length = 2 ** 32 + 1;
      return arguments;
    }
    expect(Object.getOwnPropertyDescriptor(makeArguments(), "callee")?.get).toBeFunction();
    expect(() => count.apply(null, makeArguments(1, 2) as any)).toThrow(RangeError);
    expect(() => Reflect.apply(count, null, makeArguments(1, 2))).toThrow(RangeError);
    expect(count.apply(null, [1, 2] as any)).toBe(2);
  });

  test("ArrayBuffer.prototype.resize range-checks the length before the detached check (223bd0faee)", () => {
    const detached = new ArrayBuffer(8, { maxByteLength: 16 });
    detached.transfer();
    expect(() => detached.resize(-1)).toThrow(RangeError);
    expect(() => detached.resize(2 ** 53)).toThrow(RangeError);
    // A length that passes ToIndex still reaches the detached check.
    expect(() => detached.resize(8)).toThrow(TypeError);

    const buffer = new ArrayBuffer(8, { maxByteLength: 16 });
    expect(() => buffer.resize(1e20)).toThrow(RangeError);
    expect(() => buffer.resize(Infinity)).toThrow(RangeError);
    expect(() => buffer.resize(-1)).toThrow(RangeError);
    buffer.resize(16);
    expect(buffer.byteLength).toBe(16);

    const shared = new SharedArrayBuffer(8, { maxByteLength: 16 });
    expect(() => shared.grow(1e20)).toThrow(RangeError);
    expect(() => shared.grow(2 ** 53)).toThrow(RangeError);
    expect(() => shared.grow(-1)).toThrow(RangeError);
    shared.grow(16);
    expect(shared.byteLength).toBe(16);
  });

  test("stack positions derived from source offsets match the source (c76c52f5b1)", () => {
    // No line or column is stored any more. The line table of the source gives them back.
    const source = [
      "function outer() {", // line 1
      "  const text = `a", //  line 2: a template literal that spans lines
      "b`;",
      "  return inner(text);", // line 4
      "}",
      "const inner = t => { throw new Error(t); };", // line 6
      "outer();", // line 7
    ].join("\n");
    let stack = "";
    try {
      // A new context, so that `outer` and `inner` do not stay in this realm's global scope.
      new vm.Script(source, { filename: "positions.js" }).runInNewContext();
    } catch (e) {
      stack = (e as Error).stack!;
    }
    const frames = [...stack.matchAll(/positions\.js:(\d+):(\d+)/g)].map(m => [Number(m[1]), Number(m[2])]);
    expect(frames).toEqual([
      [6, 37],
      [4, 15],
      [7, 6],
    ]);

    // lineOffset and columnOffset move the first line. columnOffset does not move later lines.
    const offsetFrames = (code: string) => {
      try {
        new vm.Script(code, { filename: "offset.js", lineOffset: 10, columnOffset: 5 }).runInThisContext();
      } catch (e) {
        return [...(e as Error).stack!.matchAll(/offset\.js:(\d+):(\d+)/g)]
          .map(m => [Number(m[1]), Number(m[2])])
          .at(-1);
      }
    };
    expect(offsetFrames("throw new Error('first line')")).toEqual([11, 21]);
    expect(offsetFrames("\nthrow new Error('second line')")).toEqual([12, 16]);
  });

  test("an error from a class field initializer is reported where the constructor starts (c76c52f5b1)", () => {
    // The constructor calls the initializer before its first statement. With offsets only, upstream
    // reports that call where the constructor ends.
    const source = [
      "const config = null;",
      "class Client {",
      "  endpoint = config.url;", //   line 3: throws
      "  constructor(retries) {", //   line 4: the frame of the constructor, at the parenthesis
      "    this.retries = retries;",
      "    this.ready = true;", //     line 6: the last statement
      "  }",
      "}",
      "new Client(3);",
    ].join("\n");
    let stack = "";
    try {
      new vm.Script(source, { filename: "fields.js" }).runInNewContext();
    } catch (e) {
      stack = (e as Error).stack!;
    }
    // A debug build also shows the frame of the initializer, so look for the constructor by name.
    const frame = /at new Client \(fields\.js:(\d+):(\d+)\)/.exec(stack);
    expect(frame?.slice(1).map(Number)).toEqual([4, 14]);
  });

  test("a source knows where its lines start once it is parsed (c76c52f5b1)", () => {
    // Not at the top of the file: a build without it would run none of the other tests.
    const { sourceHasLineStarts } = require("bun:internal-for-testing");
    // Upstream reads the whole source again the first time a position in it is asked for. Nothing has asked for one
    // in these.
    const long = `/* ${Buffer.alloc(1024, "x")} */\n`;
    expect(sourceHasLineStarts((0, eval)(long + "(function () {\n})"))).toBe(true);
    expect(sourceHasLineStarts(vm.runInThisContext(long + "(function () {\n})"))).toBe(true);
    expect(sourceHasLineStarts(new vm.Script(long + "(function () {\n})").runInNewContext())).toBe(true);
    // That is not worth its cost to a short source, which is read if it is asked.
    const short = (0, eval)("(function () {\n  return new Error().stack;\n})");
    expect(sourceHasLineStarts(short)).toBe(false);
    expect(short()).toContain(":2:19");
    expect(sourceHasLineStarts(short)).toBe(true);
    // The builtins of the engine share one text, which is never parsed as a whole and needs no table.
    expect(sourceHasLineStarts(Array.prototype.map)).toBe(false);
  });

  test.each([
    ["8 bit", ["\n", "\r", "\r\n"]],
    ["16 bit", ["\n", "\r", "\r\n", "\u2028", "\u2029"]],
  ])("positions in a %s source with lines of every length, from a parse and from bytecode (c76c52f5b1)", (_, ends) => {
    // The table of line starts has the length of a line as a LEB128, and a start for every 64 lines.
    let state = 7919;
    const random = (n: number) => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) % n;
    const lengths = [0, 1, 2, 126, 127, 128, 129, 16382, 16383, 16384, 16385];
    const fill = (count: number, character: string) => Buffer.alloc(count, character).toString();
    let text = "var probes = [];";
    const marks: string[] = [];
    for (let i = 0; i < 64 * 5 + 3; i++) {
      const end = ends[random(ends.length)];
      const length = Math.max(0, (i % 5 ? random(300) : lengths[(i / 5) % lengths.length]) - end.length);
      const probe = `probes.push(function(){return new Error("p${i}").stack});`;
      if (length >= probe.length && (i % 3 === 1 || i % 64 <= 1 || i % 64 === 63 || i % 5 === 1)) {
        const before = random(length - probe.length + 1);
        text += fill(before, " ") + probe + fill(length - probe.length - before, " ") + end;
        marks.push(`("p${i}")`);
      } else text += (length >= 4 ? "/*" + fill(length - 4, "c") + "*/" : fill(length, " ")) + end;
    }
    text += "probes";
    const counted = marks.map(mark => {
      const lines = text.slice(0, text.indexOf(mark)).split(/\r\n|[\n\r\u2028\u2029]/);
      return `${lines.length}:${lines.at(-1)!.length + 1}`;
    });
    expect(counted.length).toBeGreaterThan(100);

    const positions = (probes: (() => string)[], filename: string) =>
      probes.map(
        probe =>
          /:(\d+:\d+)\)?$/.exec(
            probe()
              .split("\n")
              .find(line => line.includes(filename))!,
          )?.[1],
      );
    // A new context, so that `probes` does not stay in this realm's global scope.
    const parsed = new vm.Script(text, { filename: "parsed-lines.js" }).runInNewContext();
    expect(positions(parsed, "parsed-lines.js")).toEqual(counted);

    const producer = new vm.Script(text, { filename: "cached-lines.js", produceCachedData: true });
    const consumer = new vm.Script(text, { filename: "cached-lines.js", cachedData: producer.cachedData });
    expect(consumer.cachedDataRejected).toBe(false);
    expect(positions(consumer.runInNewContext(), "cached-lines.js")).toEqual(counted);
  });

  test("a position in a builtin counts from where the builtin starts (c76c52f5b1)", () => {
    // The builtins share one text. With offsets only, upstream reports the line in that text, which is in the
    // thousands. A release build has no positions for the code of a builtin, so a frame is where the builtin starts.
    const inBuiltin = (stack: string, name: string) =>
      new RegExp(`at ${name} \\(native:(\\d+):(\\d+)\\)`).exec(stack)?.slice(1).map(Number);
    const expectCountedFromTheBuiltin = (position: number[] | undefined) => {
      if (isDebug || isASAN) expect(position?.[0]).toBeLessThan(100);
      else expect(position).toEqual([1, 11]);
    };

    let stack = "";
    try {
      [1].map(() => {
        throw new Error("x");
      });
    } catch (e) {
      stack = (e as Error).stack!;
    }
    expectCountedFromTheBuiltin(inBuiltin(stack, "map"));

    let thrownInside: any;
    try {
      [].reduce(() => {});
    } catch (e) {
      thrownInside = e;
    }
    expectCountedFromTheBuiltin(inBuiltin(thrownInside.stack, "reduce"));
    expect([thrownInside.line, thrownInside.column]).toEqual(inBuiltin(thrownInside.stack, "reduce")!);
  });

  test("Reflect.construct call sites keep the semantics of the function (7b485a76e9)", () => {
    class Base {
      target: unknown;
      args: unknown[];
      constructor(...args: unknown[]) {
        this.target = new.target;
        this.args = args;
      }
    }
    class Other {}
    let failures: string[] = [];
    for (let i = 0; i < 5e3; ++i) {
      const plain = Reflect.construct(Base, [1, 2, 3]);
      const withTarget = Reflect.construct(Base, [i], Other);
      const arrayLike = Reflect.construct(Base, { length: 2, 0: "a", 1: "b" } as any);
      if (plain.target !== Base || plain.args.length !== 3) failures.push("plain");
      if (withTarget.target !== Other || !(withTarget instanceof Other) || withTarget.args[0] !== i)
        failures.push("newTarget");
      if (arrayLike.args.join() !== "a,b") failures.push("array-like");
      if (failures.length) break;
    }
    expect(failures).toEqual([]);
    expect(() => Reflect.construct(Base, null as any)).toThrow(TypeError);
    expect(() => Reflect.construct(Base, [], (() => {}) as any)).toThrow(TypeError);
    expect(() => Reflect.construct((() => {}) as any, [])).toThrow(TypeError);
    // A replaced Reflect.construct is an ordinary call.
    const original = Reflect.construct;
    try {
      Reflect.construct = (() => "replaced") as any;
      expect(Reflect.construct(Base, [])).toBe("replaced" as any);
    } finally {
      Reflect.construct = original;
    }
  });

  test("an out-of-bounds string index stays undefined in optimized code (5d1761dffb)", () => {
    const atEnd = (s: string, i: number) => s.at(i) === undefined;
    const codePointAtEnd = (s: string, i: number) => s.codePointAt(i) === undefined;
    let wrong = 0;
    for (let i = 0; i < 1e5; ++i) {
      if (atEnd("abc", 1) || codePointAtEnd("abc", 1)) wrong++;
      if (!atEnd("abc", 3) || !codePointAtEnd("abc", 3)) wrong++;
    }
    expect(wrong).toBe(0);
  });

  test("a non-global replace with an empty string returns the rest of the subject (7aeed1e3bd)", () => {
    expect("https://bun.sh/docs".replace(/^https?:\/\//, "")).toBe("bun.sh/docs");
    expect("file.test.ts".replace(/\.ts$/, "")).toBe("file.test");
    expect("a-b-c".replace(/-/, "")).toBe("ab-c");
    expect("abc".replace(/x/, "")).toBe("abc");
    expect("abc".replace(/abc/, "")).toBe("");
  });

  test("weak references stay correct while WeakBlocks are released and reused (7f5ab15882)", async () => {
    // A WeakBlock now goes back to a pool of the heap as soon as its last handle is released,
    // and other MarkedBlocks take it from there.
    const kept: object[] = [];
    const keptRefs: WeakRef<object>[] = [];
    let cleared = 0;
    for (let round = 0; round < 4; ++round) {
      const shortLived: WeakRef<object>[] = [];
      for (let i = 0; i < 2048; ++i) {
        if (!(i & 63)) {
          const live = { round, i };
          kept.push(live);
          keptRefs.push(new WeakRef(live));
        }
        shortLived.push(new WeakRef({ round, i }));
      }
      // A WeakRef keeps its target alive until the job that made it ends.
      await new Promise(resolve => setImmediate(resolve));
      fullGC();
      cleared += shortLived.filter(ref => ref.deref() === undefined).length;
    }
    expect(keptRefs.map(ref => ref.deref())).toEqual(kept);
    expect(cleared).toBeGreaterThan(0);
  });

  test("a multiply with a negated operand keeps its value, sign of zero included (41ec81351b)", () => {
    const negLeft = (w: number, r: number) => -w * r;
    const negRight = (w: number, r: number) => w * -r;
    const negBoth = (w: number, r: number) => -w * -r;
    // The negation has two users here, so the multiply cannot absorb it.
    const sharedNeg = (w: number, r: number) => {
      const n = -w;
      return n * r + n;
    };
    const negLeftInt = (w: number, r: number) => (-w * r) | 0;

    // w, r, -w * r, w * -r, -w * -r
    const cases: [number, number, number, number, number][] = [
      [0, 3, -0, -0, 0],
      [-0, 3, 0, 0, -0],
      [0, -3, 0, 0, -0],
      [-0, -3, -0, -0, 0],
      [0, -0, 0, 0, -0],
      [0, Infinity, NaN, NaN, NaN],
      [2, Infinity, -Infinity, -Infinity, Infinity],
      [NaN, 3, NaN, NaN, NaN],
      [1.5, 2.5, -3.75, -3.75, 3.75],
      [-1.5, 2.5, 3.75, 3.75, -3.75],
      [Number.MAX_VALUE, 2, -Infinity, -Infinity, Infinity],
    ];
    // w, r, (-w * r) | 0
    const intCases: [number, number, number][] = [
      [3, 7, -21],
      [-3, 7, 21],
      [0x7fffffff, 2, 2],
      [-0x80000000, 2, 0],
      [0x10000, 0x10000, 0],
    ];

    const mismatches: string[] = [];
    const check = (actual: number, expected: number, what: string, w: number, r: number) => {
      if (!Object.is(actual, expected) && mismatches.length < 10)
        mismatches.push(`${what}(${w}, ${r}): got ${actual}, expected ${expected}`);
    };
    for (let i = 0; i < 1e4; ++i) {
      for (const [w, r, left, right, both] of cases) {
        check(negLeft(w, r), left, "negLeft", w, r);
        check(negRight(w, r), right, "negRight", w, r);
        check(negBoth(w, r), both, "negBoth", w, r);
        check(sharedNeg(w, r), left + -w, "sharedNeg", w, r);
      }
      for (const [w, r, expected] of intCases) check(negLeftInt(w, r), expected, "negLeftInt", w, r);
    }
    expect(mismatches).toEqual([]);
  });

  test("a WeakGCMap keeps an entry whose value is alive across eden and full collections (8ae0649a80)", () => {
    // Port of JSTests/stress/weak-gc-map-keeps-live-values.js. Symbol.for reads
    // VM::symbolImplToSymbolMap, which is a WeakGCMap. If a collection drops an entry whose
    // value is reachable, the next lookup makes a second Symbol cell for the same key.
    const symbols: symbol[] = [];
    for (let i = 0; i < 128; ++i) symbols.push(Symbol.for(`webkit-upgrade-7b485a76e9-${i}`));

    const changed: number[] = [];
    for (let i = 0; i < 16; ++i) {
      // New structure transitions, prototype structures and atom strings, so that the weak
      // tables gain entries between collections and eden collections visit them.
      for (let j = 0; j < 512; ++j) {
        const object: Record<string, number> = {};
        object[`p${j & 31}`] = j;
        object.tail = j;
        Object.create(object);
        `a,b,c-${j}`.split(",");
      }
      if (i & 1) edenGC();
      else fullGC();
      for (let j = 0; j < symbols.length; ++j) {
        if (Symbol.for(`webkit-upgrade-7b485a76e9-${j}`) !== symbols[j]) changed.push(j);
      }
    }
    expect(changed).toEqual([]);
  });

  test("BigInt multiply and divide agree from the schoolbook loops up to Toom-3 and FFT sizes (9e61914f4c, d2d61f8871)", () => {
    // A digit is 64 bits. karatsubaStart() runs its chunk loop only when the operands have
    // different lengths, divideSchoolbook() handles every divisor of 2 to 56 digits, and the
    // last two shapes are past the Toom-3 and the FFT thresholds.
    const digits = (count: number, seed: bigint) => {
      let value = 0n;
      let state = seed;
      for (let i = 0; i < count; ++i) {
        state = (state * 6364136223846793005n + 1442695040888963407n) & 0xffffffffffffffffn;
        value = (value << 64n) | state;
      }
      return value | (1n << BigInt(count * 64 - 1));
    };

    const failures: string[] = [];
    const shapes: [number, number][] = [
      [1, 1],
      [2, 1],
      [9, 2],
      [17, 16],
      [44, 44],
      [45, 45],
      [100, 50],
      [300, 47],
      [257, 130],
      [50, 2],
      [120, 56],
      [90, 30],
      [700, 600],
      [1800, 700],
    ];
    for (const [longer, shorter] of shapes) {
      const a = digits(longer, 1n);
      const b = digits(shorter, 2n);
      const r = digits(shorter, 3n) % b;
      const product = a * b;
      if (product !== b * a) failures.push(`${longer}x${shorter}: a * b !== b * a`);
      if (product / b !== a) failures.push(`${longer}x${shorter}: (a * b) / b !== a`);
      if (product % b !== 0n) failures.push(`${longer}x${shorter}: (a * b) % b !== 0`);
      if ((product + r) / b !== a) failures.push(`${longer}x${shorter}: (a * b + r) / b !== a`);
      if ((product + r) % b !== r) failures.push(`${longer}x${shorter}: (a * b + r) % b !== r`);
      if (-product / b !== -a) failures.push(`${longer}x${shorter}: -(a * b) / b !== -a`);
      // (a + 1) * b - 1 has the quotient a and the remainder b - 1.
      const below = product + b - 1n;
      if (below / b !== a || below % b !== b - 1n) failures.push(`${longer}x${shorter}: quotient below a multiple`);
      // A square takes the aliased-operand path.
      const sum = a + b;
      if (sum * sum !== a * a + 2n * product + b * b) failures.push(`${longer}x${shorter}: (a + b) ** 2`);
    }
    expect(failures).toEqual([]);
  });
});
