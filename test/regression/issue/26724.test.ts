import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";
import { join } from "path";

// Issue #26724: verbose [fetch] logging appears in bun test without BUN_CONFIG_VERBOSE_FETCH set
//
// The root cause was that fetch.zig checked vm.log.level.atLeast(.debug) before checking
// the BUN_CONFIG_VERBOSE_FETCH environment variable. This caused verbose logging to be
// enabled whenever the VM's log level was debug or lower, regardless of user preference.
//
// The fix ensures verbose fetch logging is ONLY enabled via explicit opt-in:
// 1. BUN_CONFIG_VERBOSE_FETCH environment variable
// 2. explicit `verbose: true` or `verbose: "curl"` option in fetch options
//
// Note: The original bug manifested specifically with testcontainers/dockerode patterns
// which couldn't be easily reproduced without Docker. These tests validate the core
// behavior that verbose logging respects the environment variable.

describe("issue #26724: verbose fetch logging should not be enabled by default", () => {
  test("fetch should not output verbose logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const script = `const response = await fetch("http://localhost:${server.port}/get"); console.log("status:", response.status);`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("[fetch]");
    expect(stderr).not.toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("fetch should output verbose logs when BUN_CONFIG_VERBOSE_FETCH=1", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    const script = `const response = await fetch("http://localhost:${server.port}/get"); console.log("status:", response.status);`;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: "1",
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr + stdout).toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("node:http requests over unix socket should not output verbose logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    using dir = tempDir("issue-26724-unix", {});
    const socketPath = join(String(dir), "test.sock");

    using server = Bun.serve({
      unix: socketPath,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    // Use node:http with socketPath - this is the pattern used by dockerode/testcontainers
    const script = `
      import http from 'node:http';
      const options = {
        socketPath: ${JSON.stringify(socketPath)},
        path: '/info',
        method: 'GET',
      };
      const req = http.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => { console.log('status:', res.statusCode); });
      });
      req.on('error', (err) => { console.error('error:', err.message); });
      req.end();
    `;

    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", script],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: undefined,
      },
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stderr).not.toContain("[fetch]");
    expect(stderr).not.toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("bun test should not output verbose fetch logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    using dir = tempDir("issue-26724-buntest", {
      "fetch.test.ts": `
        import { test, expect } from "bun:test";

        const url = process.env.TEST_SERVER_URL;

        test("fetch works", async () => {
          const response = await fetch(url!);
          expect(response.status).toBe(200);
        });
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "test", "fetch.test.ts"],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: undefined,
        TEST_SERVER_URL: `http://localhost:${server.port}/get`,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const output = stdout + stderr;
    expect(output).not.toContain("[fetch]");
    expect(output).not.toContain("> HTTP/1.1");
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
