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

    const { promise: chatResponse, resolve: resolveChatResponse } = Promise.withResolvers<void>();
    let chatResponseCount = 0;
    chatWs.onmessage = e => {
      chatMessages.push(e.data);
      chatResponseCount++;
      if (chatResponseCount === 2) resolveChatResponse();
    };

    await new Promise(resolve => (chatWs.onopen = resolve));
    expect(chatMessages[0]).toBe("chat:welcome");

    chatWs.send("hello");
    await chatResponse;
    expect(chatMessages[1]).toBe("chat:hello");

    chatWs.close();

    // Test notifications WebSocket
    const notifWs = new WebSocket(`ws://localhost:${server.port}/api/v2/notifications`);
    const notifMessages: string[] = [];

    const { promise: notifResponse, resolve: resolveNotifResponse } = Promise.withResolvers<void>();
    let notifResponseCount = 0;
    notifWs.onmessage = e => {
      notifMessages.push(e.data);
      notifResponseCount++;
      if (notifResponseCount === 2) resolveNotifResponse();
    };

    await new Promise(resolve => (notifWs.onopen = resolve));
    expect(notifMessages[0]).toBe("notif:connected");

    notifWs.send("test");
    await notifResponse;
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
    let closeCode = 0;

    const { promise: closeHandlerCalled, resolve: resolveCloseHandler } = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      routes: {
        "/ws": {
          websocket: {
            open(ws) {
              ws.send("ready");
            },
            close(ws, code) {
              closeCode = code;
              resolveCloseHandler();
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

    await closeHandlerCalled;
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

    const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers<void>();
    ws.onmessage = e => {
      messages.push(e.data);
      if (messages.length > 1) resolveMessageReceived();
    };

    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe("global:welcome");

    ws.send("test");
    await messageReceived;
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

    const { promise: specificMessageReceived, resolve: resolveSpecificMessage } = Promise.withResolvers<void>();
    specificWs.onmessage = e => {
      specificMessages.push(e.data);
      if (specificMessages.length > 1) resolveSpecificMessage();
    };

    await new Promise(resolve => (specificWs.onopen = resolve));

    expect(specificMessages[0]).toBe("specific:open");
    specificWs.send("hello");
    await specificMessageReceived;
    expect(specificMessages[1]).toBe("specific:hello");
    specificWs.close();

    // Test global handler
    const globalWs = new WebSocket(`ws://localhost:${server.port}/global`);
    const globalMessages: string[] = [];

    const { promise: globalMessageReceived, resolve: resolveGlobalMessage } = Promise.withResolvers<void>();
    globalWs.onmessage = e => {
      globalMessages.push(e.data);
      if (globalMessages.length > 1) resolveGlobalMessage();
    };

    await new Promise(resolve => (globalWs.onopen = resolve));

    expect(globalMessages[0]).toBe("global:open");
    globalWs.send("world");
    await globalMessageReceived;
    expect(globalMessages[1]).toBe("global:world");
    globalWs.close();
  });

  test("route-specific websocket with multiple HTTP methods", async () => {
    let wsMessageReceived = "";

    const { promise: messageProcessed, resolve: resolveMessageProcessed } = Promise.withResolvers<void>();

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
              resolveMessageProcessed();
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

    const { promise: messageReceived, resolve: resolveMessageReceived } = Promise.withResolvers<void>();
    ws.onmessage = e => {
      messages.push(e.data);
      if (messages.length > 1) resolveMessageReceived();
    };

    await new Promise(resolve => (ws.onopen = resolve));

    expect(messages[0]).toBe("ws:ready");
    ws.send("test-message");
    await Promise.all([messageReceived, messageProcessed]);
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
    const { promise: errorOccurred, resolve: resolveError } = Promise.withResolvers<void>();
    ws2.onerror = () => {
      resolveError();
    };
    await errorOccurred;
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

    const { promise: messageProcessed, resolve: resolveMessageProcessed } = Promise.withResolvers<void>();

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
              resolveMessageProcessed();
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

    const { promise: messageReceived1, resolve: resolveMessageReceived1 } = Promise.withResolvers<void>();
    ws.onmessage = e => {
      messages.push(e.data);
      if (messages.length > 1) resolveMessageReceived1();
    };

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
    await Promise.all([messageReceived1, messageProcessed]);
    expect(messages[1]).toBe("v1:echo");
    expect(messageReceived).toBe("test");
    ws.close();

    // New connection should use new handlers
    const ws2 = new WebSocket(`ws://localhost:${server.port}/ws`);
    const messages2: string[] = [];

    const { promise: messageReceived2, resolve: resolveMessageReceived2 } = Promise.withResolvers<void>();
    ws2.onmessage = e => {
      messages2.push(e.data);
      if (messages2.length > 1) resolveMessageReceived2();
    };

    await new Promise(resolve => (ws2.onopen = resolve));
    expect(messages2[0]).toBe("v2");
    ws2.send("test2");
    await messageReceived2;
    expect(messages2[1]).toBe("v2:echo");
    ws2.close();
  });

  test("multiple concurrent websocket connections to same route", async () => {
    const openCount = { count: 0 };
    const messageCount = { count: 0 };

    const { promise: allMessagesReceived, resolve: resolveAllMessagesReceived } = Promise.withResolvers<void>();

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
              if (messageCount.count === 5) resolveAllMessagesReceived();
            },
          },
          upgrade(req, server) {
            return server.upgrade(req);
          },
        },
      },
    });

    // Create 5 concurrent connections with promise resolvers for each
    const connectionPromises = Array.from({ length: 5 }, (_, i) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      return { promise, resolve, id: i };
    });

    const connections = await Promise.all(
      connectionPromises.map(async ({ promise, resolve, id }) => {
        const ws = new WebSocket(`ws://localhost:${server.port}/ws`);
        const messages: string[] = [];
        ws.onmessage = e => {
          messages.push(e.data);
          if (messages.length >= 2) resolve();
        };
        await new Promise(resolveOpen => (ws.onopen = resolveOpen));
        return { ws, messages, id, promise };
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

    // Wait for server to receive all messages
    await allMessagesReceived;
    expect(messageCount.count).toBe(5);

    // Wait for all echo responses to arrive back at clients
    await Promise.all(connections.map(conn => conn.promise));

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
    const { promise: errorHandlerCalled, resolve: resolveErrorHandler } = Promise.withResolvers<void>();

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
              resolveErrorHandler();
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
    await errorHandlerCalled;

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

    // Now stop server and await completion
    await server.stop();

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
