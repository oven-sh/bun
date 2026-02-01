import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

// https://github.com/oven-sh/bun/issues/24127
// socket.destroySoon() is missing from HTTP server upgrade sockets
test("HTTP upgrade socket has destroySoon method", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");
      const server = http.createServer();
      server.on("upgrade", (req, socket, head) => {
        console.log("destroySoon type:", typeof socket.destroySoon);
        if (typeof socket.destroySoon === "function") {
          socket.destroySoon();
          console.log("destroySoon called successfully");
        } else {
          console.log("ERROR: destroySoon is not a function");
          process.exit(1);
        }
        server.close(() => process.exit(0));
      });
      server.listen(0, "127.0.0.1", () => {
        const addr = server.address();
        const req = http.request({
          hostname: "127.0.0.1",
          port: addr.port,
          path: "/ws",
          method: "GET",
          headers: {
            "Upgrade": "websocket",
            "Connection": "Upgrade",
            "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
            "Sec-WebSocket-Version": "13"
          }
        });
        req.end();
      });
      setTimeout(() => process.exit(1), 5000);
      `,
    ],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  expect(stdout).toContain("destroySoon type: function");
  expect(stdout).toContain("destroySoon called successfully");
  expect(stderr).toBe("");
  expect(exitCode).toBe(0);
});
