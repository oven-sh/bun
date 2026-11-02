const assert = require("assert");
const { bunEnv, bunExe } = require("harness");

test("assert from require as a function does not throw", () => assert(true));
test("assert from require as a function does throw", () => {
  try {
    assert(false);
    expect(false).toBe(true);
  } catch (e) {}
});

describe("assert.partialDeepStrictEqual", () => {
  test("arrays match an in-order subsequence with partial element comparison", () => {
    assert.partialDeepStrictEqual([1, 2, 3, 4], [2, 4]);
    expect(() => assert.partialDeepStrictEqual([1, 2, 3, 4], [4, 2])).toThrow(assert.AssertionError);
  });

  test("failure message uses the kReadableOperator header", () => {
    let err;
    try {
      assert.partialDeepStrictEqual({ a: 1 }, { b: 2 });
    } catch (e) {
      err = e;
    }
    expect(err.message.split("\n")[0]).toBe("Expected values to be partially and strictly deep-equal:");
  });

  test("array subsequence scan skips candidates missing an expected key", () => {
    assert.partialDeepStrictEqual([{ a: 1 }, { b: 2 }], [{ b: 2 }]);
    assert.partialDeepStrictEqual({ items: [{ a: 1 }, { b: 2 }] }, { items: [{ b: 2 }] });
    expect(() => assert.partialDeepStrictEqual([{ a: 1 }, { b: 2 }], [{ c: 3 }])).toThrow(assert.AssertionError);
  });

  test("a repeated reference is re-compared against each expected element", () => {
    const shared = { a: 1 };
    expect(() => assert.partialDeepStrictEqual({ x: [shared, shared] }, { x: [{ a: 1 }, { a: 99 }] })).toThrow(
      assert.AssertionError,
    );
    expect(() => assert.partialDeepStrictEqual({ y: shared, z: shared }, { y: { a: 1 }, z: { a: 99 } })).toThrow(
      assert.AssertionError,
    );
    assert.partialDeepStrictEqual({ x: [shared, shared] }, { x: [{ a: 1 }, { a: 1 }] });

    const sharedMap = new Map([["k", 1]]);
    expect(() =>
      assert.partialDeepStrictEqual({ x: [sharedMap, sharedMap] }, { x: [new Map([["k", 1]]), new Map([["k", 99]])] }),
    ).toThrow(assert.AssertionError);
  });

  test("circular structures compare without recursing forever", () => {
    const a = [];
    a.push(a);
    const b = [];
    b.push(b);
    assert.partialDeepStrictEqual(a, b);
    assert.partialDeepStrictEqual(a, a);

    const oa = {};
    oa.self = oa;
    const ob = {};
    ob.self = ob;
    assert.partialDeepStrictEqual(oa, ob);
  });

  test("a circular actual still fails against a non-circular expected", () => {
    const circularArr = [];
    circularArr.push(circularArr);
    expect(() => assert.partialDeepStrictEqual(circularArr, [[1]])).toThrow(assert.AssertionError);

    const circularObj = {};
    circularObj.self = circularObj;
    expect(() => assert.partialDeepStrictEqual(circularObj, { self: { self: 1 } })).toThrow(assert.AssertionError);

    // And the other way: a non-circular actual against a circular expected.
    const circularExpected = [];
    circularExpected.push(circularExpected);
    expect(() => assert.partialDeepStrictEqual([[1]], circularExpected)).toThrow(assert.AssertionError);
  });

  test("array scan past a non-matching candidate does not poison later matches", () => {
    const shared = { x: 1 };
    expect(() => assert.partialDeepStrictEqual({ arr: [shared, shared] }, { arr: [{ x: 2 }] })).toThrow(
      assert.AssertionError,
    );
    assert.partialDeepStrictEqual({ arr: [shared, shared] }, { arr: [{ x: 1 }] });
  });

  test("a descendant actual identical to an ancestor expected is not mistaken for a cycle", () => {
    const e = { k: {} };
    assert.partialDeepStrictEqual({ k: e }, e);

    const arr = [[]];
    assert.partialDeepStrictEqual([arr], arr);
  });
});

describe("AssertionError diff rendering", () => {
  // Expected messages captured from node v24 (ANSI stripped).
  const messageOf = fn => {
    try {
      fn();
    } catch (e) {
      return Bun.stripANSI(e.message);
    }
    throw new Error("did not throw");
  };

  test("line diff keeps Latin-1 text and trailing spaces intact", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "línea\nütf" }, { s: "linea\nutf" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: 'línea\\nütf'\n-   s: 'linea\\nutf'\n  }\n",
    );
    expect(messageOf(() => assert.deepStrictEqual({ k: "v    " }, { k: "w" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   k: 'v    '\n-   k: 'w'\n  }\n",
    );
  });

  test("line diff prints UTF-16 lines as text", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "😀\nx" }, { s: "😺\nx" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: '😀\\nx'\n-   s: '😺\\nx'\n  }\n",
    );
    const a = Array.from({ length: 30 }, (_, i) => `値${i}`);
    const b = a.map((v, i) => (i === 2 || i === 27 ? "x" : v));
    expect(messageOf(() => assert.deepStrictEqual(a, b))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n... Skipped lines\n\n  [\n    '値0',\n    '値1',\n+   '値2',\n-   'x',\n    '値3',\n    '値4',\n    '値5',\n    '値6',\n    '値7',\n...\n    '値26',\n+   '値27',\n-   'x',\n    '値28',\n    '値29'\n  ]\n",
    );
  });

  test("mixed Latin-1 / UTF-16 sides diff by code unit", () => {
    expect(messageOf(() => assert.deepStrictEqual({ s: "café\nx" }, { s: "😀\nx" }))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   s: 'café\\nx'\n-   s: '😀\\nx'\n  }\n",
    );
  });

  test("long unchanged runs collapse with ... and report skipped lines", () => {
    const a = Array.from({ length: 30 }, (_, i) => i);
    const b = a.map((v, i) => (i === 3 || i === 25 ? -1 : v));
    expect(messageOf(() => assert.deepStrictEqual(a, b))).toBe(
      "Expected values to be strictly deep-equal:\n+ actual - expected\n... Skipped lines\n\n  [\n    0,\n    1,\n    2,\n+   3,\n-   -1,\n    4,\n    5,\n    6,\n    7,\n    8,\n...\n    24,\n+   25,\n-   -1,\n    26,\n    27,\n    28,\n    29\n  ]\n",
    );
  });

  // The per-character diff is only used when colors are on, so it runs in a child with FORCE_COLOR.
  test("colored char diff handles Latin-1, UTF-16 and mixed inputs", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const assert = require("node:assert");
         const messageOf = fn => { try { fn(); } catch (e) { return e.message; } };
         console.log(JSON.stringify([
           messageOf(() => assert.strictEqual("wörld, hello!", "world, hello!")),
           messageOf(() => assert.strictEqual("a😀b, hello!", "a😺b, hello!")),
           messageOf(() => assert.strictEqual("wörld, hello!", "😀rld, hello!")),
         ]));`,
      ],
      env: { ...bunEnv, NO_COLOR: undefined, FORCE_COLOR: "1" },
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");

    const green = "\x1b[32m";
    const red = "\x1b[31m";
    const white = "\x1b[39m";
    // Every UTF-16 code unit is wrapped in its own color pair, as in node.
    const wrap = (color, s) =>
      s
        .split("")
        .map(c => `${color}${c}${white}`)
        .join("");
    const same = s => wrap(white, s);
    const added = s => wrap(green, s);
    const removed = s => wrap(red, s);
    const charDiff = body =>
      `Expected values to be strictly equal:\n${green}actual${white} ${red}expected${white}\n\n${body}\n`;
    expect(JSON.parse(stdout)).toEqual([
      charDiff(same("'w") + added("ö") + removed("o") + same("rld, hello!'")),
      charDiff(same("'a\ud83d") + added("\ude00") + removed("\ude3a") + same("b, hello!'")),
      charDiff(same("'") + added("wö") + removed("😀") + same("rld, hello!'")),
    ]);
    expect(exitCode).toBe(0);
  });
});

// https://github.com/nodejs/node/pull/38215
// Each script runs in a child: an Error that is frozen or not extensible stays that way.
// Every expectation is what node v26.3.0 prints for the same script.
describe("a failed assertion and Error.stackTraceLimit", () => {
  async function runInChild(script) {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  }
  const thrownBy = `const thrownBy = fn => { try { fn(); } catch (e) { return [e.name, e.code, e.message]; } };`;

  test.concurrent.each([
    ["the limit is read-only", `Object.defineProperty(Error, "stackTraceLimit", { value: 10, writable: false });`],
    ["the limit is read-only and 0", `Object.defineProperty(Error, "stackTraceLimit", { value: 0, writable: false });`],
    ["Error is frozen", `Object.freeze(Error);`],
    ["the limit is a getter without a setter", `Object.defineProperty(Error, "stackTraceLimit", { get: () => 10 });`],
    [
      "the limit is deleted and Error is not extensible",
      `delete Error.stackTraceLimit; Object.preventExtensions(Error);`,
    ],
    ["the limit is deleted and Error is sealed", `delete Error.stackTraceLimit; Object.seal(Error);`],
  ])("an AssertionError is thrown when %s", async (_, makeReadOnly) => {
    // The message of assert.ok is left out: it is not Node's, whatever the limit is.
    const { stdout, stderr, exitCode } = await runInChild(
      `${makeReadOnly}
       const assert = require("node:assert");
       ${thrownBy}
       assert.rejects(Promise.resolve()).catch(rejection => {
         console.log(JSON.stringify([
           thrownBy(() => assert.strictEqual(1, 2)),
           thrownBy(() => assert.deepStrictEqual({ a: 1 }, { a: 2 })),
           thrownBy(() => assert.ok(false)).slice(0, 2),
           thrownBy(() => assert.fail("boom")),
           thrownBy(() => assert.throws(() => {})),
           thrownBy(() => assert.ifError(new RangeError("unwanted"))),
           thrownBy(() => { throw new assert.AssertionError({ message: "made by hand" }); }),
           [rejection.name, rejection.code, rejection.message],
         ]));
       });`,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([
      ["AssertionError", "ERR_ASSERTION", "Expected values to be strictly equal:\n\n1 !== 2\n"],
      [
        "AssertionError",
        "ERR_ASSERTION",
        "Expected values to be strictly deep-equal:\n+ actual - expected\n\n  {\n+   a: 1\n-   a: 2\n  }\n",
      ],
      ["AssertionError", "ERR_ASSERTION"],
      ["AssertionError", "ERR_ASSERTION", "boom"],
      ["AssertionError", "ERR_ASSERTION", "Missing expected exception."],
      ["AssertionError", "ERR_ASSERTION", "ifError got unwanted exception: unwanted"],
      ["AssertionError", "ERR_ASSERTION", "made by hand"],
      ["AssertionError", "ERR_ASSERTION", "Missing expected rejection."],
    ]);
    expect(exitCode).toBe(0);
  });

  // The message is rendered by code of the program, which can lock the limit at that moment.
  test.concurrent("an AssertionError is made when its message freezes Error as it is rendered", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `const assert = require("node:assert");
       ${thrownBy}
       const message = { toString() { Object.freeze(Error); return "rendered"; } };
       console.log(JSON.stringify(thrownBy(() => { throw new assert.AssertionError({ message }); })));`,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual(["AssertionError", "ERR_ASSERTION", "rendered"]);
    expect(exitCode).toBe(0);
  });

  // With frames, the error of the getter would print its stack inside the message.
  test.concurrent("an error made while the message is rendered has no frames, and one made after has", async () => {
    const { stdout, stderr, exitCode } = await runInChild(
      `const assert = require("node:assert");
       let message;
       try {
         assert.deepStrictEqual({ get a() { return new Error("made while the message is rendered"); } }, { a: 2 });
       } catch (e) {
         message = e.message;
       }
       console.log(JSON.stringify([
         message.split("\\n").filter(line => line.includes("made while")),
         new Error("made after").stack.includes("\\n    at "),
       ]));`,
    );
    expect(stderr).toBe("");
    expect(JSON.parse(stdout)).toEqual([["+   a: [Getter] [Error: made while the message is rendered]"], true]);
    expect(exitCode).toBe(0);
  });
});
