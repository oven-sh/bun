// this file is compatible with jest to test node.js' util.inspect as well as bun's

const util = require("util");

test("util.inspect.custom exists", () => {
  expect(util.inspect.custom).toEqual(Symbol.for("nodejs.util.inspect.custom"));
});

const customSymbol = util.inspect.custom;

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
