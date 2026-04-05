import { describe, expect, test } from "bun:test";
import { decodeFrames, encodeCloseFrame, encodeTextFrame, upgradeHeaders } from "./websocket.helpers";

async function runOnce(label: string): Promise<void> {
  const serverMessages: string[] = [];
  await using server = Bun.serve({
    port: 0,
    fetch(req) {
      if (server.upgrade(req)) return;
      return new Response("Hello World");
    },
    websocket: {
      open(ws) {
        ws.send("Hello World");
      },
      message(_ws, message) {
        serverMessages.push(message as string);
      },
      close(_ws) {
        serverMessages.push("close");
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
  if (res.status !== 101) throw new Error(label + " status=" + res.status);
  const clientMessages: string[] = [];
  const { promise, resolve } = Promise.withResolvers<void>();
  const reader = res.body!.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const msg of decodeFrames(Buffer.from(value))) {
      if (typeof msg === "string") clientMessages.push(msg);
      else {
        clientMessages.push(msg.type);
        if (msg.type === "close") resolve();
      }
    }
  }
  await promise;
  if (serverMessages.join(",") !== "hello,world,bye,close")
    throw new Error(label + " server=" + serverMessages.join(","));
  if (clientMessages.join(",") !== "Hello World,close") throw new Error(label + " client=" + clientMessages.join(","));
}

describe("fetch upgrade stress (roll the dice)", () => {
  test("100 sequential repeats of the original test pattern", async () => {
    const START = Date.now();
    for (let i = 0; i < 100; i++) {
      const startedAt = Date.now();
      try {
        await Promise.race([
          runOnce("seq#" + i),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("seq#" + i + " hung after " + (Date.now() - startedAt) + "ms")), 8000),
          ),
        ]);
      } catch (e) {
        process.stderr.write(
          "[stress] FAIL after " + (i + 1) + " runs in " + (Date.now() - START) + "ms: " + String(e) + "\n",
        );
        throw e;
      }
    }
    process.stderr.write("[stress] all 100 sequential passed in " + (Date.now() - START) + "ms\n");
  }, 120_000);

  test("50 concurrent repeats of the original test pattern", async () => {
    const START = Date.now();
    const results = await Promise.race([
      Promise.all(Array.from({ length: 50 }, (_, i) => runOnce("par#" + i).catch(e => String(e)))),
      new Promise<string[]>((_, reject) =>
        setTimeout(() => reject(new Error("concurrent batch hung after " + (Date.now() - START) + "ms")), 30000),
      ),
    ]);
    const errs = results.filter(r => typeof r === "string");
    if (errs.length) {
      process.stderr.write("[stress] " + errs.length + "/50 failed: " + errs.slice(0, 3).join(" | ") + "\n");
    }
    expect(errs).toHaveLength(0);
  }, 60_000);
});
