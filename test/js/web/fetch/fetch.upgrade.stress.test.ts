import { describe, expect, test } from "bun:test";
import { decodeFrames, encodeCloseFrame, encodeTextFrame, upgradeHeaders } from "./websocket.helpers";

const PADDING = "x".repeat(256);
const BIG_HEADERS = (() => {
  const h: Record<string, string> = upgradeHeaders();
  for (let i = 0; i < 8; i++) h["X-Padding-" + i] = PADDING;
  return h;
})();

async function runOnce(): Promise<{ server: string[]; client: string[]; status: number }> {
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
    headers: BIG_HEADERS,
    async *body() {
      yield encodeTextFrame("hello");
      yield encodeTextFrame("world");
      yield encodeTextFrame("bye");
      yield encodeCloseFrame();
    },
  });
  if (res.status !== 101) throw new Error("expected 101, got " + res.status);
  const clientMessages: string[] = [];
  const reader = res.body!.getReader();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    let sawClose = false;
    for (const msg of decodeFrames(Buffer.from(value))) {
      if (typeof msg === "string") clientMessages.push(msg);
      else {
        clientMessages.push(msg.type);
        if (msg.type === "close") sawClose = true;
      }
    }
    if (sawClose) break;
  }
  return { server: serverMessages, client: clientMessages, status: res.status };
}

async function runOnceMixed(server: any, sharedUrl: URL): Promise<{ ok: boolean; reason?: string }> {
  const res = await fetch(sharedUrl, {
    method: "GET",
    headers: BIG_HEADERS,
    async *body() {
      yield encodeTextFrame("hello");
      yield encodeTextFrame("world");
      yield encodeTextFrame("bye");
      yield encodeCloseFrame();
    },
  });
  if (res.status !== 101) return { ok: false, reason: "status=" + res.status };
  const reader = res.body!.getReader();
  let sawClose = false;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    for (const msg of decodeFrames(Buffer.from(value))) {
      if (typeof msg !== "string" && msg.type === "close") {
        sawClose = true;
        break;
      }
    }
    if (sawClose) break;
  }
  return sawClose ? { ok: true } : { ok: false, reason: "missing close frame" };
}

describe("fetch upgrade stress (shared-server cork-pressure)", () => {
  test("shared server, 200 concurrent upgrades, mixed with HTTP traffic", async () => {
    let serverHits = 0;
    await using server = Bun.serve({
      port: 0,
      fetch(req) {
        serverHits++;
        if (server.upgrade(req)) return;
        return new Response("Hello World");
      },
      websocket: {
        open(ws) {
          ws.send("Hello World");
        },
        message(_ws, _m) {},
        close(_ws) {},
      },
    });
    const url = new URL(server.url);
    const N = 200;
    const httpNoise = Array.from({ length: 100 }, () =>
      fetch(new URL("/noise", server.url))
        .then(r => r.text())
        .catch(() => null),
    );
    const upgrades = Array.from({ length: N }, () =>
      runOnceMixed(server, url).catch(e => ({ ok: false, reason: String(e) })),
    );
    const all = await Promise.race([
      Promise.all([...upgrades, ...httpNoise]),
      new Promise<any[]>((_, reject) =>
        setTimeout(() => reject(new Error("hang 30s — first " + N + " entries are upgrades")), 30000),
      ),
    ]);
    const upgradeResults = (all as any[]).slice(0, N);
    const failures = upgradeResults.filter(r => r && !r.ok);
    if (failures.length) {
      console.error("failures:", failures.length, "/", N, "first 3:", JSON.stringify(failures.slice(0, 3)));
    }
    expect(failures).toHaveLength(0);
  });
});
