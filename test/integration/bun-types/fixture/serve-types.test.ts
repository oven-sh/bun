// This file is checked in the `bun-types.test.ts` integration test for successful typechecking, but also checked
// on its own to make sure that the types line up with actual implementation of Bun.serve()

import { expect, it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import html from "./html.html";
import { expectType } from "./utilities";

// XXX: importing this from "harness" caused a failure in bun-types.test.ts
function tmpdirSync(pattern: string = "bun.test."): string {
  return fs.mkdtempSync(join(fs.realpathSync.native(os.tmpdir()), pattern));
}

export default {
  fetch: req => Response.json(req.url),
  websocket: {
    message(ws) {
      expectType(ws.data).is<{ name: string }>();
    },
  },
  routes: {
    "/": req => {
      expectType(req.params).is<Record<string, string>>();
    },
  },
} satisfies Bun.Serve.Options<{ name: string }>;

function expectInstanceOf<T>(value: unknown, constructor: new (...args: any[]) => T): asserts value is T {
  expect(value).toBeInstanceOf(constructor);
}

function test<T = undefined, R extends string = string>(
  name: string,
  options: Bun.Serve.Options<T, R>,
  {
    onConstructorFailure,
    overrideExpectBehavior,
    skip: skipOptions,
  }: {
    onConstructorFailure?: (error: Error) => void | Promise<void>;
    overrideExpectBehavior?: (server: NoInfer<Bun.Server<T>>) => void | Promise<void>;
    skip?: boolean;
  } = {},
) {
  const skip = skipOptions || ("unix" in options && typeof options.unix === "string" && process.platform === "win32");

  async function testServer(server: Bun.Server<T>) {
    if (overrideExpectBehavior) {
      await overrideExpectBehavior(server);
    } else {
      expectInstanceOf(server.url, URL);
      expect(server.hostname).toBeDefined();
      expect(server.port).toBeGreaterThan(0);
      expect(server.url.toString()).toStartWith("http");
      expect(await fetch(server.url)).toBeInstanceOf(Response);
    }
  }

  it.skipIf(skip)(name, async () => {
    try {
      using server = Bun.serve(options);
      try {
        await testServer(server);
      } finally {
        await server.stop(true);
      }
    } catch (error) {
      if (onConstructorFailure) {
        expectInstanceOf(error, Error);
        await onConstructorFailure(error);
      } else throw error;
    }
  });
}

test("basic", {
  routes: {
    "/123": {
      "GET": new Response("Cool/great"),
    },
  },
  fetch(req) {
    console.log(req.url); // => http://localhost:3000/
    return new Response("Hello World");
  },
});

test(
  "basic + tls",
  {
    fetch(req) {
      console.log(req.url); // => http://localhost:3000/
      return new Response("Hello World");
    },
    tls: {
      key: "ca.pem",
      cert: "cert.pem",
    },
  },
  {
    onConstructorFailure: error => {
      expect(error.message).toContain("BoringSSL error:0900006e:PEM routines:OPENSSL_internal:NO_START_LINE");
    },
  },
);

test(
  "basic + invalid route value",
  {
    routes: {
      "/": new Response("Hello World"),
      // @ts-expect-error Invalid value
      "/2": null,
    },
  },
  {
    onConstructorFailure: error => {
      expect(error.message).toContain("'routes' expects a Record<string,");
    },
  },
);

test("basic + websocket + upgrade", {
  websocket: {
    message(ws, message) {
      expectType<typeof ws>().is<Bun.ServerWebSocket<undefined>>();
      ws.send(message);
      expectType(message).is<string | Buffer<ArrayBuffer>>();
    },
  },

  fetch(req, server) {
    expectType(req).is<Request>();

    // Upgrade to a ServerWebSocket if we can
    // This automatically checks for the `Sec-WebSocket-Key` header
    // meaning you don't have to check headers, you can just call `upgrade()`
    if (server.upgrade(req)) {
      // When upgrading, we return undefined since we don't want to send a Response
      // return;
    }

    return new Response("Regular HTTP response");
  },
});

test("basic + websocket + upgrade + all handlers", {
  fetch(req, server) {
    expectType(server.upgrade).is<
      (
        req: Request,
        options: {
          data?: { name: string };
          headers?: Bun.HeadersInit;
        },
      ) => boolean
    >;

    const url = new URL(req.url);
    if (url.pathname === "/chat") {
      if (
        server.upgrade(req, {
          data: {
            name: new URL(req.url).searchParams.get("name") || "Friend",
          },
          headers: {
            "Set-Cookie": "name=" + new URL(req.url).searchParams.get("name"),
          },
        })
      ) {
        return;
      }
    }

    return new Response("Expected a websocket connection", { status: 400 });
  },

  websocket: {
    data: {} as { name: string },

    open(ws) {
      console.log("WebSocket opened");
      ws.subscribe("the-group-chat");
    },

    message(ws, message) {
      expectType(message).is<string | Buffer<ArrayBuffer>>();
      ws.publish("the-group-chat", `${ws.data.name}: ${message.toString()}`);
    },

    close(ws, code, reason) {
      expectType(code).is<number>();
      expectType(reason).is<string>();
      ws.publish("the-group-chat", `${ws.data.name} left the chat`);
    },

    drain(ws) {
      expectType(ws.data.name).is<string>();
      console.log("Please send me data. I am ready to receive it.");
    },

    perMessageDeflate: true,
  },
});

test(
  "basic error handling",
  {
    fetch(req) {
      throw new Error("woops!");
    },
    error(error) {
      return new Response(`<pre>${error.message}\n${error.stack}</pre>`, {
        status: 500,
        headers: {
          "Content-Type": "text/html",
        },
      });
    },
  },
  {
    overrideExpectBehavior: async server => {
      const res = await fetch(server.url);
      expect(res.status).toBe(500);
      expect(await res.text()).toContain("woops!");
    },
  },
);

test("port 0 + websocket + upgrade", {
  port: 0,
  fetch(req, server) {
    server.upgrade(req);
    if (Math.random() > 0.5) return undefined;
    return new Response();
  },
  websocket: {
    message(ws) {
      expectType(ws).is<Bun.ServerWebSocket<undefined>>();
    },
  },
});

test(
  "basic unix socket",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch() {
      return new Response();
    },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "basic unix socket + websocket + upgrade",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch(req, server) {
      server.upgrade(req);
      if (Math.random() > 0.5) return undefined;
      return new Response();
    },
    websocket: { message() {} },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "basic unix socket + websocket + upgrade + tls",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch(req, server) {
      server.upgrade(req);
      if (Math.random() > 0.5) return undefined;
      return new Response();
    },
    websocket: { message() {} },
    tls: {},
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "basic unix socket 2",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }

      return new Response();
    },
    websocket: { message() {} },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "basic unix socket + upgrade + cheap request to check upgrade",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch(req, server) {
      if (server.upgrade(req)) {
        return;
      }

      return new Response("failed to upgrade", { status: 500 });
    },
    websocket: {
      message: () => {},
    },
  },
  {
    overrideExpectBehavior: async server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");

      async function cheapRequest(request: string) {
        const p = Promise.withResolvers<void>();

        let chunks: string[] = [];

        const sock = await Bun.connect({
          unix: server.url.toString(),
          socket: {
            data: (socket, chunk) => {
              chunks.push(chunk.toString());

              if (chunks.length === 1) {
                p.resolve();
              }
            },
          },
        });

        sock.write(request);

        await p.promise;
        return chunks.join("\n");
      }

      const result = await cheapRequest(
        "GET / HTTP/1.1\r\n" +
          "Host: example.com\r\n" +
          "Upgrade: websocket\r\n" +
          "Connection: Upgrade\r\n" +
          "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n" +
          "Sec-WebSocket-Version: 13\r\n" +
          "\r\n",
      );

      expect(result).toContain("HTTP/1.1 101 Switching Protocols\r\n");
      expect(result).toContain("Upgrade: websocket\r\n");
      expect(result).toContain("Connection: Upgrade\r\n");
      expect(result).toContain("Sec-WebSocket-Accept: ");
    },
  },
);

test(
  "basic unix socket + routes",
  {
    unix: `${tmpdirSync()}/bun.sock`,
    routes: {
      "/": new Response("Hello World"),
    },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "unix socket with no routes or fetch handler (should fail)",
  // @ts-expect-error - Missing fetch or routes
  {
    unix: `${tmpdirSync()}/bun.sock`,
  },
  {
    onConstructorFailure: error => {
      expect(error.message).toContain("Bun.serve() needs either:");
      expect(error.message).toContain("A routes object:");
      expect(error.message).toContain("Or a fetch handler");
    },
  },
);

test("basic routes + fetch + websocket + upgrade", {
  routes: {
    "/:test": req => {
      return new Response(req.params.test);
    },
  },

  fetch: (req, server) => {
    if (!server.upgrade(req)) {
      return new Response("not upgraded");
    }
  },

  websocket: {
    message: ws => {
      ws.data;
      ws.send(" ");
    },
  },
});

test("basic routes + fetch", {
  routes: {
    "/:test": req => {
      return new Response(req.params.test);
    },
  },

  fetch: (req, server) => {
    return new Response("cool");
  },
});

test("very basic fetch", {
  fetch: (req, server) => {
    return new Response("cool");
  },
});

test("very basic single route with url params", {
  routes: {
    "/:test": req => {
      return new Response(req.params.test);
    },
  },
});

test("very basic fetch with websocket message handler", {
  fetch: () => new Response("ok"),
  websocket: {
    message: ws => {
      expectType(ws).is<Bun.ServerWebSocket<undefined>>();
    },
  },
});

test("yet another basic fetch and websocket message handler", {
  websocket: {
    message: ws => {
      expectType(ws).is<Bun.ServerWebSocket<undefined>>();
    },
  },
  fetch: (req, server) => {
    if (server.upgrade(req)) {
      return;
    }

    return new Response("not upgraded");
  },
});

test("websocket + upgrade on a route path", {
  websocket: {
    message: ws => {
      expectType(ws).is<Bun.ServerWebSocket<undefined>>();
    },
  },
  routes: {
    "/ws": (req, server) => {
      if (server.upgrade(req)) {
        return;
      }

      return new Response("not upgraded");
    },
  },
});

const files = {} as Record<string, Bun.BunFile>;

test("permutations of valid route values", {
  routes: {
    "/this/:test": Bun.file(import.meta.file),
    "/index.test-d.ts": Bun.file("index.test-d.ts"),
    // @ts-expect-error this is invalid
    "/index.test-d.ts.2": () => Bun.file("index.test-d.ts"),
    "/ping": new Response("pong"),
    "/": html,
    // @ts-expect-error this is invalid, but hopefully not for too long
    "/index.html": new Response(html),
    ...files,
  },

  fetch: (req, server) => {
    return new Response("cool");
  },
});

test("basic websocket upgrade and ws publish/subscribe to topics", {
  fetch(req, server) {
    server.upgrade(req);
  },
  websocket: {
    open(ws) {
      console.log("WebSocket opened");
      ws.subscribe("test-channel");
    },

    message(ws, message) {
      ws.publish("test-channel", `${message.toString()}`);
    },
    perMessageDeflate: true,
  },
});

test(
  "port with unix socket (is a type error)",
  // @ts-expect-error Cannot pass unix and port
  {
    unix: `${tmpdirSync()}/bun.sock`,
    port: 0,
    fetch() {
      return new Response();
    },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test(
  "port with unix socket with websocket + upgrade (is a type error)",
  // @ts-expect-error cannot pass unix and port at same time
  {
    unix: `${tmpdirSync()}/bun.sock`,
    port: 0,
    fetch(req, server) {
      server.upgrade(req);
      if (Math.random() > 0.5) return undefined;
      return new Response();
    },
    websocket: { message: ws => expectType(ws).is<Bun.ServerWebSocket<undefined>>() },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.hostname).toBeUndefined();
      expect(server.port).toBeUndefined();
      expect(server.url.toString()).toStartWith("unix://");
    },
  },
);

test("hostname: 0.0.0.0 (default - listen on all interfaces)", {
  hostname: "0.0.0.0",
  fetch() {
    return new Response("listening on all interfaces");
  },
});

test("hostname: 127.0.0.1 (localhost only)", {
  hostname: "127.0.0.1",
  fetch() {
    return new Response("listening on localhost only");
  },
});

test("hostname: localhost", {
  hostname: "localhost",
  fetch() {
    return new Response("listening on localhost");
  },
});

test(
  "hostname: custom IPv4 address",
  {
    hostname: "192.168.1.100",
    fetch() {
      return new Response("custom hostname");
    },
  },
  {
    onConstructorFailure: error => {
      expect(error.message).toContain("Failed to start server");
    },
  },
);

test("port: number type", {
  port: 3000,
  fetch() {
    return new Response("port as number");
  },
});

test("port: string type", {
  port: "3001",
  fetch() {
    return new Response("port as string");
  },
});

test("port: 0 (random port assignment)", {
  port: 0,
  fetch() {
    return new Response("random port");
  },
});

test(
  "port: from environment variable",
  {
    port: process.env.PORT || "3002",
    fetch() {
      return new Response("port from env");
    },
  },
  {
    overrideExpectBehavior: server => {
      expect(server.port).toBeGreaterThan(0);
      expect(server.url).toBeDefined();
    },
  },
);

test("reusePort: false (default)", {
  reusePort: false,
  port: 0,
  fetch() {
    return new Response("reusePort false");
  },
});

test("reusePort: true", {
  reusePort: true,
  port: 0,
  fetch() {
    return new Response("reusePort true");
  },
});

test("ipv6Only: false (default)", {
  ipv6Only: false,
  port: 0,
  fetch() {
    return new Response("ipv6Only false");
  },
});

test("idleTimeout: default (10 seconds)", {
  port: 0,
  fetch() {
    return new Response("default idleTimeout");
  },
});

test("idleTimeout: custom value (30 seconds)", {
  idleTimeout: 30,
  port: 0,
  fetch() {
    return new Response("custom idleTimeout");
  },
});

test("idleTimeout: 0 (no timeout)", {
  idleTimeout: 0,
  port: 0,
  fetch() {
    return new Response("no idleTimeout");
  },
});

test("maxRequestBodySize: default (128MB)", {
  port: 0,
  fetch() {
    return new Response("default maxRequestBodySize");
  },
});

test("maxRequestBodySize: custom small value", {
  maxRequestBodySize: 1024 * 1024, // 1MB
  port: 0,
  fetch() {
    return new Response("small maxRequestBodySize");
  },
});

test("maxRequestBodySize: custom large value", {
  maxRequestBodySize: 1024 * 1024 * 1024, // 1GB
  port: 0,
  fetch() {
    return new Response("large maxRequestBodySize");
  },
});

test("development: true", {
  development: true,
  port: 0,
  fetch() {
    return new Response("development mode on");
  },
});

test("development: false", {
  development: false,
  port: 0,
  fetch() {
    return new Response("development mode off");
  },
});

test("development: defaults to process.env.NODE_ENV !== 'production'", {
  development: process.env.NODE_ENV !== "production",
  port: 0,
  fetch() {
    return new Response("development from env");
  },
});

test(
  "error callback handles errors",
  {
    port: 0,
    fetch() {
      throw new Error("Test error");
    },
    error(error) {
      return new Response(`Error handled: ${error.message}`, { status: 500 });
    },
  },
  {
    overrideExpectBehavior: async server => {
      const res = await fetch(server.url);
      expect(res.status).toBe(500);
      expect(await res.text()).toBe("Error handled: Test error");
    },
  },
);

test(
  "error callback with async handler",
  {
    port: 0,
    fetch() {
      throw new Error("Async test error");
    },
    async error(error) {
      await new Promise(resolve => setTimeout(resolve, 10));
      return new Response(`Async error handled: ${error.message}`, { status: 503 });
    },
  },
  {
    overrideExpectBehavior: async server => {
      const res = await fetch(server.url);
      expect(res.status).toBe(503);
      expect(await res.text()).toBe("Async error handled: Async test error");
    },
  },
);

test("id: custom server identifier", {
  id: "my-custom-server-id",
  port: 0,
  fetch() {
    return new Response("server with custom id");
  },
});

test("id: null (no identifier)", {
  id: null,
  port: 0,
  fetch() {
    return new Response("server with null id");
  },
});

test("multiple properties combined", {
  hostname: "127.0.0.1",
  port: 0,
  reusePort: true,
  idleTimeout: 20,
  maxRequestBodySize: 1024 * 1024 * 10, // 10MB
  development: true,
  id: "combined-test-server",
  fetch(req) {
    return Response.json({
      url: req.url,
      method: req.method,
    });
  },
  error(error) {
    return new Response(`Combined server error: ${error.message}`, { status: 500 });
  },
});

test("#24819 regression", {
  development: !process.env.production,
  routes: {
    "/health": {
      GET: new Response("OK"),
      POST: req => {
        expectType(req).is<Bun.BunRequest<"/health">>();
        return Response.json("Sup");
      },
    },
  },
});

// @ts-expect-error
test("#24819 regression with no response requires websocket", {
  development: !process.env.production,
  routes: {
    "/health": {
      GET: new Response("OK"),
      POST: req => {
        expectType(req).is<Bun.BunRequest<"/health">>();
      },
    },
  },
});

test("#24819 regression with websocket is happy", {
  websocket: {
    message: console.log,
  },
  development: !process.env.production,
  routes: {
    "/health": {
      GET: new Response("OK"),
      POST: req => {
        expectType(req).is<Bun.BunRequest<"/health">>();
      },
    },
  },
});
