import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { EventEmitter, once } from "node:events";
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

  // https://github.com/nodejs/node/blob/v26.3.0/lib/events.js#L649-L654
  test("once() registered before on() does not duplicate events", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    await once(ws, "open");

    const seenByOnce: string[] = [];
    const seenByOn: string[] = [];
    ws.once("message", data => seenByOnce.push(data.toString()));
    ws.on("message", data => {
      seenByOn.push(data.toString());
      if (seenByOn.length === 2) ws.close();
    });
    ws.send("first");
    ws.send("second");
    await once(ws, "close");

    expect({ seenByOnce, seenByOn }).toEqual({ seenByOnce: ["first"], seenByOn: ["first", "second"] });
  });

  test("once('open') registered before on('open') does not duplicate the event", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    const calls: string[] = [];
    ws.once("open", () => calls.push("once"));
    ws.on("open", () => calls.push("on"));
    // A native listener runs after the ones above, so 'close' follows every 'open' delivery.
    ws.addEventListener("open", () => ws.close());
    await once(ws, "close");

    expect(calls).toEqual(["once", "on"]);
  });

  test("once('error') consumes a native error without re-emitting it unhandled", async () => {
    const ws = new WebSocket(`ws://localhost:${port}`);
    let emits = 0;
    EventEmitter.prototype.on.call(ws, "error", () => emits++);
    const errored = once(ws, "error");
    ws.terminate();
    await errored;
    expect(emits).toBe(1);
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

// A second delivery of 'error' finds no listener left, so the emitter throws it as an uncaught exception.
describe.concurrent("ws.once('error') on a refused connection", () => {
  // Runs `register` in its own process and reports what that process saw by the time it exited.
  async function refused(register: string) {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
          const { WebSocket } = require("ws");
          const events = require("node:events");

          const calls = [];
          const uncaught = [];
          process.on("uncaughtException", err => uncaught.push(err.message));
          process.on("exit", () => console.log(JSON.stringify({ calls, uncaught })));

          const listener = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data() {} } });
          const url = "ws://127.0.0.1:" + listener.port;
          listener.stop(true);

          const ws = new WebSocket(url);
          ${register}
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    return { stdout: stdout.trim(), stderr, exitCode };
  }

  const delivered = (calls: string[]) => ({
    stdout: JSON.stringify({ calls, uncaught: [] }),
    stderr: "",
    exitCode: 0,
  });

  test("once('error')", async () => {
    expect(await refused(`ws.once("error", () => calls.push("once"));`)).toEqual(delivered(["once"]));
  });

  test("once('error') then on('error')", async () => {
    const register = `
      ws.once("error", () => calls.push("once"));
      ws.on("error", () => calls.push("on"));
    `;
    expect(await refused(register)).toEqual(delivered(["once", "on"]));
  });

  test("two once('error')", async () => {
    const register = `
      ws.once("error", () => calls.push("first once"));
      ws.once("error", () => calls.push("second once"));
    `;
    expect(await refused(register)).toEqual(delivered(["first once", "second once"]));
  });

  test("on('error') then once('error')", async () => {
    const register = `
      ws.on("error", () => calls.push("on"));
      ws.once("error", () => calls.push("once"));
    `;
    expect(await refused(register)).toEqual(delivered(["on", "once"]));
  });

  test("events.once(ws, 'open')", async () => {
    const register = `
      events.once(ws, "open").then(
        () => calls.push("resolved"),
        () => calls.push("rejected"),
      );
    `;
    expect(await refused(register)).toEqual(delivered(["rejected"]));
  });
});
