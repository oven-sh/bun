import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("issue #26724: verbose fetch logging should not be enabled by default", () => {
  test("fetch should not output verbose logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    // Start a local test server
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    using dir = tempDir("issue-26724", {
      "test.ts": `
        const url = process.argv[2];
        const response = await fetch(url);
        console.log("status:", response.status);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "test.ts", `http://localhost:${server.port}/get`],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: undefined, // Explicitly ensure it's not set
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not contain verbose fetch output (> or [fetch])
    expect(stderr).not.toContain("[fetch]");
    expect(stderr).not.toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("fetch should output verbose logs when BUN_CONFIG_VERBOSE_FETCH=1", async () => {
    // Start a local test server
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    using dir = tempDir("issue-26724-verbose", {
      "test.ts": `
        const url = process.argv[2];
        const response = await fetch(url);
        console.log("status:", response.status);
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "test.ts", `http://localhost:${server.port}/get`],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: "1",
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should contain verbose fetch output
    expect(stderr + stdout).toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("node:http requests should not output verbose logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    // Start a local test server
    using server = Bun.serve({
      port: 0,
      fetch() {
        return new Response(JSON.stringify({ status: "ok" }), {
          headers: { "Content-Type": "application/json" },
        });
      },
    });

    using dir = tempDir("issue-26724-nodehttp", {
      "test.ts": `
        import http from 'node:http';

        const port = parseInt(process.argv[2], 10);

        const options = {
          hostname: 'localhost',
          port: port,
          path: '/get',
          method: 'GET',
        };

        const req = http.request(options, (res) => {
          let data = '';
          res.on('data', (chunk) => { data += chunk; });
          res.on('end', () => {
            console.log('status:', res.statusCode);
          });
        });

        req.on('error', (err) => {
          console.error('error:', err.message);
        });

        req.end();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "run", "test.ts", String(server.port)],
      env: {
        ...bunEnv,
        BUN_CONFIG_VERBOSE_FETCH: undefined, // Explicitly ensure it's not set
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not contain verbose fetch output (> or [fetch])
    expect(stderr).not.toContain("[fetch]");
    expect(stderr).not.toContain("> HTTP/1.1");
    expect(stdout).toContain("status: 200");
    expect(exitCode).toBe(0);
  });

  test("bun test should not output verbose fetch logs without BUN_CONFIG_VERBOSE_FETCH", async () => {
    // Start a local test server
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
        BUN_CONFIG_VERBOSE_FETCH: undefined, // Explicitly ensure it's not set
        TEST_SERVER_URL: `http://localhost:${server.port}/get`,
      },
      cwd: String(dir),
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    // Should not contain verbose fetch output (> or [fetch])
    const output = stdout + stderr;
    expect(output).not.toContain("[fetch]");
    expect(output).not.toContain("> HTTP/1.1");
    expect(output).toContain("1 pass");
    expect(exitCode).toBe(0);
  });
});
