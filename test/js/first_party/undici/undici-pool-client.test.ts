import { afterAll, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import net from "node:net";
import tls from "node:tls";
import { Readable, Transform, Writable } from "stream";
import * as undici from "undici";
import { Agent, Client, Pool, stream } from "undici";

import { tls as serverTls } from "harness";
import { createServer } from "../../../http-test-server";

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
        expect(e.code).toBe("UND_ERR_DESTROYED");
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

  // ---- dispatch ----
  describe("dispatch", () => {
    it("Pool.dispatch delivers onConnect, onHeaders, onData, onComplete", async () => {
      const pool = new Pool(hostUrl);
      try {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        let connected = false;
        let statusCode = 0;
        const chunks: Buffer[] = [];

        pool.dispatch(
          { method: "GET", path: "/get" },
          {
            onConnect(abort) {
              connected = true;
              expect(typeof abort).toBe("function");
            },
            onHeaders(status, headers, resume) {
              statusCode = status;
              expect(Array.isArray(headers)).toBe(true);
              return true;
            },
            onData(chunk) {
              chunks.push(chunk);
              return true;
            },
            onComplete(trailers) {
              try {
                expect(connected).toBe(true);
                expect(statusCode).toBe(200);
                const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                expect(json.url).toBe(`${hostUrl}/get`);
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            onError(err) {
              reject(err);
            },
          },
        );

        await promise;
      } finally {
        await pool.close();
      }
    });

    it("Client.dispatch delivers onConnect, onHeaders, onData, onComplete", async () => {
      const client = new Client(hostUrl);
      try {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const chunks: Buffer[] = [];

        client.dispatch(
          { method: "POST", path: "/post", body: "Hello from dispatch" },
          {
            onConnect() {},
            onHeaders(status) {
              expect(status).toBe(201);
              return true;
            },
            onData(chunk) {
              chunks.push(chunk);
              return true;
            },
            onComplete() {
              try {
                const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
                expect(json.data).toBe("Hello from dispatch");
                resolve();
              } catch (e) {
                reject(e);
              }
            },
            onError(err) {
              reject(err);
            },
          },
        );

        await promise;
      } finally {
        await client.close();
      }
    });

    it("Agent.dispatch requires opts.origin and dispatches", async () => {
      const agent = new Agent();
      try {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        const chunks: Buffer[] = [];

        agent.dispatch(
          { origin: hostUrl, method: "GET", path: "/get" },
          {
            onConnect() {},
            onHeaders(status) {
              expect(status).toBe(200);
              return true;
            },
            onData(chunk) {
              chunks.push(chunk);
              return true;
            },
            onComplete() {
              resolve();
            },
            onError(err) {
              reject(err);
            },
          },
        );

        await promise;
      } finally {
        await agent.close();
      }
    });

    it("Pool.dispatch throws/calls onError when closed", async () => {
      const pool = new Pool(hostUrl);
      await pool.close();

      const { promise, resolve } = Promise.withResolvers<Error>();
      pool.dispatch(
        { method: "GET", path: "/get" },
        {
          onConnect() {},
          onHeaders() {
            return true;
          },
          onData() {
            return true;
          },
          onComplete() {},
          onError(err) {
            resolve(err);
          },
        },
      );

      const err = await promise;
      expect(err.message).toContain("closed");
    });
  });

  // ---- Pool/Client stream & pipeline methods ----
  describe("Pool and Client stream / pipeline methods", () => {
    it("pool.stream streams response", async () => {
      const pool = new Pool(hostUrl);
      try {
        const chunks: Buffer[] = [];
        await pool.stream({ method: "GET", path: "/get" }, ({ statusCode }) => {
          expect(statusCode).toBe(200);
          return new Writable({
            write(chunk, _enc, cb) {
              chunks.push(chunk);
              cb();
            },
          });
        });
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.url).toBe(`${hostUrl}/get`);
      } finally {
        await pool.close();
      }
    });

    it("client.stream streams response", async () => {
      const client = new Client(hostUrl);
      try {
        const chunks: Buffer[] = [];
        await client.stream({ method: "GET", path: "/get" }, ({ statusCode }) => {
          expect(statusCode).toBe(200);
          return new Writable({
            write(chunk, _enc, cb) {
              chunks.push(chunk);
              cb();
            },
          });
        });
        const json = JSON.parse(Buffer.concat(chunks).toString("utf8"));
        expect(json.url).toBe(`${hostUrl}/get`);
      } finally {
        await client.close();
      }
    });
  });

  // ---- Edge case regressions ----
  describe("edge cases and input validations", () => {
    it("rejects empty string body on GET / HEAD requests", async () => {
      await expect(undici.request(`${hostUrl}/get`, { method: "GET", body: "" })).rejects.toThrow("Body not allowed");
      await expect(undici.request(`${hostUrl}/head`, { method: "HEAD", body: "" })).rejects.toThrow("Body not allowed");
    });

    it("does not mutate original URL instance when query options are passed", async () => {
      const urlObj = new URL(`${hostUrl}/get?original=yes`);
      const originalSearch = urlObj.search;
      await undici.request(urlObj, { query: { extra: "param" } });
      expect(urlObj.search).toBe(originalSearch);
    });

    it("stream throws synchronous TypeError when factory is not a function", () => {
      expect(() => {
        undici.stream(`${hostUrl}/get`, {} as any, null as any);
      }).toThrow(TypeError);
    });
  });

  // ---- Exports ----
  describe("exports", () => {
    it("should export all expected classes and functions", () => {
      expect(undici.Pool).toBeDefined();
      expect(undici.Client).toBeDefined();
      expect(undici.Agent).toBeDefined();
      expect(undici.Dispatcher).toBeDefined();
      expect(undici.request).toBeDefined();
      expect(undici.stream).toBeDefined();
      expect(undici.dispatch).toBeDefined();
      expect(typeof undici.Pool).toBe("function");
      expect(typeof undici.Client).toBe("function");
      expect(typeof undici.Agent).toBe("function");
      expect(typeof undici.Dispatcher).toBe("function");
      expect(typeof undici.request).toBe("function");
      expect(typeof undici.stream).toBe("function");
      expect(typeof undici.pipeline).toBe("function");
      expect(typeof undici.connect).toBe("function");
      expect(typeof undici.upgrade).toBe("function");
      expect(typeof undici.dispatch).toBe("function");
    });
  });
});

// Lifecycle (close/destroy, in-flight tracking) and the full dispatch() path used by
// @elastic/transport and miniflare.
describe("undici dispatcher lifecycle and dispatch()", () => {
  let server: ReturnType<typeof Bun.serve>;
  let origin: string;
  let release: (() => void) | undefined;
  let gate: Promise<void>;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/slow") {
          return gate.then(() => new Response("slow-done"));
        }
        if (url.pathname === "/chunks") {
          return new Response(
            new ReadableStream({
              async start(controller) {
                for (const part of ["a", "b", "c"]) {
                  controller.enqueue(new TextEncoder().encode(part));
                  await Bun.sleep(5);
                }
                controller.close();
              },
            }),
            { headers: { "x-test": "yes" } },
          );
        }
        if (url.pathname === "/product") {
          return Response.json({ ok: true }, { headers: { "x-elastic-product": "Elasticsearch" } });
        }
        return new Response("hello", { headers: { "x-test": "yes" } });
      },
    });
    origin = `http://localhost:${server.port}`;
  });
  afterAll(() => {
    server.stop(true);
  });
  beforeEach(() => {
    gate = new Promise<void>(resolve => (release = resolve));
  });

  function collect(dispatcher: any, opts: any, kind: "legacy" | "controller", pauseOnce = false) {
    return new Promise<{ status: number; headers: Record<string, string>; body: string; events: string[] }>(
      (resolve, reject) => {
        const chunks: Buffer[] = [];
        const events: string[] = [];
        let status = 0;
        let headers: Record<string, string> = {};
        let paused = false;
        const finish = () => resolve({ status, headers, body: Buffer.concat(chunks).toString(), events });
        const handler: any =
          kind === "legacy"
            ? {
                onConnect: (abort: Function) => {
                  events.push("connect");
                  expect(typeof abort).toBe("function");
                },
                onHeaders: (code: number, raw: Buffer[], _resume: Function, statusText: string) => {
                  events.push("headers");
                  status = code;
                  expect(Buffer.isBuffer(raw[0])).toBe(true);
                  expect(typeof statusText).toBe("string");
                  for (let i = 0; i < raw.length; i += 2) headers[raw[i].toString()] = raw[i + 1].toString();
                  return true;
                },
                onData: function (chunk: Buffer) {
                  events.push("data");
                  chunks.push(chunk);
                  if (pauseOnce && !paused) {
                    paused = true;
                    setTimeout(() => handler.__resume(), 20);
                    return false;
                  }
                  return true;
                },
                onComplete: () => (events.push("complete"), finish()),
                onError: reject,
              }
            : {
                onRequestStart: (c: any) => {
                  events.push("start");
                  expect(typeof c.abort).toBe("function");
                },
                onResponseStart: (_c: any, code: number, h: Record<string, string>) => {
                  events.push("headers");
                  status = code;
                  headers = h;
                },
                onResponseData: (_c: any, chunk: Buffer) => {
                  events.push("data");
                  chunks.push(chunk);
                },
                onResponseEnd: () => (events.push("end"), finish()),
                onResponseError: (_c: any, err: Error) => reject(err),
              };
        if (kind === "legacy") {
          handler.onHeaders = ((orig: Function) => (code: number, raw: Buffer[], resume: Function, st: string) => {
            handler.__resume = resume;
            return orig(code, raw, resume, st);
          })(handler.onHeaders);
        }
        dispatcher.dispatch(opts, handler);
      },
    );
  }

  it("Dispatcher base class is abstract, concrete dispatchers are Dispatchers", () => {
    expect(() => new undici.Dispatcher().dispatch({} as any, {} as any)).toThrow();
    for (const d of [new Pool(origin), new Client(origin), new Agent(), new undici.BalancedPool(origin)]) {
      expect(d).toBeInstanceOf(undici.Dispatcher);
      expect(typeof d.dispatch).toBe("function");
      expect(typeof d.close).toBe("function");
      expect(typeof d.destroy).toBe("function");
    }
    expect(undici.getGlobalDispatcher()).toBeInstanceOf(Agent);
  });

  it("errors carry undici's name and code", () => {
    const { errors } = undici as any;
    expect(new errors.ClientClosedError("x")).toMatchObject({ name: "ClientClosedError", code: "UND_ERR_CLOSED" });
    expect(new errors.ClientDestroyedError("x")).toMatchObject({ code: "UND_ERR_DESTROYED" });
    expect(new errors.RequestAbortedError("x")).toMatchObject({ code: "UND_ERR_ABORTED" });
    expect(new errors.InvalidArgumentError("x")).toMatchObject({ code: "UND_ERR_INVALID_ARG" });
  });

  for (const Ctor of [Pool, Client, undici.BalancedPool] as any[]) {
    it(`${Ctor.name}.close() waits for in-flight requests and then rejects new ones`, async () => {
      const d = new Ctor(origin);
      const inflight = d.request({ method: "GET", path: "/slow" });
      let closed = false;
      const closing = d.close().then(() => (closed = true));
      expect(d.closed).toBe(true);
      await Bun.sleep(30);
      expect(closed).toBe(false);
      await expect(d.request({ method: "GET", path: "/" })).rejects.toMatchObject({ code: "UND_ERR_CLOSED" });
      release!();
      const res = await inflight;
      expect(await res.body.text()).toBe("slow-done");
      await closing;
      expect(closed).toBe(true);
    });
  }

  it("close() supports the callback form", async () => {
    const d = new Pool(origin);
    const result = await new Promise((resolve, reject) => {
      const ret = d.close((err: any, value: any) => (err ? reject(err) : resolve(value)));
      expect(ret).toBeUndefined();
    });
    expect(result).toBeNull();
  });

  it("destroy() aborts in-flight requests with the given error and rejects new ones", async () => {
    const d = new Pool(origin);
    const inflight = d.request({ method: "GET", path: "/slow" });
    const boom = new Error("boom");
    await Bun.sleep(20);
    await d.destroy(boom);
    expect(d.destroyed).toBe(true);
    await expect(inflight).rejects.toBe(boom);
    await expect(d.request({ method: "GET", path: "/" })).rejects.toMatchObject({ code: "UND_ERR_DESTROYED" });
    release!();
  });

  it("destroy() without an error uses ClientDestroyedError, and supports callbacks", async () => {
    const d = new Client(origin);
    const inflight = d.request({ method: "GET", path: "/slow" });
    await Bun.sleep(20);
    await new Promise<void>(resolve => d.destroy(() => resolve()));
    await expect(inflight).rejects.toMatchObject({ code: "UND_ERR_DESTROYED" });
    release!();
  });

  it("dispatch() on a closed or destroyed dispatcher reports through onError", async () => {
    for (const [method, code] of [
      ["close", "UND_ERR_CLOSED"],
      ["destroy", "UND_ERR_DESTROYED"],
    ] as const) {
      const d = new Pool(origin);
      await d[method]();
      const err = await new Promise<any>(resolve => {
        expect(d.dispatch({ method: "GET", path: "/" }, { onError: resolve } as any)).toBe(false);
      });
      expect(err.code).toBe(code);
    }
  });

  it("dispatch() validates its arguments synchronously", () => {
    const d = new Pool(origin);
    expect(() => d.dispatch(null as any, {} as any)).toThrow(/opts/);
    expect(() => d.dispatch({ method: "GET", path: "/" }, null as any)).toThrow(/handler/);
  });

  for (const kind of ["legacy", "controller"] as const) {
    it(`dispatch() drives the ${kind} handler interface`, async () => {
      for (const d of [new Pool(origin), new Client(origin)]) {
        const r = await collect(d, { method: "GET", path: "/" }, kind);
        expect(r.status).toBe(200);
        expect(r.headers["x-test"]).toBe("yes");
        expect(r.body).toBe("hello");
        expect(r.events[0]).toBe(kind === "legacy" ? "connect" : "start");
        expect(r.events.at(-1)).toBe(kind === "legacy" ? "complete" : "end");
      }
      const agent = await collect(new Agent(), { origin, method: "GET", path: "/" }, kind);
      expect(agent.body).toBe("hello");
    });

    it(`dispatch() streams chunks to the ${kind} handler`, async () => {
      const r = await collect(new Pool(origin), { method: "GET", path: "/chunks" }, kind);
      expect(r.body).toBe("abc");
      expect(r.events.filter(e => e === "data").length).toBeGreaterThanOrEqual(1);
    });
  }

  it("legacy onData returning false pauses until resume() is called", async () => {
    const r = await collect(new Pool(origin), { method: "GET", path: "/chunks" }, "legacy", true);
    expect(r.body).toBe("abc");
  });

  it("aborting from onConnect reports RequestAbortedError and cancels the request", async () => {
    const d = new Pool(origin);
    const err: any = await new Promise(resolve => {
      d.dispatch({ method: "GET", path: "/slow" }, {
        onConnect: (abort: Function) => abort(),
        onError: resolve,
      } as any);
    });
    expect(err.code).toBe("UND_ERR_ABORTED");
    release!();
    await d.close();
  });

  it("aborting from a controller callback stops the body", async () => {
    const d = new Pool(origin);
    let data = 0;
    const err: any = await new Promise(resolve => {
      d.dispatch({ method: "GET", path: "/chunks" }, {
        onRequestStart() {},
        onResponseStart() {},
        onResponseData(c: any) {
          data++;
          c.abort();
        },
        onResponseEnd() {
          resolve(new Error("should not complete"));
        },
        onResponseError(_c: any, e: Error) {
          resolve(e);
        },
      } as any);
    });
    expect(err.code).toBe("UND_ERR_ABORTED");
    expect(data).toBe(1);
  });

  it("opts.signal aborts dispatch() and request(), including a synthetic 'abort' event", async () => {
    const d = new Pool(origin);
    const ac = new AbortController();
    const p = d.request({ method: "GET", path: "/slow", signal: ac.signal });
    await Bun.sleep(10);
    ac.abort();
    await expect(p).rejects.toBeDefined();

    // @elastic/transport implements per-request timeouts by dispatching a bare Event, which does
    // not flip signal.aborted; undici still reacts to the event.
    const synthetic = new AbortController();
    const p2 = d.request({ method: "GET", path: "/slow", signal: synthetic.signal });
    await Bun.sleep(10);
    synthetic.signal.dispatchEvent(new Event("abort"));
    await expect(p2).rejects.toBeDefined();
    release!();
    await d.close();
  });

  it("an in-flight dispatch() keeps close() pending until the handler completes", async () => {
    const d = new Pool(origin);
    const done = collect(d, { method: "GET", path: "/slow" }, "legacy");
    let closed = false;
    const closing = d.close().then(() => (closed = true));
    await Bun.sleep(30);
    expect(closed).toBe(false);
    release!();
    expect((await done).body).toBe("slow-done");
    await closing;
    expect(closed).toBe(true);
  });

  it("stream() on a closed dispatcher rejects with UND_ERR_CLOSED", async () => {
    const d = new Pool(origin);
    await d.close();
    await expect(d.stream({ method: "GET", path: "/" }, () => new Writable())).rejects.toMatchObject({
      code: "UND_ERR_CLOSED",
    });
  });

  // Mirrors how @elastic/transport's UndiciConnection uses undici: one Pool per node, request()
  // with a signal, body.setEncoding("utf8") + for-await, and Pool.close() on shutdown.
  it("supports the @elastic/transport usage pattern", async () => {
    const pool = new Pool(origin, { keepAliveTimeout: 1000, connections: 4 });
    const res = await pool.request({
      method: "GET",
      path: "/product",
      headers: { accept: "application/json" },
      signal: new AbortController().signal,
    } as any);
    expect(res.headers["x-elastic-product"]).toBe("Elasticsearch");
    res.body.setEncoding("utf8");
    let payload = "";
    for await (const chunk of res.body) payload += chunk;
    expect(JSON.parse(payload)).toEqual({ ok: true });
    await pool.close();
  });
});
