import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

test("req.socket.bytesRead returns non-zero with node:http server", async () => {
  await using proc = Bun.spawn({
    cmd: [
      bunExe(),
      "-e",
      `
      const http = require("node:http");
      const server = http.createServer((req, res) => {
        req.on("end", () => {
          console.log(req.socket.bytesRead);
          res.end("ok");
          server.close();
        });
        req.resume();
      });
      server.listen(0, () => {
        const port = server.address().port;
        const req = http.request({ method: "PUT", port });
        req.write("hello");
        req.end();
      });
      `,
    ],
    env: bunEnv,
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

  const bytesRead = parseInt(stdout.trim(), 10);
  expect(bytesRead).toBeGreaterThan(0);
  expect(exitCode).toBe(0);
});
