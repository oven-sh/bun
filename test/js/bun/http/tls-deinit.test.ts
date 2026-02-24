import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tls as validTls } from "harness";
import { join } from "node:path";

describe("HTTPContext.deinit with live keepalive sockets", () => {
  test("process exits cleanly when keepalive sockets are pooled", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), join(import.meta.dir, "tls-deinit-fixture.js")],
      env: {
        ...bunEnv,
        TLS_CERT: validTls.cert,
        TLS_KEY: validTls.key,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("OK");
    if (exitCode !== 0) {
      console.error(stderr);
    }
    expect(exitCode).toBe(0);
  });
});
