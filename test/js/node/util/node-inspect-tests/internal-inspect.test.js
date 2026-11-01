import assert from "assert";
import { expect, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug, withoutAggressiveGC } from "harness";
import { Console } from "node:console";
import { Writable } from "node:stream";
import util from "util";
import { getStackFrames as getStackFramesOfNode } from "./duplicate-frames-fixture.cjs";

test("no assertion failures", () => {
  // Errors in accessors are not triggered
  const obj = new Proxy(
    { x: 5 },
    {
      get() {
        throw new Error("Error message");
      },
    },
  );
  assert.strictEqual(util.format(obj), "{ x: 5 }");

  assert.strictEqual(util.formatWithOptions({ numericSeparator: true }, "%d", 4000), "4_000");

  const a = {};
  a.b = a;
  assert.strictEqual(util.inspect(a, { compact: false }), "<ref *1> {\n  b: [Circular *1]\n}");
  assert.strictEqual(util.inspect(a, { compact: true }), "<ref *1> { b: [Circular *1] }");

  const cause = new Error("cause");
  const e2 = new Error("wrapper", { cause });
  assert.match(util.inspect(e2), /\[cause\]: Error: cause\n/);
});

test("boxed BigInt/Symbol with no prototype are still formatted as boxed primitives", () => {
  assert.strictEqual(util.inspect(Object.setPrototypeOf(Object(55n), null)), "[BigInt (null prototype): 55n]");
  assert.strictEqual(
    util.inspect(Object.setPrototypeOf(Object(Symbol("x")), null)),
    "[Symbol (null prototype): Symbol(x)]",
  );
});

// Arrays and typed arrays collect their non-index keys through the native
// getOwnNonIndexProperties (UtilInspect.cpp). These pin down what it has to
// report: string and symbol keys in ownKeys order, non-enumerable keys only
// with showHidden, and numeric-looking keys that are not array indices.
test("util.inspect reports the non-index keys of an array", () => {
  const array = [1, 2];
  array[Symbol("sym")] = "s";
  array.str = "v";
  Object.defineProperty(array, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(array, Symbol("hiddenSym"), { value: 2, enumerable: false });
  array["4294967295"] = "not an index";
  array["01"] = "not canonical";

  expect(util.inspect(array)).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  str: 'v',\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's'\n" +
      "]",
  );
  expect(util.inspect(array, { showHidden: true })).toBe(
    "[\n" +
      "  1,\n" +
      "  2,\n" +
      "  [length]: 2,\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  '4294967295': 'not an index',\n" +
      "  '01': 'not canonical',\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );

  class Sub extends Array {}
  const sub = Sub.from([1]);
  sub.extra = 1;
  expect(util.inspect(sub)).toBe("Sub(1) [ 1, extra: 1 ]");

  const sparse = [];
  sparse[3] = 1;
  sparse.extra = 1;
  expect(util.inspect(sparse, { showHidden: true })).toBe("[ <3 empty items>, 1, [length]: 4, extra: 1 ]");
});

test("util.inspect reports the non-index keys of a typed array", () => {
  const u8 = new Uint8Array([1, 2]);
  u8[Symbol("sym")] = "s";
  u8.str = "v";
  Object.defineProperty(u8, "hiddenStr", { value: 1, enumerable: false });
  Object.defineProperty(u8, Symbol("hiddenSym"), { value: 2, enumerable: false });

  expect(util.inspect(u8)).toBe("Uint8Array(2) [ 1, 2, str: 'v', Symbol(sym): 's' ]");
  expect(util.inspect(u8, { showHidden: true })).toBe(
    "Uint8Array(2) [\n" +
      "  1,\n" +
      "  2,\n" +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      "  [length]: 2,\n" +
      "  [byteLength]: 2,\n" +
      "  [byteOffset]: 0,\n" +
      "  [buffer]: ArrayBuffer { [byteLength]: 2 },\n" +
      "  str: 'v',\n" +
      "  [hiddenStr]: 1,\n" +
      "  Symbol(sym): 's',\n" +
      "  [Symbol(hiddenSym)]: 2\n" +
      "]",
  );
});

const at = name => `    at ${name} (file.js:1:1)`;
const framesOf = names => names.split(" ").map(at);

// An error whose stack has these lines after its first line.
function errorWithFrames(frames, message = "m") {
  const error = new Error(message);
  error.stack = [`Error: ${message}`, ...frames].join("\n");
  return error;
}

// What Node.js prints for that error without colors: the lines that its own functions leave.
function textOfNode(frames, message = "m") {
  return [`Error: ${message}`, ...getStackFramesOfNode({ stylize: text => text }, [...frames])].join("\n");
}

// Each expected text in the next four tests is the output of Node.js v26.3.0 for the same error.
test("util.inspect prints the stack frames of a recursion once", () => {
  const recursive = errorWithFrames(
    [...Array(12).fill("    at recurse (file.js:1:1)"), "    at main (file.js:2:1)"],
    "deep",
  );
  expect(util.inspect(recursive)).toBe(
    "Error: deep\n" +
      "    at recurse (file.js:1:1)\n" +
      "    ... collapsed 11 duplicate lines matching above 1 lines 11 times...\n" +
      "    at main (file.js:2:1)",
  );

  const pair = errorWithFrames(framesOf("a b a b a b a b a b a b main"), "pair");
  expect(util.inspect(pair)).toBe(
    "Error: pair\n" +
      "    at a (file.js:1:1)\n" +
      "    at b (file.js:1:1)\n" +
      "    ... collapsed 10 duplicate lines matching above 2 lines 5 times...\n" +
      "    at main (file.js:1:1)",
  );

  // A block that repeats once, then a line that repeats.
  expect(util.inspect(errorWithFrames(framesOf("p q r p q r a a a a a main")))).toBe(
    "Error: m\n" +
      "    at p (file.js:1:1)\n" +
      "    at q (file.js:1:1)\n" +
      "    at r (file.js:1:1)\n" +
      "    ... collapsed 3 duplicate lines matching above lines ...\n" +
      "    at a (file.js:1:1)\n" +
      "    ... collapsed 4 duplicate lines matching above 1 lines 4 times...\n" +
      "    at main (file.js:1:1)",
  );

  // A block that repeats one of its own lines.
  expect(util.inspect(errorWithFrames(framesOf("a b b b a b b b a b b b main")))).toBe(
    "Error: m\n" +
      "    at a (file.js:1:1)\n" +
      "    at b (file.js:1:1)\n" +
      "    at b (file.js:1:1)\n" +
      "    at b (file.js:1:1)\n" +
      "    ... collapsed 8 duplicate lines matching above 4 lines 2 times...\n" +
      "    at main (file.js:1:1)",
  );

  // Lines are compared as text: they do not have to be frames.
  expect(util.inspect(errorWithFrames([at("x"), ...Array(12).fill("foo")]))).toBe(
    "Error: m\n" +
      "    at x (file.js:1:1)\n" +
      "foo\n" +
      "    ... collapsed 11 duplicate lines matching above 1 lines 11 times...",
  );
});

test("util.inspect hides repeated stack frames only where Node.js does", () => {
  const hidden = "\n    ... collapsed 4 duplicate lines matching above 1 lines 4 times...";
  const hiddenThree = "\n    ... collapsed 3 duplicate lines matching above 1 lines 3 times...";
  const texts = [
    // More than 10 lines.
    "a a a a a a a a a a",
    "a a a a a a a a a a a",
    // More than three lines that occurred earlier.
    "a a a a u0 u1 u2 u3 u4 u5 u6",
    "a a a a a u0 u1 u2 u3 u4 u5",
    "u0 u1 u2 u3 u4 u5 u6 u7 a a a a",
    "u0 u1 u2 u3 u4 u5 u6 u7 a a a a a",
    // Not a block whose first line repeats at once.
    "a a b c a a b c u0 u1 u2",
    // Three lines in a row that occurred earlier are enough, two are not. Names of different lengths, then of one.
    "p qq rrr p qq rrr uuuu x vvvvv x wwwwww",
    "p qq rrr p qq uuuu x vvvvv x wwwwww yyyyyyy",
    "a a a a bb x ccc x dddd eeeee ffffff",
    "a a a a x y x z x w q",
    // Two lines that repeat once are not enough.
    "p q r s r q p a b a b c a",
    // The last four lines.
    "b b b b u0 u1 u2 u3 a a a a",
  ].map(names => util.inspect(errorWithFrames(framesOf(names))));
  const every = names => `Error: m\n${framesOf(names).join("\n")}`;

  expect(texts).toEqual([
    every("a a a a a a a a a a"),
    "Error: m\n    at a (file.js:1:1)\n    ... collapsed 10 duplicate lines matching above 1 lines 10 times...",
    every("a a a a u0 u1 u2 u3 u4 u5 u6"),
    every("a") + hidden + "\n" + framesOf("u0 u1 u2 u3 u4 u5").join("\n"),
    every("u0 u1 u2 u3 u4 u5 u6 u7 a a a a"),
    every("u0 u1 u2 u3 u4 u5 u6 u7 a") + hidden,
    every("a a b c a a b c u0 u1 u2"),
    every("p qq rrr") +
      "\n    ... collapsed 3 duplicate lines matching above lines ...\n" +
      framesOf("uuuu x vvvvv x wwwwww").join("\n"),
    every("p qq rrr p qq uuuu x vvvvv x wwwwww yyyyyyy"),
    every("a") + hiddenThree + "\n" + framesOf("bb x ccc x dddd eeeee ffffff").join("\n"),
    every("a") + hiddenThree + "\n" + framesOf("x y x z x w q").join("\n"),
    every("p q r s r q p a b a b c a"),
    every("b") + hiddenThree + "\n" + framesOf("u0 u1 u2 u3 a").join("\n") + hiddenThree,
  ]);
});

test("util.format, a Console and an error inside an object print a recursion once too", () => {
  const error = errorWithFrames([...Array(12).fill(at("recurse")), at("main")]);
  const text =
    "Error: m\n" +
    "    at recurse (file.js:1:1)\n" +
    "    ... collapsed 11 duplicate lines matching above 1 lines 11 times...\n" +
    "    at main (file.js:1:1)";
  let written = "";
  const stream = new Writable({
    write(chunk, encoding, callback) {
      written += chunk;
      callback();
    },
  });
  new Console(stream).log(error);

  expect({
    format: util.format("%s", error),
    console: written,
    property: util.inspect({ error }),
    colors: util.inspect(error, { colors: true }),
  }).toEqual({
    format: text,
    console: text + "\n",
    property: `{\n  error: ${text.replaceAll("\n", "\n  ")}\n}`,
    colors: text.replace(/( {4}\.\.\. .*)/, "\x1B[90m$1\x1B[39m"),
  });
});

test("util.inspect styles the lines that stand for repeated frames from the last one to the first", () => {
  const calls = [];
  const text = util.inspect(errorWithFrames(framesOf("a a a a a x b b b b b b main")), {
    stylize(text, type) {
      calls.push([text, type]);
      return `<${text}>`;
    },
  });

  expect(calls).toEqual([
    ["    ... collapsed 5 duplicate lines matching above 1 lines 5 times...", "undefined"],
    ["    ... collapsed 4 duplicate lines matching above 1 lines 4 times...", "undefined"],
  ]);
  expect(text).toBe(
    "Error: m\n" +
      "    at a (file.js:1:1)\n" +
      "<    ... collapsed 4 duplicate lines matching above 1 lines 4 times...>\n" +
      "    at x (file.js:1:1)\n" +
      "    at b (file.js:1:1)\n" +
      "<    ... collapsed 5 duplicate lines matching above 1 lines 5 times...>\n" +
      "    at main (file.js:1:1)",
  );
});

// Stacks of up to 60 lines (every 50th: up to 600), from a fixed seed: runs of lines, blocks that repeat, with and
// without other lines between them, and copies of earlier parts of the stack.
function seededStacks(count) {
  let seed = 7;
  const int = below => {
    // xorshift32
    seed ^= seed << 13;
    seed >>>= 0;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    seed >>>= 0;
    return Math.floor((seed / 0x100000000) * below);
  };
  const stacks = [];
  for (let stack = 0; stack < count; stack++) {
    const frames = [];
    const length = 1 + int(stack % 50 === 0 ? 600 : 60);
    const alphabet = 1 + int(8);
    // Names of three lengths: two lines of one length are not always the same line.
    const line = () => {
      const name = int(alphabet);
      return at("f".repeat(1 + (name % 3)) + name);
    };
    while (frames.length < length) {
      const kind = int(6);
      if (kind === 0) {
        for (let lines = 1 + int(12); lines > 0; lines--) frames.push(line());
      } else if (kind === 1) {
        const block = Array.from({ length: 1 + int(6) }, line);
        for (let times = 1 + int(8); times > 0; times--) frames.push(...block);
      } else if (kind === 2) {
        const first = line();
        const inner = Array(1 + int(4)).fill(line());
        for (let times = 1 + int(6); times > 0; times--) frames.push(first, ...inner);
      } else if (kind === 3) {
        frames.push(at("u" + frames.length));
      } else if (kind === 4) {
        const start = int(frames.length);
        const copy = frames.slice(start, start + 1 + int(20));
        for (let times = 1 + int(3); times > 0; times--) frames.push(...copy);
      } else {
        const repeated = line();
        for (let times = 1 + int(8); times > 0; times--) {
          frames.push(repeated);
          for (let others = int(3); others > 0; others--) frames.push(int(2) ? at("u" + frames.length) : line());
        }
      }
    }
    stacks.push(frames);
  }
  return stacks;
}

test("util.inspect hides the same stack frames as the functions of Node.js on seeded stacks", () => {
  // The functions of Node.js take most of the time, and a debug build runs them slowly.
  const count = isDebug || isASAN ? 200 : 4_000;
  let collapsed = 0;
  const different = [];
  for (const frames of seededStacks(count)) {
    const expected = textOfNode(frames);
    if (expected.includes("collapsed")) collapsed++;
    if (util.inspect(errorWithFrames(frames)) !== expected) different.push(frames.join("\n"));
  }
  expect(different).toEqual([]);
  // Node.js v26.3.0 hides frames in this many of the stacks.
  expect(collapsed).toBe(count === 200 ? 175 : 3_506);
});

// The seeded stacks repeat blocks of up to 20 lines. util.inspect compares longer blocks in another way.
test("util.inspect hides blocks of 32 and more stack frames as the functions of Node.js do", () => {
  const lines = (count, name) => Array.from({ length: count }, (_, i) => at(name(i)));
  const cycle = (length, times) => lines(length * times, i => `f${i % length}`);
  const recursion = count => lines(count, i => "ab"[i % 2]);
  const stacks = {
    "a cycle of 64 functions three times": [...cycle(64, 3), at("main")],
    "a cycle of 100 functions four times, one line of the third copy changed": cycle(100, 4).with(250, at("other")),
    "two functions 256 times and a line of its own, three times": lines(3 * 513, i =>
      i % 513 === 512 ? `own${i}` : "ab"[(i % 513) % 2],
    ),
    "150 lines twice, then 40 of them again": [...cycle(150, 2), ...cycle(150, 1).slice(20, 60), at("main")],
    "a line on both sides of a recursion of two functions": [at("map"), ...recursion(400), at("map"), at("main")],
    "a recursion of two functions that the stack holds twice": [
      ...recursion(200),
      at("x"),
      ...recursion(240),
      at("main"),
    ],
    "300 lines twice but for the last one": lines(600, i => (i === 599 ? "last" : `line${i % 300}`)),
  };
  const printed = {};
  for (const [name, frames] of Object.entries(stacks)) {
    const text = util.inspect(errorWithFrames(frames));
    expect(text).toBe(textOfNode(frames));
    printed[name] = text.split("\n").length - 1;
  }

  // The lines that Node.js v26.3.0 prints for each stack.
  expect(printed).toEqual({
    "a cycle of 64 functions three times": 66,
    "a cycle of 100 functions four times, one line of the third copy changed": 301,
    "two functions 256 times and a line of its own, three times": 12,
    "150 lines twice, then 40 of them again": 192,
    "a line on both sides of a recursion of two functions": 6,
    "a recursion of two functions that the stack holds twice": 8,
    "300 lines twice but for the last one": 600,
  });
});

test("util.inspect hides the repeated frames of a stack that the program did not write", async () => {
  const withoutPositions = error =>
    util
      .inspect(error)
      .replace(/\(.*?:\d+:\d+\)/g, "(file)")
      .split("\n");
  const framesOfStack = error => error.stack.split("\n").length - 1;
  function recurse(depth) {
    if (depth === 0) throw new Error("deep");
    return recurse(depth - 1) + 1;
  }
  async function recurseAsync(depth) {
    await null;
    if (depth === 0) throw new Error("deep");
    return (await recurseAsync(depth - 1)) + 1;
  }

  const limit = Error.stackTraceLimit;
  let error;
  try {
    Error.stackTraceLimit = 30;
    recurse(20);
  } catch (thrown) {
    error = thrown;
  } finally {
    Error.stackTraceLimit = limit;
  }
  expect(withoutPositions(error).slice(0, 4)).toEqual([
    "Error: deep",
    "    at recurse (file)",
    "    at recurse (file)",
    "    ... collapsed 19 duplicate lines matching above 1 lines 19 times...",
  ]);
  expect(util.inspect(error)).toBe(textOfNode(error.stack.split("\n").slice(1), "deep"));

  // Bun keeps up to 10 async frames on top of the 10 frames of Error.stackTraceLimit, so each of the next two stacks
  // has 11 lines at the default limit. Node.js keeps 10 lines in all, and prints them. Each expected text is what
  // Node.js v26.3.0 prints with --stack-trace-limit=11.
  expect(Error.stackTraceLimit).toBe(10);
  const asyncError = await recurseAsync(20).catch(thrown => thrown);
  expect(framesOfStack(asyncError)).toBe(11);
  expect(withoutPositions(asyncError)).toEqual([
    "Error: deep",
    "    at recurseAsync (file)",
    "    at async recurseAsync (file)",
    "    ... collapsed 9 duplicate lines matching above 1 lines 9 times...",
  ]);

  // No function calls itself here: six closures of one function await one another.
  async function fails() {
    await null;
    throw new Error("deep");
  }
  const wrapped = next =>
    async function wrapper() {
      return await next();
    };
  let handler = fails;
  for (let wrappers = 0; wrappers < 6; wrappers++) handler = wrapped(handler);
  async function route() {
    return await handler();
  }
  async function handle() {
    return await route();
  }
  async function serve() {
    return await handle();
  }
  async function listen() {
    return await serve();
  }
  const wrappedError = await listen().catch(thrown => thrown);
  expect(framesOfStack(wrappedError)).toBe(11);
  expect(withoutPositions(wrappedError)).toEqual([
    "Error: deep",
    "    at fails (file)",
    "    at async wrapper (file)",
    "    ... collapsed 5 duplicate lines matching above 1 lines 5 times...",
    "    at async route (file)",
    "    at async handle (file)",
    "    at async serve (file)",
    "    at async listen (file)",
  ]);
});

// The functions of Node.js compare the lines once for every later copy of a line: on each of these stacks their time
// grows with the square of the number of lines. No clock is read here. What util.inspect does for each line, and the
// tables that it builds, are counted in test/aot/parallel/library-modules/util-inspect-of-a-long-stack-that-*.js.
test("util.inspect hides the repeated frames of a stack of very many lines", () => {
  const lines = isDebug || isASAN ? 10_000 : 100_000;
  const stackOf = line => Array.from({ length: lines }, (_, i) => at(line(i)));
  const callEachOther = errorWithFrames([...stackOf(i => "ab"[i % 2]), at("main")]);
  const underOneCaller = errorWithFrames([at("map"), ...stackOf(i => "ab"[i % 2]), at("map"), at("main")]);
  const twoThenItsOwn = errorWithFrames(stackOf(i => (i % 3 === 2 ? `u${i}` : "ab"[i % 3])));
  const oneThenItsOwn = errorWithFrames(stackOf(i => (i % 2 ? `u${i}` : "a")));
  const once =
    "    at a (file.js:1:1)\n" +
    "    at b (file.js:1:1)\n" +
    `    ... collapsed ${lines - 2} duplicate lines matching above 2 lines ${lines / 2 - 1} times...\n`;

  expect(util.inspect(callEachOther)).toBe(`Error: m\n${once}    at main (file.js:1:1)`);
  expect(util.inspect(underOneCaller)).toBe(
    `Error: m\n    at map (file.js:1:1)\n${once}    at map (file.js:1:1)\n    at main (file.js:1:1)`,
  );
  expect(util.inspect(twoThenItsOwn) === twoThenItsOwn.stack).toBe(true);
  expect(util.inspect(oneThenItsOwn) === oneThenItsOwn.stack).toBe(true);
});

// The line that stands for the frames of a cause is the only line that a `stylize` option can turn into `undefined`.
// util.inspect prints no such line until https://github.com/oven-sh/bun/pull/47497.
const causeWithFrames = errorWithFrames(framesOf("c1 c2 c3 c4 c5 c6"), "cause");
const hidesFramesOfCause = util
  .inspect(Object.assign(errorWithFrames(framesOf("x c1 c2 c3 c4 c5 c6")), { cause: causeWithFrames }))
  .includes("4 lines matching cause stack trace");

test.skipIf(!hidesFramesOfCause)(
  "util.inspect reads `undefined` past the end of the stack like Node.js, where the last block ends with it",
  () => {
    const error = errorWithFrames(framesOf("a bb a ccc a dddd a eeeee c6 c1 c2 c3 c4 c5 c6 c1"));
    error.cause = causeWithFrames;
    const text = util.inspect(error, {
      stylize: text => (text.includes("cause stack trace") ? undefined : `<${text}>`),
    });

    // The lines `c6 c1 undefined` repeat as `c6 c1` and the end of the stack.
    expect(text.split(" {\n")[0]).toBe(
      `Error: m\n${framesOf("a bb a ccc a dddd a eeeee c6 c1").join("\n")}\n` +
        "\n" +
        "<    ... collapsed 3 duplicate lines matching above lines ...>",
    );
  },
);

test.skipIf(!hidesFramesOfCause)(
  "util.inspect hides the same frames as the functions of Node.js around a line for the frames of a cause that is `undefined`",
  () => {
    let seed = 11;
    const int = below => {
      // xorshift32
      seed ^= seed << 13;
      seed >>>= 0;
      seed ^= seed >>> 17;
      seed ^= seed << 5;
      seed >>>= 0;
      return Math.floor((seed / 0x100000000) * below);
    };
    // `c1` and `c6` are the frames of the cause that stay around its line.
    const names = ["a", "c1", "c6"];
    const some = most => Array.from({ length: int(most + 1) }, () => at(names[int(names.length)]));
    const stylize = text => (text.includes("cause stack trace") ? undefined : `<${text}>`);
    const different = [];
    let collapsed = 0;
    for (let stack = 0; stack < 300; stack++) {
      let before = some(12);
      let after = some(12);
      if (stack % 2) {
        // The block that ends with the line of the cause stands again at the end of the stack, without its last line.
        const between = some(2);
        before = [...before, at("c6"), ...between];
        after = [...between, at("c1")];
      }
      const error = errorWithFrames([...before, ...framesOf("c1 c2 c3 c4 c5 c6"), ...after]);
      error.cause = causeWithFrames;
      // What the step for the cause leaves of the stack.
      const left = [...before, at("c1"), undefined, at("c6"), ...after];
      const expected = ["Error: m", ...getStackFramesOfNode({ stylize }, left)].join("\n");
      if (expected.includes("collapsed")) collapsed++;
      const text = util.inspect(error, { stylize }).split(" {\n")[0];
      if (text !== expected) different.push(`${text}\n--- Node.js:\n${expected}`);
    }
    expect(different).toEqual([]);
    // Node.js v26.3.0 hides frames in this many of the 300 stacks. 66 of them need the line past the end.
    expect(collapsed).toBe(139);
  },
);

test.skipIf(!hidesFramesOfCause)(
  "util.inspect hides the frames that an error shares with its cause before the frames that repeat",
  () => {
    const shared = "visit leaf visit leaf visit leaf visit leaf visit leaf visit leaf main";
    const error = errorWithFrames(framesOf(`wrap ${shared}`));
    error.cause = errorWithFrames(framesOf(shared), "cause");

    // The text of Node.js v26.3.0.
    expect(util.inspect(error)).toBe(
      "Error: m\n" +
        "    at wrap (file.js:1:1)\n" +
        "    at visit (file.js:1:1)\n" +
        "    ... 11 lines matching cause stack trace ...\n" +
        "    at main (file.js:1:1) {\n" +
        "  cause: Error: cause\n" +
        "      at visit (file.js:1:1)\n" +
        "      at leaf (file.js:1:1)\n" +
        "      ... collapsed 10 duplicate lines matching above 2 lines 5 times...\n" +
        "      at main (file.js:1:1)\n" +
        "}",
    );
  },
);

test("util.inspect hides repeated frames where the program has replaced built-in functions and the length of typed arrays", () => {
  const error = errorWithFrames(framesOf("a b a b a b a b a b a b main"));
  const expected =
    "Error: m\n" +
    "    at a (file.js:1:1)\n" +
    "    at b (file.js:1:1)\n" +
    "    ... collapsed 10 duplicate lines matching above 2 lines 5 times...\n" +
    "    at main (file.js:1:1)";
  // The formatter keeps the functions that it needs when it loads, which is at the first call.
  expect(util.inspect(error)).toBe(expected);

  const replaced = [
    [Array.prototype, "push"],
    [Array.prototype, "pop"],
    [Array.prototype, "indexOf"],
    [Array.prototype, "splice"],
    [Array.prototype, Symbol.iterator],
    [Map.prototype, "get"],
    [Map.prototype, "set"],
    [Set.prototype, "add"],
    [Set.prototype, "delete"],
    [globalThis, "Int32Array"],
    [Math, "min"],
  ].map(([object, key]) => [object, key, object[key]]);
  const typedArrayPrototype = Int32Array.prototype;
  let text;
  try {
    // No loop over an iterator here: the iterator of arrays is replaced too.
    for (let i = 0; i < replaced.length; i++) {
      const key = replaced[i][1];
      replaced[i][0][key] = () => {
        throw new Error(`util.inspect called the replaced ${String(key)}`);
      };
    }
    // In front of the getter that every typed array inherits.
    Object.defineProperty(typedArrayPrototype, "length", {
      configurable: true,
      get() {
        throw new Error("util.inspect read the length of a typed array");
      },
    });
    text = util.inspect(error);
  } finally {
    delete typedArrayPrototype.length;
    for (let i = 0; i < replaced.length; i++) replaced[i][0][replaced[i][1]] = replaced[i][2];
  }
  expect(text).toBe(expected);
});

// In a child: an accessor on an index of a prototype is there for every array of the process.
test("util.inspect hides repeated frames without a call of an accessor on an index of Array.prototype or Object.prototype", async () => {
  const src = `
    const util = require("node:util");
    const { Console } = require("node:console");
    const { Writable } = require("node:stream");
    const at = name => "    at " + name + " (file.js:1:1)";
    function errorWithFrames(frames) {
      const error = new Error("m");
      error.stack = ["Error: m", ...frames].join("\\n");
      return error;
    }
    const callEachOther = errorWithFrames([..."abababababab"].map(at).concat(at("main")));
    const callsItself = errorWithFrames([...Array(12).fill(at("recurse")), at("main")]);
    let written = "";
    const stream = new Writable({
      write(chunk, encoding, callback) {
        written += chunk;
        callback();
      },
    });
    const logger = new Console(stream);

    let calls = 0;
    const accessor = index => ({
      configurable: true,
      get() {
        calls++;
        throw new Error("the getter of index " + index + " ran");
      },
      set() {
        calls++;
        throw new Error("the setter of index " + index + " ran");
      },
    });
    for (let index = 0; index < 32; index++) {
      Object.defineProperty(Array.prototype, index, accessor(index));
      Object.defineProperty(Object.prototype, index, accessor(index));
    }
    const texts = {};
    try {
      texts.inspect = util.inspect(callEachOther);
      texts.itself = util.inspect(callsItself);
      texts.format = util.format("%s", callEachOther);
      logger.log(callEachOther);
      texts.console = written;
    } catch (error) {
      texts.threw = String(error);
    }
    for (let index = 0; index < 32; index++) {
      delete Array.prototype[index];
      delete Object.prototype[index];
    }
    console.log(JSON.stringify({ ...texts, calls }));
  `;

  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", src],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const callEachOther =
    "Error: m\n" +
    "    at a (file.js:1:1)\n" +
    "    at b (file.js:1:1)\n" +
    "    ... collapsed 10 duplicate lines matching above 2 lines 5 times...\n" +
    "    at main (file.js:1:1)";
  const callsItself =
    "Error: m\n" +
    "    at recurse (file.js:1:1)\n" +
    "    ... collapsed 11 duplicate lines matching above 1 lines 11 times...\n" +
    "    at main (file.js:1:1)";
  expect(stderr).toBe("");
  expect(JSON.parse(stdout)).toEqual({
    inspect: callEachOther,
    itself: callsItself,
    format: callEachOther,
    console: callEachOther + "\n",
    calls: 0,
  });
  expect(exitCode).toBe(0);
});

function fastestOf(runs, fn) {
  let fastest = Infinity;
  for (let i = 0; i < runs; i++) {
    const start = performance.now();
    fn();
    fastest = Math.min(fastest, performance.now() - start);
  }
  return fastest;
}

test.each([
  [
    "Array",
    length => Object.assign(new Array(length).fill(7), { extra: true }),
    length => `[ 7, 7, 7, ... ${length - 3} more items, [length]: ${length}, extra: true ]`,
  ],
  [
    "Uint8Array",
    length => Object.assign(new Uint8Array(length), { extra: true }),
    length =>
      `Uint8Array(${length}) [\n` +
      "  0,\n" +
      "  0,\n" +
      "  0,\n" +
      `  ... ${length - 3} more items,\n` +
      "  [BYTES_PER_ELEMENT]: 1,\n" +
      `  [length]: ${length},\n` +
      `  [byteLength]: ${length},\n` +
      "  [byteOffset]: 0,\n" +
      `  [buffer]: ArrayBuffer { [byteLength]: ${length} },\n` +
      "  extra: true\n" +
      "]",
  ],
])("util.inspect of a large %s does not visit every element", (_, create, expected) => {
  const options = { maxArrayLength: 3, showHidden: true };
  const small = create(1_000);
  const large = create(1_000_000);
  expect(util.inspect(small, options)).toBe(expected(1_000));
  expect(util.inspect(large, options)).toBe(expected(1_000_000));

  withoutAggressiveGC(() => {
    const smallMs = fastestOf(5, () => util.inspect(small, options));
    const largeMs = fastestOf(5, () => util.inspect(large, options));
    // With the keys collected through Object.getOwnPropertyDescriptors() this
    // scaled with the length: about 1s for the large one in a release build.
    expect(largeMs).toBeLessThan(smallMs * 20 + 50);
  });
});

//! non-standard property, should this be kept?
test.skip("util.stylizeWithHTML", () => {
  assert.strictEqual(
    util.inspect(
      {
        a: 1,
        b: "<p>\xA0\u{1F4A9}</p>",
        "&lt;": NaN,
        [Symbol("<br>")]: false,
        buf: new Uint8Array([1, 2, 3, 4]),
      },
      {
        compact: false,
        stylize: util.stylizeWithHTML,
      },
    ),
    "{\n" +
      '  a: <span style="color:yellow;">1</span>,\n' +
      '  b: <span style="color:green;">&apos;&lt;p&gt;&nbsp;\u{1F4A9}&lt;&#47;p&gt;&apos;</span>,\n' +
      '  <span style="color:green;">&apos;&amp;lt&#59;&apos;</span>: <span style="color:yellow;">NaN</span>,\n' +
      "  buf: Uint8Array(4) [\n" +
      '    <span style="color:yellow;">1</span>,\n' +
      '    <span style="color:yellow;">2</span>,\n' +
      '    <span style="color:yellow;">3</span>,\n' +
      '    <span style="color:yellow;">4</span>\n' +
      "  ],\n" +
      '  [<span style="color:green;">Symbol&#40;&lt;br&gt;&#41;</span>]: <span style="color:yellow;">false</span>\n' +
      "}",
  );
});
