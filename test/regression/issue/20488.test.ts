import { describe, expect, test } from "bun:test";
import { bunEnv, bunExe } from "harness";

describe.concurrent("fetch respects --max-http-header-size", () => {
  test("rejects when response headers exceed the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--max-http-header-size=16384",
        "-e",
        `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response("ok", {
              headers: { "Large-Header": Buffer.alloc(1024 * 18, "a").toString() },
            });
          },
        });
        try {
          const res = await fetch("http://localhost:" + server.port);
          server.stop(true);
          console.log("ERROR: fetch should have thrown but got status " + res.status);
          process.exit(1);
        } catch (e) {
          server.stop(true);
          console.log("CAUGHT: " + e.code);
          process.exit(0);
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("CAUGHT:");
    expect(stdout).toContain("HeaderSizeExceeded");
    expect(exitCode).toBe(0);
  }, 30_000);

  test("succeeds when response headers are within the limit", async () => {
    await using proc = Bun.spawn({
      cmd: [
        bunExe(),
        "--max-http-header-size=32768",
        "-e",
        `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response("ok", {
              headers: { "Large-Header": Buffer.alloc(1024 * 18, "a").toString() },
            });
          },
        });
        try {
          const res = await fetch("http://localhost:" + server.port);
          const text = await res.text();
          server.stop(true);
          console.log("OK: " + text);
          process.exit(0);
        } catch (e) {
          server.stop(true);
          console.log("ERROR: " + e.message);
          process.exit(1);
        }
        `,
      ],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);

    expect(stdout).toContain("OK: ok");
    expect(exitCode).toBe(0);
  }, 30_000);
});
