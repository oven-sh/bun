// this file is compatible with jest to test node.js' util.inspect as well as bun's

const util = require("util");
const { join } = require("node:path");
const { bunEnv, bunExe, tempDir } = process.versions.bun ? require("harness") : {};

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

// What is Bun's own about node's method on the web classes. inspect-web-classes.test.ts has the text that node prints.
(process.versions.bun ? describe : describe.skip)("web classes [nodejs.util.inspect.custom]", () => {
  const inspect = util.inspect;
  const flat = value => inspect(value, { breakLength: Infinity });
  function onTimeout() {}
  const make = {
    Headers: () => new Headers({ "x-request-id": "abc123" }),
    Response: () => new Response("nope", { status: 404, headers: { "x-request-id": "abc123" } }),
    Request: () => new Request("http://127.0.0.1:1/users?id=7", { method: "POST", body: "x" }),
    Blob: () => new Blob(["hello"], { type: "text/csv" }),
    File: () => new File(["hello"], "report.csv", { type: "text/csv", lastModified: 5 }),
    FormData: () => {
      const form = new FormData();
      form.append("user", "ada");
      return form;
    },
    AbortSignal: () => AbortSignal.abort("why"),
    AbortController: () => new AbortController(),
    Event: () => new Event("ping"),
    TextDecoder: () => new TextDecoder("utf-16le"),
    Timeout: () => setTimeout(onTimeout, 50),
  };
  const rows = Object.entries(make);
  const withValue = (create, use) => {
    const value = create();
    try {
      return use(value);
    } finally {
      if (create === make.Timeout) clearTimeout(value);
    }
  };
  const run = async script => {
    await using proc = Bun.spawn({ cmd: [bunExe(), "-e", script], env: bunEnv, stdout: "pipe", stderr: "pipe" });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout, stderr, exitCode };
  };

  describe("the native console keeps its text", () => {
    test("Bun.inspect prints what it printed before the classes had the method", () => {
      const text = Object.fromEntries(
        rows.map(([name, create]) => [name, withValue(create, value => Bun.inspect(value))]),
      );
      expect(text).toEqual({
        Headers: 'Headers {\n  "x-request-id": "abc123",\n}',
        Response:
          'Response (4 bytes) {\n  ok: false,\n  url: "",\n  status: 404,\n  statusText: "",\n  headers: Headers {\n    "x-request-id": "abc123",\n  },\n  redirected: false,\n  bodyUsed: false,\n  Blob (4 bytes)\n}',
        Request:
          'Request (1 bytes) {\n  method: "POST",\n  url: "http://127.0.0.1:1/users?id=7",\n  headers: Headers {}\n  Blob (1 bytes)\n}',
        Blob: 'Blob (5 bytes) {\n  type: "text/csv"\n}',
        File: 'File (5 bytes) {\n  name: "report.csv",\n  type: "text/csv",\n  lastModified: 5\n}',
        FormData: 'FormData {\n  "user": "ada",\n}',
        AbortSignal: expect.stringContaining('AbortSignal {\n  aborted: true,\n  reason: "why",\n  onabort: null,'),
        AbortController: expect.stringContaining("AbortController {\n  signal: AbortSignal {\n    aborted: false,"),
        Event: expect.stringContaining('Event {\n  isTrusted: false,\n  type: "ping",'),
        TextDecoder:
          'TextDecoder {\n  decode: [Function: decode],\n  encoding: "utf-16le",\n  fatal: false,\n  ignoreBOM: false,\n}',
        Timeout: expect.stringMatching(/^Timeout \(#\d+\)$/),
      });
      // No text names the method.
      expect(Object.values(text).filter(value => value.includes("inspect.custom"))).toEqual([]);
    });

    test("a prototype is listed without the method, by Bun.inspect and by the printer of bun:test", () => {
      expect(Bun.inspect(Blob.prototype)).not.toContain("inspect.custom");
      expect([AbortController.prototype, TextDecoder.prototype]).toMatchInlineSnapshot(`
        [
          AbortController AbortController {
            "abort": [Function: abort],
            "signal": undefined,
          },
          TextDecoder TextDecoder {
            "decode": [Function: decode],
            "encoding": undefined,
            "fatal": undefined,
            "ignoreBOM": undefined,
          },
        ]
      `);
    });

    test("one of the methods under another key is listed as any function", () => {
      const method = Blob.prototype[customSymbol];
      expect(Bun.inspect({ method, [Symbol("nodejs.util.inspect.custom")]: 1 })).toBe(
        "{\n  method: [Function: [nodejs.util.inspect.custom]],\n  [Symbol(nodejs.util.inspect.custom)]: 1,\n}",
      );
    });

    test("a method that a program put on the value, or on a prototype above, is called", () => {
      const own = new Blob(["x"]);
      own[customSymbol] = () => "own method";
      class Logged extends Response {
        [customSymbol]() {
          return "subclass method";
        }
      }
      const signal = AbortSignal.abort();
      EventTarget.prototype[customSymbol] = () => "EventTarget method";
      try {
        expect([Bun.inspect(own), Bun.inspect(new Logged(null)), Bun.inspect(signal)]).toEqual([
          "own method",
          "subclass method",
          "EventTarget method",
        ]);
      } finally {
        delete EventTarget.prototype[customSymbol];
      }
      // Object.prototype is not a place where the console looks for the method.
      Object.prototype[customSymbol] = () => "Object method";
      try {
        expect(Bun.inspect(signal)).toStartWith("AbortSignal {");
      } finally {
        delete Object.prototype[customSymbol];
      }
    });

    test("a method of a program that passes a Response to its inspect argument prints the state", () => {
      const wrapper = {
        response: new Response(null, { status: 404 }),
        [customSymbol](depth, options, inspect) {
          return `Wrapper ${inspect(this.response, { ...options, breakLength: Infinity, colors: false })}`;
        },
      };
      expect(Bun.inspect(wrapper)).toBe(
        "Wrapper Response { status: 404, statusText: '', headers: Headers {}, body: null, bodyUsed: false, ok: false, redirected: false, type: 'default', url: '' }",
      );
    });
  });

  describe("the native half runs no code of the program", () => {
    test("no getter of the class runs", () => {
      const names = {
        Headers: [],
        Response: ["status", "statusText", "headers", "body", "bodyUsed", "ok", "redirected", "type", "url"],
        Request: ["method", "url", "headers", "referrer", "mode", "credentials", "cache", "redirect", "signal"],
        Blob: ["size", "type", "name", "lastModified"],
        File: ["size", "type", "name", "lastModified"],
        FormData: [],
        AbortSignal: ["aborted"],
        AbortController: ["signal"],
        Event: ["type", "defaultPrevented", "cancelable", "timeStamp"],
        TextDecoder: ["encoding", "fatal", "ignoreBOM"],
        // A timer prints its own properties, so an accessor on it is part of its text.
        Timeout: [],
      };
      for (const [name, create] of rows) {
        withValue(create, value => {
          const before = inspect(value);
          let calls = 0;
          // A getter on the value hides the one of the class. Neither half reads it.
          for (const key of names[name]) {
            Object.defineProperty(value, key, { get: () => (calls++, undefined), configurable: true });
          }
          expect({ name, text: inspect(value), calls }).toEqual({ name, text: before, calls: 0 });
        });
      }
    });

    test("a FormData and a Headers print their entries with setters of those names on Object.prototype", () => {
      const form = new FormData();
      form.append("user", "ada");
      form.append("user", "bob");
      const headers = new Headers({ user: "ada" });
      let calls = 0;
      Object.defineProperty(Object.prototype, "user", { set: () => void calls++, configurable: true });
      try {
        expect([inspect(form), inspect(headers), calls]).toEqual([
          "FormData { user: [ 'ada', 'bob' ] }",
          "Headers { user: 'ada' }",
          0,
        ]);
      } finally {
        delete Object.prototype.user;
      }
    });

    test("an option with an index key is an option like any other", () => {
      const event = new Event("ping");
      expect(
        [
          make.Blob(),
          make.File(),
          AbortSignal.abort(),
          new AbortController(),
          event,
          new Response(new ReadableStream()),
        ].map(value => inspect(value, { 0: 1, breakLength: Infinity })),
      ).toEqual([
        "Blob { size: 5, type: 'text/csv' }",
        "File { size: 5, type: 'text/csv', name: 'report.csv', lastModified: 5 }",
        "AbortSignal { aborted: true }",
        "AbortController { signal: AbortSignal { aborted: false } }",
        `Event { type: 'ping', defaultPrevented: false, cancelable: false, timeStamp: ${event.timeStamp} }`,
        "Response { status: 200, statusText: '', headers: Headers {}, body: ReadableStream { locked: false, state: 'readable', supportsBYOB: false }, bodyUsed: false, ok: true, redirected: false, type: 'default', url: '' }",
      ]);
    });

    test("the method does not go through the inspect export of node:util", () => {
      const exported = util.inspect;
      try {
        util.inspect = 4;
        expect(util.format("%O", make.Blob())).toBe("Blob { size: 5, type: 'text/csv' }");
      } finally {
        util.inspect = exported;
      }
    });

    test("a property named body on Object.prototype is not the body of a Request or a Response", () => {
      const request = new Request("http://127.0.0.1:1/");
      const response = new Response("x");
      const before = [flat(request), flat(response)];
      Object.defineProperty(Object.prototype, "body", { value: "polluted", configurable: true });
      try {
        expect([flat(request), flat(response)]).toEqual(before);
      } finally {
        delete Object.prototype.body;
      }
    });

    test.concurrent("the methods do not read the globals Blob and File", async () => {
      const { stdout, exitCode } = await run(`
        const util = require("node:util");
        const file = new File(["x"], "a.txt", { lastModified: 5 });
        const headers = new Headers({ a: "1" });
        delete globalThis.Blob;
        globalThis.File = class File {};
        console.log(util.inspect(headers));
        console.log(util.inspect({ it: file }, { depth: 0 }));
        console.log(util.inspect(file));
      `);
      expect({ stdout, exitCode }).toEqual({
        stdout: "Headers { a: '1' }\n{ it: [File] }\nFile { size: 1, type: '', name: 'a.txt', lastModified: 5 }\n",
        exitCode: 0,
      });
    });

    test.concurrent("a stack overflow in the method is an error, not a crash", async () => {
      // Every sixteenth level tries a print on the way back from the deepest call. `probe` runs after the others.
      const { stdout, exitCode } = await run(`
        const util = require("node:util");
        let ran = 0;
        let level = 0;
        const probe = { [util.inspect.custom]: () => (ran++, "probe") };
        const values = [new Blob(["x"]), new File(["x"], "a"), new TextDecoder(), AbortSignal.abort(), new Response(null)];
        function recurse() {
          level++;
          try {
            recurse();
          } catch {}
          level--;
          if (level % 16 === 0 && ran < 2) {
            try {
              util.inspect([...values, probe], { depth: 0 });
            } catch {}
          }
        }
        recurse();
        console.log(ran);
        console.log(util.inspect({ it: values }, { depth: 1, breakLength: Infinity }));
      `);
      expect({ stdout, exitCode }).toEqual({
        stdout:
          "2\n" +
          "{ it: [ [Blob], [File], [TextDecoder], [AbortSignal], Response { status: 200, statusText: '', " +
          "headers: Headers {}, body: null, bodyUsed: false, ok: true, redirected: false, type: 'default', url: '' } ] }\n",
        exitCode: 0,
      });
    });
  });

  // Each method starts a new util.inspect, so the methods hand on which values they print.
  describe("a value that holds itself in a field that its method prints", () => {
    class Envelope {
      constructor(value) {
        this.value = value;
      }
    }

    test("is [Circular] where the depth does not count down", () => {
      class ApiResponse extends Response {
        body = new Envelope(this);
      }
      const controller = new AbortController();
      Object.defineProperty(controller, "signal", { value: controller });
      const decoder = new TextDecoder();
      Object.defineProperty(decoder, "encoding", { value: [decoder] });
      // A Proxy around the value is the same value.
      const request = new Request("http://127.0.0.1:1/");
      Object.defineProperty(request, "signal", { value: new Proxy(request, {}) });
      expect([
        flat(new ApiResponse(null)),
        inspect(controller, { depth: null }),
        inspect(controller, { depth: Infinity }),
        inspect(decoder),
        flat(request).slice(-21),
      ]).toEqual([
        "Response { status: 200, statusText: '', headers: Headers {}, body: Envelope { value: [Circular] }, bodyUsed: false, ok: true, redirected: false, type: 'default', url: '' }",
        "AbortController { signal: [Circular] }",
        "AbortController { signal: [Circular] }",
        "TextDecoder { encoding: [ [Circular] ], fatal: false, ignoreBOM: false }",
        " signal: [Circular] }",
      ]);
    });

    test("the same value twice in one print is not a cycle", () => {
      const blob = new Blob(["x"]);
      const response = new Response(null);
      Object.defineProperty(response, "url", { value: [blob, blob] });
      expect([inspect([blob, blob], { depth: null }), flat(response).slice(flat(response).indexOf("url:"))]).toEqual([
        "[ Blob { size: 1, type: '' }, Blob { size: 1, type: '' } ]",
        "url: [ Blob { size: 1, type: '' }, Blob { size: 1, type: '' } ] }",
      ]);
    });

    test("a print that starts while the same value prints is a print like any other", () => {
      const response = new Response(null);
      const plain = inspect(response);
      let inner;
      const outer = inspect(response, {
        stylize(text) {
          inner ??= inspect(response);
          return text;
        },
      });
      expect([inner, outer]).toEqual([plain, plain]);
    });

    test("a print that a node:vm timeout ends leaves the value as it was", () => {
      const vm = require("node:vm");
      const values = { response: new Response(null), blob: new Blob(["x"]), headers: new Headers({ a: "1" }) };
      const before = Object.values(values).map(value => inspect(value));
      const context = vm.createContext({ inspect, values });
      for (const name of Object.keys(values)) {
        expect(() => vm.runInContext(`for (;;) inspect(values.${name});`, context, { timeout: 20 })).toThrow(
          expect.objectContaining({ code: "ERR_SCRIPT_EXECUTION_TIMEOUT" }),
        );
      }
      expect(Object.values(values).map(value => inspect(value))).toEqual(before);
    });
  });

  describe("a print changes nothing", () => {
    test("the headers line is what response.headers gives, before and after a read of it", () => {
      const line = response =>
        inspect(response)
          .split("\n")
          .find(text => text.includes("headers:"))
          .trim();
      const of = headers => `headers: ${inspect(headers)},`;
      const bodies = {
        none: () => new Response(null),
        string: () => new Response("x"),
        blob: () => new Response(new Blob(["x"], { type: "text/csv" })),
        init: () => new Response("x", { headers: { "x-a": "1" } }),
        json: () => Response.json({ a: 1 }),
      };
      for (const [name, create] of Object.entries(bodies)) {
        const printed = create();
        const before = line(printed);
        // The first read of the getter, after a print. The next print has that list.
        const headers = printed.headers;
        const after = line(printed);
        expect({ name, before, after }).toEqual({ name, before: of(create().headers), after: of(headers) });
        expect(printed.headers).toBe(headers);
      }
    });

    test.concurrent("Bun.serve sends a printed Response as it sends one that was not printed", async () => {
      using dir = tempDir("inspect-web-classes", { "file.txt": "0123456789" });
      const path = join(String(dir), "file.txt");
      const formData = () => {
        const data = new FormData();
        data.append("a", "1");
        return data;
      };
      const bodies = {
        none: () => new Response(null, { status: 204 }),
        string: () => new Response("hello"),
        bytes: () => new Response(new Uint8Array([104, 105])),
        blob: () => new Response(new Blob(["hello"], { type: "text/csv" })),
        file: () => new Response(Bun.file(path)),
        slice: () => new Response(Bun.file(path).slice(2, 6)),
        params: () => new Response(new URLSearchParams("a=1")),
        json: () => Response.json({ a: 1 }),
        stream: () => new Response(new Blob(["hello"]).stream()),
        headers: () => new Response("hello", { headers: { "x-a": "1", "content-type": "text/x-test" } }),
        form: () => new Response(formData()),
      };
      await using server = Bun.serve({
        port: 0,
        fetch(request) {
          const url = new URL(request.url);
          const response = bodies[url.pathname.slice(1)]();
          if (url.searchParams.has("print")) inspect(response);
          return response;
        },
      });
      const seen = async (name, method, print) => {
        const response = await fetch(`${server.url}${name}${print ? "?print" : ""}`, { method });
        const headers = Object.fromEntries(response.headers);
        delete headers.date;
        if (headers["content-type"])
          headers["content-type"] = headers["content-type"].replace(/boundary=.*/, "boundary");
        const body = (await response.text()).replace(/-+WebKitFormBoundary\w+/g, "boundary");
        return { name, method, status: response.status, headers, body };
      };
      for (const name of Object.keys(bodies)) {
        for (const method of ["GET", "HEAD"]) {
          expect(await seen(name, method, true)).toEqual(await seen(name, method, false));
        }
      }
    });

    test.concurrent("a served Request prints its URL and its headers, and reads them the same after", async () => {
      let seen;
      await using server = Bun.serve({
        port: 0,
        routes: {
          "/users/:id": request => {
            const text = flat(request);
            seen = { text, url: request.url, accept: request.headers.get("accept"), id: request.params.id };
            return new Response("ok");
          },
        },
        fetch(request) {
          const text = flat(request);
          seen = { text, url: request.url, accept: request.headers.get("accept") };
          return new Response("ok");
        },
      });
      for (const path of ["/plain?q=1", "/users/7?q=1"]) {
        await (await fetch(`${server.url}${path.slice(1)}`, { headers: { accept: "text/x-test" } })).text();
        const url = `${server.url}${path.slice(1)}`;
        expect(seen.url).toBe(url);
        expect(seen.accept).toBe("text/x-test");
        expect(seen.text).toStartWith(`Request { method: 'GET', url: '${url}', headers: Headers { `);
        expect(seen.text).toContain("accept: 'text/x-test'");
      }
    });

    test("a Request shows the signal it has, or the one that `signal` gives, and keeps none", () => {
      const { heapStats } = require("bun:jsc");
      const signals = () => heapStats().objectTypeCounts.AbortSignal ?? 0;
      const controller = new AbortController();
      controller.abort();
      const withSignal = new Request("http://127.0.0.1:1/", { signal: controller.signal });
      const requests = Array.from({ length: 50 }, () => new Request("http://127.0.0.1:1/"));
      const signalOf = request => flat(request).slice(flat(request).indexOf("signal:"));
      expect([signalOf(withSignal), signalOf(requests[0])]).toEqual([
        "signal: AbortSignal { aborted: true } }",
        "signal: AbortSignal { aborted: false } }",
      ]);
      Bun.gc(true);
      const before = signals();
      for (const request of requests) inspect(request);
      Bun.gc(true);
      // A print made a signal for each Request, and no Request kept one.
      expect(signals() - before).toBeLessThan(requests.length / 2);
      // The getter makes the signal and keeps it.
      const kept = requests.map(request => request.signal);
      Bun.gc(true);
      expect(signals() - before).toBeGreaterThan(kept.length / 2);
    });

    test.concurrent("after Bun.serve sent a Response, the print has what its getters give", async () => {
      let response;
      await using server = Bun.serve({
        port: 0,
        fetch() {
          response = new Response("hello", { headers: { "x-a": "1" } });
          // The program read the headers before the server sent the Response.
          response.headers.set("x-b", "2");
          return response;
        },
      });
      await (await fetch(server.url)).text();
      const line = name =>
        inspect(response)
          .split("\n")
          .find(text => text.trim().startsWith(`${name}:`))
          ?.trim();
      expect([line("headers"), line("bodyUsed"), line("status")]).toEqual([
        `headers: ${inspect(response.headers)},`,
        `bodyUsed: ${response.bodyUsed},`,
        "status: 200,",
      ]);
    });

    test("a Bun.file() shows a size only once it has one", async () => {
      using dir = tempDir("inspect-web-classes", { "file.txt": "0123456789" });
      const file = Bun.file(join(String(dir), "file.txt"));
      const missing = Bun.file(join(String(dir), "missing.txt"));
      const before = [inspect(file), inspect(missing), inspect(file.slice(2, 6))];
      const size = file.size;
      expect({ before, after: inspect(file), size }).toEqual({
        before: [
          "Blob { type: 'text/plain;charset=utf-8' }",
          "Blob { type: 'text/plain;charset=utf-8' }",
          "Blob { type: 'text/plain;charset=utf-8' }",
        ],
        after: "Blob { size: 10, type: 'text/plain;charset=utf-8' }",
        size: 10,
      });
    });

    test.concurrent("an S3 file prints as a Blob, and no request is made", async () => {
      let requests = 0;
      await using server = Bun.serve({
        port: 0,
        fetch() {
          requests++;
          return new Response("", { status: 404 });
        },
      });
      const client = new Bun.S3Client({
        accessKeyId: "test",
        secretAccessKey: "test",
        bucket: "bucket",
        endpoint: server.url.href,
      });
      const file = client.file("key.txt");
      expect([inspect(file), inspect({ it: file }, { depth: 0 })]).toEqual([
        `Blob { type: '${file.type}' }`,
        "{ it: [Blob [S3File]] }",
      ]);
      // A request of a print would be at the server before this one.
      await (await fetch(server.url)).text();
      expect(requests).toBe(1);
      // The prototype of an S3 file inherits the method.
      expect(Object.hasOwn(Object.getPrototypeOf(file), customSymbol)).toBe(false);
    });

    test("a value prints as a File when instanceof File says so", () => {
      const file = new File(["x"], "a.txt", { lastModified: 5 });
      const copy = new Blob([file]);
      const notNumber = new File(["x"], "a.txt", { lastModified: NaN });
      expect([inspect(file), inspect(new Blob(["x"])), inspect(copy).startsWith("File {"), inspect(notNumber)]).toEqual(
        [
          "File { size: 1, type: '', name: 'a.txt', lastModified: 5 }",
          "Blob { size: 1, type: '' }",
          copy instanceof File,
          `File { size: 1, type: '', name: 'a.txt', lastModified: ${notNumber.lastModified} }`,
        ],
      );
    });
  });

  describe("Timeout", () => {
    test("prints the properties a program added, after its own", () => {
      const timeout = setTimeout(onTimeout, 50);
      try {
        timeout.custom = 7;
        timeout[Symbol.for("tag")] = "t";
        timeout.self = timeout;
        Object.defineProperty(timeout, "hidden", { value: 1 });
        expect(inspect(timeout).split("\n")).toEqual([
          "<ref *1> Timeout {",
          "  _idleTimeout: 50,",
          `  _idleStart: ${timeout._idleStart},`,
          "  _onTimeout: [Function: onTimeout],",
          "  _repeat: null,",
          "  _destroyed: false,",
          "  custom: 7,",
          "  self: [Circular *1],",
          "  Symbol(tag): 't'",
          "}",
        ]);
        expect(inspect(timeout, { showHidden: true })).toContain("[hidden]: 1");
        // The print made no change to the timer.
        expect([timeout.self, timeout.custom, timeout.hasRef(), Object.keys(timeout)]).toEqual([
          timeout,
          7,
          true,
          ["custom", "self"],
        ]);
      } finally {
        clearTimeout(timeout);
      }
    });

    test("prints its callback one level deep, as the function it was given", () => {
      function withProperty() {}
      withProperty.meta = { nested: { deep: 1 } };
      const timeout = setTimeout(withProperty, 50);
      try {
        expect(inspect(timeout).split("\n")[3]).toBe("  _onTimeout: [Function],");
        expect(timeout._onTimeout).toBe(withProperty);
      } finally {
        clearTimeout(timeout);
      }
    });

    test("an object that inherits from a timer is not the timer", () => {
      const timeout = setTimeout(onTimeout, 50);
      try {
        const child = Object.create(timeout);
        child.own = 1;
        expect(inspect(child)).toBe("Timeout { own: 1 }");
      } finally {
        clearTimeout(timeout);
      }
    });
  });

  test.concurrent("each prototype has the method before node:util loads, and in a Worker", async () => {
    const { stdout, exitCode } = await run(`
      const custom = Symbol.for("nodejs.util.inspect.custom");
      const count = () => {
        const timeout = setTimeout(() => {}, 1);
        clearTimeout(timeout);
        return [Response, Request, Headers, FormData, Blob, AbortSignal, AbortController, Event, TextDecoder]
          .map(constructor => constructor.prototype)
          .concat(Object.getPrototypeOf(timeout))
          .filter(prototype => typeof Object.getOwnPropertyDescriptor(prototype, custom)?.value === "function").length;
      };
      console.log(count(), new Blob(["hello"])[custom](2, {}));
      const code =
        "const custom = Symbol.for('nodejs.util.inspect.custom'); const count = " +
        count +
        "; postMessage([count(), new Blob(['hello'])[custom](2, {})]);";
      const worker = new Worker(URL.createObjectURL(new Blob([code])));
      worker.onmessage = event => {
        console.log(...event.data);
        worker.terminate();
      };
    `);
    expect({ stdout, exitCode }).toEqual({
      stdout: "10 Blob { size: 5, type: '' }\n10 Blob { size: 5, type: '' }\n",
      exitCode: 0,
    });
  });
});
