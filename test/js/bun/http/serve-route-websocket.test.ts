import { describe, expect, test } from "bun:test";

/**
 * Wait for a condition to become true, polling at intervals
 * @param predicate Function that returns true when condition is met
 * @param timeout Maximum time to wait in ms (default 5000)
 * @param interval Polling interval in ms (default 10)
 */
async function waitFor(predicate: () => boolean, timeout = 5000, interval = 10): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeout) {
      throw new Error(`waitFor timeout after ${timeout}ms`);
    }
    await Bun.sleep(interval);
  }
}

describe("Bun.serve() route-specific WebSocket handlers", () => {
  test("route-specific websocket handlers work independently", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/api/v1/chat": {
          websocket: {
            open(ws) {
              ws.send("chat:welcome");
            },
            message(ws, data) {
              ws.send("chat:" + data);
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
        "/api/v2/notifications": {
          websocket: {
            open(ws) {
              ws.send("notif:connected");
            },
            message(ws, data) {
              ws.send("notif:" + data);
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Test chat WebSocket
    const chatWs = new WebSocket(`ws://localhost:${server.port}/api/v1/chat`);
    const chatMessages: string[] = [];
    chatWs.onmessage = e => chatMessages.push(e.data);
    await new Promise(resolve => (chatWs.onopen = resolve));

    expect(chatMessages[0]).toBe("chat:welcome");

    chatWs.send("hello");
    await waitFor(() => chatMessages.length > 1);
    expect(chatMessages[1]).toBe("chat:hello");

    chatWs.close();

    // Test notifications WebSocket
    const notifWs = new WebSocket(`ws://localhost:${server.port}/api/v2/notifications`);
    const notifMessages: string[] = [];
    notifWs.onmessage = e => notifMessages.push(e.data);
    await new Promise(resolve => (notifWs.onopen = resolve));

    expect(notifMessages[0]).toBe("notif:connected");

    notifWs.send("test");
    await waitFor(() => notifMessages.length > 1);
    expect(notifMessages[1]).toBe("notif:test");

    notifWs.close();
  });

  test("route-specific websocket with data in upgrade", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("data:" + JSON.stringify(ws.data));
            },
          },
          upgrade(req, server) {
            return server.upgrade(req, {
              data: { user: "alice", room: "general" },
            });
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe('data:{"user":"alice","room":"general"}');
    ws.close();
  });

  test("route-specific websocket with close handler", async () => {
    let closeCalled = false;
    let closeCode = 0;

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("ready");
            },
            close(ws, code) {
              closeCalled = true;
              closeCode = code;
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise(resolve => (ws.onopen = resolve));
    ws.close(1000);

    await waitFor(() => closeCalled);
    expect(closeCalled).toBe(true);
    expect(closeCode).toBe(1000);
  });

  test("global websocket handler still works", async () => {
    using server = Bun.serve({
      port: 0,
      websocket: {
        open(ws) {
          ws.send("global:welcome");
        },
        message(ws, data) {
          ws.send("global:" + data);
        },
      },
      routes: {
        "/api/test": {
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/api/test`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe("global:welcome");

    ws.send("test");
    await waitFor(() => messages.length > 1);
    expect(messages[1]).toBe("global:test");

    ws.close();
  });

  test("mix of route-specific and global websocket handlers", async () => {
    using server = Bun.serve({
      port: 0,
      websocket: {
        open(ws) {
          ws.send("global:open");
        },
        message(ws, data) {
          ws.send("global:" + data);
        },
      },
      routes: {
        "/specific": {
          websocket: {
            open(ws) {
              ws.send("specific:open");
            },
            message(ws, data) {
              ws.send("specific:" + data);
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
        "/global": {
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Test route-specific handler
    const specificWs = new WebSocket(`ws://localhost:${server.port}/specific`);
    const specificMessages: string[] = [];
    specificWs.onmessage = e => specificMessages.push(e.data);
    await new Promise(resolve => (specificWs.onopen = resolve));

    expect(specificMessages[0]).toBe("specific:open");
    specificWs.send("hello");
    await waitFor(() => specificMessages.length > 1);
    expect(specificMessages[1]).toBe("specific:hello");
    specificWs.close();

    // Test global handler
    const globalWs = new WebSocket(`ws://localhost:${server.port}/global`);
    const globalMessages: string[] = [];
    globalWs.onmessage = e => globalMessages.push(e.data);
    await new Promise(resolve => (globalWs.onopen = resolve));

    expect(globalMessages[0]).toBe("global:open");
    globalWs.send("world");
    await waitFor(() => globalMessages.length > 1);
    expect(globalMessages[1]).toBe("global:world");
    globalWs.close();
  });

  test("route-specific websocket with multiple HTTP methods", async () => {
    let wsMessageReceived = "";

    using server = Bun.serve({
      port: 0,
      routes: {
        "/api/resource": {
          GET() {
            return new Response("GET response");
          },
          POST() {
            return new Response("POST response");
          },
          websocket: {
            open(ws) {
              ws.send("ws:ready");
            },
            message(ws, data) {
              wsMessageReceived = data.toString();
              ws.send("ws:received");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Test HTTP GET
    const getResp = await fetch(`http://localhost:${server.port}/api/resource`);
    expect(await getResp.text()).toBe("GET response");

    // Test HTTP POST
    const postResp = await fetch(`http://localhost:${server.port}/api/resource`, { method: "POST" });
    expect(await postResp.text()).toBe("POST response");

    // Test WebSocket (which uses GET under the hood)
    const ws = new WebSocket(`ws://localhost:${server.port}/api/resource`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe("ws:ready");
    ws.send("test-message");
    await waitFor(() => messages.length > 1);
    expect(messages[1]).toBe("ws:received");
    expect(wsMessageReceived).toBe("test-message");
    ws.close();
  });

  test("route-specific websocket without upgrade handler errors appropriately", () => {
    // Should throw an error because websocket requires upgrade handler
    expect(() => {
      Bun.serve({
        port: 0,
        routes: {
          "/ws": {
            websocket: {
              open(ws) {
                ws.send("should not reach here");
              },
            },
            // Note: no upgrade handler
            GET() {
              return new Response("This is not a WebSocket endpoint");
            },
          },
        },
      });
    }).toThrow("Route has 'websocket' but missing 'upgrade' handler");
  });

  test("server.reload() preserves route-specific websocket handlers", async () => {
    const { promise, resolve } = Promise.withResolvers<void>();
    let stage = 0;

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send(`stage${stage}:open`);
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
      async fetch(req, server) {
        if (req.url.endsWith("/reload")) {
          stage = 1;
          server.reload({
            routes: {
              "/ws": {
                websocket: {
                  open(ws) {
                    ws.send("reloaded:open");
                  },
                },
                upgrade(req, server) {
                  return server.upgrade(req);
                },
              },
            },
          });
          resolve();
          return new Response("reloaded");
        }
        return new Response("not found", { status: 404 });
      },
    });

    // Connect before reload
    const ws1 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages1: string[] = [];
    ws1.onmessage = e => messages1.push(e.data);
    await new Promise(resolve => (ws1.onopen = resolve));
    expect(messages1[0]).toBe("stage0:open");
    ws1.close();

    // Trigger reload
    await fetch(`http://localhost:${server.port}/reload`);
    await promise;

    // Connect after reload
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages2: string[] = [];
    ws2.onmessage = e => messages2.push(e.data);
    await new Promise(resolve => (ws2.onopen = resolve));
    expect(messages2[0]).toBe("reloaded:open");
    ws2.close();
  });

  test("server.reload() removes websocket handler", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("initial");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Connect with websocket handler
    const ws1 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages1: string[] = [];
    ws1.onmessage = e => messages1.push(e.data);
    await new Promise(resolve => (ws1.onopen = resolve));
    expect(messages1[0]).toBe("initial");
    ws1.close();

    // Reload without websocket handler
    server.reload({
      routes: {
        "/ws": {
          GET() {
            return new Response("no websocket");
          },
        },
      },
    });

    // Regular GET should work
    const resp = await fetch(`http://localhost:${server.port}/ws`);
    expect(await resp.text()).toBe("no websocket");

    // WebSocket should fail
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);
    let errorOccurred = false;
    ws2.onerror = () => {
      errorOccurred = true;
    };
    await waitFor(() => errorOccurred);
    expect(errorOccurred).toBe(true);
  });

  test("server.reload() adds websocket handler to existing route", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          GET() {
            return new Response("no websocket yet");
          },
        },
      },
    });

    // Regular GET should work
    const resp1 = await fetch(`http://localhost:${server.port}/ws`);
    expect(await resp1.text()).toBe("no websocket yet");

    // Reload with websocket handler
    server.reload({
      routes: {
        "/ws": {
          GET() {
            return new Response("now has websocket");
          },
          websocket: {
            open(ws) {
              ws.send("added");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Regular GET should still work
    const resp2 = await fetch(`http://localhost:${server.port}/ws`);
    expect(await resp2.text()).toBe("now has websocket");

    // WebSocket should now work
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));
    expect(messages[0]).toBe("added");
    ws.close();
  });

  test("server.reload() with active websocket connections", async () => {
    let messageReceived = "";

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("v1");
            },
            message(ws, data) {
              messageReceived = data.toString();
              ws.send("v1:echo");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Create active connection
    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));
    expect(messages[0]).toBe("v1");

    // Reload while connection is active
    server.reload({
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("v2");
            },
            message(ws, data) {
              ws.send("v2:echo");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Existing connection should still use old handlers
    ws.send("test");
    await waitFor(() => messages.length > 1);
    expect(messages[1]).toBe("v1:echo");
    expect(messageReceived).toBe("test");
    ws.close();

    // New connection should use new handlers
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages2: string[] = [];
    ws2.onmessage = e => messages2.push(e.data);
    await new Promise(resolve => (ws2.onopen = resolve));
    expect(messages2[0]).toBe("v2");
    ws2.send("test2");
    await waitFor(() => messages2.length > 1);
    expect(messages2[1]).toBe("v2:echo");
    ws2.close();
  });

  test("multiple concurrent websocket connections to same route", async () => {
    const openCount = { count: 0 };
    const messageCount = { count: 0 };

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              openCount.count++;
              ws.send(`connection-${openCount.count}`);
            },
            message(ws, data) {
              messageCount.count++;
              ws.send(`echo-${data}`);
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Create 5 concurrent connections
    const connections = await Promise.all(
      Array.from({ length: 5 }, async (_, i) => {
        const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
        const messages: string[] = [];
        ws.onmessage = e => messages.push(e.data);
        await new Promise(resolve => (ws.onopen = resolve));
        return { ws, messages, id: i };
      }),
    );

    expect(openCount.count).toBe(5);

    // Each should have unique connection message
    for (let i = 0; i < 5; i++) {
      expect(connections[i].messages[0]).toMatch(/^connection-\d+$/);
    }

    // Send messages from all connections
    for (const conn of connections) {
      conn.ws.send(`msg-${conn.id}`);
    }

    await waitFor(() => messageCount.count === 5);

    expect(messageCount.count).toBe(5);

    // Each should get their echo back
    for (const conn of connections) {
      expect(conn.messages[1]).toBe(`echo-msg-${conn.id}`);
      conn.ws.close();
    }
  });

  test("multiple concurrent websocket connections to different routes", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/chat": {
          websocket: {
            open(ws) {
              ws.send("chat");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
        "/notifications": {
          websocket: {
            open(ws) {
              ws.send("notif");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
        "/updates": {
          websocket: {
            open(ws) {
              ws.send("updates");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Connect to all routes simultaneously
    const [chat, notif, updates] = await Promise.all([
      (async () => {
        const ws = new WebSocket(`ws://localhost:${server.port}/chat`);
        const messages: string[] = [];
        ws.onmessage = e => messages.push(e.data);
        await new Promise(resolve => (ws.onopen = resolve));
        return { ws, messages };
      })(),
      (async () => {
        const ws = new WebSocket(`ws://localhost:${server.port}/notifications`);
        const messages: string[] = [];
        ws.onmessage = e => messages.push(e.data);
        await new Promise(resolve => (ws.onopen = resolve));
        return { ws, messages };
      })(),
      (async () => {
        const ws = new WebSocket(`ws://localhost:${server.port}/updates`);
        const messages: string[] = [];
        ws.onmessage = e => messages.push(e.data);
        await new Promise(resolve => (ws.onopen = resolve));
        return { ws, messages };
      })(),
    ]);

    expect(chat.messages[0]).toBe("chat");
    expect(notif.messages[0]).toBe("notif");
    expect(updates.messages[0]).toBe("updates");

    chat.ws.close();
    notif.ws.close();
    updates.ws.close();
  });

  test("websocket with only open handler (no message/close)", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("opened");
            },
            // No message or close handlers
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe("opened");

    // Should be able to send messages even without handler
    ws.send("test");

    // Should be able to close
    ws.close();
  });

  test("websocket error handler is called on server-side exceptions", async () => {
    let errorCalled = false;

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            message(ws, message) {
              // Trigger an error when receiving "trigger-error"
              if (message === "trigger-error") {
                throw new Error("Intentional test error");
              }
            },
            error(ws, error) {
              errorCalled = true;
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise(resolve => (ws.onopen = resolve));

    // Send message that triggers server-side error
    ws.send("trigger-error");

    // Wait for error handler to be called
    await Bun.sleep(100);

    expect(errorCalled).toBe(true);

    ws.close();
  });

  test("server.stop() with active websocket connections", async () => {
    const server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("connected");
            },
            close(ws) {
              // Close handler is called when connection closes
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
    await new Promise(resolve => (ws.onopen = resolve));

    // Manually close the connection and wait for it
    const closePromise = new Promise(resolve => (ws.onclose = resolve));
    ws.close();
    await closePromise;

    // Now stop server
    server.stop();

    // Server should stop successfully even after WebSocket was used
    expect(server.port).toBe(0);
  });

  test("multiple routes with same path but different methods and websocket", async () => {
    using server = Bun.serve({
      port: 0,
      routes: {
        "/api": {
          GET() {
            return new Response("get");
          },
          POST() {
            return new Response("post");
          },
          PUT() {
            return new Response("put");
          },
          websocket: {
            open(ws) {
              ws.send("ws");
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Test all HTTP methods work
    const getResp = await fetch(`http://localhost:${server.port}/api`);
    expect(await getResp.text()).toBe("get");

    const postResp = await fetch(`http://localhost:${server.port}/api`, { method: "POST" });
    expect(await postResp.text()).toBe("post");

    const putResp = await fetch(`http://localhost:${server.port}/api`, { method: "PUT" });
    expect(await putResp.text()).toBe("put");

    // Test WebSocket works
    const ws = new WebSocket(`ws://localhost:${server.port}/api`);
    const messages: string[] = [];
    ws.onmessage = e => messages.push(e.data);
    await new Promise(resolve => (ws.onopen = resolve));
    expect(messages[0]).toBe("ws");
    ws.close();
  });
});
