import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/24229
// https://github.com/oven-sh/bun/issues/5951
//
// Bun's `ws` shim was missing the 'upgrade' and 'unexpected-response' events.
// miniflare's `dispatchFetch` resolves a deferred promise exclusively from
// those two events, so wrangler dev would hang forever on a non-101 response.
//
// Run in a subprocess so the assertions ride the child's exit code — keeps the
// ws client's socket/timer cleanup out of the harness process.
test("ws handshake events: upgrade / unexpected-response", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", SCRIPT],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  if (exitCode !== 0) {
    throw new Error(`child failed (exit ${exitCode})\n--- stdout ---\n${stdout}\n--- stderr ---\n${stderr}`);
  }
  expect(stdout.trim()).toBe("ok");
}, 30_000);

const SCRIPT = /* js */ `
const assert = require("node:assert");
const { createHash } = require("node:crypto");
const { once } = require("node:events");
const { createServer } = require("node:net");
const { WebSocket } = require("ws");

async function rawServer(response) {
  const server = createServer(socket => socket.once("data", () => socket.end(response))).listen(0, "127.0.0.1");
  await once(server, "listening");
  return server;
}

(async () => {
  // 1. non-101 → 'unexpected-response' with status/headers/body + set-cookie array + whitespace trim
  {
    const server = await rawServer(
      "HTTP/1.1 503 Service Unavailable\\r\\n" +
        "Content-Type: text/plain\\r\\n" +
        "Set-Cookie: a=1\\r\\n" +
        "Set-Cookie: b=2\\r\\n" +
        "X-Multi: foo  \\r\\n" +
        "X-Multi:   bar  \\r\\n\\r\\nworkerd starting",
    );
    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    const { promise, resolve } = Promise.withResolvers();
    ws.once("unexpected-response", (req, res) => {
      assert.strictEqual(req, null);
      resolve(res);
    });
    const res = await promise;
    assert.strictEqual(res.statusCode, 503);
    assert.strictEqual(res.statusMessage, "Service Unavailable");
    assert.strictEqual(res.headers["content-type"], "text/plain");
    assert.deepStrictEqual(res.headers["set-cookie"], ["a=1", "b=2"]);
    assert.strictEqual(res.headers["x-multi"], "foo, bar");
    assert.deepStrictEqual(res.rawHeaders, [
      "Content-Type", "text/plain",
      "Set-Cookie", "a=1",
      "Set-Cookie", "b=2",
      "X-Multi", "foo",
      "X-Multi", "bar",
    ]);
    let body = "";
    for await (const chunk of res) body += chunk.toString();
    assert.strictEqual(body, "workerd starting");
    await once(ws, "close");
    server.close();
  }

  // 2. non-101 without 'unexpected-response' listener → 'error' with status in message
  {
    const server = await rawServer("HTTP/1.1 503 Service Unavailable\\r\\n\\r\\n");
    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    const { promise, resolve } = Promise.withResolvers();
    ws.on("error", resolve);
    const err = await promise;
    assert.strictEqual(err.message, "Unexpected server response: 503");
    await once(ws, "close");
    server.close();
  }

  // 3. 101 → 'upgrade' fires BEFORE 'open'
  {
    const server = createServer(socket => {
      let buf = "";
      socket.on("data", chunk => {
        buf += chunk.toString();
        if (buf.indexOf("\\r\\n\\r\\n") === -1) return;
        const keyMatch = buf.match(/sec-websocket-key:\\s*(.+)\\r\\n/i);
        if (!keyMatch) return socket.destroy();
        const accept = createHash("sha1")
          .update(keyMatch[1].trim() + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
          .digest("base64");
        socket.write(
          "HTTP/1.1 101 Switching Protocols\\r\\n" +
            "Upgrade: websocket\\r\\n" +
            "Connection: Upgrade\\r\\n" +
            "Sec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n",
        );
      });
    }).listen(0, "127.0.0.1");
    await once(server, "listening");
    const ws = new WebSocket("ws://127.0.0.1:" + server.address().port);
    const { promise, resolve } = Promise.withResolvers();
    const order = [];
    ws.on("upgrade", res => { order.push("upgrade"); resolve(res); });
    ws.on("open", () => { order.push("open"); ws.close(); });
    const res = await promise;
    assert.strictEqual(res.statusCode, 101);
    assert.ok(typeof res.headers["sec-websocket-accept"] === "string");
    assert.strictEqual((res.headers["upgrade"] || "").toLowerCase(), "websocket");
    await once(ws, "close");
    assert.deepStrictEqual(order, ["upgrade", "open"]);
    server.close();
  }

  console.log("ok");
  process.exit(0);
})().catch(err => {
  console.error(err);
  process.exit(1);
});
`;
