// https://github.com/oven-sh/bun/issues/13087
// supertest starts an ephemeral http.Server via `app.listen(0)` and closes it
// only when `server._handle` is truthy. Bun's http.Server never populated
// `_handle`, so supertest never called `server.close()` and the process hung.
import { test, expect } from "bun:test";
import { bunEnv, bunExe } from "harness";

const fixture = /* js */ `
  const http = require("node:http");
  const server = http.createServer((req, res) => res.end("hi"));
  server.listen(0, () => {
    const port = server.address().port;
    http.get("http://127.0.0.1:" + port + "/", (res) => {
      res.resume();
      res.on("end", () => {
        // supertest's end(): if (server && server._handle) return server.close(cb); cb();
        const done = () => console.log("done", server._handle == null ? "ok" : "leaked");
        if (server && server._handle) server.close(done);
        else done();
      });
    });
  });
`;

test.concurrent("process exits after supertest-style server._handle gated close()", async () => {
  await using proc = Bun.spawn({
    cmd: [bunExe(), "-e", fixture],
    env: bunEnv,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
  expect(stderr).toBe("");
  expect(stdout.trim()).toBe("done ok");
  expect(exitCode).toBe(0);
});
