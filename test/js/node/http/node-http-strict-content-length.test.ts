import { describe, expect, test } from "bun:test";
import { once } from "node:events";
import http from "node:http";
import net from "node:net";

// Runs `handler(res)` inside a request handler and resolves with its return
// value. The raw socket client keeps the response from being consumed, so the
// only observable effect is what the handler throws.
async function inServer<T>(handler: (res: http.ServerResponse) => T): Promise<T> {
  const { promise, resolve, reject } = Promise.withResolvers<T>();
  const server = http.createServer((req, res) => {
    new Promise<T>(done => done(handler(res))).then(resolve, reject).finally(() => res.destroy());
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address() as net.AddressInfo;
  const socket = net.connect(port, "127.0.0.1");
  socket.on("error", () => {});
  socket.write("GET / HTTP/1.1\r\nHost: localhost\r\n\r\n");
  try {
    return await promise;
  } finally {
    socket.destroy();
    server.closeAllConnections();
    server.close();
  }
}

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e: any) {
    return e.code;
  }
  return undefined;
}

const MISMATCH = "ERR_HTTP_CONTENT_LENGTH_MISMATCH";

describe("res.strictContentLength", () => {
  test("Content-Length: 0 is checked", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 0);
      return code(() => res.end("abc"));
    });
    expect(result).toBe(MISMATCH);
  });

  test("Content-Length: 0 with an empty body does not throw", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 0);
      return code(() => res.end());
    });
    expect(result).toBeUndefined();
  });

  test("the write that sends the headers is counted but not checked", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 5);
      return [code(() => res.write("abcdefghijk")), code(() => res.end("abc"))];
    });
    expect(result).toEqual([undefined, MISMATCH]);
  });

  test("writes after writeHead are checked", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.writeHead(200, { "Content-Length": 10 });
      return [code(() => res.write("123456789")), code(() => res.write("123456789")), code(() => res.end("0"))];
    });
    expect(result).toEqual([undefined, MISMATCH, undefined]);
  });

  test("a Content-Length set after removeHeader is checked", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", 3);
      res.removeHeader("Content-Length");
      res.setHeader("Content-Length", 5);
      return code(() => res.end("hello world"));
    });
    expect(result).toBe(MISMATCH);
  });

  test("a Content-Length from writeHead's flat array form is checked", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.writeHead(200, ["Content-Length", "5"]);
      return [code(() => res.write("hello")), code(() => res.end("!"))];
    });
    expect(result).toEqual([undefined, MISMATCH]);
  });

  test("a string header value is parsed like Node (+value)", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", "1e1");
      return [code(() => res.end("abcdefghij"))];
    });
    expect(result).toEqual([undefined]);
  });

  test("a string header value with a mismatch throws", async () => {
    const result = await inServer(res => {
      res.strictContentLength = true;
      res.setHeader("Content-Length", "5");
      return [code(() => res.write("hello")), code(() => res.end("!"))];
    });
    expect(result).toEqual([undefined, MISMATCH]);
  });
});
