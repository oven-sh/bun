import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool, Client, Agent, stream } from "undici";
import * as undici from "undici";
import { Readable, Writable, Transform } from "stream";
import net from "node:net";
import tls from "node:tls";

import { createServer } from "../../../http-test-server";
import { tls as serverTls } from "harness";

// Raw TCP server helper for connect()/upgrade() tests. Returns the bound port
// and an async disposer so callers can use `await using` for cleanup.
async function rawServer(onConnection: (socket: net.Socket) => void) {
  const server = net.createServer(onConnection);
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => resolve());
  await promise;
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    [Symbol.asyncDispose]: () => new Promise<void>(res => server.close(() => res())),
  };
}

// Raw TLS server variant for the connect()/upgrade() TLS path.
async function rawTlsServer(onConnection: (socket: tls.TLSSocket) => void) {
  const server = tls.createServer({ cert: serverTls.cert, key: serverTls.key }, onConnection);
  const { promise, resolve } = Promise.withResolvers<void>();
  server.listen(0, "127.0.0.1", () => resolve());
  await promise;
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    [Symbol.asyncDispose]: () => new Promise<void>(res => server.close(() => res())),
  };
}

describe("undici", () => {
  let serverCtl: ReturnType<typeof createServer>;
  let hostUrl: string;
  let port: number;
  let host: string;

  beforeAll(() => {
    serverCtl = createServer();
    port = serverCtl.port;
    host = `${serverCtl.hostname}:${port}`;
    hostUrl = `http://${host}`;
  });

  afterAll(() => {
    serverCtl.stop();
  });

  // ---- Pool ----
  describe("Pool", () => {
    it("should construct with a string origin", async () => {
      const pool = new Pool(hostUrl);
      expect(pool).toBeInstanceOf(Pool);
      await pool.close();
    });

    it("should construct with a URL origin", async () => {
      const pool = new Pool(new URL(hostUrl));
      expect(pool).toBeInstanceOf(Pool);
      await pool.close();
    });

    it("should make a GET request and return the expected response shape", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({ method: "GET", path: "/get" });

        expect(response.statusCode).toBe(200);
        expect(typeof response.headers).toBe("object");
        expect(response.headers["content-type"]).toContain("application/json");
        expect(response.body).toBeDefined();
        expect(response.trailers).toBeDefined();
        expect(response.opaque).toBeDefined();
        expect(response.context).toBeDefined();
      } finally {
        await pool.close();
      }
    });

    it("should consume body via for-await and yield Buffer chunks", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({ method: "GET", path: "/get" });

        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) {
          expect(chunk).toBeInstanceOf(Buffer);
          chunks.push(chunk);
        }

        const text = Buffer.concat(chunks).toString("utf8");
        const json = JSON.parse(text);
        expect(json.url).toBe(`${hostUrl}/get`);
      } finally {
        await pool.close();
      }
    });

    it("should yield Buffer chunks even after setEncoding('utf8')", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({ method: "GET", path: "/get" });

        // This is what @elastic/transport does — setEncoding then Buffer.concat
        response.body!.setEncoding("utf8");

        const chunks: any[] = [];
        for await (const chunk of response.body!) {
          chunks.push(chunk);
        }

        // Must be Buffers despite setEncoding, so Buffer.concat works
        const text = Buffer.concat(chunks).toString("utf8");
        const json = JSON.parse(text);
        expect(json.method).toBe("GET");
      } finally {
        await pool.close();
      }
    });

    it("should make a POST request with body", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({
          method: "POST",
          path: "/post",
          headers: { "content-type": "text/plain" },
          body: "Hello from Pool",
        });

        expect(response.statusCode).toBe(201);

        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.data).toBe("Hello from Pool");
      } finally {
        await pool.close();
      }
    });

    it("should pass request headers through", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({
          method: "GET",
          path: "/headers",
          headers: { "x-custom": "pool-value" },
        });

        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.headers["x-custom"]).toBe("pool-value");
      } finally {
        await pool.close();
      }
    });

    it("should accept origin override in request opts", async () => {
      const pool = new Pool("http://should.not.resolve.invalid");
      try {
        const response = await pool.request({
          method: "GET",
          path: "/get",
          origin: hostUrl,
        });

        expect(response.statusCode).toBe(200);
        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.url).toBe(`${hostUrl}/get`);
      } finally {
        await pool.close();
      }
    });

    it("should accept URL object as origin in request opts", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({
          method: "GET",
          path: "/get",
          origin: new URL(hostUrl),
        });

        expect(response.statusCode).toBe(200);
      } finally {
        await pool.close();
      }
    });

    it("should throw after close()", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();

      try {
        await pool.request({ method: "GET", path: "/get" });
        throw new Error("Should have thrown");
      } catch (e: any) {
        expect(e.message).toContain("closed");
      }
    });

    it("should throw after destroy()", async () => {
      const pool = new Pool(hostUrl);
      await pool.destroy();

      try {
        await pool.request({ method: "GET", path: "/get" });
        throw new Error("Should have thrown");
      } catch (e: any) {
        expect(e.message).toContain("closed");
      }
    });

    it("should return body as an empty Readable (never null) for HEAD requests", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({ method: "HEAD", path: "/head" });
        expect(response.statusCode).toBe(200);
        // body must never be null — real undici returns an empty Readable
        expect(response.body).toBeDefined();
        expect(response.body).not.toBeNull();
        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
        expect(chunks.length).toBe(0); // empty stream, no data
      } finally {
        await pool.close();
      }
    });

    it("should pass through opaque and context from opts", async () => {
      const pool = new Pool(hostUrl);
      try {
        const myOpaque = { traceId: "abc-123" };
        const myContext = { requestId: 42 };
        const response = await pool.request({
          method: "GET",
          path: "/get",
          opaque: myOpaque,
          context: myContext,
        });

        expect(response.statusCode).toBe(200);
        expect((response.opaque as any).traceId).toBe("abc-123");
        expect((response.context as any).requestId).toBe(42);

        // Consume body to avoid leaks
        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
      } finally {
        await pool.close();
      }
    });
  });

  // ---- Client ----
  describe("Client", () => {
    it("should construct with a string origin", async () => {
      const client = new Client(hostUrl);
      expect(client).toBeInstanceOf(Client);
      await client.close();
    });

    it("should construct with a URL origin", async () => {
      const client = new Client(new URL(hostUrl));
      expect(client).toBeInstanceOf(Client);
      await client.close();
    });

    it("should make a GET request with the expected response shape", async () => {
      const client = new Client(hostUrl);
      try {
        const response = await client.request({ method: "GET", path: "/get" });

        expect(response.statusCode).toBe(200);
        expect(typeof response.headers).toBe("object");
        expect(response.body).toBeDefined();
      } finally {
        await client.close();
      }
    });

    it("should consume body as Buffer chunks", async () => {
      const client = new Client(hostUrl);
      try {
        const response = await client.request({ method: "GET", path: "/get" });

        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) {
          expect(chunk).toBeInstanceOf(Buffer);
          chunks.push(chunk);
        }

        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.url).toBe(`${hostUrl}/get`);
      } finally {
        await client.close();
      }
    });

    it("should make a POST request with body", async () => {
      const client = new Client(hostUrl);
      try {
        const response = await client.request({
          method: "POST",
          path: "/post",
          headers: { "content-type": "text/plain" },
          body: "Hello from Client",
        });

        expect(response.statusCode).toBe(201);

        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.data).toBe("Hello from Client");
      } finally {
        await client.close();
      }
    });

    it("should throw after close()", async () => {
      const client = new Client(hostUrl);
      await client.close();

      try {
        await client.request({ method: "GET", path: "/get" });
        throw new Error("Should have thrown");
      } catch (e: any) {
        expect(e.message).toContain("closed");
      }
    });

    it("should pass through opaque and context from opts", async () => {
      const client = new Client(hostUrl);
      try {
        const response = await client.request({
          method: "GET",
          path: "/get",
          opaque: { span: "xyz" },
        });

        expect((response.opaque as any).span).toBe("xyz");
        const chunks: Buffer[] = [];
        for await (const chunk of response.body!) chunks.push(chunk);
      } finally {
        await client.close();
      }
    });
  });

  // ---- Agent ----
  describe("Agent", () => {
    it("should construct with default options", () => {
      const agent = new Agent();
      expect(agent).toBeDefined();
    });

    it("should construct with custom options", () => {
      const agent = new Agent({ connections: 10, pipelining: 1 });
      expect(agent).toBeDefined();
    });

    it("should be an instance of Dispatcher (EventEmitter)", () => {
      const agent = new Agent();
      expect(typeof agent.on).toBe("function");
      expect(typeof agent.emit).toBe("function");
    });
  });

  // ---- stream() ----
  describe("stream", () => {
    it("should pipe response body to a writable stream", async () => {
      const chunks: Buffer[] = [];
      const result = await stream(`${hostUrl}/get`, ({ statusCode, headers }) => {
        expect(statusCode).toBe(200);
        expect(headers["content-type"]).toContain("application/json");
        return new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        });
      });

      expect(result.trailers).toBeDefined();

      const text = Buffer.concat(chunks).toString("utf8");
      const json = JSON.parse(text);
      expect(json.url).toBe(`${hostUrl}/get`);
    });

    it("should pass opaque data through factory and return", async () => {
      const myOpaque = { id: 42, label: "test" };
      const chunks: Buffer[] = [];

      const result = await stream(
        hostUrl,
        {
          method: "GET",
          path: "/get",
          opaque: myOpaque,
        },
        ({ statusCode, opaque }) => {
          expect(statusCode).toBe(200);
          expect((opaque as any).id).toBe(42);
          return new Writable({
            write(chunk, _enc, cb) {
              chunks.push(chunk);
              cb();
            },
          });
        },
      );

      expect((result.opaque as any).id).toBe(42);
      expect((result.opaque as any).label).toBe("test");
    });

    it("should support POST with body", async () => {
      const chunks: Buffer[] = [];

      await stream(
        hostUrl,
        {
          method: "POST",
          path: "/post",
          headers: { "content-type": "text/plain" },
          body: "Hello stream",
        },
        ({ statusCode }) => {
          expect(statusCode).toBe(201);
          return new Writable({
            write(chunk, _enc, cb) {
              chunks.push(chunk);
              cb();
            },
          });
        },
      );

      const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      expect(json.data).toBe("Hello stream");
    });

    it("should pass headers through factory callback", async () => {
      let receivedHeaders: Record<string, string> = {};

      await stream(`${hostUrl}/get`, ({ statusCode, headers }) => {
        receivedHeaders = headers;
        return new Writable({
          write(_c, _e, cb) {
            cb();
          },
        });
      });

      expect(receivedHeaders["content-type"]).toContain("application/json");
    });

    it("should call callback if provided", async () => {
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      stream(
        `${hostUrl}/get`,
        {},
        ({ statusCode }) => {
          return new Writable({
            write(_c, _e, cb) {
              cb();
            },
          });
        },
        (err: any, data: any) => {
          try {
            expect(err).toBeNull();
            expect(data).toBeDefined();
            expect(data.trailers).toBeDefined();
            resolve();
          } catch (e) {
            reject(e);
          }
        },
      );

      await promise;
    });

    it("should throw on HTTP error when throwOnError is true", async () => {
      try {
        const chunks: Buffer[] = [];
        await stream(
          `${hostUrl}/not-found-endpoint-that-returns-404`,
          { throwOnError: true },
          ({ statusCode }: any) => {
            return new Writable({
              write(chunk, _enc, cb) {
                chunks.push(chunk);
                cb();
              },
            });
          },
        );
        throw new Error("Should have thrown");
      } catch (err: any) {
        expect(err.message).toContain("status code");
      }
    });

    it("should merge query parameters", async () => {
      const chunks: Buffer[] = [];

      await stream(`${hostUrl}/get?existing=1`, { query: { added: "2" } }, ({ statusCode }: any) => {
        return new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        });
      });

      const body = JSON.parse(Buffer.concat(chunks).toString());
      // The server echoes the request URL, which should contain both params
      expect(body.url).toContain("existing=1");
      expect(body.url).toContain("added=2");
    });

    it("should support Readable request body", async () => {
      const readable = new Readable({
        read() {
          this.push("streamed body data");
          this.push(null);
        },
      });

      const chunks: Buffer[] = [];
      await stream(`${hostUrl}/post`, { method: "POST", body: readable }, ({ statusCode }: any) => {
        return new Writable({
          write(chunk, _enc, cb) {
            chunks.push(chunk);
            cb();
          },
        });
      });

      const body = JSON.parse(Buffer.concat(chunks).toString());
      expect(body.data).toBe("streamed body data");
    });
  });

  // ---- Streaming behavior ----
  describe("streaming body", () => {
    it("should support destroying the body stream", async () => {
      const pool = new Pool(hostUrl);
      try {
        const response = await pool.request({ method: "GET", path: "/get" });

        // Calling destroy should not throw
        response.body!.destroy();
      } finally {
        await pool.close();
      }
    });

    it("should handle multiple sequential requests on the same pool", async () => {
      const pool = new Pool(hostUrl);
      try {
        for (let i = 0; i < 5; i++) {
          const response = await pool.request({ method: "GET", path: "/get" });
          expect(response.statusCode).toBe(200);

          const chunks: Buffer[] = [];
          for await (const chunk of response.body!) chunks.push(chunk);
          const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          expect(json.url).toBe(`${hostUrl}/get`);
        }
      } finally {
        await pool.close();
      }
    });
  });

  // ---- pipeline ----
  describe("pipeline", () => {
    it("GET: pipes the response body through unchanged", async () => {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const duplex = undici.pipeline(`${hostUrl}/get`, { method: "GET" }, ({ statusCode, body }) => {
        expect(statusCode).toBe(200);
        return body;
      });
      duplex.on("data", c => chunks.push(c));
      duplex.on("end", () => resolve());
      duplex.on("error", reject);
      duplex.end();
      await promise;

      const json = JSON.parse(Buffer.concat(chunks).toString());
      expect(json.url).toBe(`${hostUrl}/get`);
      expect(json.method).toBe("GET");
    });

    it("POST: writes a request body and reads the response", async () => {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const duplex = undici.pipeline(
        `${hostUrl}/post`,
        { method: "POST", headers: { "content-type": "text/plain" } },
        ({ statusCode, body }) => {
          expect(statusCode).toBe(201);
          return body;
        },
      );
      duplex.on("data", c => chunks.push(c));
      duplex.on("end", () => resolve());
      duplex.on("error", reject);
      duplex.end("hello pipeline");
      await promise;

      const json = JSON.parse(Buffer.concat(chunks).toString());
      expect(json.data).toBe("hello pipeline");
    });

    it("applies a Transform returned by the handler", async () => {
      const chunks: Buffer[] = [];
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      const duplex = undici.pipeline(`${hostUrl}/get`, { method: "GET" }, ({ body }) => {
        const upper = new Transform({
          transform(chunk, _enc, cb) {
            cb(null, Buffer.from(chunk.toString().toUpperCase()));
          },
        });
        body.pipe(upper);
        return upper;
      });
      duplex.on("data", c => chunks.push(c));
      duplex.on("end", () => resolve());
      duplex.on("error", reject);
      duplex.end();
      await promise;

      const out = Buffer.concat(chunks).toString();
      expect(out).toContain('"METHOD":"GET"');
      expect(out).not.toContain('"method"');
    });

    it("errors when the handler does not return a stream", async () => {
      const { promise, resolve } = Promise.withResolvers<Error>();
      const duplex = undici.pipeline(`${hostUrl}/get`, { method: "GET" }, () => undefined as any);
      duplex.on("error", e => resolve(e));
      duplex.on("data", () => {});
      duplex.end();
      const err = await promise;
      expect(err).toBeInstanceOf(Error);
    });
  });

  // ---- connect (HTTP CONNECT tunnel) ----
  describe("connect", () => {
    it("establishes a tunnel (200) and relays bytes both ways", async () => {
      await using server = await rawServer(socket => {
        let buf = Buffer.alloc(0);
        let tunneled = false;
        socket.on("data", chunk => {
          if (tunneled) {
            socket.write(chunk); // echo
            return;
          }
          buf = Buffer.concat([buf, chunk]);
          if (buf.indexOf("\r\n\r\n") !== -1) {
            tunneled = true;
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          }
        });
      });

      const { statusCode, socket } = await undici.connect(`http://127.0.0.1:${server.port}`);
      expect(statusCode).toBe(200);

      const { promise, resolve } = Promise.withResolvers<string>();
      socket.on("data", d => resolve(d.toString()));
      socket.write("ping");
      expect(await promise).toBe("ping");
      socket.destroy();
    });

    it("delivers bytes that arrive in the same packet as the CONNECT response", async () => {
      await using server = await rawServer(socket => {
        socket.once("data", () => {
          // 200 head + tunnel payload in a single write
          socket.write("HTTP/1.1 200 Connection Established\r\n\r\nhello-leftover");
        });
      });

      const { statusCode, socket } = await undici.connect(`http://127.0.0.1:${server.port}`);
      expect(statusCode).toBe(200);

      const { promise, resolve } = Promise.withResolvers<string>();
      socket.on("data", d => resolve(d.toString()));
      expect(await promise).toBe("hello-leftover");
      socket.destroy();
    });

    it("establishes a tunnel over TLS (forwards ca + servername, verification on)", async () => {
      await using server = await rawTlsServer(socket => {
        let buf = Buffer.alloc(0);
        let tunneled = false;
        socket.on("data", chunk => {
          if (tunneled) {
            socket.write(chunk); // echo
            return;
          }
          buf = Buffer.concat([buf, chunk]);
          if (buf.indexOf("\r\n\r\n") !== -1) {
            tunneled = true;
            socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          }
        });
      });

      // TCP to 127.0.0.1, but validate against the cert's "localhost" SAN using
      // the cert as its own CA. Verification stays ON.
      const { statusCode, socket } = await undici.connect(`https://127.0.0.1:${server.port}`, {
        ca: serverTls.cert,
        servername: "localhost",
      });
      expect(statusCode).toBe(200);

      const { promise, resolve } = Promise.withResolvers<string>();
      socket.on("data", d => resolve(d.toString()));
      socket.write("tls-ping");
      expect(await promise).toBe("tls-ping");
      socket.destroy();
    });

    it("rejects a self-signed TLS cert by default (validation on)", async () => {
      await using server = await rawTlsServer(socket => {
        socket.once("data", () => socket.write("HTTP/1.1 200 Connection Established\r\n\r\n"));
      });

      // No rejectUnauthorized:false -> TLS validation runs and fails the handshake.
      await expect(undici.connect(`https://127.0.0.1:${server.port}`)).rejects.toThrow();
    });
  });

  // ---- upgrade (HTTP Upgrade / 101) ----
  describe("upgrade", () => {
    it("performs a 101 upgrade and returns headers + a usable socket", async () => {
      await using server = await rawServer(socket => {
        let buf = Buffer.alloc(0);
        let upgraded = false;
        socket.on("data", chunk => {
          if (upgraded) {
            socket.write(chunk); // echo
            return;
          }
          buf = Buffer.concat([buf, chunk]);
          if (buf.indexOf("\r\n\r\n") !== -1) {
            upgraded = true;
            socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
          }
        });
      });

      const { headers, socket } = await undici.upgrade(`http://127.0.0.1:${server.port}`, { protocol: "websocket" });
      expect(headers.upgrade).toBe("websocket");

      const { promise, resolve } = Promise.withResolvers<string>();
      socket.on("data", d => resolve(d.toString()));
      socket.write("hi");
      expect(await promise).toBe("hi");
      socket.destroy();
    });

    it("rejects when the server does not switch protocols", async () => {
      await using server = await rawServer(socket => {
        socket.once("data", () => socket.write("HTTP/1.1 200 OK\r\nContent-Length: 0\r\n\r\n"));
      });

      await expect(undici.upgrade(`http://127.0.0.1:${server.port}`)).rejects.toThrow();
    });

    it("performs a 101 upgrade over TLS (forwards ca + servername)", async () => {
      await using server = await rawTlsServer(socket => {
        let buf = Buffer.alloc(0);
        let upgraded = false;
        socket.on("data", chunk => {
          if (upgraded) {
            socket.write(chunk); // echo
            return;
          }
          buf = Buffer.concat([buf, chunk]);
          if (buf.indexOf("\r\n\r\n") !== -1) {
            upgraded = true;
            socket.write("HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n");
          }
        });
      });

      const { headers, socket } = await undici.upgrade(`https://127.0.0.1:${server.port}`, {
        protocol: "websocket",
        ca: serverTls.cert,
        servername: "localhost",
      });
      expect(headers.upgrade).toBe("websocket");

      const { promise, resolve } = Promise.withResolvers<string>();
      socket.on("data", d => resolve(d.toString()));
      socket.write("tls-hi");
      expect(await promise).toBe("tls-hi");
      socket.destroy();
    });
  });

  // ---- Exports ----
  describe("exports", () => {
    it("should export all expected classes and functions", () => {
      expect(undici.Pool).toBeDefined();
      expect(undici.Client).toBeDefined();
      expect(undici.Agent).toBeDefined();
      expect(undici.request).toBeDefined();
      expect(undici.stream).toBeDefined();
      expect(typeof undici.Pool).toBe("function");
      expect(typeof undici.Client).toBe("function");
      expect(typeof undici.Agent).toBe("function");
      expect(typeof undici.request).toBe("function");
      expect(typeof undici.stream).toBe("function");
      expect(typeof undici.pipeline).toBe("function");
      expect(typeof undici.connect).toBe("function");
      expect(typeof undici.upgrade).toBe("function");
    });
  });
});
