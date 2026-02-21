import { expect, test } from "bun:test";
import http from "node:http";

// https://github.com/oven-sh/bun/issues/23751
// When using req.write() followed by req.end(), Bun should send
// Transfer-Encoding: chunked instead of Content-Length, matching Node.js behavior.

test("http.request with req.write() uses Transfer-Encoding: chunked", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    te: string | null;
    cl: string | null;
    body: string;
  }>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      resolve({
        te: req.headers.get("transfer-encoding"),
        cl: req.headers.get("content-length"),
        body,
      });
      return new Response("OK");
    },
  });

  const req = http.request(
    {
      hostname: server.hostname,
      port: server.port,
      path: "/",
      method: "POST",
    },
    res => {
      res.on("data", () => {});
      res.on("end", () => {});
    },
  );
  req.write("hello");
  req.end();

  const result = await promise;
  expect(result.te).toBe("chunked");
  expect(result.cl).toBeNull();
  expect(result.body).toBe("hello");
});

test("http.request with req.write() multiple chunks uses Transfer-Encoding: chunked", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    te: string | null;
    cl: string | null;
    body: string;
  }>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      resolve({
        te: req.headers.get("transfer-encoding"),
        cl: req.headers.get("content-length"),
        body,
      });
      return new Response("OK");
    },
  });

  const req = http.request(
    {
      hostname: server.hostname,
      port: server.port,
      path: "/",
      method: "POST",
    },
    res => {
      res.on("data", () => {});
      res.on("end", () => {});
    },
  );
  req.write("hello ");
  req.write("world");
  req.end();

  const result = await promise;
  expect(result.te).toBe("chunked");
  expect(result.cl).toBeNull();
  expect(result.body).toBe("hello world");
});

test("http.request with explicit Content-Length preserves it", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    te: string | null;
    cl: string | null;
    body: string;
  }>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      resolve({
        te: req.headers.get("transfer-encoding"),
        cl: req.headers.get("content-length"),
        body,
      });
      return new Response("OK");
    },
  });

  const req = http.request(
    {
      hostname: server.hostname,
      port: server.port,
      path: "/",
      method: "POST",
      headers: {
        "Content-Length": "5",
      },
    },
    res => {
      res.on("data", () => {});
      res.on("end", () => {});
    },
  );
  req.write("hello");
  req.end();

  const result = await promise;
  expect(result.cl).toBe("5");
  expect(result.te).toBeNull();
  expect(result.body).toBe("hello");
});

test("http.request with req.end(data) and no req.write() uses Content-Length", async () => {
  const { promise, resolve } = Promise.withResolvers<{
    te: string | null;
    cl: string | null;
    body: string;
  }>();

  using server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = await req.text();
      resolve({
        te: req.headers.get("transfer-encoding"),
        cl: req.headers.get("content-length"),
        body,
      });
      return new Response("OK");
    },
  });

  const req = http.request(
    {
      hostname: server.hostname,
      port: server.port,
      path: "/",
      method: "POST",
    },
    res => {
      res.on("data", () => {});
      res.on("end", () => {});
    },
  );
  req.end("hello");

  const result = await promise;
  expect(result.cl).toBe("5");
  expect(result.te).toBeNull();
  expect(result.body).toBe("hello");
});
