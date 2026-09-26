import { spawn } from "bun";
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, isASAN, isDebug } from "harness";
import crypto from "node:crypto";
import net from "node:net";
import stripAnsi from "strip-ansi";

setDefaultTimeout(isASAN || isDebug ? 120_000 : 60_000);

// A frontend that sends Console.enable and then stops reading must not make
// the inspected process buffer every console line forever: the per-connection
// outgoing backlog is bounded and a stalled peer is terminated once it fills.
test("a stalled inspector frontend is disconnected instead of buffering console output unboundedly", async () => {
  // Each Console.messageAdded for a 64 KB string is ~130 KB of JSON, so the
  // inspector's combined per-connection send limit (uWS 16 MB plus the JS-side
  // 32 MB retry buffer) is reached after a few hundred lines. The counter
  // argument keeps every message unique so JSC does not collapse them into
  // messageRepeatCountUpdated. Logging is gated on stdin so every line is
  // emitted after Console.enable has reached the backend, and stops after
  // several times that many lines so a build without the cap plateaus instead
  // of growing until the test times out. RSS is reported per batch so the test
  // can fail fast on unbounded growth rather than waiting for the timeout.
  const app = `
    await new Promise(resolve => process.stdin.once("data", resolve));
    const base = process.memoryUsage.rss();
    const line = Buffer.alloc(65536, "L").toString();
    let i = 0;
    const t = setInterval(() => {
      for (let k = 0; k < 50; k++) console.log(line, i++);
      process.stderr.write("RSS:" + (process.memoryUsage.rss() - base) + "\\n");
      if (i >= 5000) clearInterval(t);
    }, 0);
    setInterval(() => {}, 1 << 30);
  `;

  await using child = spawn({
    cmd: [bunExe(), "--inspect=127.0.0.1:0/stalled", "-e", app],
    env: bunEnv,
    stdin: "pipe",
    stdout: "ignore",
    stderr: "pipe",
  });

  let stderr = "";
  let rssDelta = 0;
  let rssLine = "";
  (async () => {
    for await (const chunk of child.stderr as ReadableStream) {
      const text = new TextDecoder().decode(chunk);
      stderr += stripAnsi(text);
      rssLine += text;
      let nl: number;
      while ((nl = rssLine.indexOf("\n")) !== -1) {
        const line = rssLine.slice(0, nl);
        rssLine = rssLine.slice(nl + 1);
        const m = line.match(/^RSS:(\d+)$/);
        if (m) rssDelta = Math.max(rssDelta, +m[1]);
      }
    }
  })();
  let port = 0;
  while (!port) {
    const m = stderr.match(/ws:\/\/127\.0\.0\.1:(\d+)\/stalled/);
    if (m) {
      port = +m[1];
      break;
    }
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error("inspectee exited before printing the listening URL:\n" + stderr);
    }
    await Bun.sleep(10);
  }

  // Raw TCP so the client can stop reading after the upgrade; a real
  // WebSocket client would drain the socket and never build backpressure.
  const sock = net.connect(port, "127.0.0.1");
  try {
    await new Promise<void>((resolve, reject) => {
      sock.once("connect", () => resolve());
      sock.once("error", reject);
    });
    sock.on("error", () => {});
    let closed = false;
    const closedPromise = new Promise<void>(resolve => {
      sock.once("close", () => {
        closed = true;
        resolve();
      });
    });

    sock.write(
      "GET /stalled HTTP/1.1\r\n" +
        `Host: 127.0.0.1:${port}\r\n` +
        "Upgrade: websocket\r\n" +
        "Connection: Upgrade\r\n" +
        `Sec-WebSocket-Key: ${crypto.randomBytes(16).toString("base64")}\r\n` +
        "Sec-WebSocket-Version: 13\r\n" +
        "\r\n",
    );
    // Read only the handshake response, then stop; the rest piles up in the
    // kernel receive buffer and the inspected process's send buffers.
    await Promise.race([
      new Promise<void>(resolve => {
        sock.once("data", () => {
          sock.pause();
          resolve();
        });
      }),
      closedPromise.then(() => Promise.reject(new Error("socket closed before handshake response:\n" + stderr))),
    ]);

    const sendFrame = (opcode: number, payload: Buffer) => {
      const mask = crypto.randomBytes(4);
      const masked = Buffer.alloc(payload.length);
      for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ mask[i & 3];
      const head =
        payload.length < 126
          ? Buffer.from([0x80 | opcode, 0x80 | payload.length])
          : Buffer.from([0x80 | opcode, 0x80 | 126, payload.length >> 8, payload.length & 255]);
      sock.write(Buffer.concat([head, mask, masked]));
    };

    // Console.enable: the backend now emits Console.messageAdded for every log
    // line toward this socket, which is no longer reading.
    sendFrame(0x1, Buffer.from(JSON.stringify({ id: 1, method: "Console.enable", params: {} })));
    child.stdin.write("go\n");

    // Writes from a stalled reader still reach the peer; once the server
    // terminates the socket (send backlog exceeded), one of these pings
    // surfaces the reset and 'close' fires. Probing by writing avoids waiting
    // on a FIN that would sit behind the peer's full receive buffer.
    const ping = Buffer.from([0x89, 0x80, 0, 0, 0, 0]);
    const rssLimit = 400 * 1024 * 1024;
    while (!closed && rssDelta <= rssLimit) {
      sock.write(ping);
      await Promise.race([closedPromise, Bun.sleep(20)]);
    }
    expect(rssDelta).toBeLessThanOrEqual(rssLimit);
    expect(closed).toBe(true);
    // The frontend was dropped; the inspected process itself must still be
    // running, otherwise a crash would have produced the same observables.
    expect({ exitCode: child.exitCode, signalCode: child.signalCode }).toEqual({ exitCode: null, signalCode: null });
  } finally {
    sock.destroy();
    child.kill("SIGKILL");
  }
});
