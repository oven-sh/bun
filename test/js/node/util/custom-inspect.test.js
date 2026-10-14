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

const thrownBy = fn => {
  try {
    fn();
  } catch (error) {
    return error;
  }
};

// node rethrows what a nested value throws (the catch of formatRaw, lib/internal/util/inspect.js).
test("util.inspect rethrows the error of a nested inspect.custom", () => {
  const error = new Error("nested hook");
  const hook = {
    [customSymbol]() {
      throw error;
    },
  };
  expect(thrownBy(() => util.inspect({ a: hook }))).toBe(error);
  expect(thrownBy(() => util.inspect([[hook]]))).toBe(error);
});

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

  // Like node's customInspect() (lib/internal/webstreams/util.js), these hooks print
  // their fields one level below the depth they get. URL's hook does not: see below.
  test("depth 0 cuts the fields", async () => {
    expect(inspect(new ReadableStream(), { depth: 0 })).toBe("ReadableStream [Object]");
    expect(inspect(new WritableStream(), { depth: 0 })).toBe("WritableStream [Object]");
    expect(inspect({ rs: new ReadableStream() }, { depth: 1 })).toBe(
      "{\n  rs: ReadableStream { locked: false, state: 'readable', supportsBYOB: false }\n}",
    );
    const key = await crypto.subtle.generateKey({ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    expect(inspect(key, { depth: 0 })).toBe("CryptoKey [Object]");
  });

  // node's BroadcastChannel hook lowers `options.depth`, not its depth argument (lib/internal/worker/io.js).
  test("BroadcastChannel prints its fields when it is inside the depth", () => {
    const bc = new BroadcastChannel("hello");
    try {
      expect(inspect({ a: { c: bc } })).toBe("{ a: { c: BroadcastChannel { name: 'hello', active: true } } }");
      expect(inspect({ a: bc }, { depth: 1 })).toBe("{ a: BroadcastChannel { name: 'hello', active: true } }");
      expect(inspect({ a: bc }, { depth: 0 })).toBe("{ a: BroadcastChannel }");
      expect(inspect(bc, { depth: 0 })).toBe("BroadcastChannel [Object]");
      expect(bc[customSymbol](0, { depth: 2 })).toBe("BroadcastChannel { name: 'hello', active: true }");
      expect(bc[customSymbol](2, { depth: 0 })).toBe("BroadcastChannel [Object]");
    } finally {
      bc.close();
    }
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

// The expected texts are node v26.3.0's.
describe("URL", () => {
  const href = "http://example.com/a?k=v";
  const fields = (searchParams, indentation = "") =>
    [
      "{",
      "  href: 'http://example.com/a?k=v',",
      "  origin: 'http://example.com',",
      "  protocol: 'http:',",
      "  username: '',",
      "  password: '',",
      "  host: 'example.com',",
      "  hostname: 'example.com',",
      "  port: '',",
      "  pathname: '/a',",
      "  search: '?k=v',",
      `  searchParams: ${searchParams},`,
      "  hash: ''",
      "}",
    ].join("\n" + indentation);
  const cut = fields("[Object]");
  const full = fields("URLSearchParams { 'k' => 'v' }");
  class MyURL extends URL {}

  // node's URL hook gives its options to inspect() as they are (lib/internal/url.js),
  // so the depth counts the levels below the URL.
  describe("[nodejs.util.inspect.custom]", () => {
    test("prints the fields at depth 0 and the search params at depth 1", () => {
      expect(util.inspect(new URL(href), { depth: 0 })).toBe(`URL ${cut}`);
      expect(util.inspect(new URL(href), { depth: 1 })).toBe(`URL ${full}`);
      expect(util.inspect(new MyURL(href), { depth: 0 })).toBe(`MyURL ${cut}`);
    });

    test("prints the same text for Bun.inspect", () => {
      expect(Bun.inspect(new URL(href), { depth: 0 })).toBe(`URL ${cut}`);
      expect(Bun.inspect(new URL(href), { depth: 1 })).toBe(`URL ${full}`);
    });

    test("prints a nested URL with the depth that the caller asked for", () => {
      expect(util.inspect({ a: new URL(href) }, { depth: 1 })).toBe(
        `{\n  a: URL ${fields("URLSearchParams { 'k' => 'v' }", "  ")}\n}`,
      );
      expect(util.inspect({ a: new URL(href) }, { depth: 0 })).toBe("{ a: URL {} }");
      expect(util.inspect({ a: { b: new URL(href) } }, { depth: 1 })).toBe("{ a: { b: URL {} } }");
    });

    test("gets the depth from every form of the options", () => {
      expect(util.inspect(new URL(href), false, 0)).toBe(`URL ${cut}`);
      expect(util.formatWithOptions({ depth: 0 }, new URL(href))).toBe(`URL ${cut}`);
      expect(util.inspect(new URL(href), { depth: 0, showHidden: true })).toBe(
        `URL ${cut.slice(0, -2)},\n  Symbol(context): [URLContext]\n}`,
      );
    });

    test("returns the URL for a negative depth that is a number", () => {
      const url = new URL(href);
      expect(url[customSymbol](-1, {})).toBe(url);
      expect(url[customSymbol](0, { depth: 0 })).toBe(`URL ${cut}`);
      expect(url[customSymbol]("-1", { depth: 0 })).toBe(`URL ${cut}`);
    });
  });

  // node's formatRaw() prints a URL that no hook formatted as its href
  // (lib/internal/util/inspect.js). node:assert and Console#dir ask for that.
  describe("with customInspect: false", () => {
    const raw = { customInspect: false };

    test("prints the href", () => {
      expect(util.inspect(new URL(href), raw)).toBe(href);
      expect(util.inspect([new URL(href)], raw)).toBe(`[ ${href} ]`);
      expect(util.inspect({ url: new URL(href) }, raw)).toBe(`{ url: ${href} }`);
      expect(util.inspect({ a: { b: { c: { d: new URL(href) } } } }, { ...raw, depth: null })).toBe(
        `{\n  a: { b: { c: { d: ${href} } } }\n}`,
      );
      expect(util.formatWithOptions(raw, "%O", new URL(href))).toBe(href);
    });

    test("prints the href of a subclass without the class name", () => {
      expect(util.inspect(new MyURL(href), raw)).toBe(href);
    });

    test("prints own properties after the href", () => {
      const url = new URL("http://example.com/own");
      url.extra = 1;
      expect(util.inspect(url, raw)).toBe("http://example.com/own { extra: 1 }");
    });

    test("prints the href that the URL has now", () => {
      const url = new URL("http://example.com/a");
      url.pathname = "/changed";
      url.searchParams.set("q", "1");
      url.hash = "h";
      expect(util.inspect(url, raw)).toBe("http://example.com/changed?q=1#h");
    });

    test("prints the href up to the depth and URL {} past it", () => {
      expect(util.inspect(new URL(href), { ...raw, depth: 0 })).toBe(href);
      expect(util.inspect({ a: new URL(href) }, { ...raw, depth: 1 })).toBe(`{ a: ${href} }`);
      expect(util.inspect({ a: new URL(href) }, { ...raw, depth: 0 })).toBe("{ a: URL {} }");
      expect(util.inspect(new URL(href), { ...raw, depth: -1 })).toBe("URL {}");
    });

    test("prints the accessors of the prototype after the href with showHidden", () => {
      class WithGetter extends URL {
        get foo() {
          return 1;
        }
      }
      expect(util.inspect(new WithGetter(href), { ...raw, showHidden: true })).toStartWith(
        `${href} {\n  [foo]: [Getter],\n  href: [Getter/Setter],`,
      );
      expect(util.formatWithOptions(raw, "%o", new URL(href))).toStartWith(`${href} {\n  href: [Getter/Setter],`);
    });

    test("prints the href when the hook is shadowed or returns the URL", () => {
      const shadowed = new URL(href);
      Object.defineProperty(shadowed, customSymbol, { value: undefined });
      expect(util.inspect(shadowed)).toBe(href);

      const returnsItself = new URL(href);
      Object.defineProperty(returnsItself, customSymbol, {
        value() {
          return this;
        },
      });
      expect(util.inspect(returnsItself)).toBe(href);
    });

    test("does not ask globalThis.URL what a URL is", () => {
      const url = new URL(href);
      const NativeURL = globalThis.URL;
      globalThis.URL = class URL {};
      try {
        expect(util.inspect(url, raw)).toBe(href);
      } finally {
        globalThis.URL = NativeURL;
      }
    });

    test("reads href before the class test, like node", () => {
      let reads = 0;
      class Link {
        get href() {
          reads++;
          return "http://example.com/a";
        }
      }
      expect(util.inspect(new Link(), raw)).toBe("Link {}");
      expect(reads).toBe(1);

      class NumberHref extends URL {
        get href() {
          return 42;
        }
      }
      expect(util.inspect(new NumberHref(href), raw)).toBe("NumberHref [URL] {}");

      // node tests `typeof href === "string"`, so it prints an empty href too: the value has no text.
      class EmptyHref extends URL {
        get href() {
          return "";
        }
      }
      expect(util.inspect(new EmptyHref(href), raw)).toBe("");
      expect(util.inspect({ a: new EmptyHref(href) }, raw)).toBe("{ a:  }");
    });

    test("rethrows the error of a href getter, like node", () => {
      const error = new Error("href getter");
      class Broken {
        get href() {
          throw error;
        }
      }
      expect(thrownBy(() => util.inspect(new Broken(), raw))).toBe(error);
      expect(thrownBy(() => util.inspect({ a: new Broken() }, raw))).toBe(error);
      expect(thrownBy(() => util.inspect([new Broken()]))).toBe(error);
      // One level past the default depth: the read comes before the depth test.
      expect(thrownBy(() => util.inspect({ a: { b: { c: new Broken() } } }))).toBe(error);
    });
  });
});
