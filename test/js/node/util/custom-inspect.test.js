// this file is compatible with jest to test node.js' util.inspect as well as bun's

const assert = require("assert");
const { Console } = require("console");
const { Writable } = require("stream");
const util = require("util");

test("util.inspect.custom exists", () => {
  expect(util.inspect.custom).toEqual(Symbol.for("nodejs.util.inspect.custom"));
});

const customSymbol = util.inspect.custom;

const nothingThrown = Symbol("nothing thrown");

function thrownBy(fn) {
  try {
    fn();
  } catch (thrown) {
    return thrown;
  }
  return nothingThrown;
}

// Node.js rethrows what a nested value throws (https://github.com/nodejs/node/pull/55544).
describe("util.inspect of a nested value that throws", () => {
  const boom = new RangeError("boom");
  const throwing = {
    [customSymbol]() {
      throw boom;
    },
  };

  test("rethrows what a getter for inspect.custom throws", () => {
    const obj = {
      get [customSymbol]() {
        throw boom;
      },
    };

    expect(thrownBy(() => util.inspect([obj]))).toBe(boom);
  });

  test("rethrows what a `sorted` comparator throws", () => {
    const sorted = () => {
      throw boom;
    };

    expect(thrownBy(() => util.inspect({ a: { b: 1, c: 2 } }, { sorted }))).toBe(boom);
  });

  test("rethrows it through util.format, util.formatWithOptions and Console", () => {
    expect(thrownBy(() => util.format("%o", [throwing]))).toBe(boom);
    expect(thrownBy(() => util.formatWithOptions({ colors: true }, [throwing]))).toBe(boom);

    const sink = new Writable({
      write(chunk, encoding, callback) {
        callback();
      },
    });
    expect(thrownBy(() => new Console(sink).log([throwing]))).toBe(boom);
  });

  // `getters: true` prints what the value of a getter throws, so that value reaches one more `catch`.
  describe.each([
    [
      "the getter",
      thrown => ({
        get a() {
          throw thrown;
        },
      }),
    ],
    [
      "a member of the getter's value",
      thrown => ({
        get a() {
          return [
            {
              [customSymbol]() {
                throw thrown;
              },
            },
          ];
        },
      }),
    ],
  ])("with `getters: true`, when %s throws", (_, make) => {
    const print = thrown => util.inspect(make(thrown), { getters: true });
    const printed = text => `{ a: [Getter: <Inspection threw (${text})>] }`;

    test("prints a primitive", () => {
      expect(print(null)).toBe(printed("null"));
      expect(print(undefined)).toBe(printed("undefined"));
      expect(print(42)).toBe(printed("42"));
      expect(print("boom")).toBe(printed("'boom'"));
    });

    // Node.js prints an object that is thrown. Bun prints its message.
    test("prints the message of an error", () => {
      if (process.versions.bun) expect(print(boom)).toBe(printed("boom"));
      else expect(print(boom)).toContain("a: [Getter: <Inspection threw (RangeError: boom");
    });

    test("prints an object with no readable message", () => {
      const unreadable = Object.defineProperty(new Error("unreadable"), "message", {
        get() {
          throw boom;
        },
      });

      for (const thrown of [unreadable, { message: Symbol("not a string") }]) {
        if (process.versions.bun) expect(print(thrown)).toBe(printed("undefined"));
        else expect(print(thrown)).toContain("a: [Getter: <Inspection threw (");
      }
    });
  });

  test("node:assert reports the failed assertion", () => {
    // node:assert prints its operands with `getters: true` and without inspect.custom.
    const unnamed = Object.defineProperty(function () {}, "name", {
      get() {
        throw null;
      },
    });
    const operands = [
      {
        get a() {
          throw null;
        },
      },
      {
        get a() {
          return [unnamed];
        },
      },
    ];
    const limit = Error.stackTraceLimit;

    try {
      for (const operand of operands) {
        const failed = thrownBy(() => assert.strictEqual(operand, 1));

        expect(failed).toBeInstanceOf(assert.AssertionError);
        expect(failed.message).toContain("a: [Getter: <Inspection threw (null)>]");
      }
    } finally {
      // node:assert sets the limit to 0 while it prints. A print that throws leaves it there.
      Error.stackTraceLimit = limit;
    }
  });
});

for (const [name, inspect] of process.versions.bun
  ? [
      ["util.inspect", util.inspect],
      ["Bun.inspect", Bun.inspect],
    ]
  : [["util.inspect", util.inspect]]) {
  const isBunInspect = name === "Bun.inspect";

  test(name + " calls inspect.custom", () => {
    const obj = {
      [customSymbol]() {
        return "42";
      },
    };

    expect(inspect(obj)).toBe("42");
  });

  test(name + " calls inspect.custom recursivly", () => {
    const obj = {
      [customSymbol]() {
        return {
          [customSymbol]() {
            return "42";
          },
        };
      },
    };

    expect(inspect(obj)).toBe("42");
  });

  test(name + " calls inspect.custom recursivly nested", () => {
    const obj = {
      [customSymbol]() {
        return {
          prop: {
            [customSymbol]() {
              return "42";
            },
          },
        };
      },
    };

    const expected = isBunInspect ? "{prop:42,}" : "{prop:42}";
    expect(inspect(obj).replace(/\s/g, "")).toBe(expected);
  });

  test(name + " calls inspect.custom recursivly nested 2", () => {
    const obj = {
      prop: {
        [customSymbol]() {
          return {
            [customSymbol]() {
              return "42";
            },
          };
        },
      },
    };

    const expected = isBunInspect ? "{prop:42,}" : "{prop:42}";
    expect(inspect(obj).replace(/\s/g, "")).toBe(expected);
  });

  test(name + " calls inspect.custom with valid options", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(this === obj).toBe(true);
        expect(inspect).toBe(util.inspect);
        expect(options.stylize).toBeDefined();
        expect(depth).toBeDefined(2);
        return "good";
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function works without color", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(options.stylize).toBeDefined();
        expect(options.stylize("foo", "whatever")).toBe("foo");
        expect(options.stylize("hello", "string")).toBe("hello");
        return "good";
      },
    };

    expect(inspect(obj).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function works with color", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        expect(options.stylize).toBeDefined();
        expect(options.stylize("foo", "invalid")).toBe("foo");
        expect(options.stylize("foo", "boolean")).toBe("\u001b[33mfoo\u001b[39m");
        expect(options.stylize("hello", "string")).toBe("\u001b[32mhello\u001b[39m");
        return "good";
      },
    };

    expect(inspect(obj, { colors: true }).replace(/\s/g, "")).toBe("good");
  });

  test(name + " stylize function gives correct depth", () => {
    const obj = {
      [customSymbol](depth, options, inspect) {
        return [depth, options.depth];
      },
    };
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe("[3,3]");
  });
  test(name + " stylize function gives correct depth", () => {
    const obj = {
      prop: {
        [customSymbol](depth, options, inspect) {
          return [depth, options.depth];
        },
      },
    };

    const expected = isBunInspect ? "{prop:[2,3],}" : "{prop:[2,3]}";
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe(expected);
  });

  const containers = [
    ["an object", member => ({ member })],
    ["an array", member => [member]],
    ["a Map key", member => new Map([[member, 1]])],
    ["a Map value", member => new Map([[1, member]])],
    ["a Set", member => new Set([member])],
    ["an array inside two objects", member => ({ a: { b: [member] } })],
  ];

  test.each(containers)(name + " rethrows what inspect.custom throws inside %s", (_, contain) => {
    for (const thrown of [new RangeError("boom"), 42, null, undefined]) {
      const obj = {
        [customSymbol]() {
          throw thrown;
        },
      };
      // Bun.inspect and util.inspect both hand util.inspect to the hook.
      const printedByHook = {
        [customSymbol](depth, options, inspect) {
          return inspect(contain(obj), options);
        },
      };

      expect(thrownBy(() => inspect(contain(obj)))).toBe(thrown);
      expect(thrownBy(() => inspect(printedByHook))).toBe(thrown);
    }
  });

  test(name + " non-callable does not get called", () => {
    const obj = {
      [customSymbol]: 512,
    };

    const expected = isBunInspect
      ? "{[Symbol(nodejs.util.inspect.custom)]:512,}"
      : "{Symbol(nodejs.util.inspect.custom):512}";
    expect(inspect(obj, { depth: 3 }).replace(/\s/g, "")).toBe(expected);
  });

  const exceptions = [new Error("don't crash!"), 42];

  test.each(exceptions)(name + " handles exceptions %s", err => {
    const obj = {
      [customSymbol]() {
        throw err;
      },
    };

    expect(() => inspect(obj)).toThrow();
  });
}

describe("Web Streams [nodejs.util.inspect.custom]", () => {
  const inspect = util.inspect;

  test("ReadableStream", () => {
    expect(inspect(new ReadableStream())).toBe(
      "ReadableStream { locked: false, state: 'readable', supportsBYOB: false }",
    );
    expect(inspect(new ReadableStream({ type: "bytes" }))).toBe(
      "ReadableStream { locked: false, state: 'readable', supportsBYOB: true }",
    );
    const rs = new ReadableStream();
    rs.getReader();
    expect(inspect(rs)).toBe("ReadableStream { locked: true, state: 'readable', supportsBYOB: false }");
  });

  test("WritableStream", () => {
    expect(inspect(new WritableStream())).toBe("WritableStream { locked: false, state: 'writable' }");
    const ws = new WritableStream();
    ws.getWriter();
    expect(inspect(ws)).toBe("WritableStream { locked: true, state: 'writable' }");
  });

  test("TransformStream", () => {
    const out = inspect(new TransformStream());
    expect(out).toStartWith("TransformStream {");
    expect(out).toContain("readable: ReadableStream {");
    expect(out).toContain("writable: WritableStream {");
    expect(out).toContain("backpressure: true");
  });

  test("ReadableStreamDefaultReader", () => {
    const out = inspect(new ReadableStream().getReader());
    expect(out).toStartWith("ReadableStreamDefaultReader {");
    expect(out).toContain("stream: ReadableStream {");
    expect(out).toContain("readRequests: 0");
    expect(out).toContain("close: Promise");
  });

  test("ReadableStreamBYOBReader", () => {
    const out = inspect(new ReadableStream({ type: "bytes" }).getReader({ mode: "byob" }));
    expect(out).toStartWith("ReadableStreamBYOBReader {");
    expect(out).toContain("readIntoRequests: 0");
  });

  test("ReadableStreamDefaultController", () => {
    let controller;
    new ReadableStream({
      start(c) {
        controller = c;
      },
    });
    expect(inspect(controller)).toBe("ReadableStreamDefaultController {}");
  });

  test("ReadableByteStreamController", () => {
    let controller;
    new ReadableStream({
      type: "bytes",
      start(c) {
        controller = c;
      },
    });
    expect(inspect(controller)).toBe("ReadableByteStreamController {}");
  });

  test("WritableStreamDefaultWriter", () => {
    const out = inspect(new WritableStream().getWriter());
    expect(out).toStartWith("WritableStreamDefaultWriter {");
    expect(out).toContain("stream: WritableStream {");
    expect(out).toContain("close: Promise");
    expect(out).toContain("ready: Promise");
    expect(out).toContain("desiredSize: 1");
  });

  test("WritableStreamDefaultController", () => {
    let controller;
    new WritableStream({
      start(c) {
        controller = c;
      },
    });
    const out = inspect(controller);
    expect(out).toStartWith("WritableStreamDefaultController {");
    expect(out).toContain("stream: WritableStream {");
  });

  test("TransformStreamDefaultController", () => {
    let controller;
    new TransformStream({
      start(c) {
        controller = c;
      },
    });
    const out = inspect(controller);
    expect(out).toStartWith("TransformStreamDefaultController {");
    expect(out).toContain("stream: TransformStream {");
  });

  test("ByteLengthQueuingStrategy", () => {
    expect(inspect(new ByteLengthQueuingStrategy({ highWaterMark: 16 }))).toBe(
      "ByteLengthQueuingStrategy { highWaterMark: 16 }",
    );
  });

  test("CountQueuingStrategy", () => {
    expect(inspect(new CountQueuingStrategy({ highWaterMark: 8 }))).toBe("CountQueuingStrategy { highWaterMark: 8 }");
  });

  test("TextEncoderStream", () => {
    const out = inspect(new TextEncoderStream());
    expect(out).toStartWith("TextEncoderStream {");
    expect(out).toContain("encoding: 'utf-8'");
    expect(out).toContain("readable: ReadableStream {");
    expect(out).toContain("writable: WritableStream {");
  });

  test("TextDecoderStream", () => {
    const out = inspect(new TextDecoderStream("utf-8", { fatal: true, ignoreBOM: true }));
    expect(out).toStartWith("TextDecoderStream {");
    expect(out).toContain("encoding: 'utf-8'");
    expect(out).toContain("fatal: true");
    expect(out).toContain("ignoreBOM: true");
  });

  test("ReadableStreamBYOBRequest", async () => {
    let out;
    const rs = new ReadableStream({
      type: "bytes",
      autoAllocateChunkSize: 16,
      pull(c) {
        out = inspect(c.byobRequest);
        c.byobRequest.view[0] = 1;
        c.byobRequest.respond(1);
        c.close();
      },
    });
    await rs.getReader().read();
    expect(out).toStartWith("ReadableStreamBYOBRequest {");
    expect(out).toContain("view: Uint8Array");
    expect(out).toContain("controller: ReadableByteStreamController {}");
  });

  test("depth < 0 returns the instance", () => {
    const rs = new ReadableStream();
    expect(rs[customSymbol](-1, {})).toBe(rs);
  });

  // util.inspect passes unknown user options through to the hooks unchanged.
  test("accepts a user option whose key is an array index", () => {
    expect(util.inspect(new ReadableStream(), { 0: 1 })).toBe(
      "ReadableStream { locked: false, state: 'readable', supportsBYOB: false }",
    );
    expect(util.inspect(new URLSearchParams("a=1&b=2"), { 0: 1 })).toBe("URLSearchParams { 'a' => '1', 'b' => '2' }");
  });

  test("wrong receiver returns the receiver (no infinite recursion)", () => {
    const o = {};
    expect(ReadableStream.prototype[customSymbol].call(o, 2, {})).toBe(o);
    // util.inspect and Bun.inspect must both fall through to default formatting
    // rather than recursing on a custom function that returned its own `this`.
    expect(inspect(ReadableStream.prototype)).toContain("[ReadableStream]");
    expect(Bun.inspect(ReadableStream.prototype).length > 0).toBeTrue();
    expect(Bun.inspect(TransformStream.prototype).length > 0).toBeTrue();
  });

  // Unlike the classes above, these two brand-check, matching Node.
  test.each([
    ["TextEncoderStream", () => new TextEncoderStream()],
    ["TextDecoderStream", () => new TextDecoderStream()],
  ])("%s throws ERR_INVALID_THIS on a wrong receiver", (className, create) => {
    const instance = create();
    expect(() => instance[customSymbol].call()).toThrow(
      expect.objectContaining({ code: "ERR_INVALID_THIS", name: "TypeError" }),
    );
    expect(() => instance[customSymbol].call({}, 2, {})).toThrow(expect.objectContaining({ code: "ERR_INVALID_THIS" }));
    // The prototype hosting the method is never passed to it, so inspecting it
    // formats as a plain object instead of throwing.
    expect(inspect(globalThis[className].prototype)).toContain("encoding: [Getter]");
  });
});
