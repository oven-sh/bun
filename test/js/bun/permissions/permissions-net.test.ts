import { test, expect, describe } from "bun:test";
import { bunEnv, bunExe, tempDir } from "harness";

describe("Network permissions", () => {
  test("fetch denied in secure mode without --allow-net", async () => {
    using dir = tempDir("perm-net-test", {
      "test.ts": `
        try {
          const response = await fetch("https://example.com");
          console.log("SUCCESS:", response.status);
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("Bun.serve denied in secure mode without --allow-net", async () => {
    using dir = tempDir("perm-serve-test", {
      "test.ts": `
        try {
          const server = Bun.serve({
            port: 0,
            fetch(req) {
              return new Response("Hello");
            },
          });
          console.log("SUCCESS: Server started on port", server.port);
          server.stop();
        } catch (e) {
          console.log("ERROR:", e.message);
          process.exit(1);
        }
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--no-prompt", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout + stderr).toContain("PermissionDenied");
    expect(exitCode).not.toBe(0);
  });

  test("Bun.serve allowed with --allow-net", async () => {
    using dir = tempDir("perm-serve-allow", {
      "test.ts": `
        const server = Bun.serve({
          port: 0,
          fetch(req) {
            return new Response("Hello");
          },
        });
        console.log("SUCCESS: Server started");
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-net", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  });

  test("granular --allow-net=<host> works", async () => {
    using dir = tempDir("perm-net-granular", {
      "test.ts": `
        const server = Bun.serve({
          hostname: "127.0.0.1",
          port: 0,
          fetch(req) {
            return new Response("Hello");
          },
        });
        console.log("SUCCESS: Server started on port", server.port);
        server.stop();
      `,
    });

    await using proc = Bun.spawn({
      cmd: [bunExe(), "--secure", "--allow-net=127.0.0.1", "test.ts"],
      cwd: String(dir),
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });

    const [stdout, stderr, exitCode] = await Promise.all([
      proc.stdout.text(),
      proc.stderr.text(),
      proc.exited,
    ]);

    expect(stdout).toContain("SUCCESS");
    expect(exitCode).toBe(0);
  });
});
