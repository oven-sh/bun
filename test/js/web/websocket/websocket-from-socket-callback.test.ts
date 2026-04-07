/**
 * Regression test for a segfault in _mi_heap_realloc_zero during
 * WebSocketUpgradeClient.buildRequestBody when `new WebSocket()` is created
 * from inside a Bun.connect (uSockets) data callback with an HTTP proxy.
 *
 * Stack trace shape:
 *   us_loop_run_bun_tick → us_internal_dispatch_ready_poll → NewSocketHandler
 *   → Bun.connect data handler → JS → new WebSocket() → WebSocket::connect
 *   → Bun__WebSocketHTTPClient__connect → buildRequestBody → allocPrint
 *   → Allocating.drain → mi_heap_realloc_aligned → segfault @ 0x0
 */
import { afterAll, beforeAll, expect, test } from "bun:test";
import type net from "net";
import { createConnectProxy, startProxy } from "./proxy-test-utils";

let wsServer: ReturnType<typeof Bun.serve>;
let tcpServer: ReturnType<typeof Bun.listen>;
let proxy: net.Server;
let wsPort: number;
let tcpPort: number;
let proxyPort: number;

beforeAll(async () => {
  wsServer = Bun.serve({
    port: 0,
    fetch(req, server) {
      if (server.upgrade(req)) return;
      return new Response("Expected WebSocket", { status: 400 });
    },
    websocket: {
      open(ws) {
        ws.send("connected");
      },
      message(ws, message) {
        ws.send(message);
      },
    },
  });
  wsPort = wsServer.port;

  tcpServer = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      data(socket, data) {
        socket.write(data);
      },
    },
  });
  tcpPort = tcpServer.port;

  proxy = createConnectProxy();
  proxyPort = await startProxy(proxy);
});

afterAll(() => {
  wsServer?.stop(true);
  tcpServer?.stop(true);
  proxy?.close();
});

function openWebSocketViaProxy(): Promise<void> {
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`, {
    // @ts-expect-error Bun-specific option
    proxy: `http://127.0.0.1:${proxyPort}`,
  });
  ws.onmessage = ev => {
    if (ev.data === "connected") {
      ws.close();
      resolve();
    }
  };
  ws.onerror = ev => reject(new Error(`WebSocket error: ${(ev as ErrorEvent).message ?? ev.type}`));
  ws.onclose = ev => {
    if (ev.code !== 1000 && ev.code !== 1005) {
      reject(new Error(`WebSocket closed unexpectedly: code=${ev.code} reason=${ev.reason}`));
    }
  };
  return promise;
}

test("creating a proxied WebSocket inside a Bun.connect data callback does not crash", async () => {
  const ITERATIONS = 16;
  const results: Promise<void>[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const wsCreated = Promise.withResolvers<Promise<void>>();
    results.push(wsCreated.promise.then(p => p));

    const sock = await Bun.connect({
      hostname: "127.0.0.1",
      port: tcpPort,
      socket: {
        open(socket) {
          socket.write("ping");
        },
        data(socket) {
          try {
            wsCreated.resolve(openWebSocketViaProxy());
          } catch (e) {
            wsCreated.reject(e);
          }
          socket.end();
        },
        error(_socket, error) {
          wsCreated.reject(error);
        },
      },
    });
    void sock;
  }

  const settled = await Promise.allSettled(results);
  const failures = settled.filter(r => r.status === "rejected");
  expect(failures).toEqual([]);
  expect(settled.length).toBe(ITERATIONS);
});

test("creating many proxied WebSockets concurrently inside socket callbacks does not crash", async () => {
  const SOCKETS = 8;
  const WS_PER_CALLBACK = 4;
  const allWs: Promise<void>[] = [];
  const sockReady: Promise<void>[] = [];

  for (let i = 0; i < SOCKETS; i++) {
    const done = Promise.withResolvers<void>();
    sockReady.push(done.promise);

    Bun.connect({
      hostname: "127.0.0.1",
      port: tcpPort,
      socket: {
        open(socket) {
          socket.write("ping");
        },
        data(socket) {
          for (let j = 0; j < WS_PER_CALLBACK; j++) {
            allWs.push(openWebSocketViaProxy());
          }
          socket.end();
          done.resolve();
        },
        error(_socket, error) {
          done.reject(error);
        },
      },
    }).catch(done.reject);
  }

  await Promise.all(sockReady);
  const settled = await Promise.allSettled(allWs);
  const failures = settled.filter(r => r.status === "rejected");
  expect(failures).toEqual([]);
  expect(settled.length).toBe(SOCKETS * WS_PER_CALLBACK);
});
