// https://github.com/oven-sh/bun/issues/9911
//
// Playwright bundles the real `ws` npm package. The real package performs its
// handshake with `http.request({ Upgrade: "websocket" })` and waits for
// `req.on("upgrade")`, which Bun did not emit. Bun normally intercepts the
// bare "ws" specifier with a native shim, so this test installs the real
// package locally and loads it by path to exercise the node:http upgrade path
// the way Playwright does.
import { expect, setDefaultTimeout, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

// `bun install` of the real ws package can exceed the default 5s timeout on
// slow CI workers.
setDefaultTimeout(60_000);

test("real ws package (via node:http upgrade) connects and round-trips", async () => {
  using dir = tempDir("issue-09911-ws", {
    "package.json": JSON.stringify({ dependencies: { ws: "8.18.3" } }),
    "client.mjs": `
      import { createRequire } from "node:module";
      import net from "node:net";
      import crypto from "node:crypto";
      const require = createRequire(import.meta.url);
      const RealWS = require("./node_modules/ws/index.js");
      if (RealWS === require("ws")) {
        console.error("loaded Bun shim instead of real ws");
        process.exit(2);
      }

      const server = net.createServer(conn => {
        let upgraded = false;
        let buf = Buffer.alloc(0);
        conn.on("data", chunk => {
          if (!upgraded) {
            buf = Buffer.concat([buf, chunk]);
            const i = buf.indexOf("\\r\\n\\r\\n");
            if (i === -1) return;
            upgraded = true;
            const key = /Sec-WebSocket-Key: (.+)\\r\\n/i.exec(buf.toString())[1];
            const accept = crypto.createHash("sha1").update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").digest("base64");
            conn.write("HTTP/1.1 101 Switching Protocols\\r\\nUpgrade: websocket\\r\\nConnection: Upgrade\\r\\nSec-WebSocket-Accept: " + accept + "\\r\\n\\r\\n");
            return;
          }
          conn.write(Buffer.from([0x81, 0x04, 0x70, 0x6f, 0x6e, 0x67]));
        });
      }).listen(0, "127.0.0.1");
      await new Promise(r => server.on("listening", r));

      const ws = new RealWS("ws://127.0.0.1:" + server.address().port);
      ws.on("error", err => { console.error("error: " + err.message); process.exit(1); });
      ws.on("open", () => ws.send("ping"));
      ws.on("message", data => {
        console.log("echo: " + data);
        ws.terminate();
        server.close();
      });
    `,
  });

  await using install = Bun.spawn({
    cmd: [bunExe(), "install"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "ignore",
    stderr: "pipe",
  });
  const installErr = await install.stderr.text();
  if ((await install.exited) !== 0) console.error(installErr);
  expect(await install.exited).toBe(0);

  await using proc = Bun.spawn({
    cmd: [bunExe(), "client.mjs"],
    env: bunEnv,
    cwd: String(dir),
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  if (exitCode !== 0) console.error(stderr);
  expect(stdout.trim()).toBe("echo: pong");
  expect(exitCode).toBe(0);
});
