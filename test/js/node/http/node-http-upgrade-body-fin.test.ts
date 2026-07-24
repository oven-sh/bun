import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("upgrade with a body: a mid-body client FIN closes the upgraded socket and lets server.close() complete", async () => {
  // Like Node's UpgradeStream: a FIN before the request body completes closes
  // the upgraded socket instead of leaving the connection half-open.
  const fixture = /* js */ `
    const http = require("node:http");
    const net = require("node:net");
    const { once } = require("node:events");

    (async () => {
      const server = http.createServer();
      let upgraded;
      const gotUpgrade = new Promise(r => { upgraded = r; });
      let socketClosed;
      const gotSocketClose = new Promise(r => { socketClosed = r; });
      const events = [];
      server.on("upgrade", (req, socket, head) => {
        events.push("upgrade");
        req.on("data", () => {});
        socket.on("end", () => {
          events.push("end");
          socket.write("late", err => events.push("write-cb:" + (err ? err.code : "ok")));
        });
        socket.on("error", err => events.push("error:" + err.code));
        socket.on("close", () => { events.push("close"); socketClosed(); });
        upgraded();
      });
      server.listen(0, "127.0.0.1");
      await once(server, "listening");

      const c = net.connect(server.address().port, "127.0.0.1");
      c.on("error", () => {});
      await once(c, "connect");
      c.write("GET / HTTP/1.1\\r\\nHost: x\\r\\nUpgrade: foo\\r\\nConnection: Upgrade\\r\\nContent-Length: 100\\r\\n\\r\\npartial");
      await gotUpgrade;
      // Half-close the client; the body (100 bytes) is never completed.
      c.end();
      await gotSocketClose;
      c.destroy();

      // server.close() only resolves once pending_requests has reached zero.
      await new Promise((resolve, reject) => {
        server.close(err => err ? reject(err) : resolve());
      });
      console.log(JSON.stringify(events));
      process.exit(0);
    })().catch(err => { console.error(err); process.exit(1); });
  `;
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stderr: "pipe",
    timeout: 20_000,
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect({ stdout: stdout.trim(), stderr, exitCode }).toEqual({
    stdout: JSON.stringify([
      "upgrade",
      "end",
      "write-cb:ERR_STREAM_WRITE_AFTER_END",
      "error:ERR_STREAM_WRITE_AFTER_END",
      "close",
    ]),
    stderr: expect.not.stringContaining("error"),
    exitCode: 0,
  });
}, 30_000);
