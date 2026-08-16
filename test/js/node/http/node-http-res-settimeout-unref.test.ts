import { expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";
import { once } from "node:events";
import http from "node:http";
import type { AddressInfo } from "node:net";

test("client IncomingMessage.setTimeout does not keep the event loop alive", async () => {
  // A child process makes a keep-alive http.get() and calls res.setTimeout(60000).
  // Once the body is consumed there is nothing left to do, so the process must
  // exit immediately instead of waiting for the timeout to fire. Node unrefs the
  // socket timeout timer; Bun's res.setTimeout override must do the same.
  const server = http.createServer((req, res) => {
    res.setHeader("Connection", "keep-alive");
    res.end("hello");
  });
  server.keepAliveTimeout = 60_000;
  await once(server.listen(0, "127.0.0.1"), "listening");
  try {
    const { port } = server.address() as AddressInfo;

    const script = `
      const http = require("http");
      const agent = new http.Agent({ keepAlive: true });
      const req = http.get({ host: "127.0.0.1", port: ${port}, agent }, res => {
        const ret = res.setTimeout(60000, () => {
          process.stdout.write("TIMEOUT_FIRED\\n");
        });
        if (ret !== res) process.stdout.write("BAD_RETURN\\n");
        let body = "";
        res.on("data", d => (body += d));
        res.on("end", () => {
          process.stdout.write("end:" + body + "\\n");
        });
      });
      req.end();
      // If the res.setTimeout timer (or the idle keep-alive socket) is still
      // ref'd after the response completes, this unref'd sentinel will fire
      // and fail the test instead of letting it hang for 60s.
      setTimeout(() => {
        process.stdout.write("STILL_ALIVE\\n");
        process.exit(1);
      }, 2000).unref();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, , exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Debug/ASAN builds print a startup banner to stderr; stdout === "end:hello"
    // and exit 0 are sufficient — a ref'd timer would produce STILL_ALIVE on
    // stdout and exit 1.
    expect(stdout).toBe("end:hello\n");
    expect(exitCode).toBe(0);
  } finally {
    server.closeAllConnections();
    server.close();
  }
});
