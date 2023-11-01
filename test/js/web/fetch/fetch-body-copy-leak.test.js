import { test, expect, describe } from "bun:test";
import { join } from "node:path";
import { bunEnv, bunExe } from "harness";

describe("fetch doesn't leak", () => {
  // This tests for body leakage and Response object leakage.
  async function runTest(compressed, tls) {
    const body = !compressed
      ? new Blob(["some body in here!".repeat(2000000)])
      : new Blob([Bun.deflateSync(crypto.getRandomValues(new Buffer(65123)))]);
    const headers = {
      "Content-Type": "application/octet-stream",
    };
    if (compressed) {
      headers["Content-Encoding"] = "deflate";
    }

    const serveOptions = {
      port: 0,
      fetch(req) {
        return new Response(body, { headers });
      },
    };

    const server = Bun.serve(serveOptions);

    const env = {
      ...bunEnv,
      SERVER: `http://${server.hostname}:${server.port}`,
      BUN_JSC_forceRAMSize: (1024 * 1024 * 64).toString("10"),
    };

    if (compressed) {
      env.COUNT = "5000";
    }

    const proc = Bun.spawn({
      env,
      stderr: "inherit",
      stdout: "inherit",
      cmd: [bunExe(), "--smol", join(import.meta.dir, "fetch-leak-bc-test-fixture.js")],
    });

    const exitCode = await proc.exited;
    server.stop(true);
    expect(exitCode).toBe(0);
  }

  for (let tls of [true, false]) {
    describe(tls ? "tls" : "tcp", () => {
      test("fixture", async () => {
        await runTest(true, tls);
      }, 100000);
    });
  }
});
