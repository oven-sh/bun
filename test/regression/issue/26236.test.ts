import { describe, expect, it } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { createServer, type Socket } from "node:net";

// Issue #26236: bun add crashes with "panic: Assertion failure: Expected metadata to be set"
// when HTTP requests fail before receiving response headers (e.g., connection refused, firewall blocks).
// The fix changes the panic to a graceful error message.

describe("issue #26236 - bun add with network failures", () => {
  it("shows a graceful error instead of panicking when registry connection is refused", async () => {
    // Create a server, capture its port, then close it to get a port that refuses connections
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    server.close();

    // Set up a temp directory with a package.json that points to the closed port
    using dir = tempDir("issue-26236", {
      "package.json": JSON.stringify({
        name: "test-pkg",
        version: "1.0.0",
      }),
      "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${port}/"
`,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "add", "some-package"],
      cwd: String(dir),
      env: bunEnv,
      stderr: "pipe",
      stdout: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should contain an error message about the connection failure
    expect(stderr).toContain("error");

    // Exit code should be non-zero (error)
    expect(exitCode).not.toBe(0);
  });

  it("shows a graceful error when server closes connection before sending headers", async () => {
    // Create a raw TCP server that accepts connections but closes immediately
    // without sending any HTTP response - this triggers null metadata
    const server = createServer((socket: Socket) => {
      // Immediately close the connection without sending anything
      socket.end();
    });

    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;

    try {
      using dir = tempDir("issue-26236-close", {
        "package.json": JSON.stringify({
          name: "test-pkg",
          version: "1.0.0",
        }),
        "bunfig.toml": `
[install]
cache = false
registry = "http://127.0.0.1:${port}/"
`,
      });

      await using proc = Bun.spawn({
        cmd: [bunExe(), "add", "some-package"],
        cwd: String(dir),
        env: bunEnv,
        stderr: "pipe",
        stdout: "pipe",
      });

      const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

      // Should contain an error message
      expect(stderr).toContain("error");

      // Exit code should be non-zero (error)
      expect(exitCode).not.toBe(0);
    } finally {
      server.close();
    }
  });
});
