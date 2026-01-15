import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("--max-http-header-count", () => {
  test("http.maxHeadersCount getter returns default value", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", "console.log(require('http').maxHeadersCount)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("100");
    expect(exitCode).toBe(0);
  });

  test("http.maxHeadersCount setter works", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "-e",
        `
        const http = require('http');
        console.log(http.maxHeadersCount);
        http.maxHeadersCount = 500;
        console.log(http.maxHeadersCount);
      `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    const lines = stdout.trim().split("\n");
    expect(lines[0]).toBe("100");
    expect(lines[1]).toBe("500");
    expect(exitCode).toBe(0);
  });

  test("--max-http-header-count CLI flag sets the value", async () => {
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--max-http-header-count=200", "-e", "console.log(require('http').maxHeadersCount)"],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout.trim()).toBe("200");
    expect(exitCode).toBe(0);
  });

  test("server accepts requests with many headers when limit is increased", async () => {
    using dir = tempDir("header-count-test", {
      "server.ts": `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const count = [...req.headers].length;
            return new Response(String(count));
          },
        });
        console.log(server.url.href);
      `,
    });

    // Start server with higher header limit
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--max-http-header-count=200", "server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read server URL from stdout
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const url = new TextDecoder().decode(value).trim();

    // Build request with 150 headers
    const headers = new Headers();
    for (let i = 0; i < 150; i++) {
      headers.set(`X-Custom-Header-${i}`, `value-${i}`);
    }

    const res = await fetch(url, { headers });
    expect(res.status).toBe(200);
    const count = parseInt(await res.text());
    // Account for default headers that fetch adds (Host, Accept, etc.)
    expect(count).toBeGreaterThanOrEqual(150);

    proc.kill();
  });

  test("server rejects requests with too many headers", async () => {
    using dir = tempDir("header-count-reject-test", {
      "server.ts": `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            const count = [...req.headers].length;
            return new Response(String(count));
          },
        });
        console.log(server.url.href);
      `,
    });

    // Start server with low header limit (50)
    await using proc = Bun.spawn({
      cmd: [bunExe(), "--max-http-header-count=50", "server.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    // Read server URL from stdout
    const reader = proc.stdout.getReader();
    const { value } = await reader.read();
    reader.releaseLock();
    const url = new TextDecoder().decode(value).trim();

    // Build request with 60 headers (exceeds limit)
    const headers = new Headers();
    for (let i = 0; i < 60; i++) {
      headers.set(`X-Custom-Header-${i}`, `value-${i}`);
    }

    const res = await fetch(url, { headers });
    // Should get 431 Request Header Fields Too Large
    expect(res.status).toBe(431);

    proc.kill();
  });
});
