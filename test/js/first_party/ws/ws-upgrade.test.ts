import { describe, expect, it } from "bun:test";
import { once } from "events";
import type { ClientRequest } from "http";
import { createServer, IncomingMessage } from "node:http";
import { createServer as createTcpServer } from "node:net";
import type { AddressInfo } from "node:net";
import { WebSocket, WebSocketServer } from "ws";

// https://github.com/oven-sh/bun/issues/5951
// https://github.com/oven-sh/bun/issues/31406
//
// The `ws` client used to hardcode the `upgrade` and `unexpected-response`
// events as "not implemented" and print a warning instead of firing them.
// Node's `ws` emits `upgrade` with the handshake response (an
// http.IncomingMessage) right before `open`, and `unexpected-response` with
// (req, res) when the server returns a non-101 status. These tests use
// in-process servers (no subprocess spawning) so they run fast under the ASAN
// debug build.
describe("ws client upgrade event", () => {
  it("fires before open with the 101 handshake response", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", ws => ws.close());

    const order: string[] = [];
    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();

    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    try {
      ws.on("upgrade", res => {
        order.push("upgrade");
        resolve(res);
      });
      ws.on("open", () => {
        order.push("open");
        ws.close();
      });
      ws.on("error", reject);

      const res = await promise;

      // `upgrade` must fire, and it must fire before `open` (as in node's ws).
      expect(order[0]).toBe("upgrade");
      // The argument is the handshake response (an http.IncomingMessage).
      expect(res).toBeInstanceOf(IncomingMessage);
      expect(res.statusCode).toBe(101);
      expect(res.statusMessage).toBe("Switching Protocols");
      expect(res.httpVersion).toBe("1.1");
      expect(res.headers.upgrade?.toLowerCase()).toBe("websocket");
      expect(res.headers.connection?.toLowerCase()).toBe("upgrade");
      expect(typeof res.headers["sec-websocket-accept"]).toBe("string");
      expect(Array.isArray(res.rawHeaders)).toBe(true);

      await once(ws, "close");
    } finally {
      ws.close();
      wss.close();
    }
  });

  it("exposes custom handshake response headers", async () => {
    using server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (
          server.upgrade(req, {
            headers: { "X-Custom-Header": "custom-value", "Set-Cookie": "a=1" },
          })
        ) {
          return;
        }
        return new Response("no upgrade");
      },
      websocket: { open() {}, message() {} },
    });

    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
    const ws = new WebSocket(server.url.href);
    try {
      ws.on("upgrade", resolve);
      ws.on("error", reject);
      // Close only after the connection is established to avoid racing the
      // in-flight handshake (upgrade fires while still CONNECTING).
      ws.on("open", () => ws.close());

      const res = await promise;
      expect(res.statusCode).toBe(101);
      expect(res.headers["x-custom-header"]).toBe("custom-value");
      // node's IncomingMessage represents set-cookie as an array.
      expect(res.headers["set-cookie"]).toEqual(["a=1"]);

      await once(ws, "close");
    } finally {
      ws.close();
    }
  });

  it("supports once() for upgrade", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", () => {});

    const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    try {
      ws.once("upgrade", resolve);
      ws.on("open", () => ws.close());
      ws.on("error", reject);
      const res = await promise;
      expect(res.statusCode).toBe(101);
      await once(ws, "close");
    } finally {
      ws.close();
      wss.close();
    }
  });

  // ws / EventEmitter consumers also subscribe via addListener /
  // prependListener / prependOnceListener; each must wire the native handshake
  // listener so `upgrade` actually fires.
  for (const method of ["addListener", "prependListener", "prependOnceListener"] as const) {
    it(`fires upgrade when subscribed via ${method}`, async () => {
      const wss = new WebSocketServer({ port: 0 });
      wss.on("connection", () => {});

      const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
      const ws = new WebSocket("ws://localhost:" + wss.address().port);
      try {
        ws[method]("upgrade", resolve);
        ws.on("open", () => ws.close());
        ws.on("error", reject);
        const res = await promise;
        expect(res.statusCode).toBe(101);
        await once(ws, "close");
      } finally {
        ws.close();
        wss.close();
      }
    });
  }

  // Node + ws emit `upgrade` and `open` from the same socket-data turn with no
  // microtask checkpoint between them, so a microtask/nextTick queued inside the
  // `upgrade` handler runs after the socket is OPEN.
  it("does not drain microtasks between upgrade and open", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", () => {});

    const { promise, resolve, reject } = Promise.withResolvers<{ microtask: number; nextTick: number }>();
    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    try {
      const states: { microtask?: number; nextTick?: number } = {};
      ws.on("upgrade", () => {
        // These are scheduled while still CONNECTING but must observe OPEN,
        // because `open` fires before the microtask/nextTick checkpoint.
        queueMicrotask(() => {
          states.microtask = ws.readyState;
        });
        process.nextTick(() => {
          states.nextTick = ws.readyState;
        });
      });
      ws.on("open", async () => {
        // After a macrotask turn both the microtask and the nextTick have run.
        await Bun.sleep(0);
        resolve(states as { microtask: number; nextTick: number });
      });
      ws.on("error", reject);

      const seen = await promise;
      expect(seen.microtask).toBe(WebSocket.OPEN);
      expect(seen.nextTick).toBe(WebSocket.OPEN);

      ws.close();
      await once(ws, "close");
    } finally {
      ws.close();
      wss.close();
    }
  });

  // Consequence of the ordering above: a `process.nextTick(() => ws.send(...))`
  // scheduled from the `upgrade` handler runs after `open`, so the socket is
  // OPEN and the send is delivered (rather than hitting InvalidStateError while
  // still CONNECTING).
  it("delivers a send scheduled from the upgrade handler", async () => {
    const wss = new WebSocketServer({ port: 0 });
    const { promise, resolve, reject } = Promise.withResolvers<string>();
    wss.on("connection", server => {
      server.on("message", data => resolve(data.toString()));
    });

    const ws = new WebSocket("ws://localhost:" + wss.address().port);
    try {
      ws.on("upgrade", () => {
        process.nextTick(() => ws.send("from-upgrade"));
      });
      ws.on("error", reject);

      const received = await promise;
      expect(received).toBe("from-upgrade");

      ws.close();
      await once(ws, "close");
    } finally {
      ws.close();
      wss.close();
    }
  });
});

describe("ws client unexpected-response event", () => {
  function makeHttpServer(statusCode: number, body: string, extraHeaders: Record<string, string> = {}) {
    const server = createServer((req, res) => {
      res.writeHead(statusCode, { "Content-Type": "text/plain", ...extraHeaders });
      res.end(body);
    });
    return new Promise<{ port: number; close: () => void }>(resolve => {
      server.listen(0, () => {
        resolve({
          port: (server.address() as AddressInfo).port,
          close: () => server.close(),
        });
      });
    });
  }

  it("fires with (req, res) on a non-101 response and suppresses 'error'", async () => {
    const { port, close } = await makeHttpServer(401, "unauthorized", { "X-Reason": "bad-token" });
    try {
      const { promise, resolve, reject } = Promise.withResolvers<{
        req: ClientRequest;
        res: IncomingMessage;
        errorFired: boolean;
      }>();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      let errorFired = false;
      ws.on("error", () => {
        errorFired = true;
      });
      ws.on("unexpected-response", (req, res) => {
        // npm ws emits (req, res); defer resolve so any 'error' queued
        // alongside has a chance to fire first.
        process.nextTick(() => resolve({ req, res, errorFired }));
      });
      ws.on("open", () => reject(new Error("should not open")));

      const { req, res, errorFired: sawError } = await promise;
      // npm ws hands the listener a real http.IncomingMessage.
      expect(res).toBeInstanceOf(IncomingMessage);
      expect(res.statusCode).toBe(401);
      expect(res.statusMessage).toBe("Unauthorized");
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["x-reason"]).toBe("bad-token");
      expect(Array.isArray(res.rawHeaders)).toBe(true);
      expect(typeof req.abort).toBe("function");
      expect(req.aborted).toBe(false);
      req.abort();
      expect(req.aborted).toBe(true);
      // npm ws skips the 'error' emission when an 'unexpected-response'
      // listener handled the non-101.
      expect(sawError).toBe(false);

      ws.terminate();
    } finally {
      close();
    }
  });

  it("exposes the body bytes that arrived with the headers", async () => {
    const { port, close } = await makeHttpServer(503, "backend unavailable");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<string>();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        let body = "";
        res.on("data", chunk => (body += chunk));
        res.on("end", () => resolve(body));
      });

      const body = await promise;
      expect(body).toBe("backend unavailable");
      ws.terminate();
    } finally {
      close();
    }
  });

  it("falls back to 'error' when no 'unexpected-response' listener is registered", async () => {
    const { port, close } = await makeHttpServer(500, "oops");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<Error>();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      // Subscribe to 'upgrade' (arms the handshake listener) but NOT
      // 'unexpected-response'; the non-101 must still surface as 'error'.
      ws.on("upgrade", () => reject(new Error("should not upgrade")));
      ws.on("error", err => resolve(err as Error));

      const err = await promise;
      expect(err).toBeTruthy();
      ws.terminate();
    } finally {
      close();
    }
  });

  it("supports once() for unexpected-response", async () => {
    const { port, close } = await makeHttpServer(404, "not found");
    try {
      const { promise, resolve } = Promise.withResolvers<IncomingMessage>();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", () => {});
      ws.once("unexpected-response", (_req, res) => resolve(res));
      const res = await promise;
      expect(res.statusCode).toBe(404);
      ws.terminate();
    } finally {
      close();
    }
  });

  it("does not fire for a successful 101 upgrade", async () => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("connection", ws => ws.close());
    const ws = new WebSocket("ws://127.0.0.1:" + wss.address().port);
    try {
      let unexpected = false;
      ws.on("unexpected-response", () => {
        unexpected = true;
      });
      await once(ws, "open");
      expect(unexpected).toBe(false);
      ws.close();
      await once(ws, "close");
    } finally {
      ws.close();
      wss.close();
    }
  });

  // Node's IncomingMessage folds duplicate headers per-field: first-wins for
  // singleton fields like content-type/server, array for set-cookie. The
  // handshake response must use the same rules (it's the real IncomingMessage
  // + _addHeaderLines), not a hand-rolled comma-join.
  it("folds duplicate response headers with Node's per-field rules", async () => {
    const server = createTcpServer(socket => {
      socket.once("data", () => {
        socket.write(
          "HTTP/1.1 403 Forbidden\r\n" +
            "Content-Type: text/plain\r\n" +
            "Content-Type: text/html\r\n" +
            "Server: one\r\n" +
            "Server: two\r\n" +
            "Set-Cookie: a=1\r\n" +
            "Set-Cookie: b=2\r\n" +
            "X-Multi: a\r\n" +
            "X-Multi: b\r\n" +
            "Content-Length: 2\r\n" +
            "\r\n" +
            "no",
        );
        socket.end();
      });
    });
    await once(server.listen(0), "listening");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<IncomingMessage>();
      const ws = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => resolve(res));
      const res = await promise;
      expect(res).toBeInstanceOf(IncomingMessage);
      expect(res.statusCode).toBe(403);
      expect(res.headers["content-type"]).toBe("text/plain");
      expect(res.headers["server"]).toBe("one");
      expect(res.headers["set-cookie"]).toEqual(["a=1", "b=2"]);
      expect(res.headers["x-multi"]).toBe("a, b");
      ws.terminate();
    } finally {
      server.close();
    }
  });

  // Reentrancy: the 'unexpected-response' handler may synchronously terminate
  // the socket. The native client must not crash or double-free when its own
  // teardown runs after the listener's terminate() reentered cancel().
  it("tolerates synchronous terminate() from the listener", async () => {
    const { port, close } = await makeHttpServer(418, "teapot");
    try {
      const { promise, resolve, reject } = Promise.withResolvers<number>();
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", reject);
      ws.on("unexpected-response", (_req, res) => {
        ws.terminate();
        resolve(res.statusCode);
      });
      expect(await promise).toBe(418);
    } finally {
      close();
    }
  });
});

// The native forwarder is armed once per event type; EventEmitter fans each
// emit out to every on/once listener. A once-style registration followed by a
// persistent on() must not install a second forwarder (that would emit twice).
describe("ws client event listener bridging", () => {
  for (const register of ["once", "prependOnceListener"] as const) {
    it(`${register}() + on() for the same event each fire exactly once`, async () => {
      const wss = new WebSocketServer({ port: 0 });
      wss.on("connection", () => {});

      const ws = new WebSocket("ws://localhost:" + wss.address().port);
      try {
        const { promise, resolve, reject } = Promise.withResolvers<void>();
        let onceCount = 0;
        let onCount = 0;
        ws[register]("open", () => {
          onceCount++;
        });
        ws.on("open", () => {
          onCount++;
          resolve();
        });
        ws.on("error", reject);

        await promise;
        // A duplicate native forwarder re-emits within the same dispatch, so
        // onCount is already final here; a macrotask turn makes that certain.
        await Bun.sleep(0);
        expect(onceCount).toBe(1);
        expect(onCount).toBe(1);

        ws.close();
        await once(ws, "close");
      } finally {
        ws.close();
        wss.close();
      }
    });
  }
});
