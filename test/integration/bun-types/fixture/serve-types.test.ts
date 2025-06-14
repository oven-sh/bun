// This file is checked in the `bun-types.test.ts` integration test for successful typechecking, but also checked
// on its own to make sure that the types line up with actual implementation of Bun.serve()

import { expect, test as it } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import { join } from "node:path";
import { expectType } from "./utilities";

// XXX: importing this from "harness" caused a failure in bun-types.test.ts
function tmpdirSync(pattern: string = "bun.test."): string {
  return fs.mkdtempSync(join(fs.realpathSync.native(os.tmpdir()), pattern));
}

function expectInstanceOf<T>(value: unknown, constructor: new (...args: any[]) => T): asserts value is T {
  expect(value).toBeInstanceOf(constructor);
}

let id = 0;
function test<T, R extends { [K in keyof R]: Bun.RouterTypes.RouteValue<K & string> }>(
  serveConfig: Bun.ServeFunctionOptions<T, R>,
  {
    onConstructorFailure,
    overrideExpectBehavior,
  }: {
    onConstructorFailure?: (error: Error) => void | Promise<void>;
    overrideExpectBehavior?: (server: Bun.Server) => void | Promise<void>;
  } = {},
) {
  if ("unix" in serveConfig && typeof serveConfig.unix === "string" && process.platform === "win32") {
    // Skip unix socket tests on Windows
    return;
  }

  async function testServer(server: Bun.Server) {
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

  it(`Bun.serve() types test ${++id}`, async () => {
    try {
      using server = Bun.serve(serveConfig);
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

test({
  fetch(req) {
    console.log(req.url); // => http://localhost:3000/
    return new Response("Hello World");
  },
});

test(
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

test({
  websocket: {
    message(ws, message) {
      expectType<typeof ws>().is<Bun.ServerWebSocket<unknown>>();
      ws.send(message);
    },
  },

  fetch(req, server) {
    // Upgrade to a ServerWebSocket if we can
    // This automatically checks for the `Sec-WebSocket-Key` header
    // meaning you don't have to check headers, you can just call `upgrade()`
    if (server.upgrade(req)) {
      // When upgrading, we return undefined since we don't want to send a Response
      return;
    }

    return new Response("Regular HTTP response");
  },
});

test({
  fetch(req, server) {
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
    open(ws: Bun.ServerWebSocket<{ name: string }>) {
      console.log("WebSocket opened");
      ws.subscribe("the-group-chat");
    },

    message(ws, message) {
      ws.publish("the-group-chat", `${ws.data.name}: ${message.toString()}`);
    },

    close(ws, code, reason) {
      ws.publish("the-group-chat", `${ws.data.name} left the chat`);
    },

    drain(ws) {
      console.log("Please send me data. I am ready to receive it.");
    },

    perMessageDeflate: true,
  },
});

test(
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

test({
  port: 0,
  fetch(req, server) {
    server.upgrade(req);
    if (Math.random() > 0.5) return undefined;
    return new Response();
  },
  websocket: {
    message(ws) {
      expectType(ws).is<Bun.ServerWebSocket<unknown>>();
    },
  },
});

test(
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
  // @ts-expect-error - TODO Fix this
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
  // @ts-expect-error - TODO Fix this
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
  {
    unix: `${tmpdirSync()}/bun.sock`,
    fetch(req, server) {
      server.upgrade(req);
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
  // @ts-expect-error - TODO Fix this
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

test({
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

test({
  routes: {
    "/:test": req => {
      return new Response(req.params.test);
    },
  },

  fetch: (req, server) => {
    return new Response("cool");
  },
});

test({
  fetch: (req, server) => {
    return new Response("cool");
  },
});

test({
  routes: {
    "/:test": req => {
      return new Response(req.params.test);
    },
  },
});

test({
  fetch: () => new Response("ok"),
  websocket: {
    message: ws => {
      //
    },
  },
});

test({
  websocket: {
    message: () => {
      //
    },
  },
  fetch: (req, server) => {
    if (server.upgrade(req)) {
      return;
    }

    return new Response("not upgraded");
  },
});

test({
  websocket: {
    message: () => {
      //
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

test({
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
  {
    unix: `${tmpdirSync()}/bun.sock`,
    // @ts-expect-error
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
  {
    unix: `${tmpdirSync()}/bun.sock`,
    // @ts-expect-error
    port: 0,
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
