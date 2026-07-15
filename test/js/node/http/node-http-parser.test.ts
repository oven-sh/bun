import { describe, expect, test } from "bun:test";
const { HTTPParser, ConnectionsList } = process.binding("http_parser");
const { parsers } = require("node:_http_common");

const kOnHeaders = HTTPParser.kOnHeaders;
const kOnHeadersComplete = HTTPParser.kOnHeadersComplete;

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

  test("idle() and expired() skip a close()d parser instead of crashing", () => {
    const list = new ConnectionsList();
    const alive = new HTTPParser();
    const closed = new HTTPParser();
    alive.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    closed.initialize(HTTPParser.REQUEST, {}, 0, 0, list);
    closed.close();

    try {
      // Both parsers are iterated; the close()d one must be skipped, not
      // dereferenced. A freshly initialized parser is not idle (see above).
      expect(list.idle()).toEqual([]);
      expect(list.expired()).toEqual([]);
      expect(list.all()).toEqual([alive, closed]);
    } finally {
      alive.close();
    }
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
