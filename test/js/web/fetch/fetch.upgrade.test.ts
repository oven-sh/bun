import { describe, expect, test } from "bun:test";
import { decodeFrames, encodeCloseFrame, encodeTextFrame, upgradeHeaders } from "./websocket.helpers";

describe("fetch upgrade", () => {
  test("should upgrade to websocket", async () => {
    const serverMessages: string[] = [];
    const serverClosed = Promise.withResolvers<void>();

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        if (server.upgrade(req)) return;
        return new Response("Hello World");
      },
      websocket: {
        open(ws) {
          ws.send("Hello World");
        },
        message(ws, message) {
          serverMessages.push(message as string);
        },
        close(ws) {
          serverMessages.push("close");
          serverClosed.resolve();
        },
      },
    });
    const res = await fetch(server.url, {
      method: "GET",
      headers: upgradeHeaders(),
      async *body() {
        yield encodeTextFrame("hello");
        yield encodeTextFrame("world");
        yield encodeTextFrame("bye");
        yield encodeCloseFrame();
      },
    });
    expect(res.status).toBe(101);
    expect(res.headers.get("upgrade")).toBe("websocket");
    expect(res.headers.get("sec-websocket-accept")).toBeString();
    expect(res.headers.get("connection")).toBe("Upgrade");

    const clientMessages: string[] = [];
    const reader = res.body!.getReader();
    let buffered = Buffer.alloc(0);
    let gotClose = false;

    while (!gotClose) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered = Buffer.concat([buffered, Buffer.from(value)]);
      const { messages, remaining } = decodeFrames(buffered);
      buffered = remaining;
      for (const msg of messages) {
        if (typeof msg === "string") {
          clientMessages.push(msg);
        } else {
          clientMessages.push(msg.type);
          if (msg.type === "close") {
            gotClose = true;
          }
        }
      }
    }

    await serverClosed.promise;

    expect(serverMessages).toEqual(["hello", "world", "bye", "close"]);
    expect(clientMessages).toEqual(["Hello World", "close"]);
  });
});
