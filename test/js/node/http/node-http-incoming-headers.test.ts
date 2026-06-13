// node:http IncomingMessage header-view coverage:
//   - rawHeaders preserves the on-the-wire case of header names (Node docs:
//     "Header names are not lowercased, and duplicates are not merged").
//   - headersDistinct is a per-lowercase-name array dictionary parallel to
//     `headers`, lazily cached on first access.
//
// https://github.com/oven-sh/bun/issues/31318 (and #20433 / #24268)
import { describe, expect, it } from "bun:test";
import * as http from "node:http";
import * as net from "node:net";

describe("IncomingMessage header views", () => {
  async function receiveRequest(payload: string) {
    const { promise, resolve, reject } = Promise.withResolvers<http.IncomingMessage>();
    const server = http.createServer(req => {
      resolve(req);
      // Don't respond — the test only inspects headers and ends the socket itself
      // so the server can be closed cleanly.
    });
    server.on("clientError", () => {});
    await new Promise<void>(r => server.listen(0, "127.0.0.1", r));
    try {
      const port = (server.address() as net.AddressInfo).port;
      const client = net.connect(port, "127.0.0.1", () => {
        client.write(payload);
      });
      client.on("error", reject);
      client.on("data", () => {});
      const req = await promise;
      client.destroy();
      return req;
    } finally {
      await new Promise<void>(r => server.close(() => r()));
    }
  }

  it("rawHeaders preserves the on-the-wire case", async () => {
    const req = await receiveRequest(
      "GET / HTTP/1.1\r\n" +
        "Host: x\r\n" +
        "X-Mixed-CASE: alpha\r\n" +
        "x-LOWER-mixed: beta\r\n" +
        "Connection: close\r\n\r\n",
    );

    expect(req.rawHeaders).toEqual([
      "Host",
      "x",
      "X-Mixed-CASE",
      "alpha",
      "x-LOWER-mixed",
      "beta",
      "Connection",
      "close",
    ]);
    expect(req.headers).toEqual({
      host: "x",
      "x-mixed-case": "alpha",
      "x-lower-mixed": "beta",
      connection: "close",
    });
  });

  it("headersDistinct groups every value by lowercase name", async () => {
    const req = await receiveRequest(
      "GET / HTTP/1.1\r\n" +
        "Host: x\r\n" +
        "Set-Cookie: a=1\r\n" +
        "set-COOKIE: b=2\r\n" +
        "X-Dup: one\r\n" +
        "X-Dup: two\r\n" +
        "Connection: close\r\n\r\n",
    );

    // Every occurrence keeps its original case, in arrival order.
    expect(req.rawHeaders).toEqual([
      "Host",
      "x",
      "Set-Cookie",
      "a=1",
      "set-COOKIE",
      "b=2",
      "X-Dup",
      "one",
      "X-Dup",
      "two",
      "Connection",
      "close",
    ]);

    expect((req as any).headersDistinct).toEqual({
      host: ["x"],
      "set-cookie": ["a=1", "b=2"],
      "x-dup": ["one", "two"],
      connection: ["close"],
    });

    // set-cookie remains an array in `req.headers` regardless of incoming case.
    expect(req.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
  });

  it("headersDistinct is lazily cached on first access (identity + mutation persistence)", async () => {
    const req = await receiveRequest(
      "GET / HTTP/1.1\r\n" + "Host: x\r\n" + "X-Foo: bar\r\n" + "Connection: close\r\n\r\n",
    );

    const a = (req as any).headersDistinct;
    const b = (req as any).headersDistinct;
    expect(a).toBe(b); // identity-equal, matches Node's cached behavior.

    a["x-added"] = ["baz"];
    expect((req as any).headersDistinct["x-added"]).toEqual(["baz"]);
  });
});
