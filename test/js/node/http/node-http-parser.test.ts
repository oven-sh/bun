import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { maxHeaderSize } from "node:http";
const { HTTPParser, ConnectionsList, methods, allMethods } = process.binding("http_parser") as any;
const { parsers } = require("node:_http_common");

const { REQUEST, RESPONSE, kOnMessageBegin, kOnHeaders, kOnHeadersComplete, kOnBody, kOnMessageComplete } = HTTPParser;

const callbacks = {
  begin: kOnMessageBegin,
  headers: kOnHeaders,
  head: kOnHeadersComplete,
  body: kOnBody,
  complete: kOnMessageComplete,
};
type Callback = keyof typeof callbacks;

/** A parser that logs the calls of its callbacks. `hooks` run after that, and say what to return. */
function recorded(type: number, hooks: { [name in Callback]?: (parser: any) => unknown } = {}, ...rest: unknown[]) {
  const parser = new HTTPParser();
  parser.initialize(type, {}, ...rest);
  const calls: unknown[][] = [];
  for (const [name, index] of Object.entries(callbacks)) {
    parser[index] = function (...args: unknown[]) {
      calls.push([name, ...args.map(arg => (Buffer.isBuffer(arg) ? arg.toString("latin1") : arg))]);
      return hooks[name as Callback]?.(this);
    };
  }
  const execute = (text: string) => parser.execute(Buffer.from(text, "latin1"));
  return { parser, calls, execute, names: () => calls.map(call => call[0]).join(" ") };
}

const manyFields = Array.from({ length: 32 }, (_, i) => [`a${i}`, `${i}`]);
const lines = (fields: string[][]) => fields.map(([name, value]) => `${name}: ${value}\r\n`).join("");
/** Calls every callback, and has another request behind it. */
const everyCallback = `POST /a HTTP/1.1\r\n${lines(manyFields)}Content-Length: 1\r\n\r\nAGET /b HTTP/1.1\r\n\r\n`;
const everyCall = ["begin", "headers", "headers", "head", "body", "complete"];

test("shape of the class", () => {
  expect({ ...HTTPParser }).toEqual({
    REQUEST: 1,
    RESPONSE: 2,
    kOnMessageBegin: 0,
    kOnHeaders: 1,
    kOnHeadersComplete: 2,
    kOnBody: 3,
    kOnMessageComplete: 4,
    kOnExecute: 5,
    kOnTimeout: 6,
    kLenientNone: 0,
    kLenientHeaders: 1,
    kLenientChunkedLength: 2,
    kLenientKeepAlive: 4,
    kLenientTransferEncoding: 8,
    kLenientVersion: 16,
    kLenientDataAfterClose: 32,
    kLenientOptionalLFAfterCR: 64,
    kLenientOptionalCRLFAfterChunk: 128,
    kLenientOptionalCRBeforeLF: 256,
    kLenientSpacesAfterChunkSize: 512,
    kLenientHeaderValueRelaxed: 1024,
    kLenientAll: 1023,
  });
  expect(HTTPParser.name).toBe("HTTPParser");
  expect(HTTPParser()).toBeUndefined();
  expect(Object.prototype.toString.call(new HTTPParser())).toBe("[object HTTPParser]");

  const names = Object.keys(HTTPParser.prototype);
  expect(names.join(" ")).toBe(
    "close free remove execute finish initialize pause resume consume unconsume getCurrentBuffer duration headersCompleted",
  );
  for (const name of names) {
    const { value, ...attributes } = Object.getOwnPropertyDescriptor(HTTPParser.prototype, name)!;
    expect(attributes).toEqual({ writable: true, enumerable: true, configurable: true });
    expect(value.length).toBe(0);
    expect(() => value.call({})).toThrow(TypeError);
  }
});

describe("method lists", () => {
  // oven-sh/bun#35273
  test("contain M-SEARCH, not a malformed token", () => {
    expect(methods).toContain("M-SEARCH");
    expect(allMethods).toContain("M-SEARCH");
  });

  test("contain no whitespace in any method token", () => {
    for (const method of [...methods, ...allMethods]) {
      expect(method).toMatch(/^[A-Z_-]+$/);
    }
  });

  test("the method of a request is an index of allMethods", () => {
    expect([methods.length, allMethods.length]).toEqual([35, 47]);
    for (const method of methods) {
      const { calls, execute } = recorded(REQUEST);
      execute(`${method} / HTTP/1.1\r\n\r\n`);
      expect(allMethods[calls[1][4] as number]).toBe(method);
    }
  });
});

describe("HTTPParser.prototype.close", () => {
  test("does not double free", () => {
    const parser = new HTTPParser();

    expect(parser.close()).toBeUndefined();
    expect(parser.close()).toBeUndefined();
  });

  test("does not segfault calling other methods after close", () => {
    const parser = new HTTPParser();

    parser.close();

    // implementation was freed, test each method

    expect(parser.close()).toBeUndefined();
    expect(parser.free()).toBeUndefined();
    expect(parser.remove()).toBeUndefined();
    expect(parser.execute()).toBeUndefined();
    expect(parser.execute(Buffer.from("G"))).toBeUndefined();
    expect(parser.finish()).toBeUndefined();
    expect(parser.initialize()).toBeUndefined();
    expect(parser.pause()).toBeUndefined();
    expect(parser.resume()).toBeUndefined();
    expect(parser.consume()).toBeUndefined();
    expect(parser.unconsume()).toBeUndefined();
    expect(parser.getCurrentBuffer()).toBeUndefined();
    expect(parser.duration()).toBeUndefined();
    expect(parser.headersCompleted()).toBeUndefined();
  });
});

describe("HTTPParser before initialize()", () => {
  test("execute() and finish() throw instead of running over uninitialised state", () => {
    // Churn the parser heap first so a fresh cell is likely to land on reused memory.
    let junk: any[] | null = [];
    for (let i = 0; i < 500; i++) {
      const q = new HTTPParser();
      q.initialize(HTTPParser.REQUEST, {});
      q.execute(Buffer.from(`GET /${"a".repeat(i % 50)} HTTP/1.1\r\nHost: a\r\nX: b\r\n\r\n`));
      junk.push(q);
    }
    junk = null;
    Bun.gc(true);

    for (let i = 0; i < 50; i++) {
      const parser = new HTTPParser();
      expect(() => parser.execute(Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n"))).toThrow(
        expect.objectContaining({ code: "ERR_INVALID_STATE" }),
      );
      expect(() => parser.finish()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
      expect(parser.pause()).toBeUndefined();
      expect(parser.resume()).toBeUndefined();
      expect(parser.getCurrentBuffer()).toEqual(Buffer.alloc(0));
      expect(parser.headersCompleted()).toBe(false);
    }

    // and the parser is still usable once initialised
    const parser = new HTTPParser();
    parser.remove();
    expect(() => parser.finish()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    parser.initialize(HTTPParser.REQUEST, {});
    const input = Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    expect(parser.execute(input)).toBe(input.length);
  });
});

describe("HTTPParser.prototype.initialize", () => {
  test.each([
    [undefined, "undefined"],
    [0, "type number (0)"],
    [3, "type number (3)"],
    [-1, "type number (-1)"],
  ])("type %p throws", (type, received) => {
    expect(() => new HTTPParser().initialize(type, {})).toThrow(
      expect.objectContaining({
        code: "ERR_INVALID_ARG_VALUE",
        message: `The "type" argument is invalid. Received ${received}`,
      }),
    );
  });

  test.each([
    [10, 10],
    [10.9, 10],
    [0, maxHeaderSize],
    [0.5, maxHeaderSize],
    [-1, maxHeaderSize],
    [NaN, maxHeaderSize],
    [undefined, maxHeaderSize],
    ["10", maxHeaderSize],
  ])("maxHeaderSize %p", (value, limit) => {
    const withUrlOf = (length: number) =>
      recorded(REQUEST, {}, value).execute(`GET ${Buffer.alloc(length, "/")} HTTP/1.1\r\n\r\n`);
    expect(withUrlOf(limit - 1)).toBeNumber();
    expect(withUrlOf(limit)).toMatchObject({ code: "HPE_HEADER_OVERFLOW", reason: "Header overflow" });
  });

  test.each([
    [HTTPParser.kLenientVersion, undefined, "HPE_UNEXPECTED_SPACE"],
    [new Float64Array([HTTPParser.kLenientVersion])[0], undefined, "HPE_UNEXPECTED_SPACE"],
    [-1, undefined, undefined],
    [HTTPParser.kLenientAll & ~HTTPParser.kLenientVersion, "HPE_INVALID_VERSION", undefined],
    [HTTPParser.kLenientAll + 0.5, "HPE_INVALID_VERSION", "HPE_UNEXPECTED_SPACE"],
    [2 ** 32 - 1, "HPE_INVALID_VERSION", "HPE_UNEXPECTED_SPACE"],
    [String(HTTPParser.kLenientAll), "HPE_INVALID_VERSION", "HPE_UNEXPECTED_SPACE"],
    [undefined, "HPE_INVALID_VERSION", "HPE_UNEXPECTED_SPACE"],
  ])("lenientFlags %p", (flags, ...codes) => {
    const codeFor = (text: string) => recorded(REQUEST, {}, 0, flags).execute(text).code;
    expect(["GET / HTTP/5.6\r\n", "GET / HTTP/1.1\r\n a"].map(codeFor)).toEqual(codes);
  });

  test("does nothing when the list of connections is something else", () => {
    const { parser, execute, names } = recorded(REQUEST);
    execute("GET / HT");
    expect(parser.initialize(RESPONSE, {}, 0, 0, {})).toBeUndefined();
    execute("TP/1.1\r\n\r\n");
    expect(names()).toBe("begin head complete");
  });

  test("starts over", () => {
    const { parser, calls, execute } = recorded(REQUEST);
    expect(execute(`GET /a HTTP/1.0\r\n${lines(manyFields)}\r\nG`)).toBeInstanceOf(Error);
    expect(parser.headersCompleted()).toBe(true);
    parser.initialize(RESPONSE, {});
    expect(parser.headersCompleted()).toBe(false);
    calls.length = 0;
    expect(execute("HTTP/1.1 204 a\r\nb: c\r\n\r\n")).toBe(24);
    expect(calls).toEqual([
      ["begin"],
      ["head", 1, 1, ["b", "c"], undefined, undefined, 204, "a", false, true],
      ["complete"],
    ]);
  });
});

describe("HTTPParser.prototype.finish", () => {
  test("completes a message that ends with the connection", () => {
    const { parser, execute, names } = recorded(RESPONSE);
    execute("HTTP/1.1 200 OK\r\n\r\na");
    expect(names()).toBe("begin head body");
    expect(parser.finish()).toBeUndefined();
    expect(names()).toBe("begin head body complete");
  });

  test.each(["body", "complete"])("completes a message once, also from the %s callback", callback => {
    const { parser, execute, names } = recorded(RESPONSE, { [callback]: parser => parser.finish() });
    execute("HTTP/1.1 200 OK\r\n\r\na");
    parser.finish();
    parser.finish();
    expect(names()).toBe("begin head body complete");
    expect(execute("b").code).toBe("HPE_CLOSED_CONNECTION");
  });

  test("hands over the fields that nothing took", () => {
    const { parser, calls, execute } = recorded(RESPONSE);
    delete parser[kOnHeadersComplete];
    execute("HTTP/1.1 200 OK\r\na: b\r\n\r\nc");
    parser.finish();
    expect(calls).toEqual([["begin"], ["body", "c"], ["headers", ["a", "b"], ""], ["complete"]]);
  });

  test("throws what the callback throws", () => {
    const error = new Error("complete");
    const { parser, execute } = recorded(RESPONSE, {
      complete() {
        throw error;
      },
    });
    execute("HTTP/1.1 200 OK\r\n\r\n");
    expect(() => parser.finish()).toThrow(error);
  });

  test.each(["close", "remove"])("with %s()", method => {
    const before = recorded(RESPONSE);
    before.execute("HTTP/1.1 200 OK\r\n\r\n");
    before.parser[method]();
    expect(before.parser.finish()).toBeUndefined();
    expect(before.names()).toBe("begin head");

    const during = recorded(RESPONSE, { complete: parser => parser[method]() });
    during.execute("HTTP/1.1 200 OK\r\n\r\n");
    expect(during.parser.finish()).toBeUndefined();
  });

  test("reports bytesParsed of 0 when finish() fails after a paused parse", () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});

    // Returning HPE_PAUSED (21) from the headers-complete callback pauses mid-message.
    parser[kOnHeadersComplete] = function () {
      return 21;
    };

    const paused = parser.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
    expect(paused).toMatchObject({ code: "HPE_PAUSED" });

    parser.resume();

    const result = parser.finish();
    expect(result).toMatchObject({
      code: "HPE_INVALID_EOF_STATE",
      reason: "Invalid EOF state",
    });
    expect(result.bytesParsed).toBe(0);
  });

  test("returns error for invalid state", async () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});
    const input = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
    const { promise, resolve } = Promise.withResolvers();
    parser[kOnHeadersComplete] = function () {
      expect(this.finish()).toMatchObject({
        code: "HPE_INVALID_EOF_STATE",
        reason: "Invalid EOF state",
        bytesParsed: 0,
      });
      resolve();
    };
    parser.execute(input);
    await promise;
    expect(parser.finish()).toBeUndefined();
    expect(parser.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"))).toBe(37);
  });

  test("basic", async () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});
    expect(parser.finish()).toBeUndefined();
  });
});

describe("HTTPParser.prototype.execute", () => {
  const messages: [string, number, string, unknown[][]][] = [
    [
      "a request",
      REQUEST,
      "PUT /a?b HTTP/1.0\r\nHost:  c \t\r\nd:\r\ne: \xe9\xff\r\nContent-Length: 2\r\n\r\n\0\xff",
      [
        ["begin"],
        ["head", 1, 0, ["Host", "c", "d", "", "e", "\xe9\xff", "Content-Length", "2"], 4, "/a?b", , , false, false],
        ["body", "\0\xff"],
        ["complete"],
      ],
    ],
    [
      "a response after an interim response",
      RESPONSE,
      "HTTP/1.1 100 Continue\r\n\r\nHTTP/1.1 304 \xe9\r\na: b\r\n\r\n",
      [
        ["begin"],
        ["head", 1, 1, [], , , 100, "Continue", false, true],
        ["complete"],
        ["begin"],
        ["head", 1, 1, ["a", "b"], , , 304, "\xe9", false, true],
        ["complete"],
      ],
    ],
    [
      "a request with many fields",
      REQUEST,
      `GET /a HTTP/1.1\r\n${lines(manyFields)}\r\n`,
      [
        ["begin"],
        ["headers", manyFields.slice(0, 31).flat(), "/a"],
        ["headers", manyFields[31], ""],
        ["head", 1, 1, , 1, , , , false, true],
        ["complete"],
      ],
    ],
    [
      "a response with many fields",
      RESPONSE,
      `HTTP/1.1 204 a\r\n${lines(manyFields)}\r\n`,
      [
        ["begin"],
        ["headers", manyFields.slice(0, 31).flat(), ""],
        ["headers", manyFields[31], ""],
        ["head", 1, 1, , , , 204, "a", false, true],
        ["complete"],
      ],
    ],
    [
      "a request with trailers, and the next one",
      REQUEST,
      "POST /a HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n1;b=c\r\nd\r\n0\r\ne: f\r\n\r\nGET /g HTTP/1.1\r\nh: i\r\n\r\n",
      [
        ["begin"],
        ["head", 1, 1, ["Transfer-Encoding", "chunked"], 3, "/a", , , false, true],
        ["body", "d"],
        ["headers", ["e", "f"], "/a"],
        ["complete"],
        ["begin"],
        ["headers", ["h", "i"], "/g"],
        ["head", 1, 1, , 1, , , , false, true],
        ["complete"],
      ],
    ],
  ];

  test.each(messages)("%s", (_, type, text, expected) => {
    const whole = recorded(type);
    expect(whole.execute(text)).toBe(text.length);
    expect(whole.calls).toEqual(expected);

    // In a buffer that is overwritten for each read.
    for (const size of [1, 7]) {
      const { parser, calls } = recorded(type);
      const buffer = Buffer.alloc(size);
      for (let i = 0; i < text.length; i += size) {
        const length = buffer.write(text.slice(i, i + size), "latin1");
        expect(parser.execute(buffer.subarray(0, length))).toBe(length);
      }
      const joined: unknown[][] = [];
      for (const call of calls) {
        const last = joined.at(-1);
        if (call[0] === "body" && last?.[0] === "body") last[1] = `${last[1]}${call[1]}`;
        else joined.push(call);
      }
      expect(joined).toEqual(expected);
    }
  });

  test.each(messages)("%s, without callbacks", (_, type, text) => {
    const parser = new HTTPParser();
    parser.initialize(type, {});
    parser[kOnBody] = "not a function";
    expect(parser.execute(Buffer.from(text, "latin1"))).toBe(text.length);
  });

  test("reads the bytes of any view", () => {
    const text = "GET /ab HTTP/1.1\r\n\r\n";
    for (const buffer of [
      new ArrayBuffer(28),
      new ArrayBuffer(28, { maxByteLength: 32 }),
      new SharedArrayBuffer(28),
      new SharedArrayBuffer(28, { maxByteLength: 32 }),
    ]) {
      Buffer.from(buffer).write(text, 4);
      for (const view of [new Uint8Array(buffer, 4, 20), new Uint32Array(buffer, 4, 5), new DataView(buffer, 4, 20)]) {
        let current;
        const { parser, calls } = recorded(REQUEST, { head: parser => void (current = parser.getCurrentBuffer()) });
        expect(parser.execute(view)).toBe(20);
        expect(calls[1][5]).toBe("/ab");
        expect(current).toEqual(Buffer.from(text));
        expect(parser.getCurrentBuffer()).toEqual(Buffer.alloc(0));
      }
    }
  });

  test("ignores what is not a view", () => {
    const { parser, calls } = recorded(REQUEST);
    for (const input of [undefined, null, 1, "G", {}, [71], Uint8Array.of(71).buffer]) {
      expect(parser.execute(input)).toBeUndefined();
    }
    expect(calls).toEqual([]);
  });

  test("an empty view is not the end of the input", () => {
    const { parser, execute, names } = recorded(RESPONSE);
    execute("HTTP/1.1 200 OK\r\n\r\n");
    expect(parser.execute(new Uint8Array(0))).toBe(0);
    expect(names()).toBe("begin head");
  });

  test("throws for a detached view", () => {
    const memory = new WebAssembly.Memory({ initial: 1 });
    const views = [new Uint8Array(1), new Uint8Array(memory.buffer)];
    views[0].buffer.transfer();
    memory.grow(1);
    for (const view of views) {
      expect(() => recorded(REQUEST).parser.execute(view)).toThrow(new TypeError("Buffer is detached"));
    }
  });

  test("reads a copy of a shared view", () => {
    const view = Buffer.from(new SharedArrayBuffer(everyCallback.length));
    view.write(everyCallback);
    const { parser, names } = recorded(REQUEST, { begin: () => view.fill(0) });
    expect(parser.execute(view)).toBe(view.length);
    expect(names()).toStartWith(everyCall.join(" "));
  });

  test("counts bytes, not elements", () => {
    const closing = recorded(RESPONSE, { begin: parser => parser.close() });
    expect(closing.parser.execute(new Uint16Array(2))).toBe(4);

    const inBody = recorded(RESPONSE);
    inBody.execute("HTTP/1.1 200 OK\r\n\r\n");
    expect(inBody.parser.execute(new Uint16Array(2))).toBe(4);
  });

  describe.each([100, 5000])("with a view of %p more bytes", size => {
    const body = Buffer.alloc(size, "a").toString();
    const text = `${everyCallback}PUT / HTTP/1.1\r\nContent-Length: ${size + 1}\r\n\r\n${body}`;
    const viewOf = (text: string) => {
      const view = new Uint8Array(text.length);
      new TextEncoder().encodeInto(text, view);
      return view;
    };

    // Where to split `text` for it to be the first thing to run JavaScript in a read.
    test.each([
      ["begin", everyCallback.length],
      ["maxHeaderPairs", everyCallback.indexOf("a0")],
      ["headers", everyCallback.indexOf("a31")],
      ["head", everyCallback.indexOf("\nA")],
      ["body", everyCallback.indexOf("AGET")],
      ["complete", everyCallback.length - 1],
    ])("keeps it attached from %s on", (name, start) => {
      let input: Uint8Array | undefined;
      const transfer = () => void input?.buffer.transfer(0);
      const { parser, calls, execute } = recorded(REQUEST, { [name]: transfer });
      if (name === "maxHeaderPairs") Object.defineProperty(parser, name, { get: transfer });
      if (name === "complete") (delete parser[kOnHeadersComplete], delete parser[kOnHeaders]);
      execute(text.slice(0, start));
      input = viewOf(text.slice(start));
      expect(parser.execute(input)).toBe(text.length - start);
      expect(calls.at(-1)).toEqual(["body", body]);
      transfer();
      expect(input.length).toBe(0);
    });

    test.each(["called", "read"])("needs it no more when the last callback is %s", when => {
      const input = viewOf(body);
      const lengths: number[] = [];
      function transfer() {
        lengths.push(parser.getCurrentBuffer().length);
        input.buffer.transfer(0);
        lengths.push(parser.getCurrentBuffer().length);
      }
      const { parser, calls, execute } = recorded(RESPONSE, when === "called" ? { body: transfer } : {});
      execute("HTTP/1.1 200 OK\r\n\r\n");
      const onBody = parser[kOnBody];
      if (when === "read") Object.defineProperty(parser, kOnBody, { get: () => (transfer(), onBody) });
      expect(parser.execute(input)).toBe(size);
      expect(calls.at(-1)).toEqual(["body", body]);
      expect(lengths).toEqual([size, 0]);
    });
  });

  test("an error lasts", () => {
    const { parser, execute, names } = recorded(REQUEST);
    const error = execute("GET / HTTP/1.1\r\na b");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Parse Error");
    expect(Object.entries(error)).toEqual([
      ["bytesParsed", 17],
      ["code", "HPE_INVALID_HEADER_TOKEN"],
      ["reason", "Invalid header token"],
    ]);
    parser.pause();
    parser.resume();
    expect(parser.execute(new Uint16Array(2))).toMatchObject({ bytesParsed: 4, code: "HPE_INVALID_HEADER_TOKEN" });
    expect(parser.finish()).toBeUndefined();
    expect(names()).toBe("begin");
  });

  test.each([
    [0, 53, "begin head body complete begin"],
    [undefined, 53, "begin head body complete begin"],
    [1, 53, "begin head complete begin"],
    [true, 53, "begin head complete begin"],
    [2 ** 32 + 1, 53, "begin head complete begin"],
    [2, 38, "begin head complete"],
    [{ valueOf: () => 2 }, 38, "begin head complete"],
    [21, { code: "HPE_PAUSED", reason: "Paused by on_headers_complete", bytesParsed: 38 }, "begin head"],
    [-1, { code: "HPE_CB_HEADERS_COMPLETE", reason: "User callback error", bytesParsed: 38 }, "begin head"],
    [3, { code: "HPE_CB_HEADERS_COMPLETE", reason: "User callback error", bytesParsed: 38 }, "begin head"],
  ])("kOnHeadersComplete returns %p", (answer, expected, calls) => {
    const { execute, names } = recorded(RESPONSE, { head: () => answer });
    const result = execute("HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n\r\nHTTP/1.1 200 ");
    expect(result instanceof Error ? { ...result } : result).toEqual(expected);
    expect(names()).toBe(calls);
  });

  test.each([
    [REQUEST, "GET / HTTP/1.1\r\nConnection: upgrade\r\nUpgrade: a\r\n\r\n"],
    [REQUEST, "CONNECT a:1 HTTP/1.1\r\n\r\n"],
    [RESPONSE, "HTTP/1.1 101 a\r\nConnection: upgrade\r\nUpgrade: a\r\n\r\n"],
  ])("stops where another protocol starts (%p, %j)", (type, head) => {
    const { parser, calls, execute, names } = recorded(type);
    expect(execute(head + "\0")).toBe(head.length);
    expect(names()).toBe("begin head complete");
    expect(calls[1][8]).toBe(true);
    expect(parser.finish()).toBeUndefined();
  });

  describe("after the head of an upgrade", () => {
    const upgrade = "GET / HTTP/1.1\r\nConnection: upgrade\r\nUpgrade: a\r\n";

    test.each([
      ["\r\n", "GET / HTTP/1.1\r\n", "\0"],
      ["Connection: close\r\n\r\n", "\0", "\0"],
      ["Transfer-Encoding: chunked\r\n\r\n", "1", "\0"],
    ])("an error is a count (%j, %j)", (rest, consumed, left) => {
      const { parser, execute } = recorded(REQUEST);
      expect(execute(upgrade + rest)).toBe(upgrade.length + rest.length);
      expect(execute(consumed + left)).toBe(consumed.length);
      expect(execute("GET / HTTP/1.1\r\n\r\n")).toBe(18);
      expect(parser.finish()).toBeUndefined();
    });

    test("so is an answer that stops the parser", () => {
      const { execute } = recorded(REQUEST, { head: () => -1 });
      expect(execute(`${upgrade}\r\na`)).toBe(upgrade.length + 2);
    });

    test.each([
      ["\r\n", "G"],
      ["Content-Length: 2\r\n\r\n", "a"],
    ])("finish() returns no error (%j, %j)", (rest, more) => {
      const { parser, execute } = recorded(REQUEST);
      execute(upgrade + rest);
      execute(more);
      expect(parser.finish()).toBeUndefined();
    });

    test("the next head brings the errors back", () => {
      const { parser, execute } = recorded(REQUEST);
      execute(`${upgrade}\r\n`);
      execute("GET / HTTP/1.1\r\n\r\nG");
      expect(parser.finish().code).toBe("HPE_INVALID_EOF_STATE");
      expect(execute("\0").code).toBe("HPE_INVALID_METHOD");
    });
  });

  test.each([
    [6, true],
    [Infinity, true],
    [0, true],
    [-1, true],
    [NaN, true],
    ["2", true],
    [undefined, true],
    [5, false],
    [4, false],
    [0.5, false],
  ])("maxHeaderPairs %p", (maxHeaderPairs, fits) => {
    const fields = lines(manyFields.slice(0, 3));
    const chunked = "Transfer-Encoding: chunked\r\n\r\n0\r\n";
    for (const [type, text, isLimited] of [
      [REQUEST, `GET / HTTP/1.1\r\n${fields}\r\n`, true],
      [RESPONSE, `HTTP/1.1 204 a\r\n${fields}\r\n`, false],
      [RESPONSE, `HTTP/1.1 200 a\r\n${chunked}${fields}\r\n`, false],
    ] as const) {
      const { parser, execute } = recorded(type);
      parser.maxHeaderPairs = maxHeaderPairs;
      expect(execute(text).code).toBe(fits || !isLimited ? undefined : "HPE_HEADER_OVERFLOW");
    }
  });

  test("pause() takes effect with the next call", () => {
    const { parser, execute, names } = recorded(REQUEST, { begin: parser => parser.pause() });
    expect(execute("PUT / HTTP/1.1\r\nContent-Length: 2\r\n\r\na")).toBe(38);
    expect(execute("b")).toMatchObject({ code: "HPE_PAUSED", reason: "Paused" });
    expect(parser.finish()).toBeUndefined();
    parser.resume();
    expect(execute("b")).toBe(1);
    expect(names()).toBe("begin head body body complete");
  });

  test("goes on after a pause by kOnHeadersComplete", () => {
    const { parser, calls, execute } = recorded(REQUEST, { head: () => 21 });
    expect(execute("PUT /a HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n").code).toBe("HPE_PAUSED");
    parser.resume();
    expect(execute("0\r\nb: c\r\n\r\n")).toBe(11);
    expect(calls.slice(2)).toEqual([["headers", ["b", "c"], "/a"], ["complete"]]);
  });

  describe.each(Object.keys(callbacks) as Callback[])("in the %s callback", callback => {
    const callsBefore = everyCall.slice(0, everyCall.indexOf(callback));

    test.each(["close", "remove"])("%s()", method => {
      const { execute, names } = recorded(REQUEST, { [callback]: parser => parser[method]() });
      expect(execute(everyCallback)).toBe(everyCallback.length);
      expect(names()).toBe([...callsBefore, callback].join(" "));
    });

    test("initialize()", () => {
      const hooks = {
        [callback](parser) {
          delete hooks[callback];
          parser.initialize(RESPONSE, {});
          expect(() => parser.execute(Buffer.from("H"))).toThrow("HTTPParser.execute is not reentrant");
        },
      };
      const { calls, execute, names } = recorded(REQUEST, hooks);
      expect(execute(everyCallback)).toBe(everyCallback.length);
      expect(names()).toBe([...callsBefore, callback].join(" "));
      calls.length = 0;
      expect(execute("HTTP/1.1 204 a\r\n\r\n")).toBe(18);
      expect(calls[1]).toEqual(["head", 1, 1, [], , , 204, "a", false, true]);
      expect(names()).toBe("begin head complete");
    });

    test("initialize(), then throw", () => {
      const error = new Error(callback);
      const hooks = {
        [callback](parser) {
          delete hooks[callback];
          parser.initialize(RESPONSE, {});
          throw error;
        },
      };
      const { execute } = recorded(REQUEST, hooks);
      expect(() => execute(everyCallback)).toThrow(error);
      expect(execute("HTTP/1.1 204 a\r\n\r\n")).toBe(18);
    });

    test.each(["close", "remove"])("%s() in a getter for it", method => {
      const { parser, execute, names } = recorded(REQUEST);
      const value = parser[callbacks[callback]];
      Object.defineProperty(parser, callbacks[callback], { get: () => (parser[method](), value) });
      expect(execute(everyCallback)).toBe(everyCallback.length);
      expect(names()).toBe(callback === "head" ? "begin headers" : callsBefore.join(" "));
    });
  });

  test("close() in a getter for maxHeaderPairs, or in valueOf() of what kOnHeadersComplete returns", () => {
    for (const value of [undefined, 2]) {
      const { parser, execute, names } = recorded(REQUEST);
      Object.defineProperty(parser, "maxHeaderPairs", { get: () => (parser.close(), value) });
      expect(execute(everyCallback)).toBe(everyCallback.length);
      expect(names()).toBe("begin");
    }
    for (const value of [0, 1, 2, 3]) {
      const { execute, names } = recorded(REQUEST, { head: parser => ({ valueOf: () => (parser.close(), value) }) });
      expect(execute(everyCallback)).toBe(everyCallback.length);
      expect(names()).toBe("begin headers headers head");
    }
  });

  test("ignores its input from remove() to initialize()", () => {
    const { parser, execute, names } = recorded(REQUEST);
    parser.remove();
    expect(execute(everyCallback)).toBe(everyCallback.length);
    expect(parser.execute(new Uint16Array(2))).toBe(4);
    expect(names()).toBe("");
    parser.initialize(REQUEST, {});
    execute("GET / HTTP/1.1\r\n\r\n");
    expect(names()).toBe("begin head complete");
  });

  test("keeps the input buffer attached when a callback transfers it mid-parse", async () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});

    const input = Buffer.from("POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 11\r\n\r\nhello world");
    const inputLength = input.byteLength;

    const bodyChunks: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers();

    parser[kOnHeadersComplete] = function () {
      try {
        // The parser still refers to `input` here and will keep reading
        // from it after this callback returns. Transferring the backing
        // ArrayBuffer must not free that memory out from under the parser:
        // the original buffer stays attached for the rest of execute().
        input.buffer.transfer();
        expect(input.buffer.detached).toBe(false);
        expect(input.byteLength).toBe(inputLength);
      } catch (err) {
        reject(err);
      }
    };
    parser[kOnBody] = function (chunk) {
      bodyChunks.push(chunk.toString());
    };
    parser[kOnMessageComplete] = function () {
      resolve();
    };

    const executed = parser.execute(input);
    await promise;

    // The parser kept reading from the original, still-live allocation, so the
    // body it reports is the request's actual body.
    expect(bodyChunks.join("")).toBe("hello world");
    expect(executed).toBe(inputLength);
  });

  // A callback can shrink a resizable ArrayBuffer, or grow a WebAssembly.Memory, while the parser is
  // still scanning the input. Both unmap the input bytes, which a pin does not stop, so each case
  // runs in a child process: the parse must finish on bytes that stay mapped.
  const head = "POST / HTTP/1.1\r\nHost: a\r\nTransfer-Encoding: chunked\r\n\r\n";
  const tail = "0\r\n\r\n";
  const payloadSize = 1024;
  const chunkSize = `${payloadSize.toString(16)}\r\n`.length + payloadSize + "\r\n".length;
  // A resizable ArrayBuffer of its own, or one WebAssembly.Memory page.
  const inputSizes = { resizable: 1024 * 1024, wasm: 64 * 1024 };
  // A signaling wasm memory reserves its maximum up front and commits pages in place as it grows,
  // which leaves the input mapped. Only a bounds checked memory releases the block it grew out of,
  // so the wasm case asks JSC for that mode instead of counting on a full signaling memory pool.
  const modeEnv = { resizable: bunEnv, wasm: { ...bunEnv, BUN_JSC_useWasmFastMemory: "0" } };

  const fixture = (mode: keyof typeof inputSizes) => `
    const { HTTPParser } = process.binding("http_parser");

    let bytes, mutate;
    if (${JSON.stringify(mode)} === "resizable") {
      const size = ${inputSizes.resizable};
      const buffer = new ArrayBuffer(size, { maxByteLength: size });
      bytes = new Uint8Array(buffer);
      // resize() decommits the trimmed pages.
      mutate = () => buffer.resize(0);
    } else {
      const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
      bytes = new Uint8Array(memory.buffer);
      // grow() detaches the old buffer and releases the block it held.
      mutate = () => memory.grow(1);
    }

    const payload = Buffer.alloc(${payloadSize}, 0x61);
    const chunk = Buffer.concat([Buffer.from(${JSON.stringify(`${payloadSize.toString(16)}\r\n`)}), payload, Buffer.from("\\r\\n")]);
    const head = Buffer.from(${JSON.stringify(head)});
    const tail = Buffer.from(${JSON.stringify(tail)});

    bytes.set(head, 0);
    let end = head.byteLength;
    while (end + chunk.byteLength + tail.byteLength <= bytes.byteLength) {
      bytes.set(chunk, end);
      end += chunk.byteLength;
    }
    bytes.set(tail, end);
    end += tail.byteLength;

    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});

    let mutated = false;
    let bodyBytes = 0;
    let bodyMatches = true;
    let complete = false;
    let currentBuffer = -1;
    parser[HTTPParser.kOnHeadersComplete] = () => 0;
    parser[HTTPParser.kOnBody] = received => {
      bodyBytes += received.byteLength;
      if (!received.equals(payload.subarray(0, received.byteLength))) bodyMatches = false;
      if (!mutated) {
        mutated = true;
        mutate();
        // getCurrentBuffer() copies out of the same bytes the parser is reading.
        currentBuffer = parser.getCurrentBuffer().byteLength;
      }
    };
    parser[HTTPParser.kOnMessageComplete] = () => {
      complete = true;
    };

    const executed = parser.execute(bytes.subarray(0, end));
    console.log(JSON.stringify({ executed, bodyBytes, bodyMatches, complete, mutated, currentBuffer: currentBuffer === end }));
  `;

  test.each(Object.keys(inputSizes) as (keyof typeof inputSizes)[])(
    "finishes the parse when a callback unmaps the input (%s)",
    async mode => {
      await using proc = Bun.spawn({
        cmd: [bunExe(), "-e", fixture(mode)],
        env: modeEnv[mode],
        stderr: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      const chunks = Math.floor((inputSizes[mode] - head.length - tail.length) / chunkSize);

      // `executed` covers the whole request, so the parser read every chunk that follows the callback
      // which unmapped the input, and each one held the bytes the request was built with.
      expect({ stdout: JSON.parse(stdout.trim() || "null"), stderr }).toEqual({
        stdout: {
          executed: head.length + chunks * chunkSize + tail.length,
          bodyBytes: chunks * payloadSize,
          bodyMatches: true,
          complete: true,
          mutated: true,
          currentBuffer: true,
        },
        stderr: "",
      });
      expect(exitCode).toBe(0);
    },
  );

  test("rejects re-entrant execute, even after a nested finish()", async () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});
    const input = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");
    const other = Buffer.from("GET /other HTTP/1.1\r\nHost: example.com\r\n\r\n");
    const { promise, resolve, reject } = Promise.withResolvers();
    let entered = false;
    parser[kOnHeadersComplete] = function () {
      if (entered) return;
      entered = true;
      try {
        expect(() => this.execute(other)).toThrow("HTTPParser.execute is not reentrant");
        // A nested finish() must not disarm the re-entrancy guard.
        this.finish();
        expect(() => this.execute(other)).toThrow("HTTPParser.execute is not reentrant");
        resolve();
      } catch (err) {
        reject(err);
      }
    };
    expect(parser.execute(input)).toBe(input.length);
    await promise;
    // Once the outer execute() has returned, the parser accepts new data again.
    expect(parser.execute(input)).toBe(input.length);
  });
});

describe("a callback that throws stops the parse", () => {
  // Two pipelined requests so that a parser that kept going after the throw would reach the second one.
  const input = Buffer.from(
    "POST /a HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nA" +
      "POST /b HTTP/1.1\r\nHost: x\r\nContent-Length: 1\r\n\r\nB",
  );
  for (const throwing of ["begin", "headersComplete", "body", "complete"] as const) {
    test(throwing, () => {
      const parser = new HTTPParser();
      parser.initialize(HTTPParser.REQUEST, {});
      const calls: string[] = [];
      const err = new Error(throwing + " threw");
      const hook = (name: string) => () => {
        calls.push(name);
        if (name === throwing) throw err;
        return 0;
      };
      parser[kOnMessageBegin] = hook("begin");
      parser[kOnHeadersComplete] = hook("headersComplete");
      parser[kOnBody] = hook("body");
      parser[kOnMessageComplete] = hook("complete");
      let caught;
      try {
        parser.execute(input);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBe(err);
      // Nothing ran after the callback that threw.
      expect(calls.at(-1)).toBe(throwing);
      expect(calls.filter(c => c === "begin").length).toBe(1);
      // The parser is left in the errored state.
      expect(parser.execute(Buffer.from("GET / HTTP/1.1\r\n\r\n"))).toBeInstanceOf(Error);
    });
  }

  const thrower = (error: Error) => () => {
    throw error;
  };
  test.each([
    ["begin", "HPE_CB_MESSAGE_BEGIN", "`on_message_begin` callback error"],
    ["headers", "HPE_JS_EXCEPTION", "JS Exception"],
    ["head", "HPE_CB_HEADERS_COMPLETE", "User callback error"],
    ["body", "HPE_JS_EXCEPTION", "JS Exception"],
    ["complete", "HPE_CB_MESSAGE_COMPLETE", "`on_message_complete` callback error"],
  ] as const)("%s leaves %s", (callback, code, reason) => {
    const error = new Error(callback);
    const called = recorded(REQUEST, { [callback]: thrower(error) });
    const read = recorded(REQUEST);
    Object.defineProperty(read.parser, callbacks[callback], { get: thrower(error) });
    for (const { execute } of [called, read]) {
      expect(() => execute(everyCallback)).toThrow(error);
      expect(execute("a")).toMatchObject({ code, reason, bytesParsed: 1 });
    }
  });

  test("so does what runs for one", () => {
    const error = new Error("thrown");
    const limit = recorded(REQUEST);
    Object.defineProperty(limit.parser, "maxHeaderPairs", { get: thrower(error) });
    const answer = recorded(REQUEST, { head: () => ({ valueOf: thrower(error) }) });
    const trailers = recorded(REQUEST, { headers: thrower(error) });
    const partOfBody = recorded(REQUEST, { body: thrower(error) });
    const lastFields = recorded(REQUEST, { headers: () => lastFields.calls.length > 2 && thrower(error)() });
    for (const [{ execute }, text, code] of [
      [limit, everyCallback, "HPE_JS_EXCEPTION"],
      [answer, everyCallback, "HPE_CB_HEADERS_COMPLETE"],
      [lastFields, everyCallback, "HPE_CB_HEADERS_COMPLETE"],
      [trailers, "PUT / HTTP/1.1\r\nTransfer-Encoding: chunked\r\n\r\n0\r\na: b\r\n\r\n", "HPE_CB_MESSAGE_COMPLETE"],
      [partOfBody, "PUT / HTTP/1.1\r\nContent-Length: 3\r\n\r\na", "HPE_JS_EXCEPTION"],
    ] as const) {
      expect(() => execute(text)).toThrow(error);
      expect(execute("a").code).toBe(code);
    }
  });
});

test("HTTPParser.prototype.getCurrentBuffer", async () => {
  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {});

  const input = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");

  const { promise, resolve } = Promise.withResolvers();

  parser[kOnHeaders] = function () {
    expect(this.getCurrentBuffer()).toEqual(input);
    resolve();
  };

  expect(parser.getCurrentBuffer()).toEqual(Buffer.from(""));
  parser.execute(input);

  await promise;
});

test("HTTPParser.prototype.duration", async () => {
  const parser = new HTTPParser();
  parser.initialize(HTTPParser.REQUEST, {});

  const input = Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n");

  const { promise, resolve } = Promise.withResolvers();

  parser[kOnHeadersComplete] = function () {
    expect(this.duration()).toBeGreaterThan(0);
    resolve();
  };
  expect(parser.duration()).toBe(0);
  parser.execute(input);
  expect(parser.duration()).toBe(0);

  await promise;

  const before = performance.now();
  parser.execute(Buffer.from("G"));
  Bun.sleepSync(5);
  expect(parser.duration()).toBeWithin(4, performance.now() - before + 1);
});

test("HTTPParser.prototype.headersCompleted", () => {
  const paresr = new HTTPParser();
  paresr.initialize(HTTPParser.REQUEST, {});
  expect(paresr.headersCompleted()).toBe(false);
  paresr.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
  expect(paresr.headersCompleted()).toBe(true);
  paresr.execute(Buffer.from("G"));
  expect(paresr.headersCompleted()).toBe(false);
});

describe("ConnectionsList", () => {
  test("basic operations", () => {
    const list = new ConnectionsList();

    expect(list.all()).toEqual([]);
    expect(list.idle()).toEqual([]);
    expect(list.active()).toEqual([]);
    expect(list.expired()).toEqual([]);
  });

  test("idle() and expired() skip a closed parser", () => {
    const list = new ConnectionsList();
    const closed = new HTTPParser();
    closed.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    closed.close();

    expect(list.idle()).toEqual([]);
    expect(list.expired(1, 1)).toEqual([]);
    expect(list.all()).toEqual([closed]);
  });

  test("idle() and expired() skip a parser that would be there if it were not closed", () => {
    const list = new ConnectionsList();
    const idle = recorded(REQUEST, {}, 0, 0, list);
    const expired = recorded(REQUEST, {}, 0, 0, list);
    idle.execute("GET / HTTP/1.1\r\n\r\n");
    Bun.sleepSync(3);
    idle.parser.close();
    expired.parser.close();

    expect(list.idle()).toEqual([]);
    expect(list.expired(1, 1)).toEqual([]);
  });

  test("follows the messages of a parser", () => {
    const list = new ConnectionsList();
    const { parser, execute } = recorded(REQUEST, {}, 0, 0, list);
    const state = () => ["all", "idle", "active"].filter(name => list[name]().includes(parser)).join(" ");
    expect(state()).toBe("all active");
    expect(parser.duration()).toBeGreaterThan(0);
    execute("GET / HTTP/1.1\r\n\r\n");
    expect(state()).toBe("all idle");
    execute("GET / HTTP/1.1\r\n");
    expect(state()).toBe("all active");
    parser.remove();
    expect(state()).toBe("");
    execute("\r\nG");
    expect(state()).toBe("");

    parser.initialize(REQUEST, {}, 0, 0, null);
    execute("G");
    expect(state()).toBe("");
  });

  test("expired()", () => {
    const list = new ConnectionsList();
    const inHead = recorded(REQUEST, {}, 0, 0, list);
    const inBody = recorded(REQUEST, {}, 0, 0, list);
    inHead.execute("PUT / HTTP/1.1\r\n");
    inBody.execute("PUT / HTTP/1.1\r\nContent-Length: 1\r\n\r\n");
    Bun.sleepSync(3);

    expect(list.expired(4000, 4000)).toEqual([]);
    expect(list.expired(1, 0)).toEqual([inHead.parser]);
    expect(list.active()).toEqual([inBody.parser]);
    expect(list.expired(0, 1)).toEqual([inBody.parser]);
    expect(list.active()).toEqual([]);
    expect(list.all()).toEqual([inHead.parser, inBody.parser]);
  });

  test("works with HTTPParser", () => {
    const p1 = new HTTPParser();
    p1.name = "parser1";
    const p2 = new HTTPParser();
    p2.name = "parser2";
    const p3 = new HTTPParser();
    p3.name = "parser3";
    const p4 = new HTTPParser();
    p4.name = "parser4";
    const list = new ConnectionsList();
    p1.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    p2.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    p3.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    p4.initialize(HTTPParser.REQUEST, {}, 0, 0, list);

    expect(list.all()).toEqual([p1, p2, p3, p4]);
    expect(list.idle()).toEqual([]);
    expect(list.active()).toEqual([p1, p2, p3, p4]);
    expect(list.expired()).toEqual([]);
    p2.remove();
    expect(list.all()).toEqual([p1, p3, p4]);
    p3.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
    expect(list.all()).toEqual([p1, p4, p3]);

    p1.close();
    p1.remove();
    // p1 is still in the list after remove because close
    // frees the implementation causing remove to not be able
    // to remove it.
    expect(list.all()).toEqual([p1, p4, p3]);
  });
});

test("subclasses of HTTPParser and ConnectionsList return instances of the subclass", () => {
  class RequestParser extends HTTPParser {
    start(list) {
      this.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
      return this;
    }
  }
  class ParserList extends ConnectionsList {
    count() {
      return this.all().length;
    }
  }

  const list = new ParserList();
  expect(Object.getPrototypeOf(list)).toBe(ParserList.prototype);
  expect(list).toBeInstanceOf(ConnectionsList);

  const parser = new RequestParser().start(list);
  expect(Object.getPrototypeOf(parser)).toBe(RequestParser.prototype);
  expect(parser).toBeInstanceOf(HTTPParser);

  expect(list.count()).toBe(1);
  expect(list.all()).toEqual([parser]);
  parser.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
  expect(parser.headersCompleted()).toBe(true);
});

test.concurrent("arrays are made without the setters of Array.prototype", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `for (const index of [0, 20]) Object.defineProperty(Array.prototype, index, { set() {} });
       const { HTTPParser, methods, allMethods } = process.binding("http_parser");
       console.log(methods[0], methods[20], allMethods[0], allMethods[20]);
       const parser = new HTTPParser();
       parser.initialize(HTTPParser.REQUEST, {});
       parser[HTTPParser.kOnHeadersComplete] = (major, minor, headers) => console.log(headers[0]);
       parser.execute(Buffer.from("GET / HTTP/1.1\\r\\na: b\\r\\n\\r\\n"));`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "DELETE REPORT DELETE REPORT\na\n", stderr: "" });
  expect(exitCode).toBe(0);
});

test.concurrent("calls back in what continues the I/O of a Bun.ModuleGraph that is disposed", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `const { HTTPParser } = process.binding("http_parser");
       const graph = new Bun.ModuleGraph();
       await graph.run(() => fs.promises.stat("."));
       graph.dispose();
       const parser = new HTTPParser();
       parser.initialize(HTTPParser.RESPONSE, {});
       for (const index of [0, 1, 2, 3, 4]) parser[index] = () => console.log(index);
       parser.execute(Buffer.from(${JSON.stringify(`HTTP/1.1 200 OK\r\n${lines(manyFields)}\r\na`)}));
       parser.finish();`,
    ],
    env: bunEnv,
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout, stderr }).toEqual({ stdout: "0\n1\n1\n2\n3\n4\n", stderr: "" });
  expect(exitCode).toBe(0);
});

// In a subprocess: nothing in the process can interrupt an execute() that never returns.
test.concurrent.each(["REQUEST", "RESPONSE"])(
  "a NUL in a header value is an error in relaxed mode (%s)",
  async type => {
    const head = type === "REQUEST" ? "POST / HTTP/1.1" : "HTTP/1.1 200 OK";
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { HTTPParser } = process.binding("http_parser");
       const parser = new HTTPParser();
       parser.initialize(HTTPParser.${type}, {}, 0, HTTPParser.kLenientHeaderValueRelaxed);
       console.log(parser.execute(Buffer.from(${JSON.stringify(head + "\r\nX: a\x01b\r\nY: a\0b\r\n\r\n")})).code);`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout, stderr }).toEqual({ stdout: "HPE_INVALID_HEADER_TOKEN\n", stderr: "" });
    expect(exitCode).toBe(0);
  },
);

describe("parserOnHeaders maxHeaderPairs clamp (nodejs/node#61285)", () => {
  test("only fills remaining capacity instead of pushing the whole batch", () => {
    const parser = parsers.alloc();
    try {
      const onHeaders = parser[kOnHeaders];
      parser._headers = ["x", "1"];
      parser._url = "";
      parser.maxHeaderPairs = 4;

      onHeaders.call(parser, ["a", "2", "b", "3"], "");
      expect(parser._headers).toEqual(["x", "1", "a", "2"]);

      // At capacity: nothing more is collected.
      onHeaders.call(parser, ["c", "4"], "");
      expect(parser._headers).toEqual(["x", "1", "a", "2"]);

      // maxHeaderPairs <= 0 means no limit.
      parser.maxHeaderPairs = 0;
      onHeaders.call(parser, ["c", "4"], "");
      expect(parser._headers).toEqual(["x", "1", "a", "2", "c", "4"]);

      parser.maxHeaderPairs = -1;
      onHeaders.call(parser, ["d", "5"], "");
      expect(parser._headers).toEqual(["x", "1", "a", "2", "c", "4", "d", "5"]);
    } finally {
      parser.close();
    }
  });
});
