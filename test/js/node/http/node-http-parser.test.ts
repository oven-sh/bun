import { describe, expect, test } from "bun:test";
const { HTTPParser, ConnectionsList } = process.binding("http_parser");

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
});
