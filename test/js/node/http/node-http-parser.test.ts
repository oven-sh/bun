import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
const { HTTPParser, ConnectionsList, methods, allMethods } = process.binding("http_parser");
const { parsers } = require("node:_http_common");

const kOnHeaders = HTTPParser.kOnHeaders;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete;

describe("method lists", () => {
  // oven-sh/bun#35273: the vendored llhttp method table had been reformatted
  // into `M - SEARCH`, which the preprocessor stringizes with the spaces.
  test("contain M-SEARCH, not a malformed token", () => {
    expect(methods).toContain("M-SEARCH");
    expect(allMethods).toContain("M-SEARCH");
  });

  test("contain no whitespace in any method token", () => {
    for (const method of [...methods, ...allMethods]) {
      expect(method).toMatch(/^[A-Z_-]+$/);
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
    let junk = [];
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
    expect(() => parser.finish()).toThrow(expect.objectContaining({ code: "ERR_INVALID_STATE" }));
    parser.initialize(HTTPParser.REQUEST, {});
    const input = Buffer.from("GET / HTTP/1.1\r\nHost: a\r\n\r\n");
    expect(parser.execute(input)).toBe(input.length);
  });
});

describe("HTTPParser.prototype.finish", () => {
  test("reports bytesParsed of 0 when finish() fails after a paused parse", () => {
    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});

    // Returning HPE_PAUSED (21) from the headers-complete callback makes
    // llhttp pause mid-message and record a position inside the input buffer
    // as its error position.
    parser[kOnHeadersComplete] = function () {
      return 21;
    };

    const paused = parser.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
    expect(paused).toMatchObject({ code: "HPE_PAUSED" });

    // Resuming clears the pause, but llhttp keeps the stale error position
    // from the previous buffer.
    parser.resume();

    // finish() mid-message reports an EOF error. bytesParsed must be exactly
    // 0 rather than a value derived from the stale error position.
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
  test("keeps the input buffer attached when a callback transfers it mid-parse", async () => {
    const kOnBody = HTTPParser.kOnBody;
    const kOnMessageComplete = HTTPParser.kOnMessageComplete;

    const parser = new HTTPParser();
    parser.initialize(HTTPParser.REQUEST, {});

    const input = Buffer.from("POST / HTTP/1.1\r\nHost: example.com\r\nContent-Length: 11\r\n\r\nhello world");
    const inputLength = input.byteLength;

    const bodyChunks: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers();

    parser[kOnHeadersComplete] = function () {
      try {
        // llhttp still holds pointers into `input` here and will keep reading
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
        // Re-entering execute() while a buffer is still being parsed would
        // corrupt llhttp's span pointers, so it must be rejected.
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
  const kOnMessageBegin = HTTPParser.kOnMessageBegin;
  const kOnBody = HTTPParser.kOnBody;
  const kOnMessageComplete = HTTPParser.kOnMessageComplete;
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
  parser.execute(input);

  await promise;
});

test("HTTPParser.prototype.headersCompleted", () => {
  const paresr = new HTTPParser();
  paresr.initialize(HTTPParser.REQUEST, {});
  expect(paresr.headersCompleted()).toBe(false);
  paresr.execute(Buffer.from("GET / HTTP/1.1\r\nHost: example.com\r\n\r\n"));
  expect(paresr.headersCompleted()).toBe(true);
});

describe("ConnectionsList", () => {
  test("basic operations", () => {
    const list = new ConnectionsList();

    expect(list.all()).toEqual([]);
    expect(list.idle()).toEqual([]);
    expect(list.active()).toEqual([]);
    expect(list.expired()).toEqual([]);
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

  test("idle() and expired() skip a closed parser still in the list", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `const { HTTPParser, ConnectionsList } = process.binding("http_parser");
         const list = new ConnectionsList();
         const p = new HTTPParser();
         p.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
         p.close();
         if (JSON.stringify(list.idle()) !== "[]") throw new Error("idle");
         if (JSON.stringify(list.expired(1, 1)) !== "[]") throw new Error("expired");
         if (list.all().length !== 1) throw new Error("all");
         console.log("OK");`,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stdout).toBe("OK\n");
    expect(exitCode).toBe(0);
  });
});

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
