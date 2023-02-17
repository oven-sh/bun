import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { gc } from "./gc";

let proxy, server;

// TODO: Proxy with TLS requests

beforeAll(() => {
  proxy = Bun.serve({
    async fetch(request) {
      // if is not an proxy connection just drop it
      if (!request.headers.has("proxy-connection")) {
        return new Response("Bad Request", { status: 400 });
      }

      // simple http proxy
      if (request.url.startsWith("http://")) {
        return await fetch(request.url, {
          method: request.method,
          body: await request.text(),
        });
      }

      // no TLS support here
      return new Response("Bad Request", { status: 400 });
    },
    port: 54312,
  });
  server = Bun.serve({
    async fetch(request) {
      if (request.method === "POST") {
        const text = await request.text();
        return new Response(text, { status: 200 });
      }
      return new Response("Hello, World", { status: 200 });
    },
    port: 54322,
  });
});

afterAll(() => {
  server.stop();
  proxy.stop();
});

describe("proxy", () => {
  const requests = [
    [new Request("http://localhost:54322"), "fetch() GET with non-TLS Proxy", "http://localhost:54312"],
    [
      new Request("http://localhost:54322", {
        method: "POST",
        body: "Hello, World",
      }),
      "fetch() POST with non-TLS Proxy",
      "http://localhost:54312",
    ],
  ];
  for (let [request, name, proxy] of requests) {
    gc();
    it(name, async () => {
      gc();
      const response = await fetch(request, { verbose: true, proxy });
      gc();
      const text = await response.text();
      gc();
      expect(text).toBe("Hello, World");
    });
  }
});
