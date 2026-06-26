import { describe, expect, test } from "bun:test";
import http from "node:http";
import net from "node:net";

// Regression test for https://github.com/oven-sh/bun/issues/27061
// When http.ClientRequest.write() is called more than once (streaming data in chunks),
// Bun was stripping the explicitly-set Content-Length header and switching to
// Transfer-Encoding: chunked. Node.js preserves Content-Length in all cases.

describe("node:http ClientRequest preserves explicit Content-Length", () => {
  test("with multiple req.write() calls", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      contentLength: string | undefined;
      transferEncoding: string | undefined;
      bodyLength: number;
    }>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        resolve({
          contentLength: req.headers["content-length"],
          transferEncoding: req.headers["transfer-encoding"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });

    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const chunk1 = Buffer.alloc(100, "a");
      const chunk2 = Buffer.alloc(100, "b");
      const totalLength = chunk1.length + chunk2.length;

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Content-Length": totalLength.toString(),
        },
      });

      await new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", () => res());
        req.write(chunk1);
        req.write(chunk2);
        req.end();
      });

      const result = await promise;
      expect(result.contentLength).toBe("200");
      expect(result.transferEncoding).toBeUndefined();
      expect(result.bodyLength).toBe(200);
    } finally {
      server.close();
    }
  });

  test("with req.write() + req.end(data)", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      contentLength: string | undefined;
      transferEncoding: string | undefined;
      bodyLength: number;
    }>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        resolve({
          contentLength: req.headers["content-length"],
          transferEncoding: req.headers["transfer-encoding"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });

    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const chunk1 = Buffer.alloc(100, "a");
      const chunk2 = Buffer.alloc(100, "b");
      const totalLength = chunk1.length + chunk2.length;

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Content-Length": totalLength.toString(),
        },
      });

      await new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", () => res());
        req.write(chunk1);
        req.end(chunk2);
      });

      const result = await promise;
      expect(result.contentLength).toBe("200");
      expect(result.transferEncoding).toBeUndefined();
      expect(result.bodyLength).toBe(200);
    } finally {
      server.close();
    }
  });

  test("with three req.write() calls", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      contentLength: string | undefined;
      transferEncoding: string | undefined;
      bodyLength: number;
    }>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        resolve({
          contentLength: req.headers["content-length"],
          transferEncoding: req.headers["transfer-encoding"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });

    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const chunk1 = Buffer.alloc(100, "a");
      const chunk2 = Buffer.alloc(100, "b");
      const chunk3 = Buffer.alloc(100, "c");
      const totalLength = chunk1.length + chunk2.length + chunk3.length;

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Content-Length": totalLength.toString(),
        },
      });

      await new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", () => res());
        req.write(chunk1);
        req.write(chunk2);
        req.write(chunk3);
        req.end();
      });

      const result = await promise;
      expect(result.contentLength).toBe("300");
      expect(result.transferEncoding).toBeUndefined();
      expect(result.bodyLength).toBe(300);
    } finally {
      server.close();
    }
  });

  test("single req.write() still works", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      contentLength: string | undefined;
      transferEncoding: string | undefined;
      bodyLength: number;
    }>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        resolve({
          contentLength: req.headers["content-length"],
          transferEncoding: req.headers["transfer-encoding"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });

    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const data = Buffer.alloc(200, "x");

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Content-Length": data.length.toString(),
        },
      });

      await new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", () => res());
        req.write(data);
        req.end();
      });

      const result = await promise;
      expect(result.contentLength).toBe("200");
      expect(result.transferEncoding).toBeUndefined();
      expect(result.bodyLength).toBe(200);
    } finally {
      server.close();
    }
  });

  test("without explicit Content-Length still uses chunked encoding", async () => {
    const { promise, resolve, reject } = Promise.withResolvers<{
      contentLength: string | undefined;
      transferEncoding: string | undefined;
      bodyLength: number;
    }>();

    const server = http.createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        resolve({
          contentLength: req.headers["content-length"],
          transferEncoding: req.headers["transfer-encoding"],
          bodyLength: Buffer.concat(chunks).length,
        });
        res.writeHead(200);
        res.end("ok");
      });
    });

    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const chunk1 = Buffer.alloc(100, "a");
      const chunk2 = Buffer.alloc(100, "b");

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        // No Content-Length header
      });

      await new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", () => res());
        req.write(chunk1);
        req.write(chunk2);
        req.end();
      });

      const result = await promise;
      // Without explicit Content-Length, chunked encoding should be used
      expect(result.transferEncoding).toBe("chunked");
      expect(result.bodyLength).toBe(200);
    } finally {
      server.close();
    }
  });

  test("sends both headers like Node.js when Transfer-Encoding is also set", async () => {
    // Node.js does not drop an explicitly-set Content-Length when an explicit
    // Transfer-Encoding header is also present: both headers are written and
    // the body is sent with chunked framing. Assert against a raw socket so
    // this only depends on the client's wire output.
    const { promise, resolve } = Promise.withResolvers<string>();

    const server = net.createServer(socket => {
      let raw = "";
      socket.on("data", chunk => {
        raw += chunk.toString("latin1");
        if (raw.endsWith("0\r\n\r\n")) {
          resolve(raw);
          socket.end("HTTP/1.1 200 OK\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        }
      });
    });
    await new Promise<void>(res => server.listen(0, "127.0.0.1", res));
    const port = (server.address() as any).port;

    try {
      const chunk1 = Buffer.alloc(100, "a");
      const chunk2 = Buffer.alloc(100, "b");

      const req = http.request({
        hostname: "127.0.0.1",
        port,
        method: "POST",
        headers: {
          "Content-Length": "200",
          "Transfer-Encoding": "chunked",
        },
      });

      const done = new Promise<void>((res, rej) => {
        req.on("error", rej);
        req.on("response", response => {
          response.resume();
          response.on("end", () => res());
        });
      });
      req.write(chunk1);
      req.write(chunk2);
      req.end();

      const raw = await promise;
      const headerEnd = raw.indexOf("\r\n\r\n");
      const head = raw.slice(0, headerEnd);
      const body = raw.slice(headerEnd + 4);
      expect(head).toContain("Content-Length: 200");
      expect(head).toContain("Transfer-Encoding: chunked");
      // The body is chunked-framed: two 100-byte chunks plus the terminator.
      expect(body).toBe(`64\r\n${"a".repeat(100)}\r\n64\r\n${"b".repeat(100)}\r\n0\r\n\r\n`);
      await done;
    } finally {
      server.close();
    }
  });
});
