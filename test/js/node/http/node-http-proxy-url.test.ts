import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, nodeExe, normalizeBunSnapshot } from "harness";
import { join } from "node:path";

describe("HTTP server with proxy-style absolute URLs", () => {
  test("tests should run on node.js", async () => {
    await using process = Bun.spawn({
      cmd: [nodeExe(), "--test", join(import.meta.dir, "node-http-proxy-url.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
  test("tests should run on bun", async () => {
    await using process = Bun.spawn({
      cmd: [bunExe(), "test", join(import.meta.dir, "node-http-proxy-url.node.mts")],
      stdout: "inherit",
      stderr: "inherit",
      stdin: "ignore",
      env: bunEnv,
    });
    expect(await process.exited).toBe(0);
  });
});

describe("https request through a proxy agent", () => {
  test("rejects a request host containing CR or LF with ERR_INVALID_CHAR", async () => {
    const script = `
      const net = require("node:net");
      const https = require("node:https");
      const server = net.createServer(socket => socket.destroy());
      server.listen(0, "127.0.0.1", () => {
        const proxyUrl = "http://127.0.0.1:" + server.address().port;
        const agent = new https.Agent({ proxyEnv: { https_proxy: proxyUrl } });
        let req;
        try {
          req = https.request({
            host: "127.0.0.1\\r\\nx-extra: 1",
            port: 443,
            agent,
            headers: { host: "127.0.0.1" },
          });
          console.log("no-error");
        } catch (err) {
          console.log(err.code);
        }
        if (req) {
          req.on("error", () => {});
          req.destroy();
        }
        agent.destroy();
        server.close();
      });
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect({ stdout: normalizeBunSnapshot(stdout), exitCode }).toEqual({
      stdout: "ERR_INVALID_CHAR",
      exitCode: 0,
    });
  });
});
