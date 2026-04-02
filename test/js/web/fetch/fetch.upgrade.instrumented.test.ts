import { describe, expect, test } from "bun:test";
import { decodeFrames, encodeCloseFrame, encodeTextFrame, upgradeHeaders } from "./websocket.helpers";

describe("fetch upgrade (instrumented)", () => {
  test("should upgrade to websocket — instrumented", async () => {
    const log = (msg: string) => process.stderr.write("[trace] " + msg + "\n");
    const serverMessages: string[] = [];
    log("creating server");
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        log("server.fetch hit");
        if (server.upgrade(req)) return;
        return new Response("Hello World");
      },
      websocket: {
        open(ws) {
          log("ws.open");
          ws.send("Hello World");
        },
        message(_ws, message) {
          log("ws.message=" + message);
          serverMessages.push(message as string);
        },
        close(_ws) {
          log("ws.close");
          serverMessages.push("close");
        },
      },
    });
    log("server up at " + server.url.href);

    log("calling fetch");
    const res = await fetch(server.url, {
      method: "GET",
      headers: upgradeHeaders(),
      async *body() {
        log("yield hello");
        yield encodeTextFrame("hello");
        log("yield world");
        yield encodeTextFrame("world");
        log("yield bye");
        yield encodeTextFrame("bye");
        log("yield close-frame");
        yield encodeCloseFrame();
        log("body generator done");
      },
    });
    log("fetch resolved status=" + res.status);
    expect(res.status).toBe(101);

    const clientMessages: string[] = [];
    const { promise, resolve } = Promise.withResolvers<void>();
    const reader = res.body!.getReader();
    log("starting reader loop");
    let chunks = 0;
    while (true) {
      log("reader.read() awaiting chunk #" + chunks);
      const { value, done } = await reader.read();
      log("reader.read() returned done=" + done + " bytes=" + (value?.length ?? 0));
      if (done) break;
      chunks++;
      for (const msg of decodeFrames(Buffer.from(value))) {
        if (typeof msg === "string") {
          log("decoded text=" + msg);
          clientMessages.push(msg);
        } else {
          log("decoded type=" + msg.type);
          clientMessages.push(msg.type);
        }
        if (msg.type === "close") {
          log("calling resolve()");
          resolve();
        }
      }
    }
    log("loop exited, awaiting promise");
    await promise;
    log("promise resolved, asserting");
    expect(serverMessages).toEqual(["hello", "world", "bye", "close"]);
    expect(clientMessages).toEqual(["Hello World", "close"]);
    log("done");
  }, 30_000);
});
