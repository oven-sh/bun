// this file is compatible with jest to test node.js' util.inspect as well as bun's

const util = require("util");
const vm = require("vm");
const { MessagePort } = require("worker_threads");

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

  test(name + " does not call inspect.custom of a prototype object", () => {
    const receivers = [];
    class Money {
      #cents = 150;
      [customSymbol]() {
        receivers.push(this === money ? "instance" : "other");
        return "Money<" + this.#cents + ">";
      }
    }
    class Salary extends Money {}
    function Legacy() {}
    Legacy.prototype[customSymbol] = function () {
      receivers.push("other");
      return "Legacy<>";
    };
    // These two constructors have no `prototype` of their own. Each inherits the one of its class.
    class Wage extends Money {}
    Wage.prototype.constructor = Object.create(Wage);
    class Bonus extends Money {}
    Bonus.prototype.constructor = Object.setPrototypeOf(() => {}, Bonus);
    const money = new Money();

    expect(inspect(money)).toBe("Money<150>");
    for (const prototype of [Money.prototype, Salary.prototype, Legacy.prototype, Wage.prototype, Bonus.prototype]) {
      inspect(prototype);
      inspect({ nested: prototype });
      inspect([prototype]);
      inspect(new Map([["value", prototype]]));
      inspect(new Proxy(prototype, {}));
      inspect({ [customSymbol]: () => prototype });
    }
    expect(receivers).toEqual(["instance"]);
  });

  test(name + " calls inspect.custom of an object that is not the prototype of its own constructor", () => {
    const receivers = [];
    function custom() {
      receivers.push(this.name);
      return "custom";
    }
    const nullConstructor = { name: "null", constructor: null, [customSymbol]: custom };
    const primitiveConstructor = { name: "primitive", constructor: 1, [customSymbol]: custom };
    const otherConstructor = { name: "other", constructor: Object, [customSymbol]: custom };
    const accessorConstructor = {
      name: "accessor",
      get constructor() {
        throw new Error("the constructor getter must not run");
      },
      [customSymbol]: custom,
    };
    // The inherited constructor points back at the object, but it is not an own property.
    const parent = { name: "parent", [customSymbol]: custom };
    const inheritedConstructor = Object.create(parent, { name: { value: "inherited" } });
    parent.constructor = { prototype: inheritedConstructor };
    // decimal.js gives each instance an own `constructor`.
    function Decimal() {
      this.name = "instance";
      this.constructor = Decimal;
    }
    Decimal.prototype[customSymbol] = custom;

    for (const value of [nullConstructor, primitiveConstructor, otherConstructor, accessorConstructor]) {
      expect(inspect(value)).toBe("custom");
    }
    expect(inspect(inheritedConstructor)).toBe("custom");
    expect(inspect(new Decimal())).toBe("custom");
    expect(receivers).toEqual(["null", "primitive", "other", "accessor", "inherited", "instance"]);
  });

  // `constructor` of Iterator.prototype is an accessor, so Node's test finds no constructor for it.
  test(name + " calls inspect.custom of Iterator.prototype", () => {
    const receivers = [];
    Object.defineProperty(Iterator.prototype, customSymbol, {
      value() {
        receivers.push(this === Iterator.prototype);
        return "iterator";
      },
      configurable: true,
    });
    try {
      expect(inspect(Iterator.prototype)).toBe("iterator");
    } finally {
      delete Iterator.prototype[customSymbol];
    }
    expect(receivers).toEqual([true]);
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
    // Bun.inspect does not call the hook of a prototype. An object that inherits from one gets the call.
    expect(Bun.inspect(Object.create(ReadableStream.prototype))).toStartWith("ReadableStream {");
    expect(Bun.inspect(Object.create(TransformStream.prototype))).toStartWith("TransformStream {");
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

// The hook of each of these throws ERR_INVALID_THIS for a receiver that is not an instance.
test.each([
  ["Buffer", Buffer],
  ["BroadcastChannel", BroadcastChannel],
  ["CompressionStream", CompressionStream],
  ["DecompressionStream", DecompressionStream],
  ["TextEncoderStream", TextEncoderStream],
  ["TextDecoderStream", TextDecoderStream],
  ["Module", vm.Module],
  ["SourceTextModule", vm.SourceTextModule],
  ["SyntheticModule", vm.SyntheticModule],
  ["MessagePort", MessagePort],
])("Bun.inspect prints %s.prototype without its inspect.custom", (className, { prototype }) => {
  expect(Bun.inspect(prototype)).toStartWith(className + " {");
  expect(Bun.inspect({ nested: prototype })).toStartWith("{\n  nested: " + className + " {");
});
