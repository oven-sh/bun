import { describe, expect, test } from "bun:test";

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
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(chatMessages[1]).toBe("chat:hello");

    chatWs.close();

    // Test notifications WebSocket
    const notifWs = new WebSocket(`ws://localhost:${server.port}/api/v2/notifications`);
    const notifMessages: string[] = [];
    notifWs.onmessage = e => notifMessages.push(e.data);
    await new Promise(resolve => (notifWs.onopen = resolve));

    expect(notifMessages[0]).toBe("notif:connected");

    notifWs.send("test");
    await new Promise(resolve => setTimeout(resolve, 100));
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
    await new Promise(resolve => setTimeout(resolve, 100));
    ws.close(1000);

    await new Promise(resolve => setTimeout(resolve, 200));
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
    await new Promise(resolve => setTimeout(resolve, 100));
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
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(specificMessages[1]).toBe("specific:hello");
    specificWs.close();

    // Test global handler
    const globalWs = new WebSocket(`ws://localhost:${server.port}/global`);
    const globalMessages: string[] = [];
    globalWs.onmessage = e => globalMessages.push(e.data);
    await new Promise(resolve => (globalWs.onopen = resolve));

    expect(globalMessages[0]).toBe("global:open");
    globalWs.send("world");
    await new Promise(resolve => setTimeout(resolve, 100));
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
    await new Promise(resolve => setTimeout(resolve, 100));
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
    await new Promise(resolve => setTimeout(resolve, 100));

    // Connect after reload
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages2: string[] = [];
    ws2.onmessage = e => messages2.push(e.data);
    await new Promise(resolve => (ws2.onopen = resolve));
    expect(messages2[0]).toBe("reloaded:open");
    ws2.close();
  });
});
