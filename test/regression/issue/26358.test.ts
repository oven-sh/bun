import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { WebSocket } from "ws";

describe("ws.once() multiple calls", () => {
  let server: Bun.Server;
  let port: number;

  beforeAll(() => {
    server = Bun.serve({
      port: 0,
      fetch(req, server) {
        if (server.upgrade(req)) {
          return;
        }
        return new Response("Not Found", { status: 404 });
      },
      websocket: {
        message(ws, message) {
          ws.send(message);
        },
        ping(ws, data) {
          // Bun automatically responds with pong
        },
      },
    });
    port = server.port;
  });

  afterAll(() => {
    server.stop(true);
  });

  test("ws.once('message') works multiple times", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>(resolve => ws.once("open", resolve));

    const messages: string[] = [];

    // First once() listener
    const p1 = new Promise<void>(resolve => {
      ws.once("message", data => {
        messages.push(data.toString());
        resolve();
      });
    });
    ws.send("message1");
    await p1;

    // Second once() listener - this should also work
    const p2 = new Promise<void>(resolve => {
      ws.once("message", data => {
        messages.push(data.toString());
        resolve();
      });
    });
    ws.send("message2");
    await p2;

    // Third once() listener - this should also work
    const p3 = new Promise<void>(resolve => {
      ws.once("message", data => {
        messages.push(data.toString());
        resolve();
      });
    });
    ws.send("message3");
    await p3;

    expect(messages).toEqual(["message1", "message2", "message3"]);

    ws.close();
  });

  test("ws.once('pong') works multiple times", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>(resolve => ws.once("open", resolve));

    let pongCount = 0;

    // First ping/pong
    const p1 = new Promise<void>(resolve => {
      ws.once("pong", () => {
        pongCount++;
        resolve();
      });
    });
    ws.ping();
    await p1;

    // Second ping/pong - this should also work
    const p2 = new Promise<void>(resolve => {
      ws.once("pong", () => {
        pongCount++;
        resolve();
      });
    });
    ws.ping();
    await p2;

    // Third ping/pong - this should also work
    const p3 = new Promise<void>(resolve => {
      ws.once("pong", () => {
        pongCount++;
        resolve();
      });
    });
    ws.ping();
    await p3;

    expect(pongCount).toBe(3);

    ws.close();
  });

  test("ws.on() still works correctly (only one native listener)", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>(resolve => ws.once("open", resolve));

    const messages: string[] = [];
    let messageWaiter: { count: number; resolve: () => void } | null = null;

    const checkWaiter = () => {
      if (messageWaiter && messages.length >= messageWaiter.count) {
        messageWaiter.resolve();
        messageWaiter = null;
      }
    };

    // Add multiple on() listeners - they should all receive every message
    ws.on("message", data => {
      messages.push(`listener1:${data.toString()}`);
      checkWaiter();
    });
    ws.on("message", data => {
      messages.push(`listener2:${data.toString()}`);
      checkWaiter();
    });

    const waitForMessages = (count: number) =>
      new Promise<void>(resolve => {
        if (messages.length >= count) {
          resolve();
        } else {
          messageWaiter = { count, resolve };
        }
      });

    ws.send("test1");
    await waitForMessages(2);

    ws.send("test2");
    await waitForMessages(4);

    // Both listeners should receive both messages
    expect(messages).toContain("listener1:test1");
    expect(messages).toContain("listener2:test1");
    expect(messages).toContain("listener1:test2");
    expect(messages).toContain("listener2:test2");

    ws.close();
  });

  test("mixing on() and once() works correctly", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);

    await new Promise<void>(resolve => ws.once("open", resolve));

    const messages: string[] = [];
    let messageWaiter: { count: number; resolve: () => void } | null = null;

    const checkWaiter = () => {
      if (messageWaiter && messages.length >= messageWaiter.count) {
        messageWaiter.resolve();
        messageWaiter = null;
      }
    };

    // Add a persistent on() listener
    ws.on("message", data => {
      messages.push(`persistent:${data.toString()}`);
      checkWaiter();
    });

    // Add a once() listener
    ws.once("message", data => {
      messages.push(`once:${data.toString()}`);
      checkWaiter();
    });

    const waitForMessages = (count: number) =>
      new Promise<void>(resolve => {
        if (messages.length >= count) {
          resolve();
        } else {
          messageWaiter = { count, resolve };
        }
      });

    ws.send("test1");
    await waitForMessages(2); // Both listeners fire

    ws.send("test2");
    await waitForMessages(3); // Only persistent listener fires

    expect(messages).toContain("persistent:test1");
    expect(messages).toContain("once:test1");
    expect(messages).toContain("persistent:test2");
    expect(messages).not.toContain("once:test2");

    ws.close();
  });
});
