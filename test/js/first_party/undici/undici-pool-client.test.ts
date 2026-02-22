import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { Pool, Client, Agent, stream } from "undici";
import * as undici from "undici";
import { Writable } from "stream";

import { createServer } from "../../../http-test-server";

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

    it(
      "should call callback if provided",
      async () => {
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
      },
      { timeout: 5000 },
    );

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
      let receivedUrl = "";
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
      const { Readable: ReadableStream } = require("stream");
      const readable = new ReadableStream({
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
    });
  });
});
